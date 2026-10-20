import "server-only";
import { createHash } from "node:crypto";
import type { z } from "zod";
import type { Tables } from "@/lib/database.types";
import type { SolRole } from "@/server/organization";
import {
  INGESTION_ADMIN_ROLES,
  WINDOW_FUTURE_TOLERANCE_MS,
  acceptsSourceForMode,
  canManageIngestion,
  ingestionFailure,
  ingestionRunInputSchema,
  toIngestionRunView,
  type IngestionAdminFailure,
  type IngestionAdminResult,
  type IngestionRunInput,
  type IngestionRunMode,
  type IngestionRunPage,
  type IngestionRunRequester,
  type IngestionRunRow,
  type IngestionRunView,
} from "./ingestion-admin.model";
import { EMPTY_INGEST_SUMMARY, type IngestRunSource } from "./ingestion.port";
import type { IngestJobData } from "./ingestion.queue";

// ── N8 수집 관리 흐름(05 §2 :75-77). 예상한 실패는 결과로 돌려주고 HTTP 로 옮기는 일은 Route Handler 가 한다 ──
// 의존성(저장·큐·멱등 저장·속도 제한·커서)은 인자로 받는다. 읽기는 사용자 세션(RLS)이고 ingest_runs 행은 worker 가 만든다.

type IngestErrorRow = Tables<"ingest_errors">;

export type IngestionAdminContext = { orgId: string; userId: string; role: SolRole };

/** keyset 위치. 목록은 started_at desc, id desc 다 */
export type IngestionRunPosition = { startedAt: string; id: string };

export type IngestionAdminRepo = {
  /** started_at desc, id desc 로 after 뒤부터 limit 행까지. 화면 역할이 읽을 수 있는 열만 온다(W1) */
  listRuns(query: {
    limit: number;
    after: IngestionRunPosition | null;
  }): Promise<IngestionRunRow[]>;
  findRun(id: string): Promise<IngestionRunRow | null>;
  /** 주어진 run 들의 ingest_errors 행(run 이 섞여 온다) */
  listErrors(runIds: readonly string[]): Promise<IngestErrorRow[]>;
  /** 같은 source 의 status = RUNNING 행 */
  findRunningRun(source: IngestRunSource): Promise<{ id: string } | null>;
  /** userId → 이름. orgId 조직의 구성원만 담는다 */
  findMemberNames(orgId: string, userIds: readonly string[]): Promise<Map<string, string>>;
  /**
   * runId → 요청자 id. orgId 조직 감사(action INGEST_MANUAL, target_type ingest_run)의 actor_id 다(W1).
   * 감사가 없거나(일정·데모 수집, 다른 조직이 요청한 run) actor_id 가 null 이면 빠진다
   */
  findManualRequesters(orgId: string, runIds: readonly string[]): Promise<Map<string, string>>;
};

/**
 * Redis 키 idem:ingest:<orgId>:<requestId> 의 값. requesterId 는 첫 202 를 받은 사람이다(I1).
 * 그 전에 쓴 기록에는 없고, 그때 재현의 requestedBy 는 null 이다
 */
