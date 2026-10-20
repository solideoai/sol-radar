import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  ORG_02,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import type { Tables } from "@/lib/database.types";
import { getAdminAccess } from "@/server/admin";
import * as runRoute from "./admin/ingestion/runs/[id]/route";
import * as runsRoute from "./admin/ingestion/runs/route";

// 수집 관리 Route Handler 계약 시험(05 §2 :75-77, §5 :482-504, §6.5·6.6, 계획 2026-10-20-n8-admin-ingestion-plan §1).
// 구현보다 먼저 쓴 시험이다. 인증·가입 완료·업무 조직 확인(businessRoute)과 서비스(@/server/ingestion)는 진짜가 돌고,
// SDK 전송은 fake-session 이, 저장소·큐·멱등 저장·속도 제한·커서는 시험마다 ingestionDeps 가짜가 맡는다.
// 의존성 안쪽의 순서·정확값은 서비스 시험이 본다. 여기서는 HTTP 로 보이는 계약을 본다.
// 보안 점검 W1(계획 §5): 화면 역할은 ingest_runs 를 열 단위로만 읽어 행에 requested_by 가 없다. 요청자는 지금 조직의
// 수동 수집 감사(INGEST_MANUAL)를 findManualRequesters 로 읽어 정한다.

const deps = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/app/_lib/ingestion-deps", () => ({
  ingestionDeps: () => {
    if (deps.current === null) throw new Error("시험이 ingestionDeps 를 정하지 않았다");
    return deps.current;
  },
}));
vi.mock(
  "next/headers",
  async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders,
);
vi.mock("@supabase/ssr", async () => ({
  createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
}));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (await import("@/app/api/v1/_lib/fake-session")).fakeBearerClient,
}));

const KEY = "3f2b8c1e-9d4a-4b6e-8a1c-2d5e7f9a0b3c";
// newId 가 내는 새 run id. worker 가 이 id 로 ingest_runs 행을 만든다.
const NEW_RUN_ID = "a8000000-0000-4000-8000-000000000001";
const RUN_A = "a8000000-0000-4000-8000-0000000000a1";
const RUN_B = "a8000000-0000-4000-8000-0000000000b1";
const RUNNING_ID = "a8000000-0000-4000-8000-0000000000c1";
const NOW = "2026-10-20T03:04:05.000Z";
const WINDOW = { from: "2026-10-15T00:00:00Z", to: "2026-10-16T00:00:00Z" };
const LEAKY_FAILURE = "connect redis://user:secret@redis:6379 refused";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ZERO_SUMMARY = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};

// 조직별 구성원 이름(findMemberNames 가짜). admin 은 fake-session 프로필 이름과 같게 둔다.
const MEMBER_NAMES: Record<string, Record<string, string>> = {
  [ORG_01]: {
    [FAKE_USERS.admin.id]: "가상직원",
    [FAKE_USERS.sales.id]: "가상영업",
  },
  [ORG_02]: { [FAKE_USERS.otherViewer.id]: "다른조직직원" },
};

// 화면 역할이 읽는 ingest_runs 열(20261019000019). job_key·idempotency_key·requested_by·params 는 없다.
type RunRow = Pick<
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
type ErrorRow = Tables<"ingest_errors">;

// started_at desc, id desc 순서. 시각은 PostgREST 모양과 toISOString 모양이 같은 값이 되게 Z·밀리초로 둔다.
const RUN_A_ROW: RunRow = {
  id: RUN_A,
  source: "fixture",
  run_mode: "MOCK",
  trigger: "MANUAL",
  batch: "SEED",
  cursor: null,
  status: "PARTIAL",
  // 빠진 키는 0 으로 낸다
  summary: { created: 19, quarantined: 1, retried: 2 },
  quota_used: 0,
  started_at: "2026-10-20T01:00:00.000Z",
  finished_at: "2026-10-20T01:00:05.000Z",
};
const RUN_B_ROW: RunRow = {
  id: RUN_B,
  source: "g2b",
  run_mode: "LIVE",
  trigger: "SCHEDULED",
  batch: null,
  cursor: "2026-10-19T00:00:00Z",
  status: "PARTIAL",
  summary: {
    created: 1,
    changed: 2,
    cancelled: 0,
    skippedDuplicate: 3,
    quarantined: 0,
    retried: 1,
  },
  quota_used: 12,
  started_at: "2026-10-19T01:00:00.000Z",
  finished_at: "2026-10-19T01:02:00.000Z",
};
const RUN_ROWS = [RUN_A_ROW, RUN_B_ROW];
// 조직별 수동 수집 감사(orgId → runId → actorId, findManualRequesters 가짜). RUN_A 는 org-01 SALES 가 요청했고,
// RUN_B 는 일정 수집이라 감사가 없다. 시험이 조직·run 을 더한다.
type ManualAudits = Record<string, Record<string, string>>;
const manualAudits = (): ManualAudits => ({ [ORG_01]: { [RUN_A]: FAKE_USERS.sales.id } });
const ERROR_ROWS: ErrorRow[] = [
  {
    id: "e8000000-0000-4000-8000-000000000001",
    ingest_run_id: RUN_A,
    source_key: "fixture:FX-12",
    error_code: "MISSING_REQUIRED_FIELD",
    result_code: null,
    redacted_detail: "title 누락",
    created_at: "2026-10-20T01:00:03.000Z",
  },
  {
    id: "e8000000-0000-4000-8000-000000000002",
    ingest_run_id: RUN_B,
    source_key: "g2b:notice",
    error_code: "API_HTTP_ERROR",
    result_code: "22",
    redacted_detail: "서비스 요청 제한 횟수 초과",
    created_at: "2026-10-19T01:01:00.000Z",
  },
];

