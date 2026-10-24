import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  ORG_01,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import * as memberRoute from "./team-members/[id]/route";
import * as membersRoute from "./team-members/route";

// N4b 계약: ADMIN 만 쓰고(다른 역할 403), 조직은 세션에서 정하며, 다른 조직 직원은 404 다.
// 권한·감사의 DB 쪽 확인은 scripts/database.test.mjs "N4b 직원 추가·이동·퇴사" 가 본다.
const rpc = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null as { code: string; message: string } | null },
}));
vi.mock("@/server/supabase", async (original) => {
  const actual = await original<typeof import("@/server/supabase")>();
  const { fakeCookieClient } = await import("@/app/api/v1/_lib/fake-session");
  // 쿠키 세션 클라이언트(가짜) 그대로 두고 편집 RPC 두 개만 가로챈다. 가입 완료 판정의 카탈로그 RPC 는 가짜 답 그대로다.
  const EDIT_RPCS = ["create_team_member", "update_team_member"];
  return {
    ...actual,
    getSupabase: async () => {
      const client = fakeCookieClient();
      return {
        ...client,
        rpc: async (name: string, args: Record<string, unknown>) => {
          if (!EDIT_RPCS.includes(name)) return client.rpc();
          rpc.calls.push({ name, args });
          return rpc.reply;
        },
      };
    },
  };
});
vi.mock(
  "next/headers",
  async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders,
);
vi.mock("@supabase/ssr", async () => ({
  createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
}));

const MEMBER = "5e000000-0000-4000-8000-000000000001";
const TEAM = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
const TITLE = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
const edited = (overrides: Record<string, unknown> = {}) => ({
  id: MEMBER,
  personCode: "SOL-N0001",
  name: "새직원",
  email: null,
  departmentId: TEAM,
  jobTitleId: TITLE,
  employmentStatus: "ACTIVE",
  isDemo: false,
  ...overrides,
});
const headers = { "X-Requested-With": "sol-radar", "Content-Type": "application/json" };
const post = (body: unknown, user: FakeUser = FAKE_USERS.admin, init: RequestInit = {}) => {
  fakeSession.cookie = user.token;
  return membersRoute.POST(
    fakeRequest("/api/v1/team-members", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...init,
    }),
  );
};
const patch = (body: unknown, user: FakeUser = FAKE_USERS.admin, id = MEMBER) => {
  fakeSession.cookie = user.token;
  return memberRoute.PATCH(
    fakeRequest(`/api/v1/team-members/${id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
};

beforeEach(() => {
  resetFakeSession();
  rpc.calls = [];
  rpc.reply = { data: edited(), error: null };
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/v1/team-members", () => {
  it("ADMIN 은 201 이고 조직은 본문이 아니라 세션에서 정한다", async () => {
    const response = await post({ name: " 새직원 ", departmentId: TEAM, jobTitleId: TITLE });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(edited());
    expect(rpc.calls).toEqual([
      {
        name: "create_team_member",
        args: { p_org_id: ORG_01, p_name: "새직원", p_department_id: TEAM, p_job_title_id: TITLE },
      },
    ]);
  });
  it("ADMIN 이 아니면 403, CSRF 헤더가 없으면 403, 점수 속성·조직 id 는 400 — DB 함수를 부르지 않는다", async () => {
    for (const user of [FAKE_USERS.sales, FAKE_USERS.analyst, FAKE_USERS.viewer]) {
      const response = await post({ name: "새직원", departmentId: TEAM, jobTitleId: TITLE }, user);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    }
    const noCsrf = await post(
      { name: "새직원", departmentId: TEAM, jobTitleId: TITLE },
      FAKE_USERS.admin,
      { headers: { "Content-Type": "application/json" } },
    );
    expect(noCsrf.status).toBe(403);
    expect(await noCsrf.json()).toMatchObject({ error: { code: "CSRF_REJECTED" } });
    for (const extra of [{ skills: ["Java"] }, { role: "PM" }, { orgId: ORG_01 }]) {
      const response = await post({
        name: "새직원",
        departmentId: TEAM,
        jobTitleId: TITLE,
        ...extra,
      });
      expect(response.status).toBe(400);
    }
    expect(rpc.calls).toEqual([]);
  });
  it("DB 거절은 v1 오류로 옮긴다 — 팀이 아닌 부서는 400 departmentId", async () => {
    rpc.reply = { data: null, error: { code: "P0001", message: "DEPARTMENT_NOT_TEAM" } };
    const response = await post({ name: "새직원", departmentId: TEAM, jobTitleId: TITLE });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", details: { issues: [{ path: "departmentId" }] } },
    });
  });
});

describe("PATCH /api/v1/team-members/:id", () => {
  it("ADMIN 의 퇴사 처리는 200 이고 바꾸는 값만 보낸다", async () => {
    rpc.reply = { data: edited({ employmentStatus: "LEFT" }), error: null };
    const response = await patch({ employmentStatus: "LEFT" });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ employmentStatus: "LEFT" });
    expect(rpc.calls).toEqual([
      { name: "update_team_member", args: { p_member_id: MEMBER, p_employment_status: "LEFT" } },
    ]);
  });
  it("다른 조직·없는 직원은 404, ID 형식 오류·빈 본문은 400, ADMIN 이 아니면 403", async () => {
    rpc.reply = { data: null, error: { code: "P0001", message: "NOT_FOUND" } };
    const foreign = await patch({ departmentId: TEAM });
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
    rpc.calls = [];
    const badId = await patch({ departmentId: TEAM }, FAKE_USERS.admin, "not-a-uuid");
    expect(badId.status).toBe(400);
    expect(await badId.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR", details: { issues: [{ path: "id" }] } },
    });
    expect((await patch({ departmentId: TEAM }, FAKE_USERS.viewer)).status).toBe(403);
    expect((await patch({})).status).toBe(400);
    expect(rpc.calls).toEqual([]);
  });
});
