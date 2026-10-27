import { readParseConfig } from "@/server/analysis";
import { readDocumentsSettings, readStorageSettings } from "@/server/documents";
import { createDocumentsWorkerRegistration } from "@/worker/documents-job";
import { readWorkerEnv } from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { readRunMode } from "@/worker/ingest-queue";
import {
  createRegisteredWorker,
  defaultWorkerDeps,
  startWorker,
  type WorkerDeps,
} from "@/worker/main";

// ── documents 전용 worker(2026-10-27 첨부 처리). 회사 서버에서 ingest 전용·analysis 전용 worker 와 따로 첨부만 처리한다 ──
// documents 등록 하나만 돈다: documents 큐 소비자(내려받기 → Storage → gateway /parse → 텍스트 Storage)와
// 처리 범위 복구 회차(DB 의 PENDING 첨부를 60초마다 큐에 넣는다). 수집·분석·알림·의존성 보고·Storage 정리는 넣지 않는다.
// 전체 worker(main.ts)도 같은 등록을 가지므로 같은 Redis 에서 둘을 함께 띄우지 않는다. 함께 떠도 문서마다 DB 리스와
// jobId 중복 제거가 있어 같은 첨부를 두 번 처리하지는 않지만, 나라장터 요청 간격이 프로세스마다 따로라 간격이 반으로 준다.
//
// 명령: (없음) 기동 · --check 설정 확인(Redis·Supabase·gateway·나라장터를 부르지 않는다)

type Env = Record<string, string | undefined>;
export type ShutdownSignal = "SIGTERM" | "SIGINT";

export type DocumentsOnlyDeps = {
  workerDeps: WorkerDeps;
  onSignal: (signal: ShutdownSignal, listener: () => void) => void;
  exit: (code: number) => void;
  log: (line: string) => void;
  logError: (line: string) => void;
};

export const defaultDocumentsOnlyDeps: DocumentsOnlyDeps = {
  workerDeps: {
    ...defaultWorkerDeps,
    createWorker: createRegisteredWorker([createDocumentsWorkerRegistration()]),
  },
  onSignal: (signal, listener) => {
    process.once(signal, listener);
  },
  exit: (code) => {
    process.exit(code);
  },
  log: (line) => {
    console.log(line);
  },
  logError: (line) => {
    console.error(line);
  },
};

const USAGE = "사용법: documents-only-main.ts [--check]";

// mock·fixture 에서는 documents 등록이 소비자를 만들지 않는다. 전용 worker 를 그 모드로 띄우는 것은 설정 실수다.
function assertLiveRunMode(env: Env): void {
  if (readRunMode(env) !== "live") {
    throw new Error("documents 전용 worker 는 SOL_RUN_MODE=live 에서만 실행한다");
  }
}

/** 기동 1단계와 같은 설정을 읽는다. 값은 숫자 설정만 알린다(env 값·키·URL 은 싣지 않는다) */
function describeSettings(env: Env): string[] {
  assertLiveRunMode(env);
  const settings = readDocumentsSettings(env);
  readParseConfig(env);
  const storage = readStorageSettings(env);
  readWorkerEnv(env);
  return [
    `documents 처리 범위: 공고당 ${settings.maxPerBid}건, 회차(60초)당 revision ${settings.roundMaxRevisions}개`,
    `나라장터 요청 간격 ${settings.fetchIntervalMs}ms, 동시 처리 ${settings.concurrency}, 리스 ${settings.leaseSeconds}초`,
    `Storage 버킷: 원본 ${storage.rawBucket}, 텍스트 ${storage.parsedBucket}`,
  ];
}

async function startDocumentsOnly(env: Env, deps: DocumentsOnlyDeps): Promise<void> {
  for (const line of describeSettings(env)) deps.log(line);
  const handle = await startWorker(env, deps.workerDeps);
  deps.log("documents-only worker started: SOL_RUN_MODE=live");
  // SIGTERM 뒤 SIGINT 가 와도 close 는 한 번만 부른다. close 는 진행 중 job 이 끝나기를 기다린다.
  let isClosing = false;
  const shutdown = () => {
    if (isClosing) return;
    isClosing = true;
    handle.close().then(
      () => deps.exit(0),
      (error: unknown) => {
        deps.logError(`documents-only worker 종료 실패: ${errorNameOf(error)}`);
        deps.exit(1);
      },
    );
  };
  deps.onSignal("SIGTERM", shutdown);
  deps.onSignal("SIGINT", shutdown);
}

export async function runDocumentsOnly(
  argv: readonly string[],
  env: Env,
  deps: DocumentsOnlyDeps = defaultDocumentsOnlyDeps,
): Promise<void> {
  try {
    if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) throw new Error(USAGE);
    if (argv[0] === "--check") {
      for (const line of describeSettings(env)) deps.log(line);
      deps.log("documents-only worker 확인 통과: SOL_RUN_MODE=live");
      deps.exit(0);
      return;
    }
    await startDocumentsOnly(env, deps);
  } catch (error) {
    // 메시지는 env 이름·구성요소 이름만 담는다(readWorkerEnv·readRunMode·설정 읽기·checkReadiness).
    deps.logError(error instanceof Error ? error.message : "documents-only worker 실패");
    deps.exit(1);
  }
}

// 테스트가 불러올 때는 자동 기동하지 않는다.
if (/[\\/]worker[\\/]documents-only-main\.ts$/.test(process.argv[1] ?? "")) {
  void runDocumentsOnly(process.argv.slice(2), process.env);
}