// 05 IngestionRun 모양. runMode·batch 는 소문자, errors 는 redacted_detail 을 detail 로.
const VIEW_A = {
  id: RUN_A,
  source: "fixture",
  runMode: "mock",
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
      detail: "title 누락",
    },
  ],
  cursor: null,
  requestedBy: { id: FAKE_USERS.sales.id, name: "가상영업" },
  startedAt: "2026-10-20T01:00:00.000Z",
  finishedAt: "2026-10-20T01:00:05.000Z",
};
const VIEW_B = {
  id: RUN_B,
  source: "g2b",
  runMode: "live",
  batch: null,
  trigger: "SCHEDULED",
  status: "PARTIAL",
  summary: {
    created: 1,
    changed: 2,
    cancelled: 0,
    skippedDuplicate: 3,
    quarantined: 0,
    retried: 1,
  },
  quotaUsed: 12,
  errors: [
    {
      sourceKey: "g2b:notice",
      errorCode: "API_HTTP_ERROR",
      resultCode: "22",
      detail: "서비스 요청 제한 횟수 초과",
    },
  ],
  cursor: "2026-10-19T00:00:00Z",
  requestedBy: null,
  startedAt: "2026-10-19T01:00:00.000Z",
  finishedAt: "2026-10-19T01:02:00.000Z",
};

// 접수 직후의 202 본문(05 §6.5, 계획 §1 11번).
const accepted = (overrides: Record<string, unknown> = {}) => ({
  id: NEW_RUN_ID,
  source: "fixture",
  runMode: "mock",
  batch: "seed",
  trigger: "MANUAL",
  status: "RUNNING",
  summary: ZERO_SUMMARY,
  quotaUsed: 0,
  errors: [],
  cursor: null,
  requestedBy: { id: FAKE_USERS.admin.id, name: "가상직원" },
  startedAt: NOW,
  finishedAt: null,
  ...overrides,
});

// 커서가 실어 온 마지막 행 뒤부터 준다. 커서 안의 모양은 서비스가 정하므로 id 만 본다.
function startAfter(after: unknown): number {
  if (after === null || after === undefined) return 0;
  const id = (after as { id?: unknown }).id;
  return RUN_ROWS.findIndex((row) => row.id === id) + 1;
}

function fakeRepo(audits: ManualAudits = manualAudits()) {
  return {
    listRuns: vi.fn<(input: { limit: number; after: unknown }) => Promise<RunRow[]>>(
      async ({ limit, after }) => {
        const start = startAfter(after);
        return RUN_ROWS.slice(start, start + limit);
      },
    ),
    findRun: vi.fn<(id: string) => Promise<RunRow | null>>(
      async (id) => RUN_ROWS.find((row) => row.id === id) ?? null,
    ),
    listErrors: vi.fn<(runIds: readonly string[]) => Promise<ErrorRow[]>>(async (runIds) =>
      ERROR_ROWS.filter((row) => runIds.includes(row.ingest_run_id)),
    ),
    findRunningRun: vi.fn<(source: string) => Promise<{ id: string } | null>>(async () => null),
    findMemberNames: vi.fn<
      (orgId: string, userIds: readonly string[]) => Promise<Map<string, string>>
    >(async (orgId, userIds) => {
      const names = MEMBER_NAMES[orgId] ?? {};
      return new Map(
        userIds.flatMap((id) => (names[id] === undefined ? [] : [[id, names[id]] as const])),
      );
    }),
    // RLS 처럼 부른 조직의 감사만 돌려준다.
    findManualRequesters: vi.fn<
      (orgId: string, runIds: readonly string[]) => Promise<Map<string, string>>
    >(async (orgId, runIds) => {
      const actors = audits[orgId] ?? {};
      return new Map(
        runIds.flatMap((id) => (actors[id] === undefined ? [] : [[id, actors[id]] as const])),
      );
    }),
  };
}

// 멱등 저장(Redis SET NX EX 자리). claim 은 처음이면 true, 이미 있으면 false 다(세 번째 인자 TTL 은 서비스 시험이 본다).
function fakeIdempotency() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn<(key: string) => Promise<unknown>>(async (key) => store.get(key) ?? null),
    claim: vi.fn<(key: string, value: unknown, ttlSeconds: number) => Promise<boolean>>(
      async (key, value) => {
        if (store.has(key)) return false;
        store.set(key, value);
        return true;
      },
    ),
    release: vi.fn<(key: string) => Promise<void>>(async (key) => {
      store.delete(key);
    }),
  };
}

// 커서 코덱(서비스 시험 ingestion-admin.service.test.ts 의 CursorCodec 과 같은 모양): 비밀·조직을 품은 app 층 코덱.
// sign(position) → 불투명 문자열, verify(token) → sign 이 받은 position, 변조·만료·다른 조직 것이면 null.
// 이 시험의 ADMIN 은 한 조직뿐이라 조직 묶음은 서비스 시험이 본다. 여기서는 발급한 토큰만 되돌린다.
type RunPosition = { startedAt: string; id: string };
function fakeCursorCodec() {
  const issued = new Map<string, RunPosition>();
  return {
    sign: vi.fn<(position: RunPosition) => string>((position) => {
      const token = `signed-${issued.size + 1}`;
      issued.set(token, position);
      return token;
    }),
    verify: vi.fn<(token: string) => RunPosition | null>((token) => issued.get(token) ?? null),
  };
}

type Limit = { allowed: true } | { allowed: false; retryAfterSeconds: number };
type RunModeName = "live" | "fixture" | "mock";

