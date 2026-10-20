import { describe, expect, it, vi } from "vitest";
import type { Tables } from "@/lib/database.types";
import { getIngestionRun, listIngestionRuns, requestIngestionRun } from "@/server/ingestion";

// N8 수집 관리 서비스. 구현(ingestion-admin.service.ts)보다 먼저 쓴 시험이다.
// 근거: 05 §2(:75-77)·IngestionRunInput(:361-366)·IngestionRun(:367-376)·검증(:428)·오류 §5(:482-504)·§6.5·6.6,
// 04 §3.6(:208-209), 계획서 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1 POST 순서 1~11·GET 절, e8 추가 판정 1~3.
// 보안 점검 W1(계획 §5, 2026-10-20): 화면 역할은 ingest_runs 를 열 단위로만 읽는다(job_key·idempotency_key·requested_by·params 없음).
// 목록·단건의 requestedBy 는 행의 requested_by 가 아니라 지금 조직 감사(INGEST_MANUAL)의 actor 를 findManualRequesters 로 찾고,
// 그 사람 이름을 지금 조직 구성원(findMemberNames)에서 찾는다. 감사가 없거나 구성원이 아니면 null 이다.
// 견본: server/bids/bids.service.test.ts 의 requestAnalysis 시험(가짜 deps·LazyBody·순서 단언).
//
// ── 시험이 고정하는 의존성 모양. 구현자는 이 모양을 받는다(가짜는 아래 fake() 가 만든다) ──
// 결과는 bids ServiceResult 와 같은 모양: { ok: true, status, data } | { ok: false, status, code, message, details? }

type Role = "ADMIN" | "SALES" | "ANALYST" | "VIEWER";
type Ctx = { orgId: string; userId: string; role: Role };
type RunMode = "live" | "fixture" | "mock";
/** 화면 역할이 읽는 ingest_runs 열(20261019000019, W1). job_key·idempotency_key·requested_by·params 는 없다 */
type IngestRunRow = Pick<
  Tables<"ingest_runs">,
  | "id"
  | "source"
  | "run_mode"
  | "trigger"
  | "batch"
  | "cursor"
  | "status"
  | "summary"
  | "quota_used"
  | "started_at"
  | "finished_at"
>;
type IngestErrorRow = Tables<"ingest_errors">;
/** keyset 위치. 목록은 started_at desc, id desc 다 */
type RunPosition = { startedAt: string; id: string };
/**
 * Redis 키 idem:ingest:<orgId>:<requestId> 의 값. requesterId 는 첫 202 를 받은 사람이다(I1, 2026-10-20 보안 점검 후속).
 * 그 전에 쓴 기록에는 없다(하위 호환: 재현의 requestedBy 는 null).
 */
type IdempotencyRecord = {
  requestHash: string;
  runId: string;
  startedAt: string;
  requesterId?: string;
};
type HitResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };
type BodyRead = { ok: true; value: unknown } | { ok: false };
type LazyBody = { declaredTooLarge: boolean; read: () => Promise<BodyRead> };

