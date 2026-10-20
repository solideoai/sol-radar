import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AppShell } from "./app-shell";
import { useTopbarStore } from "./topbar-status";
const { navigation } = vi.hoisted(() => ({
  navigation: { pathname: "/people", push: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  __esModule: true,
  usePathname: () => navigation.pathname,
  useRouter: () => navigation,
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: React.ComponentProps<"a">) => <a {...props} />,
}));
const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});
describe("people navigation", () => {
  it.each([1280, 1440])(
    "keeps the people link and uses absolute screen paths at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const root = createRoot(document.body.appendChild(document.createElement("div")));
      mounted.push(root);
      root.render(
        <AppShell
          user={{ name: "사용자", email: null, avatarUrl: null, isAdmin: false }}
          workspace={{
            current: {
              id: "org",
              slug: "solideo",
              name: "솔리데오",
              isPersonal: false,
              myRole: "member",
            },
            orgs: [],
            pendingInvitationCount: 0,
          }}
          defaultSidebarOpen
        >
          <main>본문</main>
        </AppShell>,
      );
      const sidebar = page.getByRole("complementary", { name: "앱 사이드바", exact: true });
      await expect.element(sidebar.getByText("솔리데오", { exact: true })).toBeVisible();
      await expect
        .element(sidebar.getByRole("navigation", { name: "주요 메뉴", exact: true }))
        .toBeVisible();
      await expect.element(sidebar.getByRole("button", { name: /사용자 메뉴/ })).toBeVisible();
      await expect
        .element(sidebar.getByRole("link", { name: "조직도", exact: true }))
        .toHaveAttribute("href", "/org-chart");
      const people = page.getByRole("link", { name: "조직·인력", exact: true });
      await expect.element(people).toBeVisible();
      await expect.element(people).toHaveAttribute("href", "/people");
      await expect.element(people).toHaveAttribute("aria-current", "page");
      await expect
        .element(page.getByRole("link", { name: "대시보드", exact: true }))
        .toHaveAttribute("href", "/dashboard");
      expect(document.querySelector("header")?.textContent).toContain("조직·인력");
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    },
  );
  it("places organization chart in a separated footer above the user menu and names its topbar", async () => {
    navigation.pathname = "/org-chart";
    const root = createRoot(document.body.appendChild(document.createElement("div")));
    mounted.push(root);
    root.render(
      <AppShell
        user={{ name: "사용자", email: null, avatarUrl: null, isAdmin: false }}
        workspace={{
          current: {
            id: "org",
            slug: "solideo",
            name: "솔리데오",
            isPersonal: false,
            myRole: "member",
          },
          orgs: [],
          pendingInvitationCount: 0,
        }}
        defaultSidebarOpen
      >
        <main>본문</main>
      </AppShell>,
    );
    const link = page.getByRole("link", { name: "조직도", exact: true });
    await expect.element(link).toHaveAttribute("href", "/org-chart");
    await expect.element(link).toHaveAttribute("aria-current", "page");
    const footer = link.element().closest('[data-slot="sidebar-footer"]');
    expect(footer).not.toBeNull();
    expect(footer?.querySelector('[data-slot="separator"]')).not.toBeNull();
    const user = page.getByRole("button", { name: /사용자 메뉴/ }).element();
    expect(
      link.element().compareDocumentPosition(user) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(document.querySelector("header")?.textContent).toContain("조직도");
    await expect
      .element(page.getByRole("link", { name: "조직·인력", exact: true }))
      .toHaveAttribute("href", "/people");
    navigation.pathname = "/people";
  });
});

const renderShell = (props: Partial<React.ComponentProps<typeof AppShell>> = {}) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(
    <AppShell
      user={{ name: "사용자", email: null, avatarUrl: null, isAdmin: false }}
      workspace={{
        current: {
          id: "org",
          slug: "solideo",
          name: "솔리데오",
          isPersonal: false,
          myRole: "member",
        },
        orgs: [],
        pendingInvitationCount: 0,
      }}
      defaultSidebarOpen
      {...props}
    >
      <main>
        <p className="type-label" data-probe="body-label">
          본문 라벨
        </p>
      </main>
    </AppShell>,
  );
};

