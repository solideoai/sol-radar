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
import { GET as getProfile } from "./route";
import { GET as getRevisions } from "./revisions/route";

// 05 §2 GET /company-profile·/company-profile/revisions 계약 시험. 인증·가입 완료·업무 조직 확인은 진짜 코드가 돌고
// Supabase SDK 전송만 fake-session 이 바꾼다(admin/ai/status route.test.ts 와 같은 방식).
// 가짜는 order 를 흉내 내지 않으므로 표에 최신 revision 을 먼저 넣는다. 누가 읽는지(RLS)는 scripts/database.test.mjs 몫이다.

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

const creator = { display_name: "관리자", email: "admin@soltech.invalid" };
const profileRow = (orgId: string, revision: number, name: string) => ({
  id: `c0000000-0000-4000-8000-${orgId.slice(-4)}0000000${revision}`,
  org_id: orgId,
  revision,
  name,
  technologies: revision === 1 ? [{ name: "Java" }] : [{ name: "Java" }, { name: "Kubernetes" }],
  technologies_complete: revision !== 1,
  licenses: [{ code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "HELD" }],
  industry_codes: [],
  past_projects: [],
  financials: null,
  preferences: null,
  is_demo: true,
  effective_at: `2026-10-1${revision}T15:00:00+00:00`,
  created_by: FAKE_USERS.admin.id,
  note: `revision ${revision}`,
  created_at: "2026-10-20T01:00:00+00:00",
  creator,
});

function seed() {
  fakeSession.tables.company_profiles = [
    profileRow(ORG_01, 2, "솔리데오"),
    profileRow(ORG_01, 1, "솔리데오"),
    profileRow(ORG_02, 1, "격리 확인 조직"),
  ];
}

type Send = { user?: FakeUser | null; path?: "profile" | "revisions"; search?: string };
function send({
  user = FAKE_USERS.viewer,
  path = "profile",
  search = "",
}: Send = {}): Promise<Response> {
  fakeSession.cookie = user?.token ?? null;
  const url = path === "profile" ? "/api/v1/company-profile" : "/api/v1/company-profile/revisions";
  const request = fakeRequest(url + search, { method: "GET" });
  return path === "profile" ? getProfile(request) : getRevisions(request);
}

async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  const body = (await response.json()) as { error: { code: string; details: unknown } };
  expect(body.error.code).toBe(code);
  return body.error;
}

beforeEach(() => {
  resetFakeSession();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SOL_RUN_MODE", "mock");
  // 500 경로는 오류 로그를 남긴다. 시험 출력만 조용히 한다.
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/v1/company-profile", () => {
  it.each(["admin", "sales", "analyst", "viewer"] as const)(
    "%s 는 자기 조직의 최신 revision 을 읽는다",
    async (role) => {
      const response = await send({ user: FAKE_USERS[role] });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        orgId: ORG_01,
        revision: 2,
        name: "솔리데오",
        isDemo: true,
        technologiesComplete: true,
        createdBy: { id: FAKE_USERS.admin.id, name: "관리자" },
      });
      expect(body).not.toHaveProperty("org_id");
    },
  );

  it("다른 조직 사용자는 자기 조직 프로필만 받는다(G5)", async () => {
    const response = await send({ user: FAKE_USERS.otherViewer });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ orgId: ORG_02, name: "격리 확인 조직" });
  });

  it("조직에 프로필이 없으면 404 다", async () => {
    fakeSession.tables.company_profiles = [profileRow(ORG_02, 1, "격리 확인 조직")];
    const error = await errorOf(await send(), 404, "NOT_FOUND");
    expect(error.details).toEqual({ resource: "companyProfile" });
  });

  it("로그인하지 않으면 401 이다", async () => {
    await errorOf(await send({ user: null }), 401, "UNAUTHENTICATED");
  });

  // 운영자(profiles.is_admin)도 남의 조직은 못 읽는다(AGENTS.md). 조직은 멤버십으로만 정하고 쿼리로 고를 수 없다.
  it("서비스 운영자도 자기 조직에 프로필이 없으면 다른 조직 것을 받지 않고 404 다", async () => {
    fakeSession.operatorIds = [FAKE_USERS.otherViewer.id];
    fakeSession.tables.company_profiles = [
      profileRow(ORG_01, 2, "솔리데오"),
      profileRow(ORG_01, 1, "솔리데오"),
    ];
    for (const search of ["", `?orgId=${ORG_01}`, `?org_id=${ORG_01}`]) {
      const error = await errorOf(
        await send({ user: FAKE_USERS.otherViewer, search }),
        404,
        "NOT_FOUND",
      );
      expect(error.details, search).toEqual({ resource: "companyProfile" });
      const revisions = await send({ user: FAKE_USERS.otherViewer, path: "revisions", search });
      expect(await revisions.json(), search).toEqual([]);
    }
  });

  it("업무 조직이 아닌 개인 조직이면 403 이다", async () => {
    fakeSession.personalOrg = true;
    await errorOf(await send(), 403, "FORBIDDEN");
  });

  it("저장 값이 프로필 스키마와 맞지 않으면 500 이고 값은 응답에 싣지 않는다", async () => {
    fakeSession.tables.company_profiles = [
      { ...profileRow(ORG_01, 2, "솔리데오"), licenses: [{ code: "X", status: "SECRET-VALUE" }] },
    ];
    const response = await send();
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SECRET-VALUE");
  });
});

describe("GET /api/v1/company-profile/revisions", () => {
  it("자기 조직의 revision 요약만 최신부터 돌려준다", async () => {
    const response = await send({ path: "revisions" });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { revision: number; note: string }[];
    expect(body.map((row) => row.revision)).toEqual([2, 1]);
    expect(body[0]).toEqual({
      id: profileRow(ORG_01, 2, "솔리데오").id,
      revision: 2,
      effectiveAt: "2026-10-12T15:00:00+00:00",
      createdBy: { id: FAKE_USERS.admin.id, name: "관리자" },
      createdAt: "2026-10-20T01:00:00+00:00",
      note: "revision 2",
    });
  });

  it("만든 사람의 계정이 지워진 revision 은 탈퇴한 사용자로 내보낸다(05 createdBy 는 null 이 아니다)", async () => {
    fakeSession.tables.company_profiles = [
      profileRow(ORG_01, 2, "솔리데오"),
      { ...profileRow(ORG_01, 1, "솔리데오"), created_by: null, creator: null },
    ];
    const body = (await (await send({ path: "revisions" })).json()) as { createdBy: unknown }[];
    expect(body.map((row) => row.createdBy)).toEqual([
      { id: FAKE_USERS.admin.id, name: "관리자" },
      { id: "deleted-user", name: "탈퇴한 사용자" },
    ]);
  });

  it("다른 조직 사용자는 자기 조직 이력 1건만 받는다", async () => {
    const response = await send({ user: FAKE_USERS.otherViewer, path: "revisions" });
    expect((await response.json()) as unknown[]).toHaveLength(1);
  });

  it("로그인하지 않으면 401 이다", async () => {
    await errorOf(await send({ user: null, path: "revisions" }), 401, "UNAUTHENTICATED");
  });
});
