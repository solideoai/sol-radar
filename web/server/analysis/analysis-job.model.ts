import "server-only";
import { z } from "zod";
import type { AiProvider, AnalysisContext, RunMode } from "./analysis.model";
import type { GatewayHealth, GatewayResult } from "./gateway.model";

// ── analysis 큐 계약과 처리 설정: Route Handler(C6)와 worker 가 함께 쓰는 순수 규칙 (03 §2.1·§3.3, 02 장애 원칙) ──
// 화면 쪽은 worker 를 import 할 수 없으므로 큐 이름·job 데이터·옵션·jobId 는 도메인에 둔다.
// gateway·큐·DB 는 부르지 않는다. 읽기·상태 port 의 구현(Supabase)은 라운드 B 다.

export const ANALYSIS_QUEUE = "analysis";
export const ANALYSIS_JOB = "analyze";

/** idempotencyKey(= `${orgId}:${requestId}`, C2) 의 조직 접두어. */
function orgPrefix(orgId: string): string {
  return `${orgId}:`;
}

/** idempotencyKey(= `${orgId}:${requestId}`, C2) 에서 requestId 를 꺼낸다. 형식이 틀리면 null. */
export function requestIdOf(data: { orgId: string; idempotencyKey: string }): string | null {
  const prefix = orgPrefix(data.orgId);
  if (!data.idempotencyKey.startsWith(prefix)) return null;
  const requestId = data.idempotencyKey.slice(prefix.length);
  return requestId === "" ? null : requestId;
}

const uuid = z.uuid();

/**
 * requestId 형식(낮음 (b)). C6 Idempotency-Key(UUID·없으면 randomUUID)와 demo:preanalyze 키(`demo-pre-FX-01-r01`)가 맞는다.
 * 로그·jobId·필터 문자열에 섞여도 줄·구분자를 깨지 않게 영문·숫자·`_`·`-` 128자까지만 받는다.
 * 그래서 키 전체 길이 상한은 uuid 36 + ':' + 128 = 165자이고, 따로 max 를 두지 않는다(같은 거절이 두 번 나오지 않게).
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

function hasValidRequestId(data: { orgId: string; idempotencyKey: string }): boolean {
  const requestId = requestIdOf(data);
  return requestId !== null && REQUEST_ID_PATTERN.test(requestId);
}

/** job payload(e8 판정 1). 공고·프로필 값은 싣지 않는다. worker 는 scoreRunId 행을 읽어 입력을 모은다. */
export const analysisJobDataSchema = z
  .object({ orgId: uuid, scoreRunId: uuid, idempotencyKey: z.string().min(1) })
  .superRefine((data, ctx) => {
    // 다른 조직 접두어의 키로 남의 run 을 가리키지 못하게 한다. 메시지에 값을 싣지 않는다.
    if (!hasValidRequestId(data)) {
      ctx.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message:
          "idempotencyKey 는 `${orgId}:${requestId}` 형식이고 requestId 는 영문·숫자·_·- 128자 이하여야 한다",
      });
    }
  });
export type AnalysisJobData = z.infer<typeof analysisJobDataSchema>;

/** 02 장애 원칙 "job 유실 없음(재시도·DLQ)". 실패 job 은 7일 남겨 DLQ 로 본다. */
export const ANALYSIS_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: { age: 604_800 },
} as const;

/** BullMQ custom jobId. ':' 가 없다(BullMQ 6 이 거부한다). 같은 run 은 같은 jobId 라 중복 enqueue 는 BullMQ 가 무시한다. */
export function toAnalysisJobId(data: Pick<AnalysisJobData, "orgId" | "scoreRunId">): string {
  return `analysis_${data.orgId}_${data.scoreRunId}`;
}

const RAW_FIXTURE_ID = /^FX-\d{2}$/;
const MIN_REVISION = 1;
const MAX_REVISION = 99;

/**
 * fixture 공고의 gateway fixtureId(ee 규칙). worker 는 늘 `${fixtureId}.r${NN}` 을 보내고, 없는 파일의 대체는 gateway mock 이 한다.
 * rawFixtureId(bid_revisions.raw_payload.fixtureId)가 없거나 형식이 아니면 null 이다. g2b 공고에는 없다.
 */
export function toFixtureStem(rawFixtureId: unknown, revision: number): string | null {
  if (typeof rawFixtureId !== "string" || !RAW_FIXTURE_ID.test(rawFixtureId)) return null;
  const isRevision =
    Number.isInteger(revision) && revision >= MIN_REVISION && revision <= MAX_REVISION;
  if (!isRevision) return null;
  return `${rawFixtureId}.r${String(revision).padStart(2, "0")}`;
}

// ── port(라운드 B 가 구현한다) ──

export type ScoreRunStatus = "QUEUED" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED";

/** loader 가 읽어 오는 값(score_runs 행 + 그 run 의 입력). */
export type LoadedAnalysisContext = Pick<
  AnalysisContext,
  | "scoreRunId"
  | "bidId"
  | "companyProfileId"
  | "fixtureId"
  | "bid"
  | "extraction"
  | "profile"
  | "team"
  | "documentIssues"
  | "queuedAt"
> & {
  /** score_runs.org_id */
  orgId: string;
  /** score_runs.idempotency_key */
  idempotencyKey: string | null;
  status: ScoreRunStatus;
};

/** 캐시 추출 재사용 키의 모델 쪽(03 §2.1). gateway /health 의 qwen. 모르면 null(→ loader 는 그 revision 의 가장 최근 성공 행). */
export type ExtractionCacheKey = { modelName: string; promptHash: string } | null;