describe("c6 shell", () => {
  it("main menu has four links in order and marks bids current", async () => {
    await page.viewport(1440, 900);
    navigation.pathname = "/bids/x";
    renderShell();
    const nav = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    await expect.element(nav).toBeVisible();
    const links = Array.from(nav.element().querySelectorAll("a"));
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/dashboard",
      "/bids",
      "/notifications",
      "/people",
    ]);
    await expect
      .element(page.getByRole("link", { name: "입찰 공고", exact: true }))
      .toHaveAttribute("aria-current", "page");
    expect(document.querySelector("header")?.textContent).toContain("입찰 공고");
    navigation.pathname = "/people";
  });

  it.each([
    ["/solideo/settings", "설정"],
    ["/solideo/tasks", "작업"],
    ["/solideo/dashboard", "대시보드"],
  ])("topbar names template screen %s and keeps the org name", async (pathname, label) => {
    await page.viewport(1440, 900);
    navigation.pathname = pathname;
    renderShell();
    const nav = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
    await expect.element(nav).toBeVisible();
    // 사이드바 메뉴는 C6 의 네 줄 그대로다(D30: 작업·설정 줄은 메뉴에서만 뺀다).
    expect(
      Array.from(nav.element().querySelectorAll("a")).map((a) => a.getAttribute("href")),
    ).toEqual(["/dashboard", "/bids", "/notifications", "/people"]);
    const banner = page.getByRole("banner");
    await expect.element(banner.getByText(label, { exact: true })).toBeInTheDocument();
    await expect.element(banner.getByText("솔리데오", { exact: true })).toBeInTheDocument();
    navigation.pathname = "/people";
  });

  it("sidebar menu text is 16px while body type-label stays 13px", async () => {
    await page.viewport(1440, 900);
    renderShell();
    const menu = page.getByRole("link", { name: "대시보드", exact: true });
    await expect.element(menu).toBeVisible();
    expect(getComputedStyle(menu.element()).fontSize).toBe("16px");
    const body = document.querySelector('[data-probe="body-label"]') as Element;
    expect(getComputedStyle(body).fontSize).toBe("13px");
  });

  it("renders TopbarStatus and the unread badge only when status is given", async () => {
    await page.viewport(1440, 900);
    useTopbarStore.setState({ summary: null });
    renderShell({
      status: {
        runMode: "fixture",
        initialSummary: {
          dataFreshness: {
            lastIngestAt: null,
            lastIngestStatus: null,
            isDemo: true,
            lastIngestSummary: null,
          },
          unreadNotifications: 3,
        },
        initialAi: "mock",
        pollIntervalMs: 3_600_000,
      },
    });
    await expect
      .poll(() => document.querySelectorAll('[data-slot="topbar-status"]').length)
      .toBe(1);
    await expect
      .poll(() => document.querySelector('[data-slot="sidebar-menu-badge"]')?.textContent)
      .toBe("3건");
  });

  it("has no status and no badge without status", async () => {
    await page.viewport(1440, 900);
    useTopbarStore.setState({ summary: null });
    renderShell();
    await expect.element(page.getByText("본문 라벨")).toBeVisible();
    expect(document.querySelectorAll('[data-slot="topbar-status"]').length).toBe(0);
    expect(document.querySelector('[data-slot="sidebar-menu-badge"]')).toBeNull();
  });

  it.each([1280, 1440])(
    "shows the whole user name and email without ellipsis or clipping at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      const name = "솔리데오 사업개발본부 데모 관리자";
      const email = "solideo-demo-administrator@soltech.invalid";
      renderShell({ user: { name, email, avatarUrl: null, isAdmin: false } });
      const button = page.getByRole("button", { name: /사용자 메뉴/ });
      await expect.element(button).toBeVisible();
      const box = button.element().getBoundingClientRect();
      for (const text of [name, email]) {
        const line = button.getByText(text, { exact: true }).element() as HTMLElement;
        // 말줄임(…)으로 숨은 글자가 없고, 줄바꿈한 글자가 버튼 밖으로 나가 잘리지 않는다.
        expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
        const rect = line.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(box.top);
        expect(rect.bottom).toBeLessThanOrEqual(box.bottom);
        expect(rect.right).toBeLessThanOrEqual(box.right);
      }
      expect(button.element().scrollHeight).toBeLessThanOrEqual(button.element().clientHeight);
    },
  );

  it("hides the under-1280 notice at 1280px and shows it at 1000px", async () => {
    await page.viewport(1280, 900);
    renderShell();
    await expect.element(page.getByText("본문 라벨")).toBeVisible();
    const notice = () => document.querySelector('[data-slot="narrow-notice"]') as HTMLElement;
    expect(notice().textContent).toContain("데스크톱 화면에서 이용하세요");
    expect(getComputedStyle(notice()).display).toBe("none");
    await page.viewport(1000, 900);
    await expect.poll(() => getComputedStyle(notice()).display).not.toBe("none");
  });
});