export type IngestionIdempotencyRecord = {
  requestHash: string;
  runId: string;
  startedAt: string;
  requesterId?: string;
};
export type IngestionIdempotencyStore = {
  get(key: string): Promise<IngestionIdempotencyRecord | null>;
  /** SET NX EX. 이미 있으면 false */
  claim(key: string, value: IngestionIdempotencyRecord, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
};

/** 조직이 묶인 HMAC 커서. 변조·만료·다른 조직 것이면 verify 가 null 이다 */
export type IngestionRunCursor = {
  sign(position: IngestionRunPosition): string;
  verify(token: string): IngestionRunPosition | null;
};

type RateLimitHit = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type IngestionAdminDeps = {
  repo: IngestionAdminRepo;
  queue: { enqueue(data: IngestJobData): Promise<void> };
  idempotency: IngestionIdempotencyStore;
  limiter: { hit(orgId: string): Promise<RateLimitHit> };
  runMode: IngestionRunMode;
  now: () => Date;
  newId: () => string;
  /** null 이면 커서 비밀이 없다. 목록은 503 {component:"cursor"} 다 */
  cursor: IngestionRunCursor | null;
  /** Redis·큐 장애의 원인을 로그로 남기는 곳. 응답에는 싣지 않고, 이 콜백이 던져도 응답은 바뀌지 않는다 */
  onInfraError?: (component: "queue" | "redis", error: unknown) => void;
};

// 요청 본문(분석 요청과 같은 모양). 읽기는 app 층이 하고 16KB 를 넘으면 ok:false 다.
export type IngestionBodyRead = { ok: true; value: unknown } | { ok: false };
export type IngestionLazyBody = {
  declaredTooLarge: boolean;
  read: () => Promise<IngestionBodyRead>;
};

/** 본문 상한(보안 L5). 분석 요청과 같은 값이고, 넘으면 같은 응답이다 */
const MAX_BODY_BYTES = 16 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_TTL_SECONDS = 86_400;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── 공통 실패 ──

// Route Handler 도 쓴다. 쿼리 검사보다 권한을 먼저 보아야 하는 곳(GET 목록)에서 같은 403 을 낸다.
export const ingestionForbidden = (): IngestionAdminFailure =>
  ingestionFailure(403, "FORBIDDEN", "수집 관리 권한이 없습니다", {
    required: [...INGESTION_ADMIN_ROLES],
  });
const forbidden = ingestionForbidden;

const bodyTooLarge = (): IngestionAdminFailure =>
  ingestionFailure(400, "VALIDATION_ERROR", "본문이 너무 큽니다", {
    issues: [{ path: "body", message: `본문은 ${MAX_BODY_BYTES / 1024}KB 이하여야 합니다` }],
  });

const redisUnavailable = (): IngestionAdminFailure =>
  ingestionFailure(503, "SERVICE_UNAVAILABLE", "Redis 에 연결하지 못했습니다", {
    component: "redis",
  });

const runNotFound = (): IngestionAdminFailure =>
  ingestionFailure(404, "NOT_FOUND", "수집 실행을 찾을 수 없습니다", {
    resource: "ingestionRun",
  });

const issuesOf = (error: z.ZodError) =>
  error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }));

// 로그 콜백이 던져도 응답과 키 정리는 영향받지 않는다.
function reportInfraError(
  deps: Pick<IngestionAdminDeps, "onInfraError">,
  component: "queue" | "redis",
  error: unknown,
): void {
  try {
    deps.onInfraError?.(component, error);
  } catch {
    // 로깅 실패는 삼킨다. 원래 장애 응답이 우선이다.
  }
}

// Redis 호출 하나. 던지면 원인을 넘기고 null 로 알린다(호출한 쪽이 503 {component:"redis"} 로 끝낸다).
async function redisCall<T>(
  deps: Pick<IngestionAdminDeps, "onInfraError">,
  work: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    reportInfraError(deps, "redis", error);
    return { ok: false };
  }
}

// ── 수동 수집 요청(POST /admin/ingestion/runs) ──

/** 큐에 넣고 해시하는 요청. stages 는 뺀다(job 스키마가 strict 이고, 생략과 ["NOTICE"] 는 같은 요청이다) */
type RunRequest =
  | { source: "fixture"; batch: "SEED" | "LIVE" }
  | { source: "g2b"; window?: { from: string; to: string } };

const toRunRequest = (input: IngestionRunInput): RunRequest =>
  input.source === "fixture"
    ? { source: "fixture", batch: input.batch }
    : input.window === undefined
      ? { source: "g2b" }
      : { source: "g2b", window: input.window };

// 같은 시각을 다르게 쓴 window(Z·밀리초 유무)는 같은 요청이다.
function requestHashOf(request: RunRequest): string {
  const window =
    request.source === "g2b" && request.window !== undefined
      ? [Date.parse(request.window.from), Date.parse(request.window.to)]
      : null;
  const batch = request.source === "fixture" ? request.batch : null;
  return createHash("sha256")
    .update(JSON.stringify([request.source, batch, window]))
    .digest("hex");
}

