import "server-only";
import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { ingestionAdminRepo } from "./ingestion-admin.repo";

// N8 수집 관리 읽기 저장소(계획 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1 "읽기"·§2 ingestion-admin.repo.ts).
// 사용자 세션(getSupabase, anon 키 + RLS)으로만 읽고 service role 을 쓰지 않는다.
// 진짜 supabase-js 에 가짜 fetch 를 넣어 PostgREST 로 보내는 요청(경로·필터·정렬·limit)을 잡는다(ingestion.repo.test.ts 관례).
// 실제 Supabase 에 붙지 않는다. 행을 RLS 가 어떻게 거르는지는 scripts/database.test.mjs 가 본다.
//
// N8 보안 점검 W1(계획 §5, 마이그레이션 20261019000019): 화면 역할은 ingest_runs 를 열 단위로만 읽는다.
// job_key·idempotency_key·requested_by·params 는 고르기·거르기 모두 권한 오류(42501)이므로 select=* 를 쓰지 않는다.
// 요청자는 행의 requested_by 가 아니라 지금 조직의 감사(audit_logs INGEST_MANUAL)의 actor_id 로 읽는다(findManualRequesters).

type Recorded = { method: string; url: URL };
type Reply = { status: number; body: unknown };

const net = vi.hoisted(() => ({
  requests: [] as { method: string; url: URL }[],
  replies: new Map<string, { status: number; body: unknown }>(),
}));

// 사용자 세션 통로만 가짜 클라이언트를 준다. service role·세션 없는 anon 통로는 부르면 던진다.
const supabase = vi.hoisted(() => ({
  getSupabase: vi.fn(),
  getSupabaseAdmin: vi.fn(() => {
    throw new Error("service role 클라이언트를 부르면 안 된다");
  }),
  createSupabaseAdminClient: vi.fn(() => {
    throw new Error("service role 클라이언트를 부르면 안 된다");
  }),
  getSupabaseAnon: vi.fn(() => {
    throw new Error("세션 없는 anon 클라이언트를 부르면 안 된다");
  }),
}));
vi.mock("@/server/supabase", () => supabase);

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const RUN_A = "a8000000-0000-4000-8000-0000000000a1";
const RUN_B = "a8000000-0000-4000-8000-0000000000b1";
const USER_A = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const USER_B = "4f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const STARTED_AT = "2026-10-20T01:00:00.000Z";

// 화면 역할이 고를 수 있는 ingest_runs 열(20261019000019 의 grant 순서). select 파라미터는 이 값 그대로다.
const VISIBLE_RUN_COLUMNS = [
  "id",
  "source",
  "run_mode",
  "trigger",
  "batch",
  "cursor",
  "status",
  "summary",
  "quota_used",
  "started_at",
  "finished_at",
];
const RUN_SELECT = VISIBLE_RUN_COLUMNS.join(",");
// PostgREST 쿼리에서 열이 아닌 키
const NON_COLUMN_PARAMS = new Set(["select", "order", "limit", "offset", "or", "and"]);

// 열 단위 grant 뒤 DB 가 돌려주는 모양(숨긴 네 열이 없다)
const RUN_ROW = {
  id: RUN_A,
  source: "fixture",
  run_mode: "MOCK",
  trigger: "MANUAL",
  batch: "SEED",
  cursor: null,
  status: "PARTIAL",
  summary: { created: 19 },
  quota_used: 0,
  started_at: STARTED_AT,
  finished_at: "2026-10-20T01:00:05.000Z",
};
const ERROR_ROW = {
  id: "e8000000-0000-4000-8000-000000000001",
  ingest_run_id: RUN_A,
  source_key: "fixture:FX-12",
  error_code: "MISSING_REQUIRED_FIELD",
  result_code: null,
  redacted_detail: "title 누락",
  created_at: "2026-10-20T01:00:03.000Z",
};
const DB_ERROR = { code: "42501", message: "permission denied for table", details: "", hint: "" };

const reply = (table: string, value: Reply) => net.replies.set(`/rest/v1/${table}`, value);
const ok = (body: unknown): Reply => ({ status: 200, body });
// 400 은 supabase-js 가 다시 시도하지 않는다(503·520 만 재시도).
const failing: Reply = { status: 400, body: DB_ERROR };

