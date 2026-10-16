import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const { profile, workspace, cookieStore, shell } = vi.hoisted(() => ({
  profile: vi.fn(),
  workspace: vi.fn(),
  cookieStore: vi.fn(),
  shell: vi.fn(),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: ComponentProps<"a">) => createElement("a", { href }, children),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "/alpha/tasks?q=1" }),
  cookies: cookieStore,
}));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/server/organization", () => ({ getMyWorkspace: workspace }));
vi.mock("@/components/app-shell", () => ({ AppShell: shell }));
import OrgLayout, { metadata } from "./layout";
const props = { params: Promise.resolve({ slug: "alpha" }), children: "PRIVATE BUSINESS CONTENT" };
beforeEach(() => {
  vi.clearAllMocks();
});
it.each([
  ["signed-out", "로그인이 필요합니다", "로그인하러 가기"],
  ["no-database", "DB 가 연결되지 않았습니다", "계정 화면으로 가기"],
])(
  "%s 조직 안내는 본문 없이 기존 제목과 링크 및 noindex를 유지한다",
  async (status, heading, link) => {
    profile.mockResolvedValue({ status });
    workspace.mockResolvedValue({ status });
    const html = renderToStaticMarkup(await OrgLayout(props));
    expect(html).toContain(heading);
    expect(html).toContain(`<a href="/auth/login">${link}</a>`);
    expect(html).not.toContain("PRIVATE BUSINESS CONTENT");
    expect(shell).not.toHaveBeenCalled();
    expect(cookieStore).not.toHaveBeenCalled();
    expect(metadata.robots).toEqual({ index: false, follow: false });
  },
);
it("미완료 로그인은 레이아웃 업무 조회 전에 실제 경로로 보완한다", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: false } });
  await expect(OrgLayout(props)).rejects.toThrow(
    /^REDIRECT:\/auth\/complete-profile\?next=%2Falpha%2Ftasks%3Fq%3D1$/,
  );
  expect(workspace).not.toHaveBeenCalled();
});
it("완료해도 조직 멤버가 아니면 기존 404를 유지한다", async () => {
  profile.mockResolvedValue({ status: "ready", profile: { profileComplete: true } });
  workspace.mockResolvedValue({ status: "not-found" });
  await expect(OrgLayout(props)).rejects.toThrow(/^NOT_FOUND$/);
  expect(shell).not.toHaveBeenCalled();
});
it.each(["missing", "suspended"])(
  "%s 계정은 조직 조회 전에 기존 로그인 안내로 보낸다",
  async (status) => {
    profile.mockResolvedValue({ status });
    await expect(OrgLayout(props)).rejects.toThrow(/^REDIRECT:\/auth\/login$/);
    expect(workspace).not.toHaveBeenCalled();
  },
);