// 7-1: 미래 창은 아직 올라오지 않은 공고 구간을 "수집함"으로 남긴다. 큐 job 스키마도 같은 규칙으로 거절하므로
// 큐에서 던져 503 이 되기 전에 400 으로 막는다. 기준은 deps.now() 다.
function futureWindowFailure(request: RunRequest, now: Date): IngestionAdminFailure | null {
  if (request.source !== "g2b" || request.window === undefined) return null;
  if (Date.parse(request.window.to) <= now.getTime() + WINDOW_FUTURE_TOLERANCE_MS) return null;
  return ingestionFailure(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", {
    issues: [{ path: "window.to", message: "window.to 는 지금보다 5분 넘게 미래일 수 없습니다" }],
  });
}

function jobDataOf(
  ctx: IngestionAdminContext,
  request: RunRequest,
  requestId: string,
  runId: string,
): IngestJobData {
  const common = {
    trigger: "MANUAL" as const,
    jobKey: `manual:${ctx.orgId}:${requestId}`,
    idempotencyKey: `${ctx.orgId}:${requestId}`,
    requestedBy: ctx.userId,
    orgId: ctx.orgId,
    runId,
  };
  return request.source === "fixture"
    ? { source: "fixture", batch: request.batch, ...common }
    : request.window === undefined
      ? { source: "g2b", ...common }
      : { source: "g2b", window: request.window, ...common };
}

/** 202 본문(05 §6.5). worker 가 행을 만들기 전의 모습이다 */
function acceptedView(
  request: RunRequest,
  record: IngestionIdempotencyRecord,
  runMode: IngestionRunMode,
  requester: IngestionRunRequester | null,
): IngestionRunView {
  return {
    id: record.runId,
    source: request.source,
    runMode,
    batch: request.source === "fixture" ? (request.batch === "SEED" ? "seed" : "live") : null,
    trigger: "MANUAL",
    status: "RUNNING",
    summary: { ...EMPTY_INGEST_SUMMARY },
    quotaUsed: 0,
    errors: [],
    cursor: null,
    requestedBy: requester,
    startedAt: record.startedAt,
    finishedAt: null,
  };
}

// 요청자가 지금 조직 구성원 이름에 없으면 내보내지 않는다(id 도).
async function requesterOf(
  ctx: IngestionAdminContext,
  repo: IngestionAdminRepo,
  userId: string,
): Promise<IngestionRunRequester | null> {
  const name = (await repo.findMemberNames(ctx.orgId, [userId])).get(userId);
  return name === undefined ? null : { id: userId, name };
}

/**
 * 수동 수집 요청: 권한 → 키 형식 → 선언된 본문 크기 → 속도 제한 → 본문 읽기 → 본문 검증(+ 미래 창) → 실행 모드
 * → 멱등 재현 → 진행 중 → 키 잡기(SET NX EX) → 큐. 같은 키·같은 본문은 실행 중이어도 첫 202 를 그대로 준다.
 * 큐에 넣지 못하면 잡은 키를 풀어 같은 키로 다시 받게 한다. ingest_runs 행은 worker 가 이 runId 로 만든다.
 */