type AdminRepo = {
  /** started_at desc, id desc 로 after 뒤부터 limit 개까지. 서비스는 다음 쪽을 보려고 query.limit + 1 을 넘긴다 */
  listRuns(query: { limit: number; after: RunPosition | null }): Promise<IngestRunRow[]>;
  findRun(id: string): Promise<IngestRunRow | null>;
  /** 주어진 run 들의 ingest_errors 행(섞여서 올 수 있다. 서비스가 ingest_run_id 로 나눈다) */
  listErrors(runIds: string[]): Promise<IngestErrorRow[]>;
  /** 같은 source 의 status = RUNNING 행(사용자 세션·RLS 로 읽는다) */
  findRunningRun(source: string): Promise<{ id: string } | null>;
  /** userId → 이름. orgId(지금 조직) 구성원만 담는다. 다른 조직 사람은 빠진다 */
  findMemberNames(orgId: string, userIds: string[]): Promise<Map<string, string>>;
  /**
   * runId → 요청자 id. orgId(지금 조직) 감사(action INGEST_MANUAL, target_type ingest_run)의 actor_id 다(W1).
   * 감사가 없거나(일정·데모 수집, 다른 조직이 요청한 run) actor_id 가 null 이면 빠진다
   */
  findManualRequesters(orgId: string, runIds: string[]): Promise<Map<string, string>>;
};
type Idempotency = {
  get(key: string): Promise<IdempotencyRecord | null>;
  /** SET NX EX. 이미 있으면 false */
  claim(key: string, value: IdempotencyRecord, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
};
type CursorCodec = {
  sign(position: RunPosition): string;
  /** 변조·만료·다른 조직이면 null */
  verify(token: string): RunPosition | null;
};
type AdminDeps = {
  repo: AdminRepo;
  queue: { enqueue(data: unknown): Promise<void> };
  idempotency: Idempotency;
  limiter: { hit(orgId: string): Promise<HitResult> };
  runMode: RunMode;
  now: () => Date;
  newId: () => string;
  /** null 이면 커서 비밀이 없다 → 목록은 503 {component:"cursor"} */
  cursor: CursorCodec | null;
  onInfraError?: (component: string, error: unknown) => void;
};

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const ORG_B = "4b5c6d7e-8f9a-4b1c-9d2e-3f4a5b6c7d8e";
const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f"; // ORG_ID 의 ADMIN
const MEMBER_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d"; // ORG_ID 의 다른 구성원
const SECOND_ADMIN_ID = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b"; // ORG_ID 의 다른 ADMIN
const USER_B = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f"; // ORG_B 의 ADMIN
const OUTSIDER_ID = "8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a"; // ORG_ID 구성원이 아님
const ADMIN_NAME = "김수집";
const MEMBERS: Record<string, Record<string, string>> = {
  [ORG_ID]: { [USER_ID]: ADMIN_NAME, [MEMBER_ID]: "이분석", [SECOND_ADMIN_ID]: "최관리" },
  [ORG_B]: { [USER_B]: "박다른" },
};

const ADMIN: Ctx = { orgId: ORG_ID, userId: USER_ID, role: "ADMIN" };
const ADMIN_B: Ctx = { orgId: ORG_B, userId: USER_B, role: "ADMIN" };
const SECOND_ADMIN: Ctx = { orgId: ORG_ID, userId: SECOND_ADMIN_ID, role: "ADMIN" };
const KEY = "req-20261020_a1";
const IDEM_KEY = `idem:ingest:${ORG_ID}:${KEY}`;
const NOW = new Date("2026-10-20T03:04:05.678Z");
const NOW_ISO = NOW.toISOString();
const LATER = new Date("2026-10-20T03:09:00.000Z");
const RUNNING_ID = "2e3f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b";

const FIXTURE_SEED = { source: "fixture", batch: "seed" };
const FIXTURE_LIVE = { source: "fixture", batch: "live" };
const WINDOW = { from: "2026-10-15T00:00:00Z", to: "2026-10-16T00:00:00Z" };
// 05 §6.6 live 예시 본문
const G2B_BODY = { source: "g2b", window: WINDOW, stages: ["NOTICE"] };
const ZERO_SUMMARY = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

// newId 가 차례로 내는 UUID(z.uuid() 를 통과하는 v4 모양)
const generatedUuid = (n: number): string =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const memberNames = async (orgId: string, userIds: string[]): Promise<Map<string, string>> => {
  const members = MEMBERS[orgId] ?? {};
  return new Map(
    userIds.flatMap((id): [string, string][] => {
      const name = members[id];
      return name === undefined ? [] : [[id, name]];
    }),
  );
};

type FakeOptions = {
  runMode?: RunMode;
  now?: () => Date;
  cursor?: CursorCodec | null;
  /** newId 가 내는 첫 번호. 두 가짜가 같은 UUID 를 내지 않게 한다 */
  firstIdNumber?: number;
};

function fake(options: FakeOptions = {}) {
  const store = new Map<string, IdempotencyRecord>();
  const generated: string[] = [];
  // 조직별 수동 수집 감사(orgId → runId → actorId). RLS 처럼 부른 조직의 감사만 돌려준다.
  const audits = new Map<string, Map<string, string>>();
  const repo = {
    listRuns: vi.fn<AdminRepo["listRuns"]>(async () => []),
    findRun: vi.fn<AdminRepo["findRun"]>(async () => null),
    listErrors: vi.fn<AdminRepo["listErrors"]>(async () => []),
    findRunningRun: vi.fn<AdminRepo["findRunningRun"]>(async () => null),
    findMemberNames: vi.fn<AdminRepo["findMemberNames"]>(memberNames),
    findManualRequesters: vi.fn<AdminRepo["findManualRequesters"]>(async (orgId, runIds) => {
      const byRun = audits.get(orgId) ?? new Map<string, string>();
      return new Map(
        runIds.flatMap((id): [string, string][] => {
          const actor = byRun.get(id);
          return actor === undefined ? [] : [[id, actor]];
        }),
      );
    }),
  };
  const enqueue = vi.fn<(data: unknown) => Promise<void>>(async () => undefined);
  // 메모리 SET NX: 있으면 false, 없으면 넣고 true
  const get = vi.fn<Idempotency["get"]>(async (key) => store.get(key) ?? null);
  const claim = vi.fn<Idempotency["claim"]>(async (key, value) => {
    if (store.has(key)) return false;
    store.set(key, value);
    return true;
  });
  const release = vi.fn<Idempotency["release"]>(async (key) => {
    store.delete(key);
  });
  const hit = vi.fn<AdminDeps["limiter"]["hit"]>(async () => ({ allowed: true }));
  const newId = vi.fn(() => {
    const id = generatedUuid((options.firstIdNumber ?? 1) + generated.length);
    generated.push(id);
    return id;
  });
  const sign = vi.fn<CursorCodec["sign"]>(
    (position) => `signed:${position.startedAt}|${position.id}`,
  );
  const verify = vi.fn<CursorCodec["verify"]>(() => null);
  const onInfraError = vi.fn<(component: string, error: unknown) => void>();
  const deps: AdminDeps = {
    repo,
    queue: { enqueue },
    idempotency: { get, claim, release },
    limiter: { hit },
    runMode: options.runMode ?? "fixture",
    now: options.now ?? (() => NOW),
    newId,
    cursor: options.cursor === undefined ? { sign, verify } : options.cursor,
    onInfraError,
  };
  return {
    deps,
    repo,
    store,
    audits,
    generated,
    enqueue,
    get,
    claim,
    release,
    hit,
    newId,
    sign,
    verify,
    onInfraError,
  };
}
type Fake = ReturnType<typeof fake>;

const bodyOf = (value: unknown, declaredTooLarge = false) => ({
  declaredTooLarge,
  read: vi.fn<LazyBody["read"]>(async () => ({ ok: true, value })),
});

const postWith = (f: Fake, body: LazyBody, key: string | null = KEY, ctx: Ctx = ADMIN) =>
  requestIngestionRun(ctx, body, key, f.deps);
const post = (f: Fake, body: unknown, key: string | null = KEY, ctx: Ctx = ADMIN) =>
  postWith(f, bodyOf(body), key, ctx);

type Called = { mock: { calls: unknown[]; invocationCallOrder: number[] } };
// 불린 함수 이름을 처음 불린 순서대로
const callOrder = (fns: Record<string, Called>): string[] =>
  Object.entries(fns)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .sort(
      ([, a], [, b]) => (a.mock.invocationCallOrder[0] ?? 0) - (b.mock.invocationCallOrder[0] ?? 0),
    )
    .map(([name]) => name);

// 저장·큐·Redis 의존성 전부
const backendOf = (f: Fake): Record<string, Called> => ({
  hit: f.hit,
  get: f.get,
  claim: f.claim,
  release: f.release,
  enqueue: f.enqueue,
  listRuns: f.repo.listRuns,
  findRun: f.repo.findRun,
  listErrors: f.repo.listErrors,
  findRunningRun: f.repo.findRunningRun,
  findMemberNames: f.repo.findMemberNames,
  findManualRequesters: f.repo.findManualRequesters,
});

type EnqueuedJob = { jobKey: string; idempotencyKey: string; runId: string };
const firstJob = (f: Fake): EnqueuedJob => {
  const job = f.enqueue.mock.calls[0]?.[0];
  if (job === undefined) throw new Error("큐에 넣지 않았다");
  return job as EnqueuedJob;
};

const VALIDATION_ISSUES = {
  issues: expect.arrayContaining([
    expect.objectContaining({ path: expect.any(String), message: expect.any(String) }),
  ]),
};
// 분석 요청(bids.service.ts bodyTooLarge)과 같은 응답
const TOO_LARGE = {
  ok: false,
  status: 400,
  code: "VALIDATION_ERROR",
  details: { issues: [{ path: "body", message: expect.any(String) }] },
};
const FORBIDDEN = {
  ok: false,
  status: 403,
  code: "FORBIDDEN",
  message: expect.any(String),
  details: { required: ["ADMIN"] },
};

// ───────────────────────── POST /admin/ingestion/runs ─────────────────────────

describe("requestIngestionRun — 권한(§1-1)", () => {
  it.each<Role>(["SALES", "ANALYST", "VIEWER"])(
    "%s 는 403 FORBIDDEN {required:[ADMIN]} 이고 저장·큐·Redis·본문을 건드리지 않는다",
    async (role) => {
      const f = fake();
      const body = bodyOf(FIXTURE_SEED);

      const result = await postWith(f, body, KEY, { ...ADMIN, role });

      expect(result).toStrictEqual(FORBIDDEN);
      expect(callOrder(backendOf(f))).toStrictEqual([]);
      expect(body.read).not.toHaveBeenCalled();
    },
  );

  it("권한 검사가 키 형식·본문 크기 검사보다 먼저다", async () => {
    const f = fake();
    const body = bodyOf(FIXTURE_SEED, true);

    const result = await postWith(f, body, "a b", { ...ADMIN, role: "VIEWER" });

    expect(result).toStrictEqual(FORBIDDEN);
  });
});

describe("requestIngestionRun — Idempotency-Key 형식(§1-2, ^[A-Za-z0-9_-]{1,128}$)", () => {
  it.each<[string, string]>([
    ["공백", "a b"],
    ["129자", "x".repeat(129)],
    ["ASCII 밖 문자 ü", "ü"],
    ["한글", "요청1"],
    ["빈 문자열", ""],
    ["콜론(저장 키 구분자)", "a:b"],
    ["슬래시", "a/b"],
    ["점", "a.b"],
  ])(
    "%s 는 400 VALIDATION_ERROR(path Idempotency-Key)이고 속도 제한·본문을 건드리지 않는다",
    async (_label, key) => {
      const f = fake();
      const body = bodyOf(FIXTURE_SEED);

      const result = await postWith(f, body, key);

      expect(result).toMatchObject({
        ok: false,
        status: 400,
        code: "VALIDATION_ERROR",
        details: { issues: [{ path: "Idempotency-Key" }] },
      });
      expect(callOrder(backendOf(f))).toStrictEqual([]);
      expect(body.read).not.toHaveBeenCalled();
    },
  );

  it.each<[string, string]>([
    ["1자", "a"],
    ["128자", "x".repeat(128)],
    ["대소문자·숫자·_·-", "AZaz09_-"],
    ["UUID", "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e"],
  ])("%s 키는 받아 jobKey·idempotencyKey 에 그대로 쓴다", async (_label, key) => {
    const f = fake();

    const result = await post(f, FIXTURE_SEED, key);

    expect(result).toMatchObject({ ok: true, status: 202 });
    expect(firstJob(f)).toMatchObject({
      jobKey: `manual:${ORG_ID}:${key}`,
      idempotencyKey: `${ORG_ID}:${key}`,
    });
  });

  it("키가 없으면 newId 로 만든 requestId 를 jobKey·idempotencyKey 에 쓰고 runId 와는 다른 값이다", async () => {
    const f = fake();

    const result = await post(f, FIXTURE_SEED, null);

    expect(result).toMatchObject({ ok: true, status: 202 });
    const job = firstJob(f);
    const requestId = f.generated.find((id) => job.idempotencyKey === `${ORG_ID}:${id}`);
    expect(requestId).toEqual(expect.any(String));
    expect(job.jobKey).toBe(`manual:${ORG_ID}:${requestId}`);
    expect(f.generated).toContain(job.runId);
    expect(job.runId).not.toBe(requestId);
  });
});

describe("requestIngestionRun — 본문 크기(§1-3, 분석과 같은 응답)", () => {
  it("선언된 크기가 상한을 넘으면 400 body 이고 속도 제한 횟수를 쓰지 않으며 본문을 읽지 않는다", async () => {
    const f = fake();
    const body = bodyOf(FIXTURE_SEED, true);

    const result = await postWith(f, body);

    expect(result).toMatchObject(TOO_LARGE);
    expect(callOrder(backendOf(f))).toStrictEqual([]);
    expect(body.read).not.toHaveBeenCalled();
  });

  it("키 형식 검사가 본문 크기 검사보다 먼저다", async () => {
    const result = await postWith(fake(), bodyOf(FIXTURE_SEED, true), "a b");

    expect(result).toMatchObject({
      status: 400,
      details: { issues: [{ path: "Idempotency-Key" }] },
    });
  });

  it("읽어 보니 상한을 넘으면 속도 제한 뒤에 400 body 이고 멱등·큐를 건드리지 않는다", async () => {
    const f = fake();
    const body = {
      declaredTooLarge: false,
      read: vi.fn<LazyBody["read"]>(async () => ({ ok: false })),
    };

    const result = await postWith(f, body);

    expect(result).toMatchObject(TOO_LARGE);
    expect(callOrder(backendOf(f))).toStrictEqual(["hit"]);
  });
});

describe("requestIngestionRun — 속도 제한(§1-4)", () => {
  it("한도를 넘으면 429 RATE_LIMITED {retryAfterSeconds} 이고 본문을 읽지 않는다", async () => {
    const f = fake();
    f.hit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 17 });
    const body = bodyOf(FIXTURE_SEED);

    const result = await postWith(f, body);

    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: "RATE_LIMITED",
      details: { retryAfterSeconds: 17 },
    });
    expect(f.hit).toHaveBeenCalledWith(ORG_ID);
    expect(body.read).not.toHaveBeenCalled();
    expect(callOrder(backendOf(f))).toStrictEqual(["hit"]);
  });

  it("속도 제한이 본문 검증보다 먼저다(틀린 본문 + 한도 초과 → 429)", async () => {
    const f = fake();
    f.hit.mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 3 });

    const result = await post(f, { source: "nara" });

    expect(result).toMatchObject({ ok: false, status: 429, code: "RATE_LIMITED" });
  });

  it("속도 제한 저장소가 던지면 원인을 onInfraError(redis) 로 넘기고 503 {component:redis} 다", async () => {
    const f = fake();
    const cause = new Error("redis down");
    f.hit.mockRejectedValueOnce(cause);
    const body = bodyOf(FIXTURE_SEED);

    const result = await postWith(f, body);

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "redis" },
    });
    expect(f.onInfraError).toHaveBeenCalledTimes(1);
    expect(f.onInfraError).toHaveBeenCalledWith("redis", cause);
    expect(body.read).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("로그 콜백이 던져도 503 {component:redis} 다", async () => {
    const f = fake();
    f.hit.mockRejectedValueOnce(new Error("redis down"));
    f.onInfraError.mockImplementationOnce(() => {
      throw new Error("log failed");
    });

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({ ok: false, status: 503, details: { component: "redis" } });
  });
});

