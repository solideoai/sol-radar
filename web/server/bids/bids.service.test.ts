import { describe, expect, it, vi } from "vitest";
import { signCursor, fingerprintOf, parseBidListQuery } from "./bid-query";
import type { BidDetail } from "./bid-detail.model";
import type { AnalysisQueue, BidsRepo, CreateAnalysisRun, RunRef } from "./bids.repo";
import {
  getAnalysis,
  getBid,
  listBids,
  requestAnalysis,
  type AnalysisContext,
} from "./bids.service";

const ctx: AnalysisContext = { orgId: "org1", userId: "u1", role: "SALES" };
const input = {
  profileRevision: 2,
  revisionId: "rev1",
  extractionId: null,
  algorithmVersion: "sol-score/v0.1",
};

type Fake = {
  repo: BidsRepo;
  queue: AnalysisQueue;
  created: CreateAnalysisRun[];
  enqueue: ReturnType<typeof vi.fn>;
};

function fake(overrides: Partial<BidsRepo> = {}): Fake {
  const created: CreateAnalysisRun[] = [];
  const enqueue = vi.fn(async () => undefined);
  const repo: BidsRepo = {
    listBids: async () => ({ items: [], hasNext: false, last: null }),
    getBid: async () => ({ id: "b1" }) as unknown as BidDetail,
    listAnalyses: async () => ({ items: [], hasNext: false, last: null }),
    getAnalysis: async () => null,
    findRunningAnalysis: async () => null,
    findCompletedSameInput: async () => null,
    resolveAnalysisInput: async () => input,
    createAnalysisRun: async (run) => {
      created.push(run);
      return { created: { id: `run${created.length}`, status: "QUEUED" } };
    },
    findIdempotency: async () => null,
    markRunFailed: async () => undefined,
    ...overrides,
  };
  return { repo, queue: { enqueue }, created, enqueue };
}

const request = (f: Fake, body: unknown, key: string | null, role = ctx.role) =>
  requestAnalysis({ ...ctx, role }, "b1", body, key, { repo: f.repo, queue: f.queue });

