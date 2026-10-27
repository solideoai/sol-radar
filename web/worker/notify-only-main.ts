import { readDeadlineSettings } from "@/worker/deadline-reminders";
import { readWorkerEnv } from "@/worker/env";
import { errorNameOf } from "@/worker/error-name";
import { readRunMode } from "@/worker/ingest-queue";
import {
  createRegisteredWorker,
  deadlineWorkerRegistration,
  defaultWorkerDeps,
  notifyWorkerRegistration,
  startWorker,
  type WorkerDeps,
} from "@/worker/main";
import { readKakaoSettings, readNotifySettings, type KakaoSettings } from "@/worker/notify-outbox";

// ── notify 전용 worker(2026-10-27 알림 처리). 회사 서버에서 ingest·analysis·documents 전용 worker 와 따로 알림만 처리한다 ──
// 등록은 둘이다: notifyWorkerRegistration(outbox_events 의 인앱 두 종 REVIEW_ASSIGNED·ANALYSIS_COMPLETE 와 카카오 두 종
// BID_RECOMMENDED·KAKAO_TEST, 기본 2초마다 50건)과 deadlineWorkerRegistration(관심·담당 공고 D-3·D-1 인앱 알림, 기본 5분마다).
// 수집·분석·documents·부처 공고·의존성 보고·Storage 정리는 넣지 않는다. 의존성 보고를 넣으면 다른 모드의 보고를 덮을 수 있다.
//
// Redis: 두 등록은 Redis 를 쓰지 않는다(outbox 표와 DB 함수만 service role 로 부른다, notify-outbox.ts·deadline-reminders.ts 머리 주석).
// 그래도 공용 기동 단계를 그대로 쓰므로 Redis 에 닿아야 뜬다 — readWorkerEnv 가 REDIS_URL 을 요구하고, 준비 확인이 Redis 를 ping 하고,
// createRegisteredWorker 가 공유 연결 하나를 열어 둔다(큐·키는 만들지 않는다). 그래서 Compose 는 기존 Redis network 에 붙는다.
//
// live 에서만 뜬다. mock·fixture 는 빈 NOTIFY_KAKAO_PROVIDER 를 mock 으로 읽는다. 그 상태로 운영 DB 를 보면 흉내 발송이
// 사람·공고마다 영속 claim 을 잡아, 나중에 memo 로 바꿔도 그 공고는 그 사람에게 다시 보내지 않는다.
// live 에서 NOTIFY_KAKAO_PROVIDER 가 비면 카카오 발송은 꺼진다(notify-outbox.ts readKakaoSettings). 카카오 이벤트는 claim·발송 없이
// 재시도(5·10·20·40초)를 거쳐 다섯 번째에 DEAD 가 된다(약 80초). 인앱·마감 알림은 그대로 나간다.
//
// 전체 worker(main.ts)와 같은 DB 에서 함께 돌 때(둘 다 같은 두 등록을 가진다):
//   인앱 — 두 프로세스가 같은 이벤트를 골라도 알림 행은 idempotency_key unique 와 ignoreDuplicates 로 한 건이고, 이벤트 상태는
//          읽은 (id·status·attempts) 가 그대로일 때만 바꾸므로 한쪽만 바뀐다(server/notifications/outbox.repo.ts).
//   카카오 — 보내기 전에 사람·공고마다(claim_kakao_notification), 시험은 이벤트마다(claim_kakao_test) kakao_send_claims 에
//          영속 claim 을 남기고 claim 을 얻은 쪽만 보낸다(migration 20261023000704). 같은 통을 두 번 보내지 않는다.
//   마감 — send_deadline_reminders 가 on conflict (idempotency_key) do nothing 이라 한 건이다(migration 20261022000110).
//   그래서 중복 발송은 없다. 다만 두 프로세스의 카카오 설정이 다르면 섞인다. mock 쪽이 claim 을 먼저 잡으면 실제로 안 간 카카오가
//   SENT 로 남고, 꺼진 쪽은 시도 수를 올려 DEAD 를 앞당긴다. memo 의 같은 사용자 1초 간격도 프로세스마다 따로 센다.
//   그래서 전체 worker 와 함께 띄우지 않는다.
//
// 명령: (없음) 기동 · --check 설정 확인(Redis·Supabase·카카오를 부르지 않는다)