describe("requestIngestionRun — 본문 검증(§1-5, 05 :428)", () => {
  it.each<[string, unknown]>([
    ["fixture 에 batch 없음", { source: "fixture" }],
    ["fixture 에 window 있음", { ...FIXTURE_SEED, window: WINDOW }],
    ["fixture 에 stages 있음", { ...FIXTURE_SEED, stages: ["NOTICE"] }],
    ["g2b 에 batch 있음", { source: "g2b", batch: "seed" }],
    [
      "window 7일 초과",
      { source: "g2b", window: { from: "2026-10-08T00:00:00Z", to: "2026-10-15T00:00:01Z" } },
    ],
    ["window from = to", { source: "g2b", window: { from: WINDOW.from, to: WINDOW.from } }],
    ["window from > to", { source: "g2b", window: { from: WINDOW.to, to: WINDOW.from } }],
    ["stages [PRE_SPEC]", { source: "g2b", stages: ["PRE_SPEC"] }],
    ["stages [NOTICE, PLAN]", { source: "g2b", stages: ["NOTICE", "PLAN"] }],
    ["batch 대문자 SEED", { source: "fixture", batch: "SEED" }],
    ["source 밖", { source: "nara" }],
    ["본문 없음", undefined],
  ])(
    "%s 면 400 VALIDATION_ERROR {issues} 이고 멱등·진행 중·큐를 건드리지 않는다",
    async (_label, body) => {
      const f = fake({ runMode: "live" });

      const result = await post(f, body);

      expect(result).toMatchObject({
        ok: false,
        status: 400,
        code: "VALIDATION_ERROR",
        details: VALIDATION_ISSUES,
      });
      expect(callOrder(backendOf(f))).toStrictEqual(["hit"]);
    },
  );

  it.each<[string, unknown]>([
    ["stages 생략", { source: "g2b", window: WINDOW }],
    ["stages [NOTICE]", G2B_BODY],
  ])("g2b %s 는 202 이고 job data 에 stages 키가 없다", async (_label, body) => {
    const f = fake({ runMode: "live" });

    const result = await post(f, body);

    expect(result).toMatchObject({ ok: true, status: 202 });
    expect(firstJob(f)).not.toHaveProperty("stages");
  });

  it.each([
    ["seed", "SEED"],
    ["live", "LIVE"],
  ])("batch %s 는 job data 에 %s 로 넣는다", async (batch, stored) => {
    const f = fake();

    await post(f, { source: "fixture", batch });

    expect(firstJob(f)).toMatchObject({ source: "fixture", batch: stored });
  });
});

describe("requestIngestionRun — 실행 모드(§1-6, 409 RUN_MODE_MISMATCH)", () => {
  it.each<[RunMode, "g2b" | "fixture", unknown]>([
    ["live", "fixture", FIXTURE_SEED],
    ["fixture", "g2b", { source: "g2b" }],
    ["mock", "g2b", { source: "g2b" }],
  ])(
    "%s 모드에 %s 요청은 409 {runMode, source} 이고 멱등·진행 중·큐를 건드리지 않는다",
    async (runMode, source, body) => {
      const f = fake({ runMode });

      const result = await post(f, body);

      expect(result).toMatchObject({ ok: false, status: 409, code: "RUN_MODE_MISMATCH" });
      expect(result.ok ? null : result.details).toStrictEqual({ runMode, source });
      expect(callOrder(backendOf(f))).toStrictEqual(["hit"]);
    },
  );

  it.each<[RunMode, unknown]>([
    ["live", G2B_BODY],
    ["fixture", FIXTURE_SEED],
    ["mock", FIXTURE_LIVE],
  ])("%s 모드에 맞는 소스는 202 다", async (runMode, body) => {
    expect(await post(fake({ runMode }), body)).toMatchObject({ ok: true, status: 202 });
  });

  it("본문 검증이 실행 모드 검사보다 먼저다(mock 모드 + g2b 에 batch → 400)", async () => {
    const result = await post(fake({ runMode: "mock" }), { source: "g2b", batch: "seed" });

    expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
  });
});