function install(options: { runMode?: RunModeName; cursor?: "none"; audits?: ManualAudits } = {}) {
  const built = {
    repo: fakeRepo(options.audits),
    queue: { enqueue: vi.fn<(job: Record<string, unknown>) => Promise<void>>(async () => {}) },
    idempotency: fakeIdempotency(),
    limiter: { hit: vi.fn<(orgId: string) => Promise<Limit>>(async () => ({ allowed: true })) },
    runMode: options.runMode ?? "mock",
    now: vi.fn(() => new Date(NOW)),
    newId: vi.fn(() => NEW_RUN_ID),
    cursor: options.cursor === "none" ? null : fakeCursorCodec(),
    onInfraError: vi.fn<(component: string, error: unknown) => void>(),
  };
  deps.current = built;
  return built;
}
type Deps = ReturnType<typeof install>;

// 저장소·큐·멱등 저장·속도 제한·커서 호출 수의 합(now·newId 는 바깥을 부르지 않으므로 뺀다)
function backendCalls(d: Deps): number {
  const ports: object[] = [d.repo, d.queue, d.idempotency, d.limiter];
  if (d.cursor !== null) ports.push(d.cursor);
  return ports
    .flatMap((port) => Object.values(port))
    .reduce((sum, fn) => sum + (vi.isMockFunction(fn) ? fn.mock.calls.length : 0), 0);
}

const firstJob = (d: Deps): Record<string, unknown> => d.queue.enqueue.mock.calls[0]?.[0] ?? {};

type Endpoint = {
  name: string;
  method: "GET" | "POST";
  path: (id: string) => string;
  handle: (request: Request, id: string) => Promise<Response>;
  id: string;
  body?: unknown;
};

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const GET_RUNS: Endpoint = {
  name: "GET /admin/ingestion/runs",
  method: "GET",
  path: () => "/api/v1/admin/ingestion/runs",
  handle: (request) => runsRoute.GET(request),
  id: "",
};
const POST_RUNS: Endpoint = {
  name: "POST /admin/ingestion/runs",
  method: "POST",
  path: () => "/api/v1/admin/ingestion/runs",
  handle: (request) => runsRoute.POST(request),
  id: "",
  body: { source: "fixture", batch: "seed" },
};
const GET_RUN: Endpoint = {
  name: "GET /admin/ingestion/runs/:id",
  method: "GET",
  path: (id) => `/api/v1/admin/ingestion/runs/${id}`,
  handle: (request, id) => runRoute.GET(request, ctx(id)),
  id: RUN_A,
};
const ENDPOINTS = [GET_RUNS, POST_RUNS, GET_RUN];

type SendOptions = {
  user?: FakeUser | null;
  via?: "cookie" | "bearer";
  csrf?: boolean;
  id?: string;
  query?: string;
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
};

// 쿠키 세션의 ADMIN 이 기본이다. 쓰기 요청은 CSRF 헤더를 기본으로 단다.
function send(endpoint: Endpoint, options: SendOptions = {}): Promise<Response> {
  const user = options.user === undefined ? FAKE_USERS.admin : options.user;
  const via = options.via ?? "cookie";
  const id = options.id ?? endpoint.id;
  const headers: Record<string, string> = {};
  if (via === "bearer" && user !== null) headers.Authorization = `Bearer ${user.token}`;
  if (endpoint.method !== "GET" && (options.csrf ?? true))
    headers["X-Requested-With"] = "sol-radar";
  const payload = options.body === undefined ? endpoint.body : options.body;
  const body =
    options.rawBody ??
    (endpoint.method === "GET" || payload === undefined ? undefined : JSON.stringify(payload));
  if (body !== undefined) headers["Content-Type"] = "application/json";
  fakeSession.cookie = via === "cookie" ? (user?.token ?? null) : null;
  const request = fakeRequest(`${endpoint.path(id)}${options.query ?? ""}`, {
    method: endpoint.method,
    headers: { ...headers, ...options.headers },
    body,
  });
  return endpoint.handle(request, id);
}

const keyed = (key: string = KEY) => ({ "Idempotency-Key": key });

async function errorOf(response: Response, status: number, code: string) {
  expect(response.status, await response.clone().text()).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({
    code,
    message: expect.any(String),
    requestId: response.headers.get("X-Request-Id"),
    details: expect.any(Object),
  });
  return body.error;
}

async function successOf(response: Response, status: number) {
  expect(response.status, await response.clone().text()).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-Id")).toMatch(UUID_PATTERN);
  return response.json();
}

