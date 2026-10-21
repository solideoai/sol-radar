import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
  type FakeUser,
} from "@/app/api/v1/_lib/fake-session";
import { GET } from "./route";

// GET /api/v1/program-notices 계약 시험. 인증·가입 완료·업무 조직 확인은 진짜 코드가 돌고 Supabase SDK 전송만 fake-session 이 바꾼다.
// 가짜는 정렬을 흉내 내지 않는다. 정렬·묶기·마감 규칙은 list.service.test.ts, 누가 읽는지(RLS)는 scripts/database.test.mjs 몫이다.

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

const noticeRow = (n: number, fields: Record<string, unknown> = {}) => ({
  id: `9a000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  source: "bizinfo",
  source_notice_id: `PBLN_${n}`,
  title: `가상 지원사업 ${n}`,
  agency: "중소벤처기업부",
  source_url: `https://www.bizinfo.go.kr/view.do?pblancId=PBLN_${n}`,
  published_at: "2026-10-20T00:00:00+00:00",
  apply_start_on: null,
  apply_end_on: "2099-12-31",
  summary: null,
  apply_method: null,
  target: null,
  tags: [],
  is_demo: false,
  dedupe_key: `가상지원사업${n}|중소벤처기업부`,
  fetched_at: "2026-10-21T00:00:00+00:00",
  ...fields,
});

function send(search = "", user: FakeUser | null = FAKE_USERS.viewer): Promise<Response> {
  fakeSession.cookie = user?.token ?? null;
  return GET(fakeRequest(`/api/v1/program-notices${search}`, { method: "GET" }));
}

beforeEach(() => {
  resetFakeSession();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
  vi.stubEnv("SOL_RUN_MODE", "mock");
  vi.spyOn(console, "error").mockImplementation(() => {});
  fakeSession.tables.program_notices = [
    noticeRow(1),
    noticeRow(2, { apply_end_on: "2000-01-01" }),
    noticeRow(3, { source: "mss", source_url: "https://mss.go.kr/x?bcIdx=3", apply_end_on: null }),
  ];
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/v1/program-notices", () => {
  it("업무 사용자는 진행 중 공고 목록을 받는다(마감 지난 공고는 기본으로 빠진다)", async () => {
    const response = await send();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: { id: string; sourceUrl: string }[];
      total: number;
      hasAnyNotice: boolean;
      isCapped: boolean;
    };
    expect(body.items.map((item) => item.id)).toEqual([noticeRow(1).id, noticeRow(3).id]);
    expect(body).toMatchObject({ total: 2, hasAnyNotice: true, isCapped: false });
    expect(body.items[0]).not.toHaveProperty("source_url");
    expect(body.items[0]).not.toHaveProperty("dedupe_key");
  });

  it("includeClosed=true·source=bizinfo 를 따른다(마감 빠른 순이라 지난 마감이 앞이다)", async () => {
    const body = (await (await send("?includeClosed=true&source=bizinfo")).json()) as {
      items: { id: string }[];
    };
    expect(body.items.map((item) => item.id)).toEqual([noticeRow(2).id, noticeRow(1).id]);
  });

  it("값이 틀리면 400 VALIDATION_ERROR 와 틀린 키다", async () => {
    const response = await send("?sort=score");
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: { code: string; details: { issues: { path: string }[] } };
    };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.issues.map((issue) => issue.path)).toEqual(["sort"]);
  });

  it("로그인하지 않으면 401 이다", async () => {
    const response = await send("", null);
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "UNAUTHENTICATED",
    );
  });
});