describe("requestIngestionRun — 멱등(§1-7·9, Redis idem:ingest:<orgId>:<requestId>)", () => {
  // I1(2026-10-20): 기록에 첫 요청자 requesterId 를 더한다. 재현의 requestedBy 를 이 사람으로 낸다.
  it("키 idem:ingest:<orgId>:<requestId> 를 읽고, {requestHash, runId, startedAt, requesterId} 를 TTL 86400 초로 잡는다", async () => {
    const f = fake();

    const result = await post(f, FIXTURE_SEED);

    expect(f.get).toHaveBeenCalledWith(IDEM_KEY);
    expect(f.claim).toHaveBeenCalledTimes(1);
    const [key, value, ttl] = f.claim.mock.calls[0] ?? [];
    expect(key).toBe(IDEM_KEY);
    expect(ttl).toBe(86_400);
    expect(value).toStrictEqual({
      requestHash: expect.any(String),
      runId: firstJob(f).runId,
      startedAt: NOW_ISO,
      requesterId: USER_ID,
    });
    expect(result).toMatchObject({ ok: true, data: { id: firstJob(f).runId } });
  });

  it("같은 키·같은 본문이면 첫 202(같은 runId·startedAt)를 그대로 주고 큐를 다시 부르지 않는다", async () => {
    let now = NOW;
    const f = fake({ now: () => now });
    const first = await post(f, FIXTURE_SEED);
    now = LATER;

    const again = await post(f, FIXTURE_SEED);

    expect(first).toMatchObject({ ok: true, status: 202, data: { startedAt: NOW_ISO } });
    expect(again).toStrictEqual(first);
    expect(f.enqueue).toHaveBeenCalledTimes(1);
    expect(f.claim).toHaveBeenCalledTimes(1);
  });

  it("그 run 이 RUNNING 이어도 같은 키·같은 본문은 409 가 아니라 첫 202 다(재현이 진행 중 검사보다 먼저)", async () => {
    const f = fake();
    const first = await post(f, FIXTURE_SEED);
    f.repo.findRunningRun.mockResolvedValue({ id: firstJob(f).runId });

    const again = await post(f, FIXTURE_SEED);

    expect(again).toStrictEqual(first);
    expect(f.enqueue).toHaveBeenCalledTimes(1);
  });

  it("같은 키·다른 본문이면 409 IDEMPOTENCY_KEY_REUSED 이고 큐를 다시 부르지 않는다", async () => {
    const f = fake();
    await post(f, FIXTURE_SEED);

    const other = await post(f, FIXTURE_LIVE);

    expect(other).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(f.enqueue).toHaveBeenCalledTimes(1);
    expect(f.claim).toHaveBeenCalledTimes(1);
  });

  it("같은 키·다른 본문은 RUNNING 행이 있어도 INGESTION_IN_PROGRESS 가 아니라 IDEMPOTENCY_KEY_REUSED 다", async () => {
    const f = fake();
    await post(f, FIXTURE_SEED);
    f.repo.findRunningRun.mockResolvedValue({ id: firstJob(f).runId });

    const other = await post(f, FIXTURE_LIVE);

    expect(other).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("다른 키면 같은 본문이라도 새 run 으로 넣는다", async () => {
    const f = fake();
    const first = await post(f, FIXTURE_SEED, "req-a");

    const second = await post(f, FIXTURE_SEED, "req-b");

    expect(second).toMatchObject({ ok: true, status: 202 });
    expect(second.ok && first.ok && second.data.id !== first.data.id).toBe(true);
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });

  it("다른 조직의 같은 키는 서로 막지 않는다(키에 조직이 들어간다)", async () => {
    const f = fake();
    await post(f, FIXTURE_SEED, KEY, ADMIN);

    const other = await post(f, FIXTURE_LIVE, KEY, ADMIN_B);

    expect(other).toMatchObject({ ok: true, status: 202 });
    expect(f.get).toHaveBeenLastCalledWith(`idem:ingest:${ORG_B}:${KEY}`);
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });

  it("키 잡기 경쟁에서 지면 다시 읽어 같은 본문이면 먼저 들어간 202 를 준다", async () => {
    const winner = fake();
    const first = await post(winner, FIXTURE_SEED);
    const stored = winner.store.get(IDEM_KEY) ?? null;
    const f = fake({ now: () => LATER, firstIdNumber: 100 });
    f.get.mockResolvedValueOnce(null).mockResolvedValue(stored);
    f.claim.mockResolvedValue(false);

    const result = await post(f, FIXTURE_SEED);

    expect(stored).not.toBeNull();
    expect(result).toStrictEqual(first);
    expect(f.get).toHaveBeenCalledTimes(2);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("키 잡기 경쟁에서 지고 다른 본문이면 409 IDEMPOTENCY_KEY_REUSED 이고 큐를 부르지 않는다", async () => {
    const winner = fake();
    await post(winner, FIXTURE_SEED);
    const stored = winner.store.get(IDEM_KEY) ?? null;
    const f = fake();
    f.get.mockResolvedValueOnce(null).mockResolvedValue(stored);
    f.claim.mockResolvedValue(false);

    const result = await post(f, FIXTURE_LIVE);

    expect(result).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
});

// 보안 점검 후속 I1(2026-10-20): 같은 조직 ADMIN 둘이 같은 Idempotency-Key·같은 본문을 보낸다.
// 재현은 "첫 202 를 그대로" 다(계획 §1-7). 그 202 의 requestedBy 는 첫 요청자 A 이고, 재요청한 B 가 아니다.
// A 의 이름은 재현할 때 지금 조직 구성원에서 다시 찾는다(GET 의 requestedBy 규칙, e8 판정 2). 구성원이 아니면 null 이다.
// requesterId 가 없는 옛 기록은 누가 재요청해도 requestedBy null 로 재현한다(하위 호환).
describe("requestIngestionRun — 같은 조직 다른 ADMIN 의 같은 키 재현(I1)", () => {
  // requesterId 를 담기 전의 기록 모양
  const legacyOf = (record: IdempotencyRecord): IdempotencyRecord => ({
    requestHash: record.requestHash,
    runId: record.runId,
    startedAt: record.startedAt,
  });
  // 처음 202 의 본문에서 requestedBy 만 바꾼 결과
  const withRequester = (
    result: Awaited<ReturnType<typeof post>>,
    requestedBy: { id: string; name: string } | null,
  ) => (result.ok ? { ...result, data: { ...result.data, requestedBy } } : result);

  it("A 가 202 를 받은 뒤 B 가 같은 키·같은 본문을 보내면 첫 202 그대로(requestedBy 는 A)이고 큐를 다시 부르지 않는다", async () => {
    const f = fake();
    const first = await post(f, FIXTURE_SEED, KEY, ADMIN);

    const again = await post(f, FIXTURE_SEED, KEY, SECOND_ADMIN);

    expect(first).toMatchObject({
      ok: true,
      status: 202,
      data: { requestedBy: { id: USER_ID, name: ADMIN_NAME } },
    });
    expect(again).toStrictEqual(first);
    expect(f.enqueue).toHaveBeenCalledTimes(1);
    expect(f.claim).toHaveBeenCalledTimes(1);
  });

  it("B 의 재현에서 requestedBy 이름은 지금 조직 구성원에서 A 로 찾고 B 의 id 를 싣지 않는다", async () => {
    const f = fake();
    await post(f, FIXTURE_SEED, KEY, ADMIN);
    f.repo.findMemberNames.mockClear();

    const again = await post(f, FIXTURE_SEED, KEY, SECOND_ADMIN);

    expect(f.repo.findMemberNames).toHaveBeenCalledWith(ORG_ID, [USER_ID]);
    expect(JSON.stringify(again)).not.toContain(SECOND_ADMIN_ID);
  });

  it("A 가 그사이 조직 구성원이 아니게 되면 B 의 재현에서 requestedBy 는 null 이고 A·B 의 id 를 싣지 않는다", async () => {
    const f = fake();
    const first = await post(f, FIXTURE_SEED, KEY, ADMIN);
    // 지금 조직 구성원에서 A 가 빠졌다(B 는 남아 있다)
    f.repo.findMemberNames.mockImplementation(async (orgId, userIds) =>
      memberNames(
        orgId,
        userIds.filter((id) => id !== USER_ID),
      ),
    );

    const again = await post(f, FIXTURE_SEED, KEY, SECOND_ADMIN);

    expect(again).toStrictEqual(withRequester(first, null));
    expect(JSON.stringify(again)).not.toContain(USER_ID);
    expect(JSON.stringify(again)).not.toContain(SECOND_ADMIN_ID);
    expect(f.enqueue).toHaveBeenCalledTimes(1);
  });

  it("키 잡기 경쟁에서 B 가 지면 이긴 A 의 기록으로 재현해 requestedBy 는 A 다", async () => {
    const winner = fake();
    const first = await post(winner, FIXTURE_SEED, KEY, ADMIN);
    const stored = winner.store.get(IDEM_KEY) ?? null;
    const f = fake({ now: () => LATER, firstIdNumber: 100 });
    f.get.mockResolvedValueOnce(null).mockResolvedValue(stored);
    f.claim.mockResolvedValue(false);

    const result = await post(f, FIXTURE_SEED, KEY, SECOND_ADMIN);

    expect(stored).not.toBeNull();
    expect(result).toStrictEqual(first);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it.each<[string, Ctx]>([
    ["처음 요청한 A", ADMIN],
    ["다른 ADMIN B", SECOND_ADMIN],
  ])(
    "requesterId 가 없는 옛 기록을 %s 가 재현하면 같은 runId·startedAt 에 requestedBy null 이고 큐를 부르지 않는다(하위 호환)",
    async (_label, ctx) => {
      const winner = fake();
      const first = await post(winner, FIXTURE_SEED, KEY, ADMIN);
      const stored = winner.store.get(IDEM_KEY);
      if (stored === undefined) throw new Error("첫 요청이 기록을 남기지 않았다");
      const f = fake({ now: () => LATER, firstIdNumber: 100 });
      f.store.set(IDEM_KEY, legacyOf(stored));

      const again = await post(f, FIXTURE_SEED, KEY, ctx);

      expect(again).toStrictEqual(withRequester(first, null));
      expect(JSON.stringify(again)).not.toContain(ctx.userId);
      expect(f.claim).not.toHaveBeenCalled();
      expect(f.enqueue).not.toHaveBeenCalled();
    },
  );

  it("같은 키·다른 본문은 다른 ADMIN 이 보내도 409 IDEMPOTENCY_KEY_REUSED 이고 큐를 다시 부르지 않는다", async () => {
    const f = fake();
    await post(f, FIXTURE_SEED, KEY, ADMIN);

    const other = await post(f, FIXTURE_LIVE, KEY, SECOND_ADMIN);

    expect(other).toMatchObject({ ok: false, status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
    expect(f.enqueue).toHaveBeenCalledTimes(1);
  });
});

describe("requestIngestionRun — 진행 중(§1-8, 409 INGESTION_IN_PROGRESS)", () => {
  it("같은 source 의 RUNNING 행이 있으면 409 {runId} 이고 키를 잡지 않으며 큐를 부르지 않는다", async () => {
    const f = fake();
    f.repo.findRunningRun.mockResolvedValue({ id: RUNNING_ID });

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({ ok: false, status: 409, code: "INGESTION_IN_PROGRESS" });
    expect(result.ok ? null : result.details).toStrictEqual({ runId: RUNNING_ID });
    expect(f.repo.findRunningRun).toHaveBeenCalledWith("fixture");
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("g2b 요청은 g2b 의 RUNNING 행을 찾는다", async () => {
    const f = fake({ runMode: "live" });

    await post(f, G2B_BODY);

    expect(f.repo.findRunningRun).toHaveBeenCalledWith("g2b");
  });
});

describe("requestIngestionRun — 큐(§1-10)", () => {
  it("fixture job data 는 정확히 이 모양이다(batch 대문자, trigger MANUAL, stages 없음)", async () => {
    const f = fake();

    await post(f, FIXTURE_SEED);

    const { runId } = firstJob(f);
    expect(f.enqueue.mock.calls).toStrictEqual([
      [
        {
          source: "fixture",
          batch: "SEED",
          trigger: "MANUAL",
          jobKey: `manual:${ORG_ID}:${KEY}`,
          idempotencyKey: `${ORG_ID}:${KEY}`,
          requestedBy: USER_ID,
          orgId: ORG_ID,
          runId,
        },
      ],
    ]);
    expect(f.generated).toContain(runId);
  });

  it("g2b job data 는 window 를 그대로 싣고 batch·stages 키가 없다(05 §6.6)", async () => {
    const f = fake({ runMode: "live" });

    await post(f, G2B_BODY);

    const { runId } = firstJob(f);
    expect(f.enqueue.mock.calls).toStrictEqual([
      [
        {
          source: "g2b",
          window: WINDOW,
          trigger: "MANUAL",
          jobKey: `manual:${ORG_ID}:${KEY}`,
          idempotencyKey: `${ORG_ID}:${KEY}`,
          requestedBy: USER_ID,
          orgId: ORG_ID,
          runId,
        },
      ],
    ]);
  });

  it("window 를 생략한 g2b job data 에는 window 키가 없다(worker 가 체크포인트로 정한다)", async () => {
    const f = fake({ runMode: "live" });

    await post(f, { source: "g2b" });

    expect(firstJob(f)).not.toHaveProperty("window");
  });

  it("순서: 속도 제한 → 본문 읽기 → 멱등 읽기 → 진행 중 → 키 잡기 → 큐", async () => {
    const f = fake();
    const body = bodyOf(FIXTURE_SEED);

    await postWith(f, body);

    expect(
      callOrder({
        enqueue: f.enqueue,
        claim: f.claim,
        findRunningRun: f.repo.findRunningRun,
        get: f.get,
        read: body.read,
        hit: f.hit,
      }),
    ).toStrictEqual(["hit", "read", "get", "findRunningRun", "claim", "enqueue"]);
  });

  it("큐에 넣지 못하면 원인을 onInfraError(queue) 로 넘기고, 잡은 키를 풀고, 503 {component:queue} 다", async () => {
    const f = fake();
    const cause = new Error("queue down");
    f.enqueue.mockRejectedValueOnce(cause);

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "queue" },
    });
    expect(f.onInfraError).toHaveBeenCalledWith("queue", cause);
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledWith(IDEM_KEY);
    expect(callOrder({ release: f.release, claim: f.claim })).toStrictEqual(["claim", "release"]);
  });

  it("큐 실패 뒤 같은 키·같은 본문으로 다시 보내면 새로 넣고 202 다", async () => {
    const f = fake();
    f.enqueue.mockRejectedValueOnce(new Error("queue down"));
    await post(f, FIXTURE_SEED);

    const retry = await post(f, FIXTURE_SEED);

    expect(retry).toMatchObject({ ok: true, status: 202 });
    expect(f.enqueue).toHaveBeenCalledTimes(2);
  });

  it("로그 콜백이 던져도 키를 풀고 503 {component:queue} 다", async () => {
    const f = fake();
    f.enqueue.mockRejectedValueOnce(new Error("queue down"));
    f.onInfraError.mockImplementationOnce(() => {
      throw new Error("log failed");
    });

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({ ok: false, status: 503, details: { component: "queue" } });
    expect(f.release).toHaveBeenCalledWith(IDEM_KEY);
  });
});

describe("requestIngestionRun — 202 본문(§1-11, 05 §6.5 IngestionRun)", () => {
  it("fixture 모드 fixture seed 는 정확히 이 IngestionRun 이다", async () => {
    const f = fake({ runMode: "fixture" });

    const result = await post(f, FIXTURE_SEED);

    expect(result).toStrictEqual({
      ok: true,
      status: 202,
      data: {
        id: firstJob(f).runId,
        source: "fixture",
        runMode: "fixture",
        batch: "seed",
        trigger: "MANUAL",
        status: "RUNNING",
        summary: ZERO_SUMMARY,
        quotaUsed: 0,
        errors: [],
        cursor: null,
        requestedBy: { id: USER_ID, name: ADMIN_NAME },
        startedAt: NOW_ISO,
        finishedAt: null,
      },
    });
  });

  it("live 모드 g2b 는 runMode live·batch null 이다(05 §6.6)", async () => {
    const f = fake({ runMode: "live" });

    const result = await post(f, G2B_BODY);

    expect(result).toStrictEqual({
      ok: true,
      status: 202,
      data: {
        id: firstJob(f).runId,
        source: "g2b",
        runMode: "live",
        batch: null,
        trigger: "MANUAL",
        status: "RUNNING",
        summary: ZERO_SUMMARY,
        quotaUsed: 0,
        errors: [],
        cursor: null,
        requestedBy: { id: USER_ID, name: ADMIN_NAME },
        startedAt: NOW_ISO,
        finishedAt: null,
      },
    });
  });

  it("mock 모드 fixture live 는 runMode mock·batch live 다(소문자)", async () => {
    const result = await post(fake({ runMode: "mock" }), FIXTURE_LIVE);

    expect(result).toMatchObject({ ok: true, data: { runMode: "mock", batch: "live" } });
  });

  it("requestedBy 이름은 지금 조직 구성원 이름에서 읽는다", async () => {
    const f = fake();

    await post(f, FIXTURE_SEED);

    expect(f.repo.findMemberNames).toHaveBeenCalledWith(ORG_ID, [USER_ID]);
  });
});

// 계획서 §1-4 의 "Redis 실패는 503 {component:redis}" 를 멱등 저장소(같은 Redis)에도 건다(05 §5 503).
describe("requestIngestionRun — 멱등 저장소 장애(05 §5)", () => {
  it("멱등 키를 읽지 못하면 503 {component:redis} 이고 큐를 부르지 않는다", async () => {
    const f = fake();
    f.get.mockRejectedValueOnce(new Error("redis down"));

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "redis" },
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it("멱등 키를 잡지 못하면 503 {component:redis} 이고 큐를 부르지 않는다", async () => {
    const f = fake();
    f.claim.mockRejectedValueOnce(new Error("redis down"));

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "redis" },
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
});

// 계획서 미정 4건에 대한 조정자 판정(2026-10-20).
describe("requestIngestionRun — 미정 4건 판정", () => {
  const FIVE_MINUTES_MS = 5 * 60_000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const isoAfter = (base: Date, ms: number): string => new Date(base.getTime() + ms).toISOString();
  // to 로 끝나는 1일 창
  const windowEndingAt = (to: string) => ({
    from: new Date(Date.parse(to) - DAY_MS).toISOString(),
    to,
  });
  const WINDOW_TO_ISSUE = {
    issues: expect.arrayContaining([expect.objectContaining({ path: "window.to" })]),
  };

  // 판정 1: window.to > now() + 5분 → 400. 큐 job 스키마(ingestJobDataSchemaAt)가 던져 503 queue 가 되기 전에 막는다.
  it("window.to 가 now()+5분+1ms 면 400 VALIDATION_ERROR(path window.to) 이고 키를 잡지 않으며 큐를 부르지 않는다", async () => {
    const f = fake({ runMode: "live" });

    const result = await post(f, {
      source: "g2b",
      window: windowEndingAt(isoAfter(NOW, FIVE_MINUTES_MS + 1)),
    });

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      details: WINDOW_TO_ISSUE,
    });
    expect(f.claim).not.toHaveBeenCalled();
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["now()+5분 정확히", FIVE_MINUTES_MS],
    ["now() 와 같음", 0],
    ["now() 보다 1시간 앞", -60 * 60_000],
  ])("window.to 가 %s 이면 202 다", async (_label, offsetMs) => {
    const f = fake({ runMode: "live" });

    const result = await post(f, {
      source: "g2b",
      window: windowEndingAt(isoAfter(NOW, offsetMs)),
    });

    expect(result).toMatchObject({ ok: true, status: 202 });
    expect(f.enqueue).toHaveBeenCalledTimes(1);
  });

  it("window.to 의 기준 시각은 벽시계가 아니라 deps.now() 다", async () => {
    // WINDOW.to(2026-10-16)는 벽시계로는 지났지만 이 now() 로는 6일 뒤다
    const f = fake({ runMode: "live", now: () => new Date("2026-10-10T00:00:00.000Z") });

    const result = await post(f, G2B_BODY);

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      details: WINDOW_TO_ISSUE,
    });
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  // 판정 2: stages 를 빼고 정규화한 뒤 해시한다. 생략과 ["NOTICE"] 는 같은 요청이다.
  it.each<[string, unknown, unknown]>([
    ["생략 → [NOTICE]", { source: "g2b", window: WINDOW }, G2B_BODY],
    ["[NOTICE] → 생략", G2B_BODY, { source: "g2b", window: WINDOW }],
  ])(
    "stages %s 로 같은 키를 다시 보내면 첫 202 를 그대로 주고 큐를 다시 부르지 않는다",
    async (_label, firstBody, secondBody) => {
      const f = fake({ runMode: "live" });
      const first = await post(f, firstBody);

      const again = await post(f, secondBody);

      expect(first).toMatchObject({ ok: true, status: 202 });
      expect(again).toStrictEqual(first);
      expect(f.enqueue).toHaveBeenCalledTimes(1);
      expect(f.claim).toHaveBeenCalledTimes(1);
    },
  );

  // 판정 3: 경쟁에서 졌는데 다시 읽은 값이 없다(그사이 만료·해제) → 판정할 수 없어 503 redis.
  it("키 잡기 경쟁에서 지고 다시 읽은 값이 null 이면 503 {component:redis} 이고 큐를 부르지 않는다", async () => {
    const f = fake();
    f.claim.mockResolvedValue(false);

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "redis" },
    });
    expect(f.get).toHaveBeenCalledTimes(2);
    expect(f.enqueue).not.toHaveBeenCalled();
  });

  // 판정 4: 이름을 못 찾으면 요청자를 내보내지 않는다(id 도).
  it("findMemberNames 에 요청자 본인이 없으면 202 의 requestedBy 는 null 이고 요청자 id 를 싣지 않는다", async () => {
    const f = fake();
    f.repo.findMemberNames.mockResolvedValue(new Map());

    const result = await post(f, FIXTURE_SEED);

    expect(result).toMatchObject({ ok: true, status: 202, data: { requestedBy: null } });
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });
});

// ───────────────────────── GET /admin/ingestion/runs·/runs/:id ─────────────────────────

// 열 단위 grant 뒤 DB 가 돌려주는 행(숨긴 네 열이 없다)
const runRow = (id: string, overrides: Partial<IngestRunRow> = {}): IngestRunRow => ({
  id,
  source: "fixture",
  run_mode: "FIXTURE",
  trigger: "MANUAL",
  batch: "SEED",
  cursor: null,
  status: "SUCCEEDED",
  summary: ZERO_SUMMARY,
  quota_used: 0,
  started_at: "2026-10-20T01:00:00.000Z",
  finished_at: "2026-10-20T01:02:00.000Z",
  ...overrides,
});
// 숨긴 열이 섞여 온 옛 모양 행. 서비스가 requested_by 를 쓰지 않는지 본다.
const legacyRow = (id: string, requestedBy: string): IngestRunRow =>
  ({ ...runRow(id), requested_by: requestedBy }) as IngestRunRow;
// orgId 조직에 run 의 수동 수집 감사(행위자 actorId)를 남긴다
const audit = (f: Fake, orgId: string, runId: string, actorId: string): void => {
  const byRun = f.audits.get(orgId) ?? new Map<string, string>();
  byRun.set(runId, actorId);
  f.audits.set(orgId, byRun);
};
const errorRow = (
  runId: string,
  sourceKey: string,
  overrides: Partial<IngestErrorRow> = {},
): IngestErrorRow => ({
  id: `${runId}:${sourceKey}`,
  ingest_run_id: runId,
  source_key: sourceKey,
  error_code: "MISSING_REQUIRED_FIELD",
  result_code: null,
  redacted_detail: `${sourceKey} 누락`,
  created_at: "2026-10-20T01:01:00.000Z",
  ...overrides,
});

const RUN_A = "a1000000-0000-4000-8000-00000000000a";
const RUN_B = "b2000000-0000-4000-8000-00000000000b";
const RUN_C = "c3000000-0000-4000-8000-00000000000c";
const ROW_A = runRow(RUN_A, { started_at: "2026-10-20T03:00:00.000Z" });
const ROW_B = runRow(RUN_B, { started_at: "2026-10-20T02:00:00.000Z" });
const ROW_C = runRow(RUN_C, { started_at: "2026-10-20T01:00:00.000Z" });
const TOKEN = "cursor-token";
const POSITION: RunPosition = { startedAt: "2026-10-20T04:00:00.000Z", id: RUN_C };

describe("listIngestionRuns — 권한·커서(05 Page<IngestionRun>)", () => {
  it.each<Role>(["SALES", "ANALYST", "VIEWER"])(
    "%s 는 403 FORBIDDEN {required:[ADMIN]} 이고 저장·커서를 건드리지 않는다",
    async (role) => {
      const f = fake();

      const result = await listIngestionRuns(
        { ...ADMIN, role },
        { limit: 20, cursor: TOKEN },
        f.deps,
      );

      expect(result).toStrictEqual(FORBIDDEN);
      expect(callOrder(backendOf(f))).toStrictEqual([]);
      expect(f.verify).not.toHaveBeenCalled();
      expect(f.sign).not.toHaveBeenCalled();
    },
  );

  it("권한 검사가 커서 설정 검사보다 먼저다(비ADMIN + 커서 비밀 없음 → 403)", async () => {
    const f = fake({ cursor: null });

    const result = await listIngestionRuns(
      { ...ADMIN, role: "VIEWER" },
      { limit: 20, cursor: null },
      f.deps,
    );

    expect(result).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("커서 코덱이 없으면(비밀 없음) 첫 쪽이어도 503 {component:cursor} 이고 목록을 읽지 않는다", async () => {
    const f = fake({ cursor: null });

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      details: { component: "cursor" },
    });
    expect(f.repo.listRuns).not.toHaveBeenCalled();
  });

  it("틀린 커서는 400 INVALID_CURSOR 이고 목록을 읽지 않는다", async () => {
    const f = fake();
    f.verify.mockReturnValue(null);

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: "tampered" }, f.deps);

    expect(result).toMatchObject({ ok: false, status: 400, code: "INVALID_CURSOR" });
    expect(f.verify).toHaveBeenCalledWith("tampered");
    expect(f.repo.listRuns).not.toHaveBeenCalled();
  });
});

describe("listIngestionRuns — keyset 쪽 나누기", () => {
  it("첫 쪽은 after null 로 limit+1 행을 읽고, 넘친 행이 있으면 limit 개만 내고 마지막 항목 위치를 서명한다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue([ROW_A, ROW_B, ROW_C]);

    const result = await listIngestionRuns(ADMIN, { limit: 2, cursor: null }, f.deps);

    expect(f.repo.listRuns).toHaveBeenCalledWith({ limit: 3, after: null });
    expect(f.sign).toHaveBeenCalledTimes(1);
    expect(f.sign.mock.calls[0]?.[0]).toStrictEqual({ startedAt: ROW_B.started_at, id: RUN_B });
    expect(result).toMatchObject({ ok: true, status: 200 });
    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.items.map((item) => item.id)).toStrictEqual([RUN_A, RUN_B]);
    expect(result.data.pageInfo).toStrictEqual({
      cursor: null,
      nextCursor: `signed:${ROW_B.started_at}|${RUN_B}`,
      hasNext: true,
    });
  });

  it("넘친 행이 없으면 마지막 쪽이라 nextCursor null·hasNext false 이고 서명하지 않는다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue([ROW_A, ROW_B]);

    const result = await listIngestionRuns(ADMIN, { limit: 2, cursor: null }, f.deps);

    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.items.map((item) => item.id)).toStrictEqual([RUN_A, RUN_B]);
    expect(result.data.pageInfo).toStrictEqual({ cursor: null, nextCursor: null, hasNext: false });
    expect(f.sign).not.toHaveBeenCalled();
  });

  it("검증한 커서 위치를 after 로 넘기고 pageInfo.cursor 에 받은 커서를 그대로 둔다", async () => {
    const f = fake();
    f.verify.mockReturnValue(POSITION);
    f.repo.listRuns.mockResolvedValue([ROW_C]);

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: TOKEN }, f.deps);

    expect(f.verify).toHaveBeenCalledWith(TOKEN);
    expect(f.repo.listRuns).toHaveBeenCalledWith({ limit: 21, after: POSITION });
    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.pageInfo).toStrictEqual({ cursor: TOKEN, nextCursor: null, hasNext: false });
  });

  it("행이 없으면 빈 쪽이다", async () => {
    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, fake().deps);

    expect(result).toStrictEqual({
      ok: true,
      status: 200,
      data: { items: [], pageInfo: { cursor: null, nextCursor: null, hasNext: false } },
    });
  });
});

