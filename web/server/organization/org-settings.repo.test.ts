import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { orgSettingsRepo } from "./org-settings.repo";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/server/supabase", () => ({
  getSupabase: () => client(),
  getAuthClaims: vi.fn(),
  isSupabaseConfigured: () => true,
}));

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000002";

type Sent = { method: string; url: URL; body: unknown };

// PostgREST 응답을 흉내 낸다. 보낸 요청(방법·주소·본문)을 남겨 어떤 표·열·조건을 읽고 쓰는지 본다.
function respondWith(status: number, payload: unknown): Sent[] {
  const sent: Sent[] = [];
  client.mockReturnValue(
    createClient<Database>("https://supabase.example.invalid", "fake-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          sent.push({
            method: init?.method ?? "GET",
            url: new URL(input instanceof Request ? input.url : input.toString()),
            body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
          });
          return new Response(JSON.stringify(payload), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }),
  );
  return sent;
}

beforeEach(() => client.mockReset());

describe("orgSettingsRepo 읽기", () => {
  it("구성원은 지금 조직의 업무 역할·합류일·프로필(상태 포함)을 읽는다", async () => {
    const sent = respondWith(200, [
      {
        user_id: USER_ID,
        sol_role: "ADMIN",
        created_at: "2026-10-19T00:00:00Z",
        profile: { email: "a@x.invalid", display_name: "김관리", status: "active" },
      },
    ]);
    await expect(orgSettingsRepo.listMembers(ORG_ID)).resolves.toEqual([
      {
        userId: USER_ID,
        solRole: "ADMIN",
        joinedAt: "2026-10-19T00:00:00Z",
        email: "a@x.invalid",
        displayName: "김관리",
        status: "active",
      },
    ]);
    expect(sent[0].url.pathname).toBe("/rest/v1/memberships");
    expect(sent[0].url.searchParams.get("org_id")).toBe(`eq.${ORG_ID}`);
    expect(sent[0].url.searchParams.get("select")).toContain("sol_role");
  });

  it("기록은 두 감사 종류만 최근 순으로 limit 건 읽는다", async () => {
    const sent = respondWith(200, []);
    await orgSettingsRepo.listAudit(ORG_ID, 20);
    const params = sent[0].url.searchParams;
    expect(sent[0].url.pathname).toBe("/rest/v1/audit_logs");
    expect(params.get("org_id")).toBe(`eq.${ORG_ID}`);
    expect(params.get("action")).toBe("in.(USER_ROLE_CHANGE,USER_INVITE)");
    expect(params.get("order")).toBe("created_at.desc,id.desc");
    expect(params.get("limit")).toBe("20");
  });
});

describe("orgSettingsRepo.updateSolRole", () => {
  it("지금 조직의 대상 행의 sol_role 만 적는다", async () => {
    const sent = respondWith(200, [{ user_id: USER_ID }]);
    await expect(orgSettingsRepo.updateSolRole(ORG_ID, USER_ID, "ANALYST")).resolves.toBe("saved");
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].body).toEqual({ sol_role: "ANALYST" });
    expect(sent[0].url.searchParams.get("org_id")).toBe(`eq.${ORG_ID}`);
    expect(sent[0].url.searchParams.get("user_id")).toBe(`eq.${USER_ID}`);
  });

  it("정책이 걸러 바뀐 행이 없으면 none 이다", async () => {
    respondWith(200, []);
    await expect(orgSettingsRepo.updateSolRole(ORG_ID, USER_ID, "VIEWER")).resolves.toBe("none");
  });

  it("마지막 ADMIN 보호는 last-admin, 두 번째 잠금(42501)은 forbidden 이다", async () => {
    respondWith(400, { code: "P0001", hint: "last_admin", message: "마지막 ADMIN" });
    await expect(orgSettingsRepo.updateSolRole(ORG_ID, USER_ID, "VIEWER")).resolves.toBe(
      "last-admin",
    );
    respondWith(403, { code: "42501", hint: "sol_role_admin_only", message: "ADMIN 만" });
    await expect(orgSettingsRepo.updateSolRole(ORG_ID, USER_ID, "VIEWER")).resolves.toBe(
      "forbidden",
    );
  });

  it("예상하지 못한 오류는 던진다", async () => {
    respondWith(500, { code: "XX000", hint: "", message: "boom" });
    await expect(orgSettingsRepo.updateSolRole(ORG_ID, USER_ID, "VIEWER")).rejects.toMatchObject({
      code: "XX000",
    });
  });
});

describe("orgSettingsRepo 초대", () => {
  it("새 초대는 조직 역할 member 와 고른 업무 역할로 넣는다", async () => {
    const sent = respondWith(201, null);
    await expect(orgSettingsRepo.insertInvitation(ORG_ID, "new@x.invalid", "SALES")).resolves.toBe(
      "invited",
    );
    expect(sent[0].body).toEqual({
      org_id: ORG_ID,
      email: "new@x.invalid",
      org_role: "member",
      sol_role: "SALES",
    });
  });

  it.each([
    [409, { code: "23505", hint: "", message: "dup" }, "exists"],
    [400, { code: "P0001", hint: "already_member", message: "member" }, "already-member"],
    [400, { code: "P0001", hint: "personal_org", message: "personal" }, "personal-org"],
    [403, { code: "42501", hint: "", message: "rls" }, "forbidden"],
  ])("응답 %i %o 는 %s 다", async (status, payload, expected) => {
    respondWith(status, payload);
    await expect(orgSettingsRepo.insertInvitation(ORG_ID, "new@x.invalid", "VIEWER")).resolves.toBe(
      expected,
    );
  });

  it("다시 초대는 업무 역할만 적는다(만료 연장은 DB 트리거가 한다)", async () => {
    const sent = respondWith(200, [{ id: "inv" }]);
    await expect(orgSettingsRepo.renewInvitation(ORG_ID, "new@x.invalid", "ANALYST")).resolves.toBe(
      true,
    );
    expect(sent[0].method).toBe("PATCH");
    expect(sent[0].body).toEqual({ sol_role: "ANALYST" });
    expect(sent[0].url.searchParams.get("email")).toBe("eq.new@x.invalid");
  });

  it("초대 취소는 지금 조직과 id 둘 다로 좁힌다", async () => {
    const sent = respondWith(200, []);
    await orgSettingsRepo.deleteInvitation(ORG_ID, USER_ID);
    expect(sent[0].method).toBe("DELETE");
    expect(sent[0].url.searchParams.get("org_id")).toBe(`eq.${ORG_ID}`);
    expect(sent[0].url.searchParams.get("id")).toBe(`eq.${USER_ID}`);
  });
});
