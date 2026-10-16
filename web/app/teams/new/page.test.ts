import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { home, profile } = vi.hoisted(() => ({ home: vi.fn(), profile: vi.fn() }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: ComponentProps<"a">) => createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("@/server/profile", () => ({
  getMyProfile: profile,
}));
vi.mock("@/server/organization", () => ({ getMyHome: home }));
import NewTeamPage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
});
it("새 팀 페이지도 홈 데이터 조회 전에 미완료 사용자를 차단한다", async () => {
  await expect(NewTeamPage()).rejects.toThrow(
    "REDIRECT:/auth/complete-profile?next=%2Fteams%2Fnew",
  );
  expect(home).not.toHaveBeenCalled();
});

it.each([
  ["signed-out", "로그인이 필요합니다", "로그인하러 가기"],
  ["no-database", "DB 가 연결되지 않았습니다", "계정 화면으로 가기"],
])("%s는 기존 새 팀 안내와 로그인 링크를 그린다", async (status, heading, link) => {
  profile.mockResolvedValue({ status });
  home.mockResolvedValue({ status });
  const html = renderToStaticMarkup(await NewTeamPage());
  expect(html).toContain(heading);
  expect(html).toContain(`<a href="/auth/login">${link}</a>`);
  expect(html).not.toContain("새 팀 만들기");
  expect(html).not.toContain("<form");
});
it.each(["missing", "suspended"])(
  "%s 계정은 홈 조회 전에 기존 로그인 안내로 보낸다",
  async (status) => {
    profile.mockResolvedValue({ status });
    await expect(NewTeamPage()).rejects.toThrow(/^REDIRECT:\/auth\/login$/);
    expect(home).not.toHaveBeenCalled();
  },
);

it.each(["no-org", "multiple-orgs"])("%s goes to organization state", async (status) => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  home.mockResolvedValue({ status, userId: "me" });
  await expect(NewTeamPage()).rejects.toThrow("REDIRECT:/auth/organization-state");
});
it("READY direct company creation is unreleased 404", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  home.mockResolvedValue({ status: "ready", userId: "me", current: { slug: "business" } });
  await expect(NewTeamPage()).rejects.toThrow("NOT_FOUND");
});
