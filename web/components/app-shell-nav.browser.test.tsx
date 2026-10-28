import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { SolRole } from "@/server/organization";
import { AppShell } from "./app-shell";

// 묶음 사이드바(2026-10-28 사용자 결정 시안 A): 묶음 줄에만 아이콘, 메뉴는 글자만 들여 쓰고 지금 메뉴는 연한 파랑.
// 접은 64px 줄은 메뉴 아이콘만 남는다. 위 막대에서는 화면 이름을 빼고, 접었을 때 조직 이름만 남긴다.

const nav = vi.hoisted(() => ({ pathname: "/bids" }));

vi.mock("next/navigation", () => ({
  __esModule: true,
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
// Next 이미지 최적화 서버가 없는 부품 시험에서는 원본 정적 이미지를 그린다.
vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"img">) => createElement("img", props),
}));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowser: vi.fn() }));

const user = { name: "이영업", email: null, avatarUrl: null, isAdmin: false };
const workspace = {
  current: {
    id: "org-1",
    slug: "solideo",
    name: "솔리데오",
    isPersonal: false,
    myRole: "member" as const,
  },
  orgs: [],
  pendingInvitationCount: 0,
};

const mounted: Root[] = [];
const unmountAll = () => {
  for (const root of mounted.splice(0)) root.unmount();
  document.body.replaceChildren();
};

// 사이드바 펼침은 첫 그림의 값(defaultOpen)이라 그릴 때마다 새로 붙인다.
function show({
  pathname = "/bids",
  solRole = "SALES",
  open = true,
}: { pathname?: string; solRole?: SolRole; open?: boolean } = {}) {
  unmountAll();
  nav.pathname = pathname;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  flushSync(() =>
    root.render(
      <AppShell user={user} workspace={workspace} solRole={solRole} defaultSidebarOpen={open}>
        <main />
      </AppShell>,
    ),
  );
}

const mainNav = () => page.getByRole("navigation", { name: "주요 메뉴" });
const groupButton = (name: string) => mainNav().getByRole("button", { name, exact: true });
const menuLink = (name: string) => mainNav().getByRole("link", { name, exact: true });
const groupIcons = (button: Element) => button.querySelectorAll('[data-slot="sidebar-group-icon"]');
const iconDisplay = (link: Element) => {
  const icon = link.querySelector("svg");
  return icon === null ? null : getComputedStyle(icon).display;
};

beforeEach(async () => {
  await page.viewport(1440, 900);
});

afterEach(() => {
  unmountAll();
  window.localStorage.clear();
});

describe("묶음 사이드바", () => {
  it("펼치면 묶음 줄에만 아이콘을 두고, 메뉴는 글자만 묶음 이름 선에 맞춰 들여 쓴다", async () => {
    show();
    for (const name of ["업무", "분석", "회사"]) {
      await expect.element(groupButton(name)).toHaveAttribute("aria-expanded", "true");
      expect(groupIcons(groupButton(name).element())).toHaveLength(1);
    }
    const links = mainNav().getByRole("link").elements();
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(iconDisplay(link)).toBe("none");

    const groupName = groupButton("업무").element().querySelector("span");
    const menuText = menuLink("입찰 공고").element().querySelector("span");
    expect(groupName).not.toBeNull();
    expect(menuText).not.toBeNull();
    const groupLeft = groupName?.getBoundingClientRect().left ?? 0;
    const menuLeft = menuText?.getBoundingClientRect().left ?? 0;
    expect(Math.abs(groupLeft - menuLeft)).toBeLessThanOrEqual(1);
  });

  it("지금 메뉴는 연한 파랑 바탕·파란 글자·굵기 600 이고, 위 막대에는 화면 이름이 없다", async () => {
    show();
    const current = menuLink("입찰 공고");
    await expect.element(current).toHaveAttribute("aria-current", "page");
    const style = getComputedStyle(current.element());
    expect(style.backgroundColor).toBe("rgb(234, 242, 254)");
    expect(style.color).toBe("rgb(27, 100, 218)");
    expect(style.fontWeight).toBe("600");
    await expect.element(menuLink("대시보드")).not.toHaveAttribute("aria-current");
    await expect.element(page.getByRole("banner")).not.toHaveTextContent("입찰 공고");
  });

  it("VIEWER 는 역할 메뉴가 빠져도 남은 메뉴가 있는 회사 묶음 줄(아이콘 포함)을 본다", async () => {
    show({ solRole: "VIEWER" });
    await expect.element(groupButton("회사")).toBeVisible();
    expect(groupIcons(groupButton("회사").element())).toHaveLength(1);
    await expect.element(menuLink("조직·인력")).toBeVisible();
    expect(page.getByRole("link", { name: "회사 역량", exact: true }).elements()).toHaveLength(0);
    expect(
      page.getByRole("link", { name: "데이터 수집 관리", exact: true }).elements(),
    ).toHaveLength(0);
  });

  it("접으면(64px) 묶음 줄 없이 메뉴 아이콘이 보이고, 연한 파랑 위에서도 키보드 초점 고리가 보인다", async () => {
    show({ open: false });
    expect(mainNav().getByRole("button").elements()).toHaveLength(0);
    const links = mainNav().getByRole("link").elements();
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(iconDisplay(link)).not.toBe("none");

    menuLink("대시보드").element().focus();
    await userEvent.keyboard("{Tab}");
    const current = menuLink("입찰 공고").element();
    expect(document.activeElement).toBe(current);
    const style = getComputedStyle(current);
    expect(style.outlineStyle !== "none" || style.boxShadow !== "none").toBe(true);
  });

  it("접으면 위 막대에 지금 조직 이름이 남는다", async () => {
    show({ open: false });
    await expect.element(page.getByRole("banner").getByText("솔리데오")).toBeVisible();
  });
});