const fakeClient = () =>
  createClient<Database>("https://supabase.example.invalid", "public-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        net.requests.push({ method: init?.method ?? "GET", url });
        const found = net.replies.get(url.pathname) ?? {
          status: 404,
          body: { code: "PGRST000", message: `가짜에 없는 경로 ${url.pathname}` },
        };
        return new Response(JSON.stringify(found.body), {
          status: found.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });

const only = (): Recorded => {
  expect(net.requests).toHaveLength(1);
  return net.requests[0] as Recorded;
};
const params = (request: Recorded, key: string): string[] => request.url.searchParams.getAll(key);

beforeEach(() => {
  net.requests.length = 0;
  net.replies.clear();
  vi.clearAllMocks();
  supabase.getSupabase.mockImplementation(async () => fakeClient());
});

describe("ingestionAdminRepo.listRuns", () => {
  it("after 가 null 이면 ingest_runs 를 or 필터 없이 started_at desc, id desc 로 limit 만큼 읽는다", async () => {
    reply("ingest_runs", ok([RUN_ROW]));

    expect(await ingestionAdminRepo.listRuns({ limit: 21, after: null })).toEqual([RUN_ROW]);

    const request = only();
    expect([request.method, request.url.pathname]).toEqual(["GET", "/rest/v1/ingest_runs"]);
    expect(params(request, "select")).toEqual([RUN_SELECT]);
    expect(params(request, "or")).toEqual([]);
    expect(params(request, "order")).toEqual(["started_at.desc,id.desc"]);
    expect(params(request, "limit")).toEqual(["21"]);
  });

  it("조직 구분 없는 공용 표라 org_id 로 거르지 않는다", async () => {
    reply("ingest_runs", ok([]));

    await ingestionAdminRepo.listRuns({ limit: 5, after: null });

    expect(params(only(), "org_id")).toEqual([]);
  });

  it("after 가 있으면 started_at.lt 또는 (같은 started_at·더 작은 id) 의 keyset or 필터를 붙인다", async () => {
    reply("ingest_runs", ok([]));

    await ingestionAdminRepo.listRuns({ limit: 3, after: { startedAt: STARTED_AT, id: RUN_B } });

    const request = only();
    expect(params(request, "or")).toEqual([
      `(started_at.lt."${STARTED_AT}",and(started_at.eq."${STARTED_AT}",id.lt."${RUN_B}"))`,
    ]);
    expect(params(request, "order")).toEqual(["started_at.desc,id.desc"]);
    expect(params(request, "limit")).toEqual(["3"]);
  });

  it("필터 값 안의 큰따옴표·역슬래시는 역슬래시로 이스케이프한다(PostgREST 따옴표 값 규칙)", async () => {
    reply("ingest_runs", ok([]));

    await ingestionAdminRepo.listRuns({
      limit: 1,
      after: { startedAt: String.raw`2026"x\y`, id: String.raw`a"b\c` },
    });

    expect(params(only(), "or")).toEqual([
      String.raw`(started_at.lt."2026\"x\\y",and(started_at.eq."2026\"x\\y",id.lt."a\"b\\c"))`,
    ]);
  });

  it("DB 오류는 던진다(빈 목록으로 바꾸지 않는다)", async () => {
    reply("ingest_runs", failing);

    await expect(ingestionAdminRepo.listRuns({ limit: 1, after: null })).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo.findRun", () => {
  it("id 로 한 행을 읽는다", async () => {
    reply("ingest_runs", ok([RUN_ROW]));

    expect(await ingestionAdminRepo.findRun(RUN_A)).toEqual(RUN_ROW);
    expect(params(only(), "id")).toEqual([`eq.${RUN_A}`]);
  });

  it("select=* 가 아니라 허용 열 열한 개를 그 순서로 고른다(W1)", async () => {
    reply("ingest_runs", ok([RUN_ROW]));

    await ingestionAdminRepo.findRun(RUN_A);

    expect(params(only(), "select")).toEqual([RUN_SELECT]);
  });

  it("행이 없으면 null 이다", async () => {
    reply("ingest_runs", ok([]));

    expect(await ingestionAdminRepo.findRun(RUN_A)).toBeNull();
  });

  it("DB 오류는 던진다", async () => {
    reply("ingest_runs", failing);

    await expect(ingestionAdminRepo.findRun(RUN_A)).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo.listErrors", () => {
  it("run 이 없으면 DB 를 부르지 않고 [] 다", async () => {
    expect(await ingestionAdminRepo.listErrors([])).toEqual([]);

    expect(net.requests).toEqual([]);
    expect(supabase.getSupabase).not.toHaveBeenCalled();
  });

  it("주어진 run 들의 ingest_errors 를 in(ingest_run_id) 로 created_at·id 오름차순으로 읽는다", async () => {
    reply("ingest_errors", ok([ERROR_ROW]));

    expect(await ingestionAdminRepo.listErrors([RUN_A, RUN_B])).toEqual([ERROR_ROW]);

    const request = only();
    expect(request.url.pathname).toBe("/rest/v1/ingest_errors");
    expect(params(request, "ingest_run_id")).toEqual([`in.(${RUN_A},${RUN_B})`]);
    expect(params(request, "order")).toEqual(["created_at.asc,id.asc"]);
  });

  it("DB 오류는 던진다", async () => {
    reply("ingest_errors", failing);

    await expect(ingestionAdminRepo.listErrors([RUN_A])).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo.findRunningRun", () => {
  it("같은 source 의 RUNNING 행 하나(id 만)를 eq source·eq status·limit 1 로 읽는다", async () => {
    reply("ingest_runs", ok([{ id: RUN_A }]));

    expect(await ingestionAdminRepo.findRunningRun("g2b")).toEqual({ id: RUN_A });

    const request = only();
    expect(request.url.pathname).toBe("/rest/v1/ingest_runs");
    expect(params(request, "select")).toEqual(["id"]);
    expect(params(request, "source")).toEqual(["eq.g2b"]);
    expect(params(request, "status")).toEqual(["eq.RUNNING"]);
    expect(params(request, "limit")).toEqual(["1"]);
  });

  it("RUNNING 행이 없으면 null 이다", async () => {
    reply("ingest_runs", ok([]));

    expect(await ingestionAdminRepo.findRunningRun("fixture")).toBeNull();
    expect(params(only(), "source")).toEqual(["eq.fixture"]);
  });

  it("DB 오류는 던진다", async () => {
    reply("ingest_runs", failing);

    await expect(ingestionAdminRepo.findRunningRun("g2b")).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo.findLatestRun — 소스별 카드(N8 디자인 스펙 §4.4)", () => {
  it("source·status 묶음으로 거르고 finished_at desc(빈 값은 뒤)·id desc 로 한 행만 읽는다", async () => {
    reply("ingest_runs", ok([RUN_ROW]));

    expect(await ingestionAdminRepo.findLatestRun("fixture", ["SUCCEEDED", "PARTIAL"])).toEqual(
      RUN_ROW,
    );

    const request = only();
    expect([request.method, request.url.pathname]).toEqual(["GET", "/rest/v1/ingest_runs"]);
    expect(params(request, "select")).toEqual([RUN_SELECT]);
    expect(params(request, "source")).toEqual(["eq.fixture"]);
    expect(params(request, "status")).toEqual(["in.(SUCCEEDED,PARTIAL)"]);
    expect(params(request, "order")).toEqual(["finished_at.desc.nullslast,id.desc"]);
    expect(params(request, "limit")).toEqual(["1"]);
  });

  it("FAILED 하나도 같은 in 필터로 읽는다", async () => {
    reply("ingest_runs", ok([]));

    await ingestionAdminRepo.findLatestRun("g2b", ["FAILED"]);

    const request = only();
    expect(params(request, "source")).toEqual(["eq.g2b"]);
    expect(params(request, "status")).toEqual(["in.(FAILED)"]);
  });

  it("조직 구분 없는 공용 표라 org_id 로 거르지 않는다", async () => {
    reply("ingest_runs", ok([]));

    await ingestionAdminRepo.findLatestRun("fixture", ["FAILED"]);

    expect(params(only(), "org_id")).toEqual([]);
  });

  it("행이 없으면 null 이다", async () => {
    reply("ingest_runs", ok([]));

    expect(await ingestionAdminRepo.findLatestRun("g2b", ["SUCCEEDED", "PARTIAL"])).toBeNull();
  });

  it("DB 오류는 던진다(null 로 바꿔 '기록 없음'처럼 보이지 않는다)", async () => {
    reply("ingest_runs", failing);

    await expect(ingestionAdminRepo.findLatestRun("fixture", ["FAILED"])).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo — ingest_runs 열 단위 읽기(W1, 20261019000019)", () => {
  it("ingest_runs 를 읽는 네 메서드는 select=* 도 숨긴 열(job_key·idempotency_key·requested_by·params)도 고르지 않고, 거르기·정렬도 허용 열로만 한다", async () => {
    reply("ingest_runs", ok([]));

    await ingestionAdminRepo.listRuns({ limit: 2, after: { startedAt: STARTED_AT, id: RUN_B } });
    await ingestionAdminRepo.findRun(RUN_A);
    await ingestionAdminRepo.findRunningRun("g2b");
    await ingestionAdminRepo.findLatestRun("fixture", ["SUCCEEDED", "PARTIAL"]);

    expect(net.requests).toHaveLength(4);
    for (const request of net.requests) {
      const label = `${request.method} ${request.url.search}`;
      const selected = params(request, "select").flatMap((value) => value.split(","));
      expect(selected.length, label).toBeGreaterThan(0);
      expect(VISIBLE_RUN_COLUMNS, label).toEqual(expect.arrayContaining(selected));
      const filtered = [...request.url.searchParams.keys()].filter(
        (key) => !NON_COLUMN_PARAMS.has(key),
      );
      expect(VISIBLE_RUN_COLUMNS, label).toEqual(expect.arrayContaining(filtered));
      const ordered = params(request, "order").flatMap((value) =>
        value.split(",").map((part) => part.split(".")[0] ?? ""),
      );
      expect(VISIBLE_RUN_COLUMNS, label).toEqual(expect.arrayContaining(ordered));
    }
  });
});

describe("ingestionAdminRepo.findManualRequesters", () => {
  const AUDIT_ROW_A = { target_id: RUN_A, actor_id: USER_A };

  it("run 이 없으면 DB 를 부르지 않고 빈 Map 이다", async () => {
    const requesters = await ingestionAdminRepo.findManualRequesters(ORG_ID, []);

    expect(requesters).toEqual(new Map());
    expect(net.requests).toEqual([]);
    expect(supabase.getSupabase).not.toHaveBeenCalled();
  });

  it("audit_logs 를 eq org_id(지금 조직)·eq action INGEST_MANUAL·eq target_type ingest_run·in target_id 로 좁혀 GET 한 번에 읽는다", async () => {
    reply("audit_logs", ok([]));

    await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A, RUN_B]);

    const request = only();
    expect([request.method, request.url.pathname]).toEqual(["GET", "/rest/v1/audit_logs"]);
    expect(params(request, "org_id")).toEqual([`eq.${ORG_ID}`]);
    expect(params(request, "action")).toEqual(["eq.INGEST_MANUAL"]);
    expect(params(request, "target_type")).toEqual(["eq.ingest_run"]);
    expect(params(request, "target_id")).toEqual([`in.(${RUN_A},${RUN_B})`]);
  });

  it("감사의 target_id·actor_id 를 고르고 select=* 를 쓰지 않는다", async () => {
    reply("audit_logs", ok([]));

    await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A]);

    const selected = params(only(), "select").flatMap((value) => value.split(","));
    expect(selected).toEqual(expect.arrayContaining(["target_id", "actor_id"]));
    expect(selected).not.toContain("*");
  });

  it("ingest_runs 는 읽지 않는다(행의 requested_by 를 쓰지 않는다)", async () => {
    reply("audit_logs", ok([AUDIT_ROW_A]));

    await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A]);

    expect(net.requests.map((request) => request.url.pathname)).toEqual(["/rest/v1/audit_logs"]);
  });

  it("runId → actorId Map 이다", async () => {
    reply("audit_logs", ok([AUDIT_ROW_A, { target_id: RUN_B, actor_id: USER_B }]));

    const requesters = await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A, RUN_B]);

    expect(requesters).toEqual(
      new Map([
        [RUN_A, USER_A],
        [RUN_B, USER_B],
      ]),
    );
  });

  it("actor_id 가 null 인 감사(계정이 지워진 행위자)는 Map 에서 뺀다", async () => {
    reply("audit_logs", ok([AUDIT_ROW_A, { target_id: RUN_B, actor_id: null }]));

    const requesters = await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A, RUN_B]);

    expect(requesters).toEqual(new Map([[RUN_A, USER_A]]));
    expect(requesters.has(RUN_B)).toBe(false);
  });

  it("감사가 없는 run(일정·데모 수집, 다른 조직이 요청한 run)은 Map 에 없다", async () => {
    reply("audit_logs", ok([]));

    const requesters = await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A]);

    expect(requesters).toEqual(new Map());
  });

  it("DB 오류는 던진다(빈 Map 으로 바꾸지 않는다)", async () => {
    reply("audit_logs", failing);

    await expect(ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A])).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo.findMemberNames", () => {
  it("사람이 없으면 DB 를 부르지 않고 빈 Map 이다", async () => {
    const names = await ingestionAdminRepo.findMemberNames(ORG_ID, []);

    expect(names).toEqual(new Map());
    expect(net.requests).toEqual([]);
    expect(supabase.getSupabase).not.toHaveBeenCalled();
  });

  it("memberships 를 eq org_id 로 지금 조직에 좁히고 in user_id 로 프로필 이름을 함께 읽는다", async () => {
    reply("memberships", ok([]));

    await ingestionAdminRepo.findMemberNames(ORG_ID, [USER_A, USER_B]);

    const request = only();
    expect(request.url.pathname).toBe("/rest/v1/memberships");
    expect(params(request, "org_id")).toEqual([`eq.${ORG_ID}`]);
    expect(params(request, "user_id")).toEqual([`in.(${USER_A},${USER_B})`]);
    expect(params(request, "select")).toEqual(["user_id,profile:profiles(email,display_name)"]);
  });

  it("이름은 display_name, 없으면 이메일 @ 앞부분이다(nameOf 규칙)", async () => {
    reply(
      "memberships",
      ok([
        { user_id: USER_A, profile: { email: "admin@example.com", display_name: "가상직원" } },
        { user_id: USER_B, profile: { email: "sales.kim@example.com", display_name: null } },
      ]),
    );

    const names = await ingestionAdminRepo.findMemberNames(ORG_ID, [USER_A, USER_B]);

    expect(names).toEqual(
      new Map([
        [USER_A, "가상직원"],
        [USER_B, "sales.kim"],
      ]),
    );
  });

  it("조직 구성원으로 읽히지 않은 사람은 Map 에 없다", async () => {
    reply(
      "memberships",
      ok([{ user_id: USER_A, profile: { email: "admin@example.com", display_name: "가상직원" } }]),
    );

    const names = await ingestionAdminRepo.findMemberNames(ORG_ID, [USER_A, USER_B]);

    expect(names.has(USER_B)).toBe(false);
  });

  it("DB 오류는 던진다", async () => {
    reply("memberships", failing);

    await expect(ingestionAdminRepo.findMemberNames(ORG_ID, [USER_A])).rejects.toMatchObject({
      message: DB_ERROR.message,
    });
  });
});