describe("listIngestionRuns — 항목 변환(errors·requestedBy)", () => {
  const rows = [
    runRow(RUN_A, { status: "PARTIAL" }),
    runRow(RUN_B),
    runRow(RUN_C, { trigger: "SCHEDULED" }),
  ];
  // A 는 지금 조직 ADMIN 이 요청했다. B 의 감사는 지금 조직에 남았지만 행위자가 이제 구성원이 아니다. C 는 감사가 없다(일정 수집).
  const withAudits = (f: Fake) => {
    audit(f, ORG_ID, RUN_A, USER_ID);
    audit(f, ORG_ID, RUN_B, OUTSIDER_ID);
  };
  const errors = [
    errorRow(RUN_B, "fixture:FX-14"),
    errorRow(RUN_A, "fixture:FX-12"),
    errorRow(RUN_B, "fixture:FX-15"),
  ];

  it("오류 행을 run 마다 나눠 싣는다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue(rows);
    f.repo.listErrors.mockResolvedValue(errors);

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);

    if (!result.ok) throw new Error("성공이어야 한다");
    expect(
      result.data.items.map((item) => [item.id, item.errors.map((error) => error.sourceKey)]),
    ).toStrictEqual([
      [RUN_A, ["fixture:FX-12"]],
      [RUN_B, ["fixture:FX-14", "fixture:FX-15"]],
      [RUN_C, []],
    ]);
  });

  it("요청자는 지금 조직 감사의 행위자가 지금 조직 구성원이면 {id,name}, 구성원이 아니거나 감사가 없으면 null 이고 그 id 를 싣지 않는다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue(rows);
    withAudits(f);

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);

    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.items.map((item) => item.requestedBy)).toStrictEqual([
      { id: USER_ID, name: ADMIN_NAME },
      null,
      null,
    ]);
    expect(JSON.stringify(result.data)).not.toContain(OUTSIDER_ID);
  });

  it("감사는 지금 조직(ctx.orgId)과 이 쪽의 run id 들로 한 번 읽고, 찾은 행위자만 지금 조직 구성원 이름에서 찾는다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue(rows);
    withAudits(f);

    await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);

    expect(f.repo.findManualRequesters).toHaveBeenCalledTimes(1);
    const [orgId, runIds] = f.repo.findManualRequesters.mock.calls[0] ?? [];
    expect(orgId).toBe(ORG_ID);
    expect([...(runIds ?? [])].sort()).toStrictEqual([RUN_A, RUN_B, RUN_C].sort());
    expect(f.repo.findMemberNames).toHaveBeenCalled();
    expect(f.repo.findMemberNames.mock.calls.every(([org]) => org === ORG_ID)).toBe(true);
    const asked = new Set(f.repo.findMemberNames.mock.calls.flatMap(([, ids]) => ids));
    expect(asked).toStrictEqual(new Set([USER_ID, OUTSIDER_ID]));
  });

  it("행의 requested_by 는 쓰지 않는다 — 옛 모양 행에 requested_by 가 남아 있어도 감사가 없으면 null 이다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue([legacyRow(RUN_A, USER_ID)]);

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);

    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.items.map((item) => item.requestedBy)).toStrictEqual([null]);
    expect(JSON.stringify(result.data)).not.toContain(USER_ID);
  });

  it("감사의 행위자가 행의 requested_by 와 다르면 감사를 따른다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue([legacyRow(RUN_A, USER_ID)]);
    audit(f, ORG_ID, RUN_A, MEMBER_ID);

    const result = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);

    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.items.map((item) => item.requestedBy)).toStrictEqual([
      { id: MEMBER_ID, name: "이분석" },
    ]);
  });

  it("다른 조직 ADMIN 이 읽으면 감사가 요청한 조직에만 있어 같은 run 의 요청자도 null 이고, 감사는 읽는 사람의 조직으로 찾는다(e8 판정 2)", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue(rows);
    withAudits(f);

    const result = await listIngestionRuns(ADMIN_B, { limit: 20, cursor: null }, f.deps);

    if (!result.ok) throw new Error("성공이어야 한다");
    expect(result.data.items.map((item) => item.requestedBy)).toStrictEqual([null, null, null]);
    expect(JSON.stringify(result.data)).not.toContain(USER_ID);
    expect(JSON.stringify(result.data)).not.toContain(OUTSIDER_ID);
    expect(f.repo.findManualRequesters.mock.calls.every(([orgId]) => orgId === ORG_B)).toBe(true);
    expect(f.repo.findManualRequesters).toHaveBeenCalled();
  });

  it("다른 조직 ADMIN 이 요청한 run 은 그 조직 ADMIN 에게만 요청자가 보이고 지금 조직 ADMIN 에게는 null 이다", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue([runRow(RUN_A)]);
    audit(f, ORG_B, RUN_A, USER_B);

    const ours = await listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps);
    const theirs = await listIngestionRuns(ADMIN_B, { limit: 20, cursor: null }, f.deps);

    if (!ours.ok || !theirs.ok) throw new Error("성공이어야 한다");
    expect(ours.data.items.map((item) => item.requestedBy)).toStrictEqual([null]);
    expect(JSON.stringify(ours.data)).not.toContain(USER_B);
    expect(theirs.data.items.map((item) => item.requestedBy)).toStrictEqual([
      { id: USER_B, name: "박다른" },
    ]);
  });

  it("감사를 읽다 던지면 그대로 던진다(요청자를 null 로 바꿔 숨기지 않는다)", async () => {
    const f = fake();
    f.repo.listRuns.mockResolvedValue(rows);
    f.repo.findManualRequesters.mockRejectedValue(new Error("audit read failed"));

    await expect(listIngestionRuns(ADMIN, { limit: 20, cursor: null }, f.deps)).rejects.toThrow(
      "audit read failed",
    );
  });
});