export async function requestIngestionRun(
  ctx: IngestionAdminContext,
  body: IngestionLazyBody,
  idempotencyKey: string | null,
  deps: IngestionAdminDeps,
): Promise<IngestionAdminResult<IngestionRunView>> {
  if (!canManageIngestion(ctx.role)) return forbidden();
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return ingestionFailure(400, "VALIDATION_ERROR", "Idempotency-Key 형식이 올바르지 않습니다", {
      issues: [{ path: "Idempotency-Key", message: "영문·숫자·_·- 1~128자여야 합니다" }],
    });
  }
  if (body.declaredTooLarge) return bodyTooLarge();

  const limit = await redisCall(deps, () => deps.limiter.hit(ctx.orgId));
  if (!limit.ok) return redisUnavailable();
  if (!limit.value.allowed) {
    return ingestionFailure(429, "RATE_LIMITED", "수집 요청이 너무 많습니다", {
      retryAfterSeconds: limit.value.retryAfterSeconds,
    });
  }

  const read = await body.read();
  if (!read.ok) return bodyTooLarge();
  const parsed = ingestionRunInputSchema.safeParse(read.value);
  if (!parsed.success) {
    return ingestionFailure(400, "VALIDATION_ERROR", "요청 본문이 올바르지 않습니다", {
      issues: issuesOf(parsed.error),
    });
  }
  const request = toRunRequest(parsed.data);
  const now = deps.now();
  const futureWindow = futureWindowFailure(request, now);
  if (futureWindow !== null) return futureWindow;
  if (!acceptsSourceForMode(deps.runMode, request.source)) {
    return ingestionFailure(
      409,
      "RUN_MODE_MISMATCH",
      "지금 실행 모드에서 받지 않는 수집 소스입니다",
      {
        runMode: deps.runMode,
        source: request.source,
      },
    );
  }

  // 05 §1: Idempotency-Key 는 필수가 아니다. 없으면 서버가 만든다(이때는 재현할 수 없다).
  const requestId = idempotencyKey ?? deps.newId();
  const redisKey = `idem:ingest:${ctx.orgId}:${requestId}`;
  const requestHash = requestHashOf(request);
  // 같은 키 재현: 같은 본문이면 첫 202, 다른 본문이면 409. 첫 202 의 요청자는 기록의 requesterId(첫 요청자)이고
  // 다시 보낸 사람이 아니다(I1). 이름은 지금 조직 구성원에서 다시 찾는다. requesterId 가 없는 옛 기록은 null 이다.
  const replay = async (
    earlier: IngestionIdempotencyRecord,
  ): Promise<IngestionAdminResult<IngestionRunView>> => {
    if (earlier.requestHash !== requestHash) {
      return ingestionFailure(409, "IDEMPOTENCY_KEY_REUSED", "같은 키로 다른 요청을 보냈습니다");
    }
    const requester =
      earlier.requesterId === undefined
        ? null
        : await requesterOf(ctx, deps.repo, earlier.requesterId);
    return accepted(acceptedView(request, earlier, deps.runMode, requester));
  };

  const earlier = await redisCall(deps, () => deps.idempotency.get(redisKey));
  if (!earlier.ok) return redisUnavailable();
  if (earlier.value !== null) return replay(earlier.value);

  // 행으로 보이는 실행만 막는다. 큐에만 있는 job 은 worker 가 jobKey 로 멱등 처리한다(e8 판정 3).
  const running = await deps.repo.findRunningRun(request.source);
  if (running !== null) {
    return ingestionFailure(409, "INGESTION_IN_PROGRESS", "같은 소스의 수집이 실행 중입니다", {
      runId: running.id,
    });
  }

  // 키를 잡기 전에 읽는다. 여기서 DB 가 실패하면 키도 큐도 건드리지 않은 채 끝난다.
  const requester = await requesterOf(ctx, deps.repo, ctx.userId);
  const record: IngestionIdempotencyRecord = {
    requestHash,
    runId: deps.newId(),
    startedAt: now.toISOString(),
    requesterId: ctx.userId,
  };
  const claimed = await redisCall(deps, () =>
    deps.idempotency.claim(redisKey, record, IDEMPOTENCY_TTL_SECONDS),
  );
  if (!claimed.ok) return redisUnavailable();
  if (!claimed.value) {
    // 같은 키의 동시 요청이 먼저 잡았다. 그 값으로 다시 판정한다. 그사이 사라졌으면 판정할 수 없다.
    const winner = await redisCall(deps, () => deps.idempotency.get(redisKey));
    if (!winner.ok || winner.value === null) return redisUnavailable();
    return replay(winner.value);
  }

  try {
    await deps.queue.enqueue(jobDataOf(ctx, request, requestId, record.runId));
  } catch (error) {
    reportInfraError(deps, "queue", error);
    // 키가 남으면 같은 키의 재시도가 만들어지지 않은 run 의 202 를 받는다. 풀지 못하면 원인만 남긴다(24시간 뒤 만료).
    await redisCall(deps, () => deps.idempotency.release(redisKey));
    return ingestionFailure(503, "SERVICE_UNAVAILABLE", "수집 큐에 넣지 못했습니다", {
      component: "queue",
    });
  }
  return accepted(acceptedView(request, record, deps.runMode, requester));
}