describe("requestAnalysis", () => {
  it("VIEWER 는 403 FORBIDDEN 이다", async () => {
    const f = fake();
    const result = await request(f, {}, "k1", "VIEWER");
    expect(result).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("다른 조직 공고는 404 NOT_FOUND 다", async () => {
    const f = fake({ getBid: async () => null });
    const result = await request(f, {}, "k1");
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });

  it("본문이 틀리면 400 VALIDATION_ERROR 다", async () => {
    const result = await request(fake(), { force: "yes" }, "k1");
    expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
  });

  it("없는 프로필 revision 은 404 다", async () => {
    const f = fake({ resolveAnalysisInput: async () => null });
    const result = await request(f, { profileRevision: 99 }, "k1");
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
  });

  it("실행 중인 분석이 있으면 409 ANALYSIS_IN_PROGRESS 다", async () => {
    const f = fake({ findRunningAnalysis: async () => ({ id: "run0", status: "RUNNING" }) });
    const result = await request(f, { force: true }, "k1");
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "ANALYSIS_IN_PROGRESS",
      details: { analysisId: "run0" },
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("같은 키에 다른 본문이 오면 409 IDEMPOTENCY_KEY_REUSED 다", async () => {
    const f = fake();
    await request(f, { force: true }, "k1");
    const first = f.created[0];
    if (!first) throw new Error("run 이 만들어지지 않았다");
    const stored = {
      requestHash: first.requestHash,
      run: { id: "run1", status: "QUEUED" } as RunRef,
    };
    const g = fake({
      findIdempotency: async (_org, key) => (key === first.idempotencyKey ? stored : null),
    });
    const other = await request(g, { force: false }, "k1");
    expect(other).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(g.enqueue).not.toHaveBeenCalled();
  });

  it("같은 키에 같은 본문이면 첫 응답을 그대로 준다", async () => {
    const f = fake();
    const firstResult = await request(f, { force: true }, "k1");
    const first = f.created[0];
    if (!first) throw new Error("run 이 만들어지지 않았다");
    const g = fake({
      findIdempotency: async (_org, key) =>
        key === first.idempotencyKey
          ? { requestHash: first.requestHash, run: { id: "run1", status: "QUEUED" } }
          : null,
    });
    const replay = await request(g, { force: true }, "k1");
    expect(replay).toEqual(firstResult);
    expect(g.created).toHaveLength(0);
    expect(g.enqueue).not.toHaveBeenCalled();
  });

  it("force:false 에 같은 입력의 완료 run 이 있으면 202 deduplicated 이고 큐를 부르지 않는다", async () => {
    const f = fake({ findCompletedSameInput: async () => ({ id: "done1", status: "COMPLETED" }) });
    const result = await request(f, { force: false }, "k1");
    expect(result).toEqual({
      ok: true,
      status: 202,
      data: {
        analysisId: "done1",
        status: "COMPLETED",
        deduplicated: true,
        pollUrl: "/api/v1/analyses/done1",
      },
    });
    expect(f.created).toHaveLength(0);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("force:true 면 완료 run 이 있어도 새 run 을 만들고 큐를 1회 부른다", async () => {
    const f = fake({ findCompletedSameInput: async () => ({ id: "done1", status: "COMPLETED" }) });
    const result = await request(f, { force: true }, "k1");
    expect(result).toEqual({
      ok: true,
      status: 202,
      data: {
        analysisId: "run1",
        status: "QUEUED",
        deduplicated: false,
        pollUrl: "/api/v1/analyses/run1",
      },
    });
    expect(f.created).toHaveLength(1);
    expect(f.created[0]).toMatchObject({
      orgId: "org1",
      bidId: "b1",
      profileRevision: 2,
      revisionId: "rev1",
      extractionId: null,
      algorithmVersion: "sol-score/v0.1",
      idempotencyKey: "org1:k1",
    });
    expect(f.enqueue).toHaveBeenCalledTimes(1);
    expect(f.enqueue).toHaveBeenCalledWith({
      orgId: "org1",
      scoreRunId: "run1",
      idempotencyKey: "org1:k1",
    });
  });

  it("큐에 넣기 전에 QUEUED 행을 먼저 만든다", async () => {
    const order: string[] = [];
    const f = fake({
      createAnalysisRun: async () => {
        order.push("create");
        return { created: { id: "run1", status: "QUEUED" } };
      },
    });
    f.enqueue.mockImplementation(async () => {
      order.push("enqueue");
    });
    await request(f, {}, "k1");
    expect(order).toEqual(["create", "enqueue"]);
  });

  it("키가 없으면 서버가 UUID 키를 만든다", async () => {
    const f = fake();
    await request(f, undefined, null);
    expect(f.created[0]?.idempotencyKey).toMatch(/^org1:[0-9a-f-]{36}$/);
  });

  it("본문이 없어도 기본값(force:false)으로 받는다", async () => {
    const f = fake();
    const result = await request(f, undefined, "k2");
    expect(result.ok).toBe(true);
  });
});

describe("같은 입력 판정 (04 §5, 05 §4.5)", () => {
  it("중복 판정에 입력 전체를 넘긴다", async () => {
    const running = vi.fn(async () => null);
    const done = vi.fn(async () => null);
    const f = fake({ findRunningAnalysis: running, findCompletedSameInput: done });
    await request(f, { force: false }, "k1");
    expect(running).toHaveBeenCalledWith("org1", "b1", input);
    expect(done).toHaveBeenCalledWith("org1", "b1", input);
  });

  it("공고 revision 이 바뀌면 예전 완료 run 을 돌려주지 않고 새 run 을 만든다", async () => {
    const f = fake({
      findCompletedSameInput: async (_org, _bid, wanted) =>
        wanted.revisionId === "rev1" ? { id: "old", status: "COMPLETED" } : null,
      resolveAnalysisInput: async () => ({ ...input, revisionId: "rev2" }),
    });
    const result = await request(f, { force: false }, "k1");
    expect(result).toMatchObject({ ok: true, data: { analysisId: "run1", deduplicated: false } });
    expect(f.enqueue).toHaveBeenCalledTimes(1);
  });

  it("force:false 에 같은 입력이 진행 중이면 202 deduplicated 이고 새 행도 큐도 없다", async () => {
    const f = fake({ findRunningAnalysis: async () => ({ id: "run0", status: "RUNNING" }) });
    const result = await request(f, { force: false }, "k1");
    expect(result).toEqual({
      ok: true,
      status: 202,
      data: {
        analysisId: "run0",
        status: "RUNNING",
        deduplicated: true,
        pollUrl: "/api/v1/analyses/run0",
      },
    });
    expect(f.created).toHaveLength(0);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("force:true 에 같은 입력이 진행 중이면 409 이고 details.analysisId 가 있다", async () => {
    const f = fake({ findRunningAnalysis: async () => ({ id: "run0", status: "QUEUED" }) });
    const result = await request(f, { force: true }, "k1");
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "ANALYSIS_IN_PROGRESS",
      details: { analysisId: "run0" },
    });
  });
});

describe("동시 요청 충돌", () => {
  it("ACTIVE_INPUT 충돌 + force:false 는 202 deduplicated 다", async () => {
    const f = fake({
      createAnalysisRun: async () => ({
        conflict: "ACTIVE_INPUT",
        run: { id: "run9", status: "QUEUED" },
      }),
    });
    const result = await request(f, { force: false }, "k1");
    expect(result).toMatchObject({
      ok: true,
      status: 202,
      data: { analysisId: "run9", deduplicated: true },
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("ACTIVE_INPUT 충돌 + force:true 는 409 ANALYSIS_IN_PROGRESS 다", async () => {
    const f = fake({
      createAnalysisRun: async () => ({
        conflict: "ACTIVE_INPUT",
        run: { id: "run9", status: "RUNNING" },
      }),
    });
    const result = await request(f, { force: true }, "k1");
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      code: "ANALYSIS_IN_PROGRESS",
      details: { analysisId: "run9" },
    });
  });

  it("IDEMPOTENCY_KEY 충돌 + 같은 본문이면 첫 응답을 재생한다", async () => {
    const probe = fake();
    await request(probe, { force: true }, "k1");
    const hash = probe.created[0]?.requestHash ?? "";
    let calls = 0;
    const f = fake({
      findIdempotency: async () => {
        calls += 1;
        return calls === 1 ? null : { requestHash: hash, run: { id: "run9", status: "QUEUED" } };
      },
      createAnalysisRun: async () => ({
        conflict: "IDEMPOTENCY_KEY",
        run: { id: "run9", status: "QUEUED" },
      }),
    });
    const result = await request(f, { force: true }, "k1");
    expect(result).toMatchObject({
      ok: true,
      status: 202,
      data: { analysisId: "run9", deduplicated: false },
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("IDEMPOTENCY_KEY 충돌 + 다른 본문이면 409 IDEMPOTENCY_KEY_REUSED 다", async () => {
    let calls = 0;
    const f = fake({
      findIdempotency: async () => {
        calls += 1;
        return calls === 1 ? null : { requestHash: "other", run: { id: "run9", status: "QUEUED" } };
      },
      createAnalysisRun: async () => ({
        conflict: "IDEMPOTENCY_KEY",
        run: { id: "run9", status: "QUEUED" },
      }),
    });
    const result = await request(f, { force: true }, "k1");
    expect(result).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });
});

describe("enqueue 실패", () => {
  it("503 뒤 같은 키로 재시도하면 새 run 을 만들고 enqueue 한다", async () => {
    const keys = new Map<string, { requestHash: string; run: RunRef }>();
    let seq = 0;
    const f = fake({
      findIdempotency: async (_org, key) => keys.get(key) ?? null,
      createAnalysisRun: async (run) => {
        seq += 1;
        const ref: RunRef = { id: `run${seq}`, status: "QUEUED" };
        keys.set(run.idempotencyKey, { requestHash: run.requestHash, run: ref });
        return { created: ref };
      },
      // 포트 계약: 실패 표시는 그 run 의 idempotency_key 를 푼다
      markRunFailed: async (_org, id) => {
        for (const [key, value] of keys) if (value.run.id === id) keys.delete(key);
      },
    });
    f.enqueue.mockRejectedValueOnce(new Error("redis down"));
    const first = await request(f, { force: true }, "k1");
    expect(first).toMatchObject({ ok: false, status: 503 });
    const retry = await request(f, { force: true }, "k1");
    expect(retry).toMatchObject({ ok: true, status: 202, data: { analysisId: "run2" } });
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });

  it("큐가 던지면 run 을 FAILED 로 표시하고 503 을 돌려준다", async () => {
    const markRunFailed = vi.fn(async () => undefined);
    const f = fake({ markRunFailed });
    f.enqueue.mockRejectedValueOnce(new Error("redis down"));
    const result = await request(f, { force: true }, "k1");
    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "queue" },
    });
    expect(markRunFailed).toHaveBeenCalledTimes(1);
    expect(markRunFailed).toHaveBeenCalledWith("org1", "run1", "ENQUEUE_FAILED");
  });

  it("실패한 run 은 active 로 세지 않아 같은 입력의 다음 요청이 새 run 을 만든다", async () => {
    const active = new Set<string>();
    let seq = 0;
    const f = fake({
      findRunningAnalysis: async () => {
        const id = [...active][0];
        return id === undefined ? null : { id, status: "QUEUED" };
      },
      createAnalysisRun: async () => {
        seq += 1;
        active.add(`run${seq}`);
        return { created: { id: `run${seq}`, status: "QUEUED" } };
      },
      markRunFailed: async (_org, id) => {
        active.delete(id);
      },
    });
    f.enqueue.mockRejectedValueOnce(new Error("redis down"));
    const first = await request(f, { force: true }, "k1");
    expect(first.ok).toBe(false);
    const second = await request(f, { force: true }, "k2");
    expect(second).toMatchObject({ ok: true, status: 202, data: { analysisId: "run2" } });
  });
});

describe("조회", () => {
  const secret = "s";

  it("getBid 는 없으면 404 다", async () => {
    const f = fake({ getBid: async () => null });
    expect(await getBid("org1", "x", { repo: f.repo })).toMatchObject({ ok: false, status: 404 });
  });

  it("getAnalysis 는 repo 값을 그대로 넘기고 없으면 404 다", async () => {
    const f = fake();
    expect(await getAnalysis("org1", "x", { repo: f.repo })).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it("listBids 는 다음 쪽 커서를 서명해 낸다", async () => {
    const query = parseBidListQuery({}, "mock");
    if (!query.ok) throw new Error("쿼리 오류");
    const f = fake({
      listBids: async () => ({
        items: [],
        hasNext: true,
        last: { sortValue: "2026-10-01T00:00:00Z", id: "b9" },
      }),
    });
    const result = await listBids("org1", query.value, secret, { repo: f.repo });
    expect(result.ok && result.data.pageInfo.hasNext).toBe(true);
    expect(result.ok && result.data.pageInfo.nextCursor).toEqual(expect.any(String));
  });

  it("listBids 는 변조된 커서를 400 INVALID_CURSOR 로 막는다", async () => {
    const query = parseBidListQuery({ cursor: "bad.cursor" }, "mock");
    if (!query.ok) throw new Error("쿼리 오류");
    const f = fake();
    expect(await listBids("org1", query.value, secret, { repo: f.repo })).toMatchObject({
      ok: false,
      status: 400,
      code: "INVALID_CURSOR",
    });
  });

  it("listBids 는 유효한 커서의 위치를 repo 에 넘긴다", async () => {
    const base = parseBidListQuery({}, "mock");
    if (!base.ok) throw new Error("쿼리 오류");
    const payload = { sortValue: "x", id: "b1", queryFingerprint: fingerprintOf(base.value) };
    const cursor = signCursor(payload, secret);
    const withCursor = parseBidListQuery({ cursor }, "mock");
    if (!withCursor.ok) throw new Error("쿼리 오류");
    const listSpy = vi.fn(async () => ({ items: [], hasNext: false, last: null }));
    const f = fake({ listBids: listSpy });
    await listBids("org1", withCursor.value, secret, { repo: f.repo });
    expect(listSpy).toHaveBeenCalledWith("org1", withCursor.value, payload);
  });
});