describe("getIngestionRun", () => {
  it.each<Role>(["SALES", "ANALYST", "VIEWER"])(
    "%s 는 403 FORBIDDEN {required:[ADMIN]} 이고 저장을 건드리지 않는다",
    async (role) => {
      const f = fake();

      const result = await getIngestionRun({ ...ADMIN, role }, RUN_A, f.deps);

      expect(result).toStrictEqual(FORBIDDEN);
      expect(callOrder(backendOf(f))).toStrictEqual([]);
    },
  );

  it.each([
    ["UUID 아님", "not-a-uuid"],
    ["빈 문자열", ""],
  ])("id 가 %s 면 404 {resource:ingestionRun} 이고 행을 읽지 않는다", async (_label, id) => {
    const f = fake();

    const result = await getIngestionRun(ADMIN, id, f.deps);

    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(result.ok ? null : result.details).toStrictEqual({ resource: "ingestionRun" });
    expect(f.repo.findRun).not.toHaveBeenCalled();
  });

  it("행이 없으면(worker 가 아직 만들지 않음) 404 {resource:ingestionRun} 이다", async () => {
    const f = fake();

    const result = await getIngestionRun(ADMIN, RUN_A, f.deps);

    expect(f.repo.findRun).toHaveBeenCalledWith(RUN_A);
    expect(result).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(result.ok ? null : result.details).toStrictEqual({ resource: "ingestionRun" });
  });

  it("있으면 200 IngestionRun 이고 그 run 의 오류를 싣는다", async () => {
    const f = fake();
    f.repo.findRun.mockResolvedValue(
      runRow(RUN_A, { status: "PARTIAL", summary: { created: 19, quarantined: 1, retried: 2 } }),
    );
    f.repo.listErrors.mockResolvedValue([errorRow(RUN_A, "fixture:FX-12")]);
    audit(f, ORG_ID, RUN_A, USER_ID);

    const result = await getIngestionRun(ADMIN, RUN_A, f.deps);

    expect(f.repo.listErrors).toHaveBeenCalledWith([RUN_A]);
    expect(f.repo.findManualRequesters).toHaveBeenCalledWith(ORG_ID, [RUN_A]);
    expect(result).toStrictEqual({
      ok: true,
      status: 200,
      data: {
        id: RUN_A,
        source: "fixture",
        runMode: "fixture",
        batch: "seed",
        trigger: "MANUAL",
        status: "PARTIAL",
        summary: { ...ZERO_SUMMARY, created: 19, quarantined: 1, retried: 2 },
        quotaUsed: 0,
        errors: [
          {
            sourceKey: "fixture:FX-12",
            errorCode: "MISSING_REQUIRED_FIELD",
            resultCode: null,
            detail: "fixture:FX-12 누락",
          },
        ],
        cursor: null,
        requestedBy: { id: USER_ID, name: ADMIN_NAME },
        startedAt: "2026-10-20T01:00:00.000Z",
        finishedAt: "2026-10-20T01:02:00.000Z",
      },
    });
  });

  it("감사의 행위자가 지금 조직 구성원이 아니면 requestedBy null 이고 그 id 를 싣지 않는다(e8 판정 2)", async () => {
    const f = fake();
    f.repo.findRun.mockResolvedValue(runRow(RUN_A));
    audit(f, ORG_ID, RUN_A, OUTSIDER_ID);

    const result = await getIngestionRun(ADMIN, RUN_A, f.deps);

    expect(result).toMatchObject({ ok: true, status: 200, data: { requestedBy: null } });
    expect(JSON.stringify(result)).not.toContain(OUTSIDER_ID);
  });

  it("감사가 없는 run(일정·데모)은 requestedBy null 이다", async () => {
    const f = fake();
    f.repo.findRun.mockResolvedValue(runRow(RUN_A, { trigger: "SCHEDULED" }));

    const result = await getIngestionRun(ADMIN, RUN_A, f.deps);

    expect(result).toMatchObject({ ok: true, data: { requestedBy: null, trigger: "SCHEDULED" } });
  });

  it("행의 requested_by 는 쓰지 않는다 — 옛 모양 행에 requested_by 가 남아 있어도 감사가 없으면 null 이다", async () => {
    const f = fake();
    f.repo.findRun.mockResolvedValue(legacyRow(RUN_A, USER_ID));

    const result = await getIngestionRun(ADMIN, RUN_A, f.deps);

    expect(result).toMatchObject({ ok: true, status: 200, data: { requestedBy: null } });
    expect(JSON.stringify(result)).not.toContain(USER_ID);
  });

  it("다른 조직 ADMIN 이 읽으면 요청자는 null 이고 그 id 를 싣지 않으며, 감사는 읽는 사람의 조직으로 찾는다", async () => {
    const f = fake();
    f.repo.findRun.mockResolvedValue(runRow(RUN_A));
    audit(f, ORG_ID, RUN_A, USER_ID);

    const result = await getIngestionRun(ADMIN_B, RUN_A, f.deps);

    expect(result).toMatchObject({ ok: true, status: 200, data: { requestedBy: null } });
    expect(JSON.stringify(result)).not.toContain(USER_ID);
    expect(f.repo.findManualRequesters).toHaveBeenCalledWith(ORG_B, [RUN_A]);
  });
});