beforeEach(() => {
  resetFakeSession();
  deps.current = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("수집 관리 Route Handler 계약 — 입구", () => {
  it("1. 세션이 없으면 세 엔드포인트 모두 401 UNAUTHENTICATED 이고 의존성을 부르지 않는다", async () => {
    const d = install();
    for (const endpoint of ENDPOINTS) {
      await errorOf(await send(endpoint, { user: null, headers: keyed() }), 401, "UNAUTHENTICATED");
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("2. 쿠키 세션의 POST 는 X-Requested-With 가 없거나 틀리면 403 CSRF_REJECTED 이고 의존성을 부르지 않는다", async () => {
    const d = install();
    await errorOf(await send(POST_RUNS, { csrf: false, headers: keyed() }), 403, "CSRF_REJECTED");
    await errorOf(
      await send(POST_RUNS, {
        csrf: false,
        headers: { ...keyed(), "X-Requested-With": "XMLHttpRequest" },
      }),
      403,
      "CSRF_REJECTED",
    );
    expect(backendCalls(d)).toBe(0);
  });

  it("2. Bearer 는 X-Requested-With 없이 POST 를 통과한다", async () => {
    install();
    const response = await send(POST_RUNS, { via: "bearer", csrf: false, headers: keyed() });
    expect(await successOf(response, 202)).toEqual(accepted());
  });

  it("3. SALES·ANALYST·VIEWER 와 다른 조직 VIEWER 는 세 엔드포인트 모두 403 FORBIDDEN {required:[ADMIN]} 이고 의존성을 부르지 않는다", async () => {
    const d = install();
    const users = [FAKE_USERS.sales, FAKE_USERS.analyst, FAKE_USERS.viewer, FAKE_USERS.otherViewer];
    for (const user of users) {
      for (const endpoint of ENDPOINTS) {
        const error = await errorOf(
          await send(endpoint, { user, headers: keyed() }),
          403,
          "FORBIDDEN",
        );
        expect(error.details, `${user.email} ${endpoint.name}`).toEqual({ required: ["ADMIN"] });
      }
    }
    expect(backendCalls(d)).toBe(0);
  });

  // 보안 점검 후속(2026-10-20): 서비스 운영자(profiles.is_admin)는 업무 역할이 아니다(계획 §1 권한, 계약 메모 "위치·권한").
  // 운영자 판정 코드(@/server/admin getAdminAccess)가 이 사람을 운영자로 본다는 것을 먼저 확인해, 표시가 실제로 실렸는지 보장한다.
  it("3. ANALYST 가 운영자(profiles.is_admin=true)여도 세 엔드포인트 모두 403 FORBIDDEN {required:[ADMIN]} 이고 의존성을 부르지 않는다", async () => {
    const d = install();
    const user = FAKE_USERS.analyst;
    fakeSession.operatorIds = [user.id];
    fakeSession.cookie = user.token;
    expect(await getAdminAccess()).toEqual({ status: "ready", userId: user.id });

    for (const via of ["cookie", "bearer"] as const) {
      for (const endpoint of ENDPOINTS) {
        const error = await errorOf(
          await send(endpoint, { user, via, headers: keyed() }),
          403,
          "FORBIDDEN",
        );
        expect(error.details, `${via} ${endpoint.name}`).toEqual({ required: ["ADMIN"] });
      }
    }
    expect(backendCalls(d)).toBe(0);
  });

  // Bearer 는 CSRF 확인(X-Requested-With)을 건너뛴다. 건너뛴 뒤에도 역할 검사는 그대로여야 한다.
  it.each([
    ["SALES", FAKE_USERS.sales],
    ["ANALYST", FAKE_USERS.analyst],
    ["VIEWER", FAKE_USERS.viewer],
  ])(
    "2·3. Bearer 의 %s POST 는 X-Requested-With 없이 CSRF 를 건너뛰어도 403 FORBIDDEN {required:[ADMIN]} 이고 의존성을 부르지 않는다",
    async (_role, user) => {
      const d = install();

      const response = await send(POST_RUNS, {
        user,
        via: "bearer",
        csrf: false,
        headers: keyed(),
      });

      const error = await errorOf(response, 403, "FORBIDDEN");
      expect(error.details).toEqual({ required: ["ADMIN"] });
      expect(backendCalls(d)).toBe(0);
    },
  );

  it("3. 권한이 먼저다: VIEWER 는 Idempotency-Key·본문이 틀려도 403 FORBIDDEN 이다", async () => {
    const d = install();
    await errorOf(
      await send(POST_RUNS, {
        user: FAKE_USERS.viewer,
        body: { source: "bogus" },
        headers: keyed("not a key"),
      }),
      403,
      "FORBIDDEN",
    );
    expect(backendCalls(d)).toBe(0);
  });

  // 계획 §1 "권한"(ADMIN 밖은 403 FORBIDDEN {required:["ADMIN"]})과 위 "권한이 먼저다"(POST 본문·키보다 역할 먼저)를
  // GET 목록의 쿼리에도 건다. 쿼리 검사(limit·cursor)가 역할보다 먼저면 비ADMIN 이 400 으로 쿼리 규칙을 알아낸다.
  // ?cursor=garbage 는 서비스의 커서 검증(400 INVALID_CURSOR)보다, 나머지는 Route Handler 의 쿼리 파싱(400 VALIDATION_ERROR)보다 먼저다.
  it.each(["?limit=abc", "?limit=0", "?cursor=garbage", "?cursor=a&cursor=b"])(
    "3. 권한이 쿼리 검사보다 먼저다: SALES·ANALYST·VIEWER 의 GET 목록 %s 는 403 FORBIDDEN {required:[ADMIN]} 이고 의존성을 부르지 않는다",
    async (query) => {
      const d = install();
      for (const user of [FAKE_USERS.sales, FAKE_USERS.analyst, FAKE_USERS.viewer]) {
        const error = await errorOf(await send(GET_RUNS, { user, query }), 403, "FORBIDDEN");
        expect(error.details, `${user.email} ${query}`).toEqual({ required: ["ADMIN"] });
      }
      expect(backendCalls(d)).toBe(0);
    },
  );

  it("14. 업무 조직이 둘이면 403 UNSUPPORTED_ACCOUNT_STATE, 없으면 403 FORBIDDEN ORGANIZATION_REQUIRED 다", async () => {
    const d = install();
    fakeSession.orgCount = 2;
    for (const endpoint of ENDPOINTS) {
      await errorOf(await send(endpoint, { headers: keyed() }), 403, "UNSUPPORTED_ACCOUNT_STATE");
    }
    fakeSession.orgCount = 0;
    for (const endpoint of ENDPOINTS) {
      const error = await errorOf(await send(endpoint, { headers: keyed() }), 403, "FORBIDDEN");
      expect(error.details.reason).toBe("ORGANIZATION_REQUIRED");
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("12. route 모듈은 runs: GET·POST, runs/[id]: GET 만 내보낸다(PUT·PATCH·DELETE 없음)", () => {
    const exported = (module: object) => Object.keys(module).sort();
    expect(exported(runsRoute)).toEqual(["GET", "POST"]);
    expect(exported(runRoute)).toEqual(["GET"]);
  });
});

describe("수집 관리 Route Handler 계약 — POST /admin/ingestion/runs", () => {
  it("4. ADMIN 의 fixture 수동 수집은 202 IngestionRun(RUNNING, summary 0, requestedBy {id,name}) 이다", async () => {
    install();
    const response = await send(POST_RUNS, { headers: keyed() });
    expect(await successOf(response, 202)).toEqual(accepted());
  });

  it("4. 큐에는 세션의 조직·사람과 새 runId 로 job 하나를 넣는다(batch 대문자, 조직이 붙은 멱등 키)", async () => {
    const d = install();
    expect((await send(POST_RUNS, { headers: keyed() })).status).toBe(202);
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
    expect(firstJob(d)).toEqual({
      source: "fixture",
      batch: "SEED",
      trigger: "MANUAL",
      jobKey: `manual:${ORG_01}:${KEY}`,
      idempotencyKey: `${ORG_01}:${KEY}`,
      requestedBy: FAKE_USERS.admin.id,
      orgId: ORG_01,
      runId: NEW_RUN_ID,
    });
    expect(d.limiter.hit).toHaveBeenCalledWith(ORG_01);
  });

  it("4. live 모드의 g2b 수집은 202 batch:null 이고, stages 는 job 에 싣지 않는다(05 §6.6)", async () => {
    const d = install({ runMode: "live" });
    const response = await send(POST_RUNS, {
      body: { source: "g2b", window: WINDOW, stages: ["NOTICE"] },
      headers: keyed(),
    });
    expect(await successOf(response, 202)).toEqual(
      accepted({ source: "g2b", runMode: "live", batch: null }),
    );
    const job = firstJob(d);
    expect(job).toMatchObject({
      source: "g2b",
      trigger: "MANUAL",
      jobKey: `manual:${ORG_01}:${KEY}`,
      idempotencyKey: `${ORG_01}:${KEY}`,
      requestedBy: FAKE_USERS.admin.id,
      orgId: ORG_01,
      runId: NEW_RUN_ID,
    });
    expect(job).not.toHaveProperty("stages");
    expect(job).not.toHaveProperty("batch");
    const window = job.window as { from: string; to: string };
    expect(Date.parse(window.from)).toBe(Date.parse(WINDOW.from));
    expect(Date.parse(window.to)).toBe(Date.parse(WINDOW.to));
  });

  it("4. Idempotency-Key 가 없으면 서버가 requestId 를 만들어 jobKey·멱등 키에 같은 값을 쓴다", async () => {
    const d = install();
    expect((await send(POST_RUNS)).status).toBe(202);
    const job = firstJob(d);
    const match = /^manual:([^:]+):([A-Za-z0-9_-]{1,128})$/.exec(String(job.jobKey));
    expect(match?.[1]).toBe(ORG_01);
    expect(job.idempotencyKey).toBe(`${ORG_01}:${match?.[2]}`);
  });

  it.each([
    { name: "공백", key: "abc def" },
    { name: "129자", key: "a".repeat(129) },
    { name: "점", key: "a.b" },
    { name: "콜론", key: "a:b" },
    { name: "슬래시", key: "a/b" },
  ])(
    "5. Idempotency-Key 가 형식 밖($name)이면 400 VALIDATION_ERROR path Idempotency-Key 이고 Redis·큐를 부르지 않는다",
    async ({ key }) => {
      const d = install();
      const error = await errorOf(
        await send(POST_RUNS, { headers: keyed(key) }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details.issues[0].path).toBe("Idempotency-Key");
      expect(backendCalls(d)).toBe(0);
    },
  );

  it("5. 경계: 128자와 영숫자·_·- 조합의 Idempotency-Key 는 받는다", async () => {
    const d = install();
    expect((await send(POST_RUNS, { headers: keyed("a".repeat(128)) })).status).toBe(202);
    expect((await send(POST_RUNS, { headers: keyed("abc_DEF-123") })).status).toBe(202);
    expect(d.queue.enqueue).toHaveBeenCalledTimes(2);
  });

  it.each([
    { name: "빈 본문", rawBody: "" },
    { name: "JSON 아님", rawBody: "{not json" },
    { name: "배열", rawBody: "[]" },
    { name: "모르는 source", body: { source: "bogus" } },
    { name: "fixture 에 batch 없음", body: { source: "fixture" } },
    { name: "fixture 에 window", body: { source: "fixture", batch: "seed", window: WINDOW } },
    { name: "fixture 에 stages", body: { source: "fixture", batch: "seed", stages: ["NOTICE"] } },
    { name: "g2b 에 batch", body: { source: "g2b", batch: "seed" } },
    {
      name: "g2b window 8일",
      body: { source: "g2b", window: { from: "2026-10-01T00:00:00Z", to: "2026-10-09T00:00:00Z" } },
    },
    {
      name: "g2b window from > to",
      body: { source: "g2b", window: { from: WINDOW.to, to: WINDOW.from } },
    },
    { name: "g2b stages PRE_SPEC", body: { source: "g2b", stages: ["PRE_SPEC"] } },
  ])(
    "5. 본문이 IngestionRunInput 에 맞지 않으면($name) 400 VALIDATION_ERROR {issues} 이고 큐에 넣지 않는다",
    async ({ body, rawBody }) => {
      const d = install();
      const error = await errorOf(
        await send(POST_RUNS, { body, rawBody, headers: keyed() }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details.issues.length).toBeGreaterThan(0);
      for (const issue of error.details.issues) {
        expect(issue).toEqual({ path: expect.any(String), message: expect.any(String) });
      }
      expect(d.idempotency.claim).not.toHaveBeenCalled();
      expect(d.queue.enqueue).not.toHaveBeenCalled();
    },
  );

  it("5. 모르는 source 의 issues 는 path source 를 가리킨다", async () => {
    install();
    const error = await errorOf(
      await send(POST_RUNS, { body: { source: "bogus" }, headers: keyed() }),
      400,
      "VALIDATION_ERROR",
    );
    expect(error.details.issues.map((issue: { path: string }) => issue.path)).toContain("source");
  });

  it.each([
    { runMode: "mock", body: { source: "g2b" }, source: "g2b" },
    { runMode: "fixture", body: { source: "g2b", window: WINDOW }, source: "g2b" },
    { runMode: "live", body: { source: "fixture", batch: "seed" }, source: "fixture" },
  ] as const)(
    "6. $runMode 모드에 $source 수집은 409 RUN_MODE_MISMATCH {runMode, source} 이고 큐에 넣지 않는다",
    async ({ runMode, body, source }) => {
      const d = install({ runMode });
      const error = await errorOf(
        await send(POST_RUNS, { body, headers: keyed() }),
        409,
        "RUN_MODE_MISMATCH",
      );
      expect(error.details).toEqual({ runMode, source });
      expect(d.queue.enqueue).not.toHaveBeenCalled();
    },
  );

  it("6. 같은 키·같은 본문은 첫 202 를 그대로 다시 주고, 같은 키·다른 본문은 409 IDEMPOTENCY_KEY_REUSED 다", async () => {
    const d = install();
    const first = await successOf(await send(POST_RUNS, { headers: keyed() }), 202);
    const again = await successOf(await send(POST_RUNS, { headers: keyed() }), 202);
    expect(again).toEqual(first);
    await errorOf(
      await send(POST_RUNS, { body: { source: "fixture", batch: "live" }, headers: keyed() }),
      409,
      "IDEMPOTENCY_KEY_REUSED",
    );
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("6. 같은 키·같은 본문의 재요청은 그 수집이 RUNNING 이어도 첫 202 다(멱등 재현이 진행 중 판정보다 먼저)", async () => {
    const d = install();
    const first = await successOf(await send(POST_RUNS, { headers: keyed() }), 202);
    d.repo.findRunningRun.mockResolvedValue({ id: NEW_RUN_ID });
    const again = await successOf(await send(POST_RUNS, { headers: keyed() }), 202);
    expect(again).toEqual(first);
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("6. 같은 source 의 수집이 RUNNING 이면 409 INGESTION_IN_PROGRESS {runId} 이고, 끝난 뒤 같은 키로 다시 받는다", async () => {
    const d = install();
    d.repo.findRunningRun.mockImplementation(async (source) =>
      source === "fixture" ? { id: RUNNING_ID } : null,
    );
    const error = await errorOf(
      await send(POST_RUNS, { headers: keyed() }),
      409,
      "INGESTION_IN_PROGRESS",
    );
    expect(error.details).toEqual({ runId: RUNNING_ID });
    expect(d.queue.enqueue).not.toHaveBeenCalled();

    d.repo.findRunningRun.mockResolvedValue(null);
    expect(await successOf(await send(POST_RUNS, { headers: keyed() }), 202)).toEqual(accepted());
    expect(d.queue.enqueue).toHaveBeenCalledTimes(1);
  });

  it("6. 다른 source 의 RUNNING 은 막지 않는다", async () => {
    const d = install({ runMode: "live" });
    d.repo.findRunningRun.mockImplementation(async (source) =>
      source === "fixture" ? { id: RUNNING_ID } : null,
    );
    const response = await send(POST_RUNS, { body: { source: "g2b" }, headers: keyed() });
    expect(response.status, await response.clone().text()).toBe(202);
    expect(d.repo.findRunningRun).toHaveBeenCalledWith("g2b");
  });

  it("7. 속도 제한에 걸리면 429 RATE_LIMITED 와 Retry-After: 17 이고 큐에 넣지 않는다", async () => {
    const d = install();
    d.limiter.hit.mockResolvedValue({ allowed: false, retryAfterSeconds: 17 });
    const response = await send(POST_RUNS, { headers: keyed() });
    await errorOf(response, 429, "RATE_LIMITED");
    expect(response.headers.get("Retry-After")).toBe("17");
    expect(d.idempotency.claim).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it("8. 속도 제한 저장소가 던지면 503 {component:redis} 이고 원인은 로그 콜백으로만 간다", async () => {
    const d = install();
    const failure = new Error(LEAKY_FAILURE);
    d.limiter.hit.mockRejectedValue(failure);
    const response = await send(POST_RUNS, { headers: keyed() });
    const text = await response.clone().text();
    const error = await errorOf(response, 503, "SERVICE_UNAVAILABLE");
    expect(error.details).toEqual({ component: "redis" });
    expect(d.onInfraError).toHaveBeenCalledWith("redis", failure);
    expect(text).not.toContain("secret");
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it("8. 큐 등록이 던지면 503 {component:queue} 이고 멱등 키를 풀어 같은 키로 다시 받는다", async () => {
    const d = install();
    const failure = new Error(LEAKY_FAILURE);
    d.queue.enqueue.mockRejectedValueOnce(failure);
    const response = await send(POST_RUNS, { headers: keyed() });
    const text = await response.clone().text();
    const error = await errorOf(response, 503, "SERVICE_UNAVAILABLE");
    expect(error.details).toEqual({ component: "queue" });
    expect(d.onInfraError).toHaveBeenCalledWith("queue", failure);
    expect(text).not.toContain("secret");
    expect(d.idempotency.release).toHaveBeenCalledTimes(1);
    const released = String(d.idempotency.release.mock.calls[0]?.[0]);
    expect(released).toContain(ORG_01);
    expect(released).toContain(KEY);

    expect(await successOf(await send(POST_RUNS, { headers: keyed() }), 202)).toEqual(accepted());
    expect(d.queue.enqueue).toHaveBeenCalledTimes(2);
  });

  // 보안 L5: POST 본문 상한 16KB. bids analyses 와 같은 응답(400 VALIDATION_ERROR, issues path "body").
  const bodyTooLarge = async (response: Response) => {
    const error = await errorOf(response, 400, "VALIDATION_ERROR");
    expect(error.message).toBe("본문이 너무 큽니다");
    expect(error.details.issues).toEqual([{ path: "body", message: expect.any(String) }]);
  };
  const OVER_LIMIT = `"${"x".repeat(16 * 1024)}"`;

  it("13. Content-Length 가 16KB 를 넘는 수동 수집은 400 body 이고 속도 제한 횟수를 쓰지 않는다", async () => {
    const d = install();
    await bodyTooLarge(
      await send(POST_RUNS, {
        rawBody: OVER_LIMIT,
        headers: { ...keyed(), "Content-Length": String(OVER_LIMIT.length) },
      }),
    );
    expect(d.limiter.hit).not.toHaveBeenCalled();
    expect(backendCalls(d)).toBe(0);
  });

  it("13. Content-Length 없이 16KB 를 넘게 읽힌 본문도 400 body 이고 큐에 넣지 않는다", async () => {
    const d = install();
    await bodyTooLarge(await send(POST_RUNS, { rawBody: OVER_LIMIT, headers: keyed() }));
    // 길이를 미리 알 수 없어 본문은 속도 제한 뒤에 읽는다. 그 뒤로는 멱등 저장·큐를 부르지 않는다.
    expect(d.limiter.hit).toHaveBeenCalledTimes(1);
    expect(d.idempotency.claim).not.toHaveBeenCalled();
    expect(d.queue.enqueue).not.toHaveBeenCalled();
  });

  it("13. VIEWER 는 큰 본문이어도 403 FORBIDDEN 이다(권한이 먼저)", async () => {
    const d = install();
    await errorOf(
      await send(POST_RUNS, {
        user: FAKE_USERS.viewer,
        rawBody: OVER_LIMIT,
        headers: { ...keyed(), "Content-Length": String(OVER_LIMIT.length) },
      }),
      403,
      "FORBIDDEN",
    );
    expect(backendCalls(d)).toBe(0);
  });
});

describe("수집 관리 Route Handler 계약 — GET 목록·단건", () => {
  it("9. 목록은 Page<IngestionRun> 봉투이고 행을 05 IngestionRun 으로 바꾼다", async () => {
    const d = install();
    const body = await successOf(await send(GET_RUNS), 200);
    expect(Object.keys(body).sort()).toEqual(["items", "pageInfo"]);
    expect(body).toEqual({
      items: [VIEW_A, VIEW_B],
      pageInfo: { cursor: null, nextCursor: null, hasNext: false },
    });
    expect(d.repo.findMemberNames).toHaveBeenCalled();
    for (const [orgId] of d.repo.findMemberNames.mock.calls) expect(orgId).toBe(ORG_01);
    expect(d.repo.findManualRequesters).toHaveBeenCalled();
    for (const [orgId] of d.repo.findManualRequesters.mock.calls) expect(orgId).toBe(ORG_01);
  });

  it("9. limit 만큼 자르고 다음 커서로 이어 읽으며, 마지막 쪽은 nextCursor:null·hasNext:false 다", async () => {
    install();
    const first = await successOf(await send(GET_RUNS, { query: "?limit=1" }), 200);
    expect(first.items).toEqual([VIEW_A]);
    expect(first.pageInfo).toEqual({
      cursor: null,
      nextCursor: expect.any(String),
      hasNext: true,
    });
    const next: string = first.pageInfo.nextCursor;
    const second = await successOf(
      await send(GET_RUNS, { query: `?limit=1&cursor=${encodeURIComponent(next)}` }),
      200,
    );
    expect(second).toEqual({
      items: [VIEW_B],
      pageInfo: { cursor: next, nextCursor: null, hasNext: false },
    });
  });

  it("9. 틀린 커서는 400 INVALID_CURSOR 이고 목록을 읽지 않는다", async () => {
    const d = install();
    await errorOf(await send(GET_RUNS, { query: "?cursor=forged" }), 400, "INVALID_CURSOR");
    expect(d.repo.listRuns).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "abc", "1.5"])(
    "9. limit=%s 는 400 VALIDATION_ERROR path limit 이고 목록을 읽지 않는다",
    async (limit) => {
      const d = install();
      const error = await errorOf(
        await send(GET_RUNS, { query: `?limit=${limit}` }),
        400,
        "VALIDATION_ERROR",
      );
      expect(error.details.issues).toEqual([{ path: "limit", message: expect.any(String) }]);
      expect(d.repo.listRuns).not.toHaveBeenCalled();
    },
  );

  it("8. 커서 설정이 없으면 목록은 503 {component:cursor} 이고, 단건·수동 수집은 그대로 된다", async () => {
    const d = install({ cursor: "none" });
    const error = await errorOf(await send(GET_RUNS), 503, "SERVICE_UNAVAILABLE");
    expect(error.details).toEqual({ component: "cursor" });
    expect(d.repo.listRuns).not.toHaveBeenCalled();
    expect(await successOf(await send(GET_RUN), 200)).toEqual(VIEW_A);
    expect(await successOf(await send(POST_RUNS, { headers: keyed() }), 202)).toEqual(accepted());
  });

  it("10. 경로 id 가 UUID 가 아니면 404 NOT_FOUND {resource:ingestionRun} 이고 의존성을 부르지 않는다", async () => {
    const d = install();
    for (const id of ["abc", "FX-01", `${RUN_A}x`]) {
      const error = await errorOf(await send(GET_RUN, { id }), 404, "NOT_FOUND");
      expect(error.details, id).toEqual({ resource: "ingestionRun" });
    }
    expect(backendCalls(d)).toBe(0);
  });

  it("10. 없는 run(worker 가 아직 행을 만들지 않은 run 포함)은 404 NOT_FOUND {resource:ingestionRun} 이다", async () => {
    const d = install();
    const error = await errorOf(await send(GET_RUN, { id: NEW_RUN_ID }), 404, "NOT_FOUND");
    expect(error.details).toEqual({ resource: "ingestionRun" });
    expect(d.repo.findRun).toHaveBeenCalledWith(NEW_RUN_ID);
  });

  it("10. 있는 run 은 200 IngestionRun 이고 ingest_errors 를 {sourceKey,errorCode,resultCode,detail} 로 옮긴다", async () => {
    const d = install();
    expect(await successOf(await send(GET_RUN), 200)).toEqual(VIEW_A);
    expect(d.repo.findRun).toHaveBeenCalledWith(RUN_A);
    expect(d.repo.listErrors).toHaveBeenCalledWith([RUN_A]);
    expect(await successOf(await send(GET_RUN, { id: RUN_B }), 200)).toEqual(VIEW_B);
  });

  it("10. 다른 조직 사람이 요청한 run(감사가 그 조직에만 있다)은 requestedBy 가 null 이고 그 사람의 id 를 내보내지 않는다", async () => {
    const d = install({ audits: { [ORG_02]: { [RUN_A]: FAKE_USERS.otherViewer.id } } });
    const response = await send(GET_RUN);
    const text = await response.clone().text();
    expect(await successOf(response, 200)).toEqual({ ...VIEW_A, requestedBy: null });
    expect(text).not.toContain(FAKE_USERS.otherViewer.id);
    expect(d.repo.findManualRequesters).toHaveBeenCalledWith(ORG_01, [RUN_A]);
  });

  it("10. 지금 조직 감사의 행위자가 이제 구성원이 아니면 requestedBy 는 null 이고 그 사람의 id 를 내보내지 않는다", async () => {
    const d = install({ audits: { [ORG_01]: { [RUN_A]: FAKE_USERS.otherViewer.id } } });
    const response = await send(GET_RUN);
    const text = await response.clone().text();
    expect(await successOf(response, 200)).toEqual({ ...VIEW_A, requestedBy: null });
    expect(text).not.toContain(FAKE_USERS.otherViewer.id);
    expect(d.repo.findMemberNames).toHaveBeenCalledWith(ORG_01, [FAKE_USERS.otherViewer.id]);
  });

  it("10. 요청자는 행이 아니라 감사로 정한다 — 감사가 없으면 목록·단건 모두 requestedBy 가 null 이다", async () => {
    install({ audits: {} });
    expect(await successOf(await send(GET_RUN), 200)).toEqual({ ...VIEW_A, requestedBy: null });
    const list = await successOf(await send(GET_RUNS), 200);
    expect(list.items).toEqual([{ ...VIEW_A, requestedBy: null }, VIEW_B]);
  });

  it("15. 감사 읽기가 던진 DB 오류는 목록·단건 모두 500 INTERNAL_ERROR 이고 원문이 응답에 없다", async () => {
    const d = install();
    d.repo.findManualRequesters.mockRejectedValue({
      code: "XX000",
      message: "private audit details",
    });
    for (const endpoint of [GET_RUNS, GET_RUN]) {
      const response = await send(endpoint);
      const text = await response.clone().text();
      await errorOf(response, 500, "INTERNAL_ERROR");
      expect(text, endpoint.name).not.toContain("private");
    }
  });

  it("15. 저장소가 던진 DB 오류는 500 INTERNAL_ERROR 이고 원문이 응답에 없다", async () => {
    const d = install();
    const dbError = { code: "XX000", message: "private database details" };
    d.repo.listRuns.mockRejectedValue(dbError);
    d.repo.findRun.mockRejectedValue(dbError);
    for (const endpoint of [GET_RUNS, GET_RUN]) {
      const response = await send(endpoint);
      const text = await response.clone().text();
      await errorOf(response, 500, "INTERNAL_ERROR");
      expect(text, endpoint.name).not.toContain("private");
    }
  });
});

describe("수집 관리 Route Handler 계약 — 오류 봉투", () => {
  it("11. 오류 본문은 {error:{code,message,details,requestId}} 하나이고 requestId 는 X-Request-Id 와 같다", async () => {
    const d = install();
    d.repo.findRunningRun.mockResolvedValue({ id: RUNNING_ID });
    const samples = [
      await send(GET_RUN, { id: "abc" }),
      await send(POST_RUNS, { headers: keyed() }),
      await send(POST_RUNS, { user: FAKE_USERS.viewer, headers: keyed() }),
    ];
    for (const response of samples) {
      const requestId = response.headers.get("X-Request-Id");
      expect(requestId).toMatch(UUID_PATTERN);
      const body = await response.json();
      expect(Object.keys(body)).toEqual(["error"]);
      expect(Object.keys(body.error).sort()).toEqual(["code", "details", "message", "requestId"]);
      expect(body.error.requestId).toBe(requestId);
    }
  });
});
