import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { Chip } from "@/components/ui/chip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SolRole } from "@/server/organization";
import { AppPage } from "./app-page";
import { AppShell } from "./app-shell";

// 묶음 사이드바(2026-10-28 사용자 결정 시안 A): 묶음 줄에만 아이콘, 메뉴는 글자만 들여 쓰고 지금 메뉴는 연한 파랑.
// 접은 64px 줄은 메뉴 아이콘만 남는다. 위 막대에서는 화면 이름을 빼고, 접었을 때 조직 이름만 남긴다.
// 화면 머리는 경로(묶음 / 화면) → 제목 → 설명 → 1px 구분선이다. 표는 둥근 1px 테두리와 연한 머리 줄이다.

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
function mount(pathname: string, element: React.ReactNode) {
  unmountAll();
  nav.pathname = pathname;
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  flushSync(() => root.render(element));
}

function show({
  pathname = "/bids",
  solRole = "SALES",
  open = true,
  children = <main />,
}: { pathname?: string; solRole?: SolRole; open?: boolean; children?: React.ReactNode } = {}) {
  mount(
    pathname,
    <AppShell user={user} workspace={workspace} solRole={solRole} defaultSidebarOpen={open}>
      {children}
    </AppShell>,
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

describe("AppPage 머리", () => {
  const breadcrumb = () => page.getByRole("navigation", { name: "경로" });

  // 경로는 앱 틀이 넘겨 준 지금 주소로 찾는다. 앱 틀 밖에서 그린 AppPage 는 경로가 없다(화면 부품 시험).
  it("경로(묶음 / 화면)가 제목 위에 있고, 머리 아래 1px 구분선이 있다", async () => {
    show({
      pathname: "/gaps",
      children: (
        <AppPage title="자격 갭 레이더" description="설명">
          <p>본문</p>
        </AppPage>
      ),
    });
    await expect.element(breadcrumb()).toHaveTextContent(/분석.*자격 갭 레이더/);
    const heading = page.getByRole("heading", { level: 1, name: "자격 갭 레이더" }).element();
    expect(
      breadcrumb().element().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const head = document.querySelector('[data-slot="app-page-header"]');
    expect(head).not.toBeNull();
    expect(head && getComputedStyle(head).borderBottomWidth).toBe("1px");
  });

  // 상세 화면(/bids/123)의 화면 이름은 그 메뉴일 뿐 지금 쪽이 아니다. aria-current 는 메뉴 주소 그 자체일 때만이다.
  it("경로의 화면 이름은 메뉴 화면에서만 지금 쪽(aria-current)이다", async () => {
    for (const [pathname, current] of [
      ["/bids", "page"],
      ["/bids/123", null],
    ] as const) {
      show({
        pathname,
        children: (
          <AppPage title="입찰 공고">
            <p>본문</p>
          </AppPage>
        ),
      });
      const screen = breadcrumb().getByText("입찰 공고");
      await expect.element(screen).toBeVisible();
      expect(screen.element().getAttribute("aria-current")).toBe(current);
    }
  });

  it("묶음이 없는 화면(설정)과 앱 틀 밖은 경로 줄이 없다", async () => {
    show({
      pathname: "/settings",
      children: (
        <AppPage title="설정">
          <p>본문</p>
        </AppPage>
      ),
    });
    await expect.element(page.getByRole("heading", { level: 1, name: "설정" })).toBeVisible();
    expect(breadcrumb().elements()).toHaveLength(0);

    mount(
      "/gaps",
      <AppPage title="자격 갭 레이더">
        <p>본문</p>
      </AppPage>,
    );
    await expect
      .element(page.getByRole("heading", { level: 1, name: "자격 갭 레이더" }))
      .toBeVisible();
    expect(breadcrumb().elements()).toHaveLength(0);
  });
});

describe("표 테두리", () => {
  const table = (containerClassName?: string) => (
    <Table containerClassName={containerClassName}>
      <TableHeader>
        <TableRow>
          <TableHead>업무</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>부가가치세 신고</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
  const container = () => document.querySelector('[data-slot="table-container"]');

  it("기본은 둥근 1px 테두리와 연한 머리 줄이고, 테두리 상자 안에서는 containerClassName 으로 끈다", async () => {
    mount("/bids", table());
    await expect.element(page.getByRole("table")).toBeVisible();
    const boxed = container();
    expect(boxed && getComputedStyle(boxed).borderTopWidth).toBe("1px");
    expect(boxed && getComputedStyle(boxed).borderTopLeftRadius).not.toBe("0px");
    const header = document.querySelector('[data-slot="table-header"]');
    expect(header && getComputedStyle(header).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

    mount("/bids", table("rounded-none border-0"));
    await expect.element(page.getByRole("table")).toBeVisible();
    const bare = container();
    expect(bare && getComputedStyle(bare).borderTopWidth).toBe("0px");
    expect(bare && getComputedStyle(bare).borderTopLeftRadius).toBe("0px");
  });
});

describe("칩", () => {
  it("sm 은 촘촘한 줄에 맞춰 20px 높이이고, brand 는 파란 1px 테두리다", async () => {
    mount(
      "/bids",
      <p>
        <Chip>회색</Chip>
        <Chip tone="brand" size="sm">
          강조
        </Chip>
      </p>,
    );
    const brand = page.getByText("강조", { exact: true }).element();
    await expect.element(page.getByText("회색", { exact: true })).toBeVisible();
    expect(brand.getBoundingClientRect().height).toBe(20);
    const style = getComputedStyle(brand);
    expect(style.borderTopWidth).toBe("1px");
    expect(style.borderTopColor).toBe("rgb(27, 100, 218)");
    expect(style.color).toBe("rgb(27, 100, 218)");
  });
});

it("모바일 업무 틀은 제목과 메뉴 서랍을 보여주고 메뉴 이동 뒤 서랍을 닫는다", async () => {
  await page.viewport(390, 844);
  show({
    children: (
      <AppPage title="입찰 공고">
        <p>모바일 본문</p>
      </AppPage>
    ),
  });
  await expect.element(page.getByRole("banner")).toHaveTextContent("입찰 공고");
  await expect.element(page.getByRole("navigation", { name: "주요 메뉴" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "사이드바 여닫기" }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  const target = page.getByRole("link", { name: "관심 공고", exact: true });
  expect(target.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  // 부품 시험에서 페이지를 떠나지 않고 기존 서랍 닫기 핸들러를 확인한다.
  target.element().addEventListener("click", (event) => event.preventDefault(), { once: true });
  await target.click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
});
