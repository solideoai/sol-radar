import { Worker, type ConnectionOptions } from "bullmq";
import {
  toInsightPayload,
  toInsightRequest,
  type GatewayClient,
  type GatewayFailure,
  type InsightStore,
} from "@/server/analysis";
import {
  INSIGHT_QUEUE,
  INSIGHT_STALE_MS,
  insightJobDataSchema,
  type InsightErrorCode,
  type InsightJobData,
} from "@/server/insight";
import { errorNameOf } from "@/worker/error-name";

// ── 추천 분석 job(ADR-066): PENDING 행 → 저장된 run 으로 gateway POST /insight → 행을 DONE·FAILED 로 닫는다 ──
// 판정(점수·권고)은 바꾸지 않는다. 분석 job 은 /insight 를 부르지 않고, [추천 분석] 버튼이 넣은 job 만 부른다.
// 모든 실패는 행으로 닫고 job 은 던지지 않는다(attempts 1). 저장소가 죽어 닫지 못한 행은 정리가 10분 뒤 STALE 로 닫는다.
// 로그에는 식별자·결과·코드만 싣는다. 공고 인용·모델 문장·오류 message 는 싣지 않는다(docs/14).

export type InsightJobDeps = {
  store: InsightStore;
  /** 분석 Worker 와 같은 클라이언트. breaker 를 함께 쓴다. */
  gateway: Pick<GatewayClient, "insight">;
  now: () => Date;
  /** JSON 한 줄. */
  log: (line: string) => void;
};

/** gateway 가 받지 않았거나 죽었으면 UNAVAILABLE, 요청·응답이 계약과 다르면 INVALID. */
function errorCodeOf(failure: GatewayFailure): InsightErrorCode {
  if (failure.kind === "INVALID_RESPONSE") return "GATEWAY_INVALID";
  if (failure.kind === "HTTP_ERROR" && failure.httpStatus < 500) return "GATEWAY_INVALID";
  return "GATEWAY_UNAVAILABLE";
}

type Outcome =
  | { outcome: "SKIPPED" }
  | { outcome: "DONE"; source: "MODEL" | "TEMPLATE"; closed: boolean }
  | { outcome: "FAILED"; errorCode: InsightErrorCode; closed: boolean };

async function run(data: InsightJobData, deps: InsightJobDeps): Promise<Outcome> {
  const { insightId, orgId } = data;
  const pending = await deps.store.loadPending(insightId, orgId);
  if (pending === null) return { outcome: "SKIPPED" };

  const fail = async (errorCode: InsightErrorCode): Promise<Outcome> => ({
    outcome: "FAILED",
    errorCode,
    closed: await deps.store.finishFailed({
      insightId,
      orgId,
      errorCode,
      finishedAt: deps.now().toISOString(),
    }),
  });

  const source = await deps.store.loadRunSource(pending.scoreRunId, orgId);
  if (source === null) return fail("SOURCE_INVALID");
  // 요청 id 는 행 id 다. gateway 로그의 X-Request-Id 로 행을 찾는다.
  const { request, refs } = toInsightRequest(source, insightId);

  const result = await deps.gateway.insight(request);
  if (!result.ok) return fail(errorCodeOf(result.failure));
  const parsed = (() => {
    try {
      return toInsightPayload(result.value, refs);
    } catch {
      return null;
    }
  })();
  if (parsed === null) return fail("GATEWAY_INVALID");

  const response = result.value;
  const sourceKind = response.fallback ? "TEMPLATE" : "MODEL";
  const closed = await deps.store.finishDone({
    insightId,
    orgId,
    source: sourceKind,
    payload: parsed,
    fallbackReason: response.fallbackReason,
    modelName: response.model,
    promptHash: response.promptHash,
    finishedAt: deps.now().toISOString(),
  });
  return { outcome: "DONE", source: sourceKind, closed };
}

/** job 하나를 처리한다. 던지지 않는다. */
export async function processInsightJob(data: InsightJobData, deps: InsightJobDeps): Promise<void> {
  try {
    const outcome = await run(data, deps);
    deps.log(JSON.stringify({ event: "insight.job", insightId: data.insightId, ...outcome }));
  } catch (error) {
    deps.log(
      JSON.stringify({
        event: "insight.job.failed",
        insightId: data.insightId,
        errorName: errorNameOf(error),
      }),
    );
  }
}

/** BullMQ 처리 함수. job 데이터가 계약과 다르면 닫을 행을 알 수 없으므로 로그만 남긴다. */
export function createInsightProcessor(
  deps: InsightJobDeps,
): (job: { data: unknown }) => Promise<void> {
  return async (job) => {
    const data = insightJobDataSchema.safeParse(job.data);
    if (!data.success) {
      deps.log(JSON.stringify({ event: "insight.job.invalid" }));
      return;
    }
    await processInsightJob(data.data, deps);
  };
}

/** 10분 넘은 PENDING 을 FAILED(STALE)로 닫는다. 닫은 수를 돌려준다. */
export async function sweepStaleInsights(
  deps: Pick<InsightJobDeps, "store" | "now">,
): Promise<number> {
  const now = deps.now();
  return deps.store.sweepStale(
    new Date(now.getTime() - INSIGHT_STALE_MS).toISOString(),
    now.toISOString(),
  );
}

/** 정리 주기. 화면이 늦음 안내를 내는 3분보다 길고 STALE 기준 10분보다 짧다. */
export const INSIGHT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

type SweepTimers = {
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

/** 기동 때 한 번, 그 뒤 5분마다 정리한다. 회차가 겹치지 않고, stop 은 진행 중 회차를 기다린다. */
export function startInsightSweeper(
  deps: Pick<InsightJobDeps, "store" | "now" | "log">,
  timers: SweepTimers = { setInterval, clearInterval },
): { stop(): Promise<void> } {
  let running: Promise<void> | null = null;
  let isStopped = false;

  const round = () => {
    if (isStopped || running !== null) return;
    running = sweepStaleInsights(deps).then(
      (closed) => {
        if (closed > 0) deps.log(JSON.stringify({ event: "insight.sweep", closed }));
      },
      (error: unknown) => {
        deps.log(JSON.stringify({ event: "insight.sweep.failed", errorName: errorNameOf(error) }));
      },
    );
    void running.finally(() => {
      running = null;
    });
  };

  round();
  const handle = timers.setInterval(round, INSIGHT_SWEEP_INTERVAL_MS);

  return {
    async stop() {
      isStopped = true;
      timers.clearInterval(handle);
      if (running !== null) await running;
    },
  };
}

/** insight 큐 Worker. 분석 Worker 와 연결을 따로 쓴다(blocking 명령). concurrency 1. */
export function createInsightWorker(
  connection: ConnectionOptions,
  deps: InsightJobDeps,
): { close(): Promise<void> } {
  const worker = new Worker(INSIGHT_QUEUE, createInsightProcessor(deps), {
    connection,
    concurrency: 1,
  });
  // message 는 접속 문자열을 담을 수 있어 쓰지 않는다(analysis worker 와 같은 원칙).
  worker.on("error", (error) => {
    console.error(`insight worker 오류: ${errorNameOf(error)}`);
  });
  return { close: () => worker.close() };
}
