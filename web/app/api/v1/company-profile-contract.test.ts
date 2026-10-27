import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import { SOL_ROLE_GUIDE } from "@/app/(app)/(work)/settings/organization/org-settings-copy";
import { visibleNavGroups } from "@/components/app-nav";
import * as profileRoute from "./company-profile/route";
import * as revisionsRoute from "./company-profile/revisions/route";

// GET /company-profile·/revisions 접근 제한(회사 역량은 ADMIN·EXECUTIVE 만). 인증·업무 조직 확인은 진짜 입구 코드가 돌고
// 프로필 읽기만 가짜다. RLS 읽기는 조직 전원이라 제한은 메뉴·페이지·API 에서만 건다.

const reads = vi.hoisted(() => ({
  getCompanyProfile: vi.fn(),
  listCompanyProfileRevisions: vi.fn(),
}));
vi.mock("@/server/company-profile", async (original) => ({
  ...(await original<typeof import("@/server/company-profile")>()),
  getCompanyProfile: reads.getCompanyProfile,
  listCompanyProfileRevisions: reads.listCompanyProfileRevisions,
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

const PROFILE = { id: "p1", revision: 1 };

function get(handler: (request: Request) => Promise<Response>, path: string, user: FakeUser) {
  fakeSession.cookie = user.token;
  return handler(fakeRequest(path));
}
const getProfile = (user: FakeUser) => get(profileRoute.GET, "/api/v1/company-profile", user);
const getRevisions = (user: FakeUser) =>
  get(revisionsRoute.GET, "/api/v1/company-profile/revisions", user);

beforeEach(() => {
  resetFakeSession();
  reads.getCompanyProfile.mockReset().mockResolvedValue(PROFILE);
  reads.listCompanyProfileRevisions.mockReset().mockResolvedValue([]);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("회사 역량 API 접근 제한", () => {
  it("ADMIN·EXECUTIVE 는 GET /company-profile·/revisions 200", async () => {
    for (const user of [FAKE_USERS.admin, FAKE_USERS.executive]) {
      expect((await getProfile(user)).status).toBe(200);
      expect((await getRevisions(user)).status).toBe(200);
    }
  });

  it("VIEWER·ANALYST·SALES 는 두 API 모두 403 FORBIDDEN 이고 프로필을 읽지 않는다", async () => {
    for (const user of [FAKE_USERS.viewer, FAKE_USERS.analyst, FAKE_USERS.sales]) {
      for (const call of [getProfile, getRevisions]) {
        const response = await call(user);
        expect(response.status).toBe(403);
        expect((await response.json()).error.code).toBe("FORBIDDEN");
      }
    }
    expect(reads.getCompanyProfile).not.toHaveBeenCalled();
    expect(reads.listCompanyProfileRevisions).not.toHaveBeenCalled();
  });
});

describe("역할 목록·메뉴", () => {
  const hasCompany = (role: Parameters<typeof visibleNavGroups>[0]) =>
    visibleNavGroups(role).some((group) => group.items.some((item) => item.href === "/company"));

  it("/company 메뉴는 VIEWER 에 없고 EXECUTIVE·ADMIN 에 있다", () => {
    expect(hasCompany("VIEWER")).toBe(false);
    expect(hasCompany("EXECUTIVE")).toBe(true);
    expect(hasCompany("ADMIN")).toBe(true);
  });

  it("안내 문구에 EXECUTIVE 줄이 있다", () => {
    expect(SOL_ROLE_GUIDE.some((line) => line.role === "EXECUTIVE")).toBe(true);
  });
});