type Env = Record<string, string | undefined>;
export type ShutdownSignal = "SIGTERM" | "SIGINT";

export type NotifyOnlyDeps = {
  workerDeps: WorkerDeps;
  onSignal: (signal: ShutdownSignal, listener: () => void) => void;
  exit: (code: number) => void;
  log: (line: string) => void;
  logError: (line: string) => void;
};

export const defaultNotifyOnlyDeps: NotifyOnlyDeps = {
  workerDeps: {
    ...defaultWorkerDeps,
    createWorker: createRegisteredWorker([notifyWorkerRegistration, deadlineWorkerRegistration]),
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

const USAGE = "사용법: notify-only-main.ts [--check]";

/** 카카오 발송 수단마다 --check·기동 로그에 남길 설명. env 값은 싣지 않는다. */
const KAKAO_LABELS: Record<KakaoSettings["provider"], string> = {
  disabled: "꺼짐(NOTIFY_KAKAO_PROVIDER 빈 값. 카카오 이벤트는 재시도 뒤 DEAD)",
  mock: "mock(실제로 보내지 않고 SENT 로 적는다)",
  memo: "memo(카카오 나에게 보내기 실발송)",
};

function assertLiveRunMode(env: Env): void {
  if (readRunMode(env) !== "live") {
    throw new Error("notify 전용 worker 는 SOL_RUN_MODE=live 에서만 실행한다");
  }
}

/** 기동 1단계와 같은 설정을 읽는다. 숫자 설정과 발송 수단 이름만 알린다(env 값·키·URL 은 싣지 않는다) */
function describeSettings(env: Env): string[] {
  assertLiveRunMode(env);
  readWorkerEnv(env);
  const notify = readNotifySettings(env);
  const kakao = readKakaoSettings(env);
  const deadline = readDeadlineSettings(env);
  return [
    `알림 outbox: ${notify.intervalMs}ms 마다 최대 ${notify.batchLimit}건(인앱 REVIEW_ASSIGNED·ANALYSIS_COMPLETE, 카카오 BID_RECOMMENDED·KAKAO_TEST)`,
    `카카오 발송: ${KAKAO_LABELS[kakao.provider]}`,
    `마감 알림: ${deadline.intervalMs}ms 마다(KST 09:00 뒤 그날 D-3·D-1, 관심 등록자·최신 결정 담당자)`,
  ];
}

async function startNotifyOnly(env: Env, deps: NotifyOnlyDeps): Promise<void> {
  for (const line of describeSettings(env)) deps.log(line);
  const handle = await startWorker(env, deps.workerDeps);
  deps.log("notify-only worker started: SOL_RUN_MODE=live");
  // SIGTERM 뒤 SIGINT 가 와도 close 는 한 번만 부른다. close 는 진행 중 회차를 등록마다 최대 5초 기다린다.
  let isClosing = false;
  const shutdown = () => {
    if (isClosing) return;
    isClosing = true;
    handle.close().then(
      () => deps.exit(0),
      (error: unknown) => {
        deps.logError(`notify-only worker 종료 실패: ${errorNameOf(error)}`);
        deps.exit(1);
      },
    );
  };
  deps.onSignal("SIGTERM", shutdown);
  deps.onSignal("SIGINT", shutdown);
}

export async function runNotifyOnly(
  argv: readonly string[],
  env: Env,
  deps: NotifyOnlyDeps = defaultNotifyOnlyDeps,
): Promise<void> {
  try {
    if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--check")) throw new Error(USAGE);
    if (argv[0] === "--check") {
      for (const line of describeSettings(env)) deps.log(line);
      deps.log("notify-only worker 확인 통과: SOL_RUN_MODE=live");
      deps.exit(0);
      return;
    }
    await startNotifyOnly(env, deps);
  } catch (error) {
    // 메시지는 env 이름·구성요소 이름만 담는다(readWorkerEnv·readRunMode·설정 읽기·checkReadiness).
    deps.logError(error instanceof Error ? error.message : "notify-only worker 실패");
    deps.exit(1);
  }
}

// 테스트가 불러올 때는 자동 기동하지 않는다.
if (/[\\/]worker[\\/]notify-only-main\.ts$/.test(process.argv[1] ?? "")) {
  void runNotifyOnly(process.argv.slice(2), process.env);
}