/** 읽기 port. 없으면 null. 시도마다 부른다(앞 시도가 저장한 추출을 다시 읽게). */
export type AnalysisContextLoader = {
  load(
    target: Pick<AnalysisJobData, "orgId" | "scoreRunId">,
    cacheKey: ExtractionCacheKey,
  ): Promise<LoadedAnalysisContext | null>;
};

/** score_runs 상태 port. 결과 저장(COMPLETED·PARTIAL)은 AnalysisRunSink 가 한다. */
export type AnalysisRunTracker = {
  markRunning(input: {
    orgId: string;
    scoreRunId: string;
    runMode: RunMode;
    aiProvider: AiProvider;
    startedAt: string;
  }): Promise<void>;
  /**
   * attemptStartedAt 이 있으면 그 시도가 잡은 run(status=RUNNING, started_at=attemptStartedAt)만 닫는다(markRunning 뒤 영구 실패).
   * 없으면 끝나지 않은 run(QUEUED·RUNNING)을 닫는다(복구·markRunning 전 실패). C5-B 보안 후속 2.1.
   */
  markFailed(input: {
    orgId: string;
    scoreRunId: string;
    errorCode: string;
    finishedAt: string;
    attemptStartedAt?: string;
  }): Promise<void>;
};

/** 오래 QUEUED·RUNNING 으로 남은 score_runs 행(멈춘 run 복구, docs/02 "job 유실 없음"). */
export type StaleRun = {
  orgId: string;
  scoreRunId: string;
  idempotencyKey: string | null;
  status: "QUEUED" | "RUNNING";
  /** queued_at 을 Date.toISOString 모양(밀리초·Z)으로 바꾼 값. 다음 페이지 커서에 쓴다. */
  queuedAt: string;
};

/** keyset 페이지 커서: 앞 페이지 마지막 run 의 queuedAt·id(scoreRunId). */
export type StaleRunCursor = { queuedAt: string; id: string };

/** 멈춘 run 찾기 port. 복구는 운영 작업이라 모든 조직을 본다. 처리할 때는 행의 orgId 를 그대로 쓴다. */
export type StaleRunFinder = {
  /**
   * status=QUEUED 이고 queued_at < queuedBefore, 또는 status=RUNNING 이고 started_at < runningBefore 인 run.
   * (queued_at, id) 오름차순, 최대 limit 건. after 가 있으면 (queued_at, id) 가 after 보다 큰 run 만 고른다(첫 페이지는 null).
   * 시각은 Date.toISOString 결과만, after.id 는 uuid 만 받는다(값이 필터 문자열에 그대로 들어간다).
   */
  findStaleRuns(input: {
    queuedBefore: string;
    runningBefore: string;
    limit: number;
    after: StaleRunCursor | null;
  }): Promise<StaleRun[]>;
};

// ── 처리 설정(gateway /health 가 기준, 실패하면 env) ──

export type AnalysisSettings = {
  runMode: RunMode;
  aiProvider: AiProvider;
  kev: AnalysisContext["kev"];
  cacheKey: ExtractionCacheKey;
  source: "HEALTH" | "ENV";
  /** env 에 SOL_RUN_MODE 가 있는데 gateway 와 다르다. 처리는 gateway 값으로 하고 로그로만 알린다. */
  runModeMismatch: boolean;
};

const RUN_MODES: readonly RunMode[] = ["live", "fixture", "mock"];

function isRunMode(value: string): value is RunMode {
  return RUN_MODES.some((mode) => mode === value);
}

/** worker env 의 SOL_RUN_MODE. 앞뒤 공백을 지우고, 빈 값은 "mock"(given=false)이다. 오류에는 키 이름만 싣는다. */
export function readRunMode(env: Record<string, string | undefined>): {
  runMode: RunMode;
  given: boolean;
} {
  const value = env.SOL_RUN_MODE?.trim() ?? "";
  if (value === "") return { runMode: "mock", given: false };
  if (!isRunMode(value)) throw new Error("worker env 오류: SOL_RUN_MODE");
  return { runMode: value, given: true };
}

/** Kev 질문 세트. mock 은 v0.1, fixture·live 는 v0.2 다(03 §3 KEV_QUESTION_SET). */
function questionSetFor(runMode: RunMode): AnalysisContext["kev"]["questionSetVersion"] {
  return runMode === "mock" ? "kev-qs/v0.1" : "kev-qs/v0.2";
}

/** gateway /health 성공이면 그 값, 실패면(어떤 kind 든) env 기준 기본값(infra/run-modes.json)이다. */
export function toAnalysisSettings(
  health: GatewayResult<GatewayHealth>,
  env: { runMode: RunMode; given: boolean },
): AnalysisSettings {
  if (!health.ok) {
    const { runMode } = env;
    return {
      runMode,
      aiProvider: runMode === "mock" ? "mock" : "local",
      kev: { enabled: true, questionSetVersion: questionSetFor(runMode) },
      // 어떤 모델이 추출했는지 모르므로 loader 가 그 revision 의 가장 최근 성공 행을 고른다.
      cacheKey: null,
      source: "ENV",
      runModeMismatch: false,
    };
  }
  const { value } = health;
  return {
    runMode: value.runMode,
    aiProvider: value.provider,
    kev: { enabled: value.kevEnabled, questionSetVersion: questionSetFor(value.runMode) },
    cacheKey:
      value.qwen === null
        ? null
        : { modelName: value.qwen.model, promptHash: value.qwen.promptHash },
    source: "HEALTH",
    runModeMismatch: env.given && env.runMode !== value.runMode,
  };
}
