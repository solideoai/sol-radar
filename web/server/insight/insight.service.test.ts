import { describe, expect, it, vi } from "vitest";
import type { InsightRateLimiter, InsightRepo, InsightRequestDeps } from "./insight-request.model";
import { INSIGHT_PROMPT_VERSION, type InsightView } from "./insight.model";
import { getInsight, requestInsight } from "./insight.service";

const ORG = "0f000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000003";
const BID = "b1000000-0000-4000-8000-000000000001";
const RUN = "c1000000-0000-4000-8000-000000000001";
const OLD = "d1000000-0000-4000-8000-000000000001";
const NEW = "d1000000-0000-4000-8000-000000000002";
const POLL_URL = `/api/v1/bids/${BID}/analyses/${RUN}/insight`;
const ctx = { orgId: ORG, userId: USER, role: "ANALYST" } as const;

const view = (overrides: Partial<InsightView> = {}): InsightView => ({
  id: OLD,
  scoreRunId: RUN,
  status: "PENDING",
  source: null,
  payload: null,
  fallbackReason: null,
  modelName: null,
  promptVersion: null,
  errorCode: null,
  createdAt: "2026-10-29T01:00:00.000Z",
  finishedAt: null,
  ...overrides,
});

function depsWith(repo: Partial<InsightRepo> = {}) {
  const deps = {
    repo: {
      findRun: vi.fn(async () => ({ id: RUN, bidId: BID, status: "COMPLETED" })),
      latestInsight: vi.fn(async (): Promise<InsightView | null> => null),
      latestModelInsight: vi.fn(async (): Promise<InsightView | null> => null),
      insertPending: vi.fn(async (): Promise<string | null> => NEW),
      ...repo,
    },
    enqueue: vi.fn(async () => undefined),
    limiter: { hit: vi.fn<InsightRateLimiter["hit"]>(async () => ({ allowed: true })) },
    onInfraError: vi.fn(),
  } satisfies InsightRequestDeps;
  return deps;
}

