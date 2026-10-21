// 메뉴 글자가 폭에 들어가는지는 앱과 같은 글꼴로 잰다(app/layout.tsx 와 같은 파일).
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useSidebarGroupsStore } from "@/lib/stores/sidebar-groups";
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
const STORAGE_KEY = "sol-radar.sidebar.collapsed-groups";
const mounted: Root[] = [];
beforeEach(() => {
  window.localStorage.clear();
  useSidebarGroupsStore.setState({ collapsed: [], isLoaded: false });
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  window.localStorage.clear();
  navigation.pathname = "/people";
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
      solRole="VIEWER"
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

const mainNav = () => page.getByRole("navigation", { name: "주요 메뉴", exact: true });
const linkHrefs = () =>
  Array.from(mainNav().element().querySelectorAll("a")).map((a) => a.getAttribute("href"));
const groupButton = (label: string) => mainNav().getByRole("button", { name: label, exact: true });

describe("people navigation", () => {
  it.each([1280, 1440])(
    "keeps the people link and uses absolute screen paths at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      renderShell();
      const sidebar = page.getByRole("complementary", { name: "앱 사이드바", exact: true });
      await expect.element(sidebar.getByText("솔리데오", { exact: true })).toBeVisible();
      await expect.element(mainNav()).toBeVisible();
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
    renderShell();
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
  });
});

describe("sidebar tree (NAV-10)", () => {
  it("shows five groups in order with released links and planned items without links", async () => {
    await page.viewport(1440, 900);
    navigation.pathname = "/bids/x";
    renderShell();
    await expect.element(mainNav()).toBeVisible();
    const groupLabels = Array.from(
      mainNav().element().querySelectorAll("button[aria-expanded]"),
    ).map((button) => button.textContent);
    expect(groupLabels).toEqual(["업무", "AI 분석", "입찰 관리", "조직", "시스템"]);
    // VIEWER 에게 데이터 수집 관리(ADMIN 전용)는 없다.
    expect(linkHrefs()).toEqual([
      "/dashboard",
      "/bids",
      "/notifications",
      "/company",
      "/people",
      "/settings",
    ]);
    const planned = Array.from(mainNav().element().querySelectorAll("[data-planned]")).map(
      (item) => item.textContent,
    );
    expect(planned).toEqual([
      "관심 공고준비 중",
      "분석 결과 비교준비 중",
      "인력 배치 시뮬레이션준비 중",
      "입찰 프로젝트준비 중",
    ]);
    // 준비 중 메뉴는 누를 곳이 없다: 링크도 버튼도 아니고(역할 포함) 초점을 받지 않는다.
    // 화면 시험이 이름으로 버튼·링크를 찾을 때 준비 중 메뉴가 걸리지 않는다.
    for (const item of mainNav().element().querySelectorAll("[data-planned]")) {
      expect(
        item.querySelector('a, button, [tabindex], [role="button"], [role="link"]'),
      ).toBeNull();
    }
    expect(
      mainNav()
        .getByRole("button")
        .elements()
        .map((button) => button.textContent),
    ).toEqual(["업무", "AI 분석", "입찰 관리", "조직", "시스템"]);
    await expect
      .element(page.getByRole("link", { name: "입찰 공고", exact: true }))
      .toHaveAttribute("aria-current", "page");
    expect(document.querySelector("header")?.textContent).toContain("입찰 공고");
  });

  it("shows data ingestion only to ADMIN and names it in the topbar", async () => {
    await page.viewport(1440, 900);
    navigation.pathname = "/admin/ingestion";
    renderShell({ solRole: "ADMIN" });
    const ingestion = page.getByRole("link", { name: "데이터 수집 관리", exact: true });
    await expect.element(ingestion).toHaveAttribute("href", "/admin/ingestion");
    await expect.element(ingestion).toHaveAttribute("aria-current", "page");
    expect(linkHrefs()).toEqual([
      "/dashboard",
      "/bids",
      "/notifications",
      "/company",
      "/people",
      "/settings",
      "/admin/ingestion",
    ]);
    expect(document.querySelector("header")?.textContent).toContain("데이터 수집 관리");
  });

  it("hides role menus when the role is unknown", async () => {
    await page.viewport(1440, 900);
    renderShell({ solRole: null });
    await expect.element(mainNav()).toBeVisible();
    expect(linkHrefs()).not.toContain("/admin/ingestion");
  });

  it("marks the active menu with aria-current and a brand bar on the tree line", async () => {
    await page.viewport(1440, 900);
    navigation.pathname = "/dashboard";
    renderShell();
    const active = page.getByRole("link", { name: "대시보드", exact: true });
    await expect.element(active).toHaveAttribute("aria-current", "page");
    const item = active.element().closest('[data-slot="sidebar-menu-item"]') as HTMLElement;
    const bar = getComputedStyle(item, "::before");
    expect(bar.width).toBe("3px");
    expect(bar.position).toBe("absolute");
    const list = item.closest("ul") as HTMLElement;
    expect(getComputedStyle(list).borderLeftWidth).toBe("1px");
    const other = page.getByRole("link", { name: "입찰 공고", exact: true }).element();
    expect(other.getAttribute("aria-current")).toBeNull();
  });

  it("marks settings current on the template settings path", async () => {
    await page.viewport(1440, 900);
    navigation.pathname = "/solideo/settings/members";
    renderShell();
    await expect
      .element(page.getByRole("link", { name: "설정", exact: true }))
      .toHaveAttribute("aria-current", "page");
  });

  it("collapses and expands a group with aria-expanded and remembers it", async () => {
    await page.viewport(1440, 900);
    navigation.pathname = "/dashboard";
    renderShell();
    const analysis = groupButton("AI 분석");
    await expect.element(analysis).toHaveAttribute("aria-expanded", "true");
    const listId = analysis.element().getAttribute("aria-controls") as string;
    const list = document.getElementById(listId) as HTMLElement;
    expect(list).not.toBeNull();
    expect(getComputedStyle(list).display).not.toBe("none");
    await analysis.click();
    await expect.element(analysis).toHaveAttribute("aria-expanded", "false");
    expect(getComputedStyle(list).display).toBe("none");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual(["analysis"]);
    await analysis.click();
    await expect.element(analysis).toHaveAttribute("aria-expanded", "true");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual([]);
  });

  it("restores stored collapse but always opens the current screen's group on entry", async () => {
    await page.viewport(1440, 900);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(["work", "organization"]));
    navigation.pathname = "/bids";
    renderShell();
    await expect.element(groupButton("조직")).toHaveAttribute("aria-expanded", "false");
    await expect.element(groupButton("업무")).toHaveAttribute("aria-expanded", "true");
    await expect.element(page.getByRole("link", { name: "입찰 공고", exact: true })).toBeVisible();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]")).toEqual(["organization"]);
  });

  it("still renders and toggles when browser storage throws", async () => {
    await page.viewport(1440, 900);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    navigation.pathname = "/dashboard";
    renderShell();
    const system = groupButton("시스템");
    await expect.element(system).toHaveAttribute("aria-expanded", "true");
    await system.click();
    await expect.element(system).toHaveAttribute("aria-expanded", "false");
    await expect.element(page.getByRole("link", { name: "대시보드", exact: true })).toBeVisible();
  });

  it.each([1280, 1440])(
    "fits the longest planned label without truncation at %ipx",
    async (width) => {
      await page.viewport(width, 900);
      renderShell({ solRole: "ADMIN" });
      await expect.element(mainNav()).toBeVisible();
      await expect
        .poll(() =>
          document.fonts.check("16px 'Pretendard Variable'", "인력 배치 시뮬레이션 준비 중"),
        )
        .toBe(true);
      await document.fonts.ready;
      for (const label of mainNav().element().querySelectorAll("[data-planned] span.truncate")) {
        expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
      }
      const ingestion = page.getByRole("link", { name: "데이터 수집 관리", exact: true });
      const text = ingestion.element().querySelector("span:last-child") as HTMLElement;
      expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth);
      // 들여 쓴 메뉴도 사이드바 안쪽 여백(8px) 안에서 끝난다.
      const inner = document.querySelector('[data-slot="sidebar-inner"]') as HTMLElement;
      const innerRight = inner.getBoundingClientRect().right;
      for (const item of mainNav().element().querySelectorAll('[data-slot="sidebar-menu-item"]')) {
        expect(item.getBoundingClientRect().right).toBeLessThanOrEqual(innerRight - 8);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    },
  );

  it("collapses to a 64px icon rail with every menu icon, named links and no group rows", async () => {
    await page.viewport(1440, 900);
    renderShell({ solRole: "ADMIN", defaultSidebarOpen: false });
    await expect.element(mainNav()).toBeInTheDocument();
    const container = document.querySelector('[data-slot="sidebar-container"]') as HTMLElement;
    await expect.poll(() => container.getBoundingClientRect().width).toBe(64);
    expect(mainNav().element().querySelectorAll("button[aria-expanded]").length).toBe(0);
    expect(linkHrefs()).toEqual([
      "/dashboard",
      "/bids",
      "/notifications",
      "/company",
      "/people",
      "/settings",
      "/admin/ingestion",
    ]);
    for (const link of mainNav().element().querySelectorAll("a")) {
      expect(link.getAttribute("aria-label")).toBeTruthy();
      expect(link.querySelector("svg")).not.toBeNull();
    }
    expect(mainNav().element().querySelectorAll("[data-planned] svg").length).toBe(4);
    // 아이콘 줄에서도 준비 중 메뉴는 화면 낭독기에 "준비 중"을 읽힌다(sr-only: 보이지 않지만 display 는 남는다).
    for (const item of mainNav().element().querySelectorAll("[data-planned]")) {
      const status = Array.from(item.querySelectorAll("span")).find(
        (span) => span.textContent === "준비 중",
      ) as HTMLElement;
      expect(getComputedStyle(status).display).not.toBe("none");
      expect(status.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    }
    expect(
      document.querySelectorAll('[data-slot="sidebar-group-divider"]').length,
    ).toBeGreaterThanOrEqual(4);
    // 접어 둔 묶음도 아이콘 줄에서는 다 보인다.
    const firstDivider = document.querySelector('[data-slot="sidebar-group-divider"]');
    expect(getComputedStyle(firstDivider as Element).display).toBe("block");
    const tooltipText = () =>
      Array.from(document.querySelectorAll('[data-slot="tooltip-content"]'))
        .map((tip) => tip.textContent)
        .join("|");
    await userEvent.hover(page.getByRole("link", { name: "입찰 공고", exact: true }));
    await expect.poll(tooltipText).toContain("입찰 공고");
    await userEvent.unhover(page.getByRole("link", { name: "입찰 공고", exact: true }));
    // 키보드 초점으로도 이름이 뜬다. 조직·인력 다음 Tab 은 설정이다(준비 중 메뉴는 초점을 받지 않는다).
    (page.getByRole("link", { name: "조직·인력", exact: true }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Tab}");
    await expect.element(page.getByRole("link", { name: "설정", exact: true })).toHaveFocus();
    await expect.poll(tooltipText).toContain("설정");
    // 아이콘 줄의 아이콘은 64px 가운데에 선다(조직 표시·메뉴·사용자 칸).
    const railCenter = container.getBoundingClientRect().left + 32;
    for (const selector of [
      '[data-slot="sidebar-menu-button"]',
      '[data-slot="sidebar-footer"] [data-slot="avatar"]',
    ]) {
      for (const node of document.querySelectorAll(selector)) {
        const box = node.getBoundingClientRect();
        expect(Math.abs(box.left + box.width / 2 - railCenter)).toBeLessThanOrEqual(1);
      }
    }
    // 접으면 사이드바의 조직 이름이 안 보여 위 막대가 대신 보인다.
    await expect
      .element(page.getByRole("banner").getByText("솔리데오", { exact: true }))
      .toBeVisible();
  });

  it("keeps the organization chart fixed below a scrolling menu area", async () => {
    await page.viewport(1280, 600);
    navigation.pathname = "/org-chart";
    renderShell({ solRole: "ADMIN" });
    const link = page.getByRole("link", { name: "조직도", exact: true });
    await expect.element(link).toBeVisible();
    const content = document.querySelector('[data-slot="sidebar-content"]') as HTMLElement;
    expect(getComputedStyle(content).overflowY).toBe("auto");
    const before = link.element().getBoundingClientRect().top;
    content.scrollTop = content.scrollHeight;
    expect(link.element().getBoundingClientRect().top).toBe(before);
  });
});

describe("c6 shell", () => {
  it.each([
    ["/solideo/settings", "설정"],
    ["/solideo/tasks", "작업"],
    ["/solideo/dashboard", "대시보드"],
  ])("topbar names template screen %s and keeps the org name", async (pathname, label) => {
    await page.viewport(1440, 900);
    navigation.pathname = pathname;
    renderShell();
    await expect.element(mainNav()).toBeVisible();
    // 템플릿 작업 화면은 사이드바 메뉴에 더하지 않는다(D30).
    expect(linkHrefs()).not.toContain("/solideo/tasks");
    const banner = page.getByRole("banner");
    await expect.element(banner.getByText(label, { exact: true })).toBeInTheDocument();
    await expect.element(banner.getByText("솔리데오", { exact: true })).toBeInTheDocument();
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