const accepted = (view: IngestionRunView): IngestionAdminResult<IngestionRunView> => ({
  ok: true,
  status: 202,
  data: view,
});

// ── 조회(GET /admin/ingestion/runs·/runs/:id) ──

// 이 쪽 run 들의 요청자. 행의 requested_by 는 쓰지 않는다(W1: 화면 역할은 그 열을 못 읽고, 다른 조직 사람 id 다).
// 지금 조직 감사(INGEST_MANUAL)의 행위자를 찾고, 그 사람이 지금 조직 구성원일 때만 {id,name} 이다.
async function requestersOf(
  ctx: IngestionAdminContext,
  runIds: readonly string[],
  repo: IngestionAdminRepo,
): Promise<Map<string, IngestionRunRequester>> {
  const actors = await repo.findManualRequesters(ctx.orgId, runIds);
  const actorIds = [...new Set(actors.values())];
  const names =
    actorIds.length === 0
      ? new Map<string, string>()
      : await repo.findMemberNames(ctx.orgId, actorIds);
  return new Map(
    [...actors].flatMap(([runId, actorId]): [string, IngestionRunRequester][] => {
      const name = names.get(actorId);
      return name === undefined ? [] : [[runId, { id: actorId, name }]];
    }),
  );
}

// 행들 → IngestionRun. 오류는 run 마다 나누고, 요청자는 requestersOf 가 지금 조직 기준으로 정한다.
async function toViews(
  ctx: IngestionAdminContext,
  rows: readonly IngestionRunRow[],
  repo: IngestionAdminRepo,
): Promise<IngestionRunView[]> {
  if (rows.length === 0) return [];
  const runIds = rows.map((row) => row.id);
  const [errors, requesters] = await Promise.all([
    repo.listErrors(runIds),
    requestersOf(ctx, runIds, repo),
  ]);
  return rows.map((row) =>
    toIngestionRunView(
      row,
      errors.filter((error) => error.ingest_run_id === row.id),
      requesters.get(row.id) ?? null,
    ),
  );
}

/** 수집 실행 이력(05 Page<IngestionRun>). started_at desc, id desc keyset 이고 커서는 조직에 묶인다 */
export async function listIngestionRuns(
  ctx: IngestionAdminContext,
  query: { limit: number; cursor: string | null },
  deps: Pick<IngestionAdminDeps, "repo" | "cursor">,
): Promise<IngestionAdminResult<IngestionRunPage>> {
  if (!canManageIngestion(ctx.role)) return forbidden();
  const { repo, cursor } = deps;
  if (cursor === null) {
    return ingestionFailure(503, "SERVICE_UNAVAILABLE", "커서 서명 설정이 올바르지 않습니다", {
      component: "cursor",
    });
  }
  const after = query.cursor === null ? null : cursor.verify(query.cursor);
  if (query.cursor !== null && after === null) {
    return ingestionFailure(400, "INVALID_CURSOR", "커서가 올바르지 않습니다");
  }
  // 한 행 더 읽어 다음 쪽이 있는지 본다.
  const rows = await repo.listRuns({ limit: query.limit + 1, after });
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > query.limit && last !== undefined
      ? cursor.sign({ startedAt: last.started_at, id: last.id })
      : null;
  return {
    ok: true,
    status: 200,
    data: {
      items: await toViews(ctx, page, repo),
      pageInfo: { cursor: query.cursor, nextCursor, hasNext: nextCursor !== null },
    },
  };
}

/** 수집 실행 하나. worker 가 행을 만들기 전에는 404 다(화면은 목록을 다시 읽는다) */
export async function getIngestionRun(
  ctx: IngestionAdminContext,
  id: string,
  deps: Pick<IngestionAdminDeps, "repo">,
): Promise<IngestionAdminResult<IngestionRunView>> {
  if (!canManageIngestion(ctx.role)) return forbidden();
  if (!UUID_PATTERN.test(id)) return runNotFound();
  const row = await deps.repo.findRun(id);
  if (row === null) return runNotFound();
  const [view] = await toViews(ctx, [row], deps.repo);
  return view === undefined ? runNotFound() : { ok: true, status: 200, data: view };
}