describe("ingestionAdminRepo — 접속 통로", () => {
  it("일곱 읽기 모두 사용자 세션(getSupabase)만 쓰고 service role·세션 없는 anon 통로는 부르지 않는다", async () => {
    reply("ingest_runs", ok([]));
    reply("ingest_errors", ok([]));
    reply("memberships", ok([]));
    reply("audit_logs", ok([]));

    await ingestionAdminRepo.listRuns({ limit: 1, after: null });
    await ingestionAdminRepo.findRun(RUN_A);
    await ingestionAdminRepo.listErrors([RUN_A]);
    await ingestionAdminRepo.findRunningRun("fixture");
    await ingestionAdminRepo.findLatestRun("g2b", ["FAILED"]);
    await ingestionAdminRepo.findMemberNames(ORG_ID, [USER_A]);
    await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A]);

    expect(supabase.getSupabase).toHaveBeenCalledTimes(7);
    expect(supabase.getSupabaseAdmin).not.toHaveBeenCalled();
    expect(supabase.createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(supabase.getSupabaseAnon).not.toHaveBeenCalled();
  });

  it("읽기만 한다(GET 외 메서드를 보내지 않는다)", async () => {
    reply("ingest_runs", ok([]));
    reply("ingest_errors", ok([]));
    reply("memberships", ok([]));
    reply("audit_logs", ok([]));

    await ingestionAdminRepo.listRuns({ limit: 1, after: null });
    await ingestionAdminRepo.findRun(RUN_A);
    await ingestionAdminRepo.listErrors([RUN_A]);
    await ingestionAdminRepo.findRunningRun("fixture");
    await ingestionAdminRepo.findLatestRun("fixture", ["SUCCEEDED", "PARTIAL"]);
    await ingestionAdminRepo.findMemberNames(ORG_ID, [USER_A]);
    await ingestionAdminRepo.findManualRequesters(ORG_ID, [RUN_A]);

    expect(new Set(net.requests.map((request) => request.method))).toEqual(new Set(["GET"]));
  });
});