describe("requestInsight", () => {
  it("요청이 없으면 PENDING 행을 넣고 그 id 로 큐에 넣는다 — 속도 제한은 사용자 기준", async () => {
    const deps = depsWith();
    expect(await requestInsight(ctx, BID, RUN, deps)).toEqual({
      ok: true,
      status: 202,
      data: { insightId: NEW, status: "PENDING", deduplicated: false, pollUrl: POLL_URL },
    });
    expect(deps.repo.insertPending).toHaveBeenCalledWith(ORG, RUN);
    expect(deps.limiter.hit).toHaveBeenCalledWith(USER);
    expect(deps.enqueue).toHaveBeenCalledWith({ insightId: NEW, orgId: ORG });
  });

  it("PENDING 이 있으면 새로 만들지 않고 같은 id 를 다시 큐에 넣는다 — 큐에 넣으므로 속도 제한을 센다", async () => {
    const deps = depsWith({ latestInsight: vi.fn(async () => view()) });
    const result = await requestInsight(ctx, BID, RUN, deps);
    expect(result).toMatchObject({
      ok: true,
      status: 202,
      data: { insightId: OLD, status: "PENDING", deduplicated: true },
    });
    expect(deps.repo.insertPending).not.toHaveBeenCalled();
    expect(deps.limiter.hit).toHaveBeenCalledWith(USER);
    expect(deps.enqueue).toHaveBeenCalledWith({ insightId: OLD, orgId: ORG });
  });

  it("직접 넣은 PENDING 에 POST 를 반복해도 분당 3회까지만 큐에 넣고 4번째는 429 다", async () => {
    let hits = 0;
    const deps = depsWith({ latestInsight: vi.fn(async () => view()) });
    deps.limiter.hit.mockImplementation(async () =>
      ++hits <= 3 ? { allowed: true } : { allowed: false, retryAfterSeconds: 30 },
    );
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await requestInsight(ctx, BID, RUN, deps));
    expect(results.map((result) => result.status)).toEqual([202, 202, 202, 429]);
    expect(deps.enqueue).toHaveBeenCalledTimes(3);
  });

  it("지금 버전의 DONE·MODEL 이 있으면 그대로 돌려주고 큐에 넣지 않는다", async () => {
    const deps = depsWith({
      latestInsight: vi.fn(async () =>
        view({ status: "DONE", source: "MODEL", promptVersion: INSIGHT_PROMPT_VERSION }),
      ),
    });
    expect(await requestInsight(ctx, BID, RUN, deps)).toMatchObject({
      status: 202,
      data: { insightId: OLD, status: "DONE", deduplicated: true },
    });
    expect(deps.repo.insertPending).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
    expect(deps.limiter.hit).not.toHaveBeenCalled();
  });

  it.each([
    ["FAILED", view({ status: "FAILED", errorCode: "GATEWAY_UNAVAILABLE" })],
    ["DONE·TEMPLATE", view({ status: "DONE", source: "TEMPLATE" })],
    // 옛 형식 모델 설명은 새 형식으로 다시 요청할 수 있다(ADR-078). DB 제약도 지금 버전만 막는다.
    [
      "옛 버전(insight/v0.1) DONE·MODEL",
      view({ status: "DONE", source: "MODEL", promptVersion: "insight/v0.1" }),
    ],
    ["버전 없는 DONE·MODEL", view({ status: "DONE", source: "MODEL", promptVersion: null })],
  ])("%s 뒤에는 새 행을 만든다", async (_label, latest) => {
    const deps = depsWith({ latestInsight: vi.fn(async () => latest) });
    expect(await requestInsight(ctx, BID, RUN, deps)).toMatchObject({
      data: { insightId: NEW, status: "PENDING", deduplicated: false },
    });
    expect(deps.enqueue).toHaveBeenCalledWith({ insightId: NEW, orgId: ORG });
  });

  it("insert 가 유일 위반이면 먼저 들어간 PENDING 을 읽어 돌려준다(두 번 누르기·relay 재시도)", async () => {
    const latestInsight = vi
      .fn<InsightRepo["latestInsight"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(view());
    const deps = depsWith({ latestInsight, insertPending: vi.fn(async () => null) });
    expect(await requestInsight(ctx, BID, RUN, deps)).toMatchObject({
      status: 202,
      data: { insightId: OLD, status: "PENDING", deduplicated: true },
    });
    expect(deps.enqueue).toHaveBeenCalledTimes(1);
    expect(deps.enqueue).toHaveBeenCalledWith({ insightId: OLD, orgId: ORG });
  });

  it.each([
    ["없는 run(다른 조직 포함)", null],
    ["다른 공고의 run", { id: RUN, bidId: OLD, status: "COMPLETED" }],
    ["끝나지 않은 run", { id: RUN, bidId: BID, status: "RUNNING" }],
    ["실패한 run", { id: RUN, bidId: BID, status: "FAILED" }],
  ])("%s 이면 404 이고 행·큐를 건드리지 않는다", async (_label, run) => {
    const deps = depsWith({ findRun: vi.fn(async () => run) });
    expect(await requestInsight(ctx, BID, RUN, deps)).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
    });
    expect(deps.repo.insertPending).not.toHaveBeenCalled();
    expect(deps.enqueue).not.toHaveBeenCalled();
  });

  it.each(["EXECUTIVE", "VIEWER"] as const)("%s 는 403 이고 DB 를 읽지 않는다", async (role) => {
    const deps = depsWith();
    expect(await requestInsight({ ...ctx, role }, BID, RUN, deps)).toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
    expect(deps.repo.findRun).not.toHaveBeenCalled();
  });

  it("분당 횟수를 넘으면 429 와 다시 시도할 초, 큐 등록이 실패하면 503 queue", async () => {
    const limited = depsWith();
    limited.limiter.hit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 41 });
    expect(await requestInsight(ctx, BID, RUN, limited)).toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      details: { retryAfterSeconds: 41 },
    });
    expect(limited.repo.insertPending).not.toHaveBeenCalled();

    const broken = depsWith();
    const error = new Error("redis://user:secret@host down");
    broken.enqueue.mockRejectedValueOnce(error);
    expect(await requestInsight(ctx, BID, RUN, broken)).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "queue" },
    });
    expect(broken.onInfraError).toHaveBeenCalledWith("queue", error);
  });
});

describe("getInsight", () => {
  it("그 공고의 완료 run 이면 최신 1건이고 previous 는 null(최신이 FAILED 가 아니면 묻지 않는다), 아니면 둘 다 null", async () => {
    const latest = view({ status: "DONE", source: "MODEL", promptVersion: INSIGHT_PROMPT_VERSION });
    const { repo } = depsWith({ latestInsight: vi.fn(async () => latest) });
    expect(await getInsight(ctx, BID, RUN, { repo })).toEqual({ insight: latest, previous: null });
    expect(repo.latestInsight).toHaveBeenCalledWith(ORG, RUN);
    expect(await getInsight(ctx, OLD, RUN, { repo })).toEqual({ insight: null, previous: null });
    expect(repo.latestModelInsight).not.toHaveBeenCalled();
  });

  it("최신이 FAILED 이면 previous 는 그 run 의 마지막 DONE·MODEL 이다(새 형식 재요청 실패 뒤 옛 결과를 계속 보인다)", async () => {
    const failed = view({ id: NEW, status: "FAILED", errorCode: "GATEWAY_UNAVAILABLE" });
    const earlier = view({ status: "DONE", source: "MODEL", promptVersion: "insight/v0.1" });
    const { repo } = depsWith({
      latestInsight: vi.fn(async () => failed),
      latestModelInsight: vi.fn(async () => earlier),
    });
    expect(await getInsight(ctx, BID, RUN, { repo })).toEqual({
      insight: failed,
      previous: earlier,
    });
    expect(repo.latestModelInsight).toHaveBeenCalledWith(ORG, RUN);
  });
});
