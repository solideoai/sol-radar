import { use, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { ProgramNoticeListItem, ProgramNoticeListQuery } from "@/server/program-notices";
import { BidsSourceNav } from "@/app/(app)/(work)/bids/bids-source-nav";
import { ProgramListView } from "./program-list-view";

// /bids/programs 본문(필터 막대 + 결과 줄 + 표 + 빈 상태 + 상세 서랍)과 링크 줄을 진짜 브라우저에 그린다.
// 화면 이동은 가짜로 바꾸고, 부른 주소와 그려진 요소만 잰다(견본 bids/bid-list-more.browser.test.tsx).
const nav = vi.hoisted(() => ({
  search: "",
  // true 면 push 를 기록만 하고 주소는 그대로 둔다. 대신 NavHarness 가 끝나지 않는 이동을 흉내 낸다.
  hold: false,
  navigate: null as ((href: string) => void) | null,
  listeners: new Set<() => void>(),
  push: vi.fn(),
}));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  const subscribe = (fn: () => void) => {
    nav.listeners.add(fn);
    return () => nav.listeners.delete(fn);
  };
  return {
    __esModule: true,
    useRouter: () => ({
      push: (href: string, options?: { scroll: boolean }) => {
        nav.push(href, options);
        if (nav.hold) {
          nav.navigate?.(href);
          return;
        }
        nav.search = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
        nav.listeners.forEach((fn) => fn());
      },
      refresh: vi.fn(),
    }),
    usePathname: () => "/bids/programs",
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          subscribe,
          () => nav.search,
          () => "",
        ),
      ),
  };
});
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    className,
    title,
    children,
    "aria-current": ariaCurrent,
  }: React.ComponentProps<"a">) => (
    <a href={href} className={className} title={title} aria-current={ariaCurrent}>
      {children}
    </a>
  ),
}));

const TODAY = "2026-10-21";
const DEFAULT_QUERY: ProgramNoticeListQuery = {
  source: null,
  q: null,
  sort: "deadline",
  includeClosed: false,
};

const BIZINFO: ProgramNoticeListItem = {
  id: "pn-biz-1",
  source: "bizinfo",
  title:
    "2026년 AI 바우처 지원사업 수요기업 모집 공고 — 제목이 길어 두 줄을 넘겨도 표가 가로로 넘치지 않는지 보려고 늘인 가상 공고명입니다",
  agency: "과학기술정보통신부 정보통신산업정책관 소프트웨어정책과",
  sourceUrl: "https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_1",
  publishedAt: "2026-10-20T01:00:00Z",
  applyStartOn: "2026-10-01",
  applyEndOn: "2026-10-31",
  summary: "사업 목적\n<b>강조</b> 글자는 글자 그대로 보인다",
  applyMethod: "온라인 신청\n서류 우편 제출",
  target: "중소기업",
  tags: ["기술", "AI", "SW융합"],
  isDemo: false,
};
const TODAY_END: ProgramNoticeListItem = {
  ...BIZINFO,
  id: "pn-biz-2",
  title: "오늘 마감하는 지원사업",
  agency: "중소벤처기업부",
  applyStartOn: null,
  applyEndOn: TODAY,
  summary: null,
  applyMethod: null,
  target: "예비창업자",
  tags: [],
};
const MSS: ProgramNoticeListItem = {
  id: "pn-mss-1",
  source: "mss",
  title: "2026년 스마트공장 구축 지원사업 공고",
  agency: "중소벤처기업부",
  sourceUrl: "https://www.mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1001",
  publishedAt: "2026-10-21T00:30:00Z",
  applyStartOn: null,
  applyEndOn: null,
  summary: null,
  applyMethod: null,
  target: null,
  tags: [],
  isDemo: false,
};
const CLOSED: ProgramNoticeListItem = {
  ...BIZINFO,
  id: "pn-biz-3",
  title: "이미 마감된 지원사업",
  agency: null,
  publishedAt: null,
  applyStartOn: "2026-09-01",
  applyEndOn: "2026-09-30",
};
const ITEMS = [TODAY_END, BIZINFO, MSS];

// Next 의 router.push 는 전환 안에서 라우터 상태를 바꾸고, 서버 응답이 올 때까지 그 렌더가 멈춘다(Suspense).
const NEVER = new Promise<never>(() => undefined);
function Pending() {
  use(NEVER);
  return null;
}
function NavHarness({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    nav.navigate = setTarget;
  }, []);
  return (
    <>
      {target === null ? null : <Pending />}
      {children}
    </>
  );
}

const mounted: Root[] = [];
beforeEach(() => {
  nav.search = "";
  nav.hold = false;
  nav.navigate = null;
  nav.push.mockClear();
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

type ViewProps = React.ComponentProps<typeof ProgramListView>;
const node = (props: Partial<ViewProps> = {}) => (
  <NavHarness>
    <BidsSourceNav current="programs" />
    <ProgramListView
      items={ITEMS}
      hasAnyNotice
      isCapped={false}
      query={DEFAULT_QUERY}
      search=""
      isDefault
      today={TODAY}
      {...props}
    />
  </NavHarness>
);
const render = (props: Partial<ViewProps> = {}, width = 960) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  host.className = "@container flex flex-col gap-6";
  const root = createRoot(host);
  flushSync(() => root.render(node(props)));
  mounted.push(root);
  return { host, root };
};

const rowOf = (host: HTMLElement, title: string): HTMLTableRowElement => {
  const row = [...host.querySelectorAll("tbody tr")].find((tr) =>
    tr.querySelector("button")?.textContent?.includes(title),
  );
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`행 없음: ${title}`);
  return row;
};

// 서랍은 오른쪽에서 밀려 들어온다. 시작 상태가 끝나고 서랍의 전환이 멈춘 뒤에 돌려준다(person-drawer 시험 관례).
const openDrawer = async (title: string) => {
  await page.getByRole("button", { name: title, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: title, exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog).not.toHaveAttribute("data-starting-style");
  await Promise.allSettled(
    dialog
      .element()
      .getAnimations()
      .map((animation) => animation.finished),
  );
  return dialog;
};

describe("BidsSourceNav", () => {
  it("지금 화면 링크에 aria-current 를 달고, 탭이 아니라 두 주소로 가는 링크다", async () => {
    render();
    const links = page.getByRole("navigation", { name: "공고 종류" }).getByRole("link");
    await expect.element(links.nth(0)).toHaveTextContent("나라장터 공고");
    await expect.element(links.nth(0)).toHaveAttribute("href", "/bids");
    await expect.element(links.nth(0)).not.toHaveAttribute("aria-current");
    await expect.element(links.nth(1)).toHaveTextContent("부처 지원사업");
    await expect.element(links.nth(1)).toHaveAttribute("href", "/bids/programs");
    await expect.element(links.nth(1)).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('[role="tablist"],[role="tab"]')).toBeNull();
  });

  it("나라장터 공고 화면에서는 나라장터 공고 링크가 지금 화면이다", async () => {
    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    mounted.push(root);
    flushSync(() => root.render(<BidsSourceNav current="g2b" />));
    await expect
      .element(page.getByRole("link", { name: "나라장터 공고" }))
      .toHaveAttribute("aria-current", "page");
    await expect
      .element(page.getByRole("link", { name: "부처 지원사업" }))
      .not.toHaveAttribute("aria-current");
  });
});

describe("ProgramListView 표", () => {
  it.each([960, 1120])(
    "%ipx(1280·1440 화면의 본문 폭)에서 링크 줄·필터 막대·결과 줄·표가 가로로 넘치지 않는다",
    (width) => {
      // 필터 초기화 단추까지 보이는 가장 넓은 필터 막대로 잰다.
      nav.search = `source=bizinfo&sort=published&includeClosed=true&q=${encodeURIComponent("중소")}`;
      const { host } = render({}, width);
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      const right = host.getBoundingClientRect().right;
      const overflowing = [...host.querySelectorAll("*")].filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && box.right > right + 0.5;
      });
      expect(overflowing.map((el) => `${el.tagName}.${el.className}`)).toEqual([]);
      expect(host.querySelectorAll("thead th")).toHaveLength(5);
      // 필터 막대는 한 줄이다(라벨 20 + 간격 8 + 칸 40).
      const bar = host.querySelector('[role="search"]')?.parentElement as HTMLElement;
      expect(bar.getBoundingClientRect().height).toBeLessThanOrEqual(68);
    },
  );

  it("열은 출처·공고명·소관기관·신청 마감·등록일이고 점수·권고·분석·결정은 없다", () => {
    const { host } = render();
    const heads = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["출처", "공고명", "소관기관", "신청 마감", "등록일"]);
    expect(host.textContent).not.toMatch(/SOL Score|권고|분석|결정|BID|WATCH/);
  });

  it("마감 칸은 D-n·D-Day·마감·기간 미표기 네 모양이고 보이는 D-n 대신 낭독 글자가 있다", () => {
    const { host } = render({
      items: [TODAY_END, BIZINFO, MSS, CLOSED],
      query: { ...DEFAULT_QUERY, includeClosed: true },
      search: "includeClosed=true",
      isDefault: false,
    });
    const deadlineCell = (title: string) => rowOf(host, title).cells[3];
    const biz = deadlineCell(BIZINFO.title);
    expect(biz.querySelector('[aria-hidden="true"]')?.textContent).toBe("D-10");
    expect(biz.querySelector(".sr-only")?.textContent).toBe("10일 남음");
    expect(biz.querySelector("time")?.getAttribute("dateTime")).toBe("2026-10-31");
    expect(biz.querySelector("time")?.textContent).toBe("10. 31.");
    expect(deadlineCell(TODAY_END.title).textContent).toContain("D-Day");
    expect(deadlineCell(TODAY_END.title).textContent).toContain("오늘 마감");
    const closed = deadlineCell(CLOSED.title);
    expect(closed.textContent).toContain("마감 지남");
    const closedLabel = closed.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(closedLabel.textContent).toBe("마감");
    expect(closedLabel.parentElement?.className).toContain("text-muted-foreground");
    expect(deadlineCell(MSS.title).textContent).toBe("기간 미표기");
  });

  it("출처 배지·소관기관·등록일을 그리고 값이 없으면 — 다", () => {
    const { host } = render({ items: [BIZINFO, MSS, CLOSED] });
    const biz = rowOf(host, BIZINFO.title);
    expect(biz.cells[0].textContent).toBe("기업마당");
    expect(biz.cells[2].querySelector("[title]")?.getAttribute("title")).toBe(BIZINFO.agency);
    expect(biz.cells[4].querySelector("time")?.getAttribute("dateTime")).toBe(BIZINFO.publishedAt);
    expect(biz.cells[4].textContent).toBe("2026-10-20");
    const mss = rowOf(host, MSS.title);
    expect(mss.cells[0].textContent).toBe("중기부");
    expect(mss.cells[4].textContent).toBe("2026-10-21");
    const closed = rowOf(host, CLOSED.title);
    expect(closed.cells[2].textContent).toBe("—");
    expect(closed.cells[4].textContent).toBe("—");
  });

  it("DEMO 행은 출처 배지 대신 DEMO 배지다", () => {
    const { host } = render({ items: [{ ...BIZINFO, isDemo: true }] });
    expect(rowOf(host, BIZINFO.title).cells[0].textContent).toBe("DEMO");
  });

  it("정렬 열에 aria-sort 를 단다(마감 빠른 순 → 신청 마감 오름차순, 최근 등록 순 → 등록일 내림차순)", () => {
    const { host, root } = render();
    const head = (label: string) =>
      [...host.querySelectorAll("thead th")].find((th) => th.textContent === label);
    expect(head("신청 마감")?.getAttribute("aria-sort")).toBe("ascending");
    expect(head("등록일")?.hasAttribute("aria-sort")).toBe(false);
    flushSync(() => root.render(node({ query: { ...DEFAULT_QUERY, sort: "published" } })));
    expect(head("등록일")?.getAttribute("aria-sort")).toBe("descending");
    expect(head("신청 마감")?.hasAttribute("aria-sort")).toBe(false);
  });

  it("결과 줄은 표 위에서 건수를 알리고, 300건에서 잘렸으면 상한 안내를 붙인다", async () => {
    const { host, root } = render();
    const status = page.getByRole("status");
    await expect.element(status).toHaveTextContent("공고 3건 표시");
    expect(status.element().textContent).not.toContain("최대 300건");
    const table = host.querySelector("table") as HTMLElement;
    expect(status.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      table.getBoundingClientRect().top,
    );
    flushSync(() => root.render(node({ isCapped: true })));
    await expect
      .element(status)
      .toHaveTextContent(
        "공고 3건 표시 · 최대 300건까지 보입니다. 출처나 소관기관으로 좁혀 보세요",
      );
  });
});

describe("ProgramListView 빈 상태", () => {
  it("저장된 공고가 없으면(hasAnyNotice=false) 수집된 공고가 없다고 하고 나라장터 공고로 보낸다", async () => {
    render({ items: [], hasAnyNotice: false });
    await expect.element(page.getByText("수집된 부처 지원사업 공고가 없습니다")).toBeVisible();
    await expect
      .element(page.getByText("부처 공고는 정해진 주기로 자동 수집됩니다."))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "나라장터 공고 보기" }))
      .toHaveAttribute("href", "/bids");
    await expect.element(page.getByRole("status")).toHaveTextContent("공고 0건 표시");
    expect(page.getByText("진행 중인 부처 지원사업 공고가 없습니다").query()).toBeNull();
  });

  it("조건이 바뀐 화면이라도 저장된 공고가 없으면 수집 0건 문구다", async () => {
    render({
      items: [],
      hasAnyNotice: false,
      query: { ...DEFAULT_QUERY, source: "mss" },
      search: "source=mss",
      isDefault: false,
    });
    await expect.element(page.getByText("수집된 부처 지원사업 공고가 없습니다")).toBeVisible();
    expect(page.getByText("조건에 맞는 공고가 없습니다").query()).toBeNull();
  });

  it("기본 조건에서 0건이면 진행 중 공고가 없다고 하고 [마감 지난 공고 포함]으로 includeClosed 를 켠다", async () => {
    nav.search = "sort=published";
    render({
      items: [],
      query: { ...DEFAULT_QUERY, sort: "published" },
      search: "sort=published",
    });
    await expect.element(page.getByText("진행 중인 부처 지원사업 공고가 없습니다")).toBeVisible();
    await expect.element(page.getByText("마감 지난 공고는 숨겨져 있습니다.")).toBeVisible();
    await page.getByRole("button", { name: "마감 지난 공고 포함" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs?sort=published&includeClosed=true", {
      scroll: false,
    });
  });

  it("조건을 바꿔 0건이면 조건에 맞는 공고가 없다고 하고 [필터 초기화]로 /bids/programs 에 간다", async () => {
    nav.search = "source=mss";
    render({
      items: [],
      query: { ...DEFAULT_QUERY, source: "mss" },
      search: "source=mss",
      isDefault: false,
    });
    await expect.element(page.getByText("조건에 맞는 공고가 없습니다")).toBeVisible();
    await expect.element(page.getByText("마감 지난 공고는 숨겨져 있습니다.")).toBeVisible();
    expect(page.getByText("진행 중인 부처 지원사업 공고가 없습니다").query()).toBeNull();
    await page.getByRole("button", { name: "필터 초기화" }).last().click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs", { scroll: false });
  });

  it("마감 지난 공고를 이미 포함한 조건 0건이면 숨김 안내를 두지 않는다", async () => {
    render({
      items: [],
      query: { ...DEFAULT_QUERY, includeClosed: true },
      search: "includeClosed=true",
      isDefault: false,
    });
    await expect.element(page.getByText("조건에 맞는 공고가 없습니다")).toBeVisible();
    expect(page.getByText("마감 지난 공고는 숨겨져 있습니다.").query()).toBeNull();
  });
});

describe("ProgramListView 필터", () => {
  it("마감 지난 공고 포함 스위치를 켜면 includeClosed=true 가 주소에 적히고, 끄면 사라진다", async () => {
    render();
    expect(page.getByRole("button", { name: "필터 초기화" }).query()).toBeNull();
    const toggle = page.getByRole("switch", { name: "마감 지난 공고 포함" });
    await expect.element(toggle).not.toBeChecked();
    await toggle.click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs?includeClosed=true", {
      scroll: false,
    });
    await expect.element(toggle).toBeChecked();
    await expect.element(page.getByRole("button", { name: "필터 초기화" })).toBeVisible();
    await toggle.click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs", { scroll: false });
  });

  it("출처·정렬은 기본값을 주소에 적지 않고 다른 키는 남긴다", async () => {
    nav.search = "utm=x";
    render();
    await page.getByRole("combobox", { name: "출처" }).click();
    await expect.element(page.getByRole("option", { name: "전체 (기본)" })).toBeVisible();
    await page.getByRole("option", { name: "기업마당" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs?utm=x&source=bizinfo", {
      scroll: false,
    });
    await page.getByRole("combobox", { name: "정렬" }).click();
    await page.getByRole("option", { name: "최근 등록 순" }).click();
    expect(nav.push).toHaveBeenLastCalledWith(
      "/bids/programs?utm=x&source=bizinfo&sort=published",
      { scroll: false },
    );
    await page.getByRole("combobox", { name: "출처" }).click();
    await page.getByRole("option", { name: "전체 (기본)" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs?utm=x&sort=published", {
      scroll: false,
    });
  });

  it("소관기관 검색어는 Enter 로 적용하고 비우면 q 가 사라진다", async () => {
    render();
    const input = page.getByRole("searchbox", { name: "소관기관 검색" });
    await expect.element(input).toHaveAttribute("maxlength", "50");
    await input.fill("  중소벤처  ");
    await userEvent.keyboard("{Enter}");
    const params = new URL(nav.push.mock.lastCall?.[0] as string, "http://x").searchParams;
    expect(params.get("q")).toBe("중소벤처");
    await input.fill("   ");
    await userEvent.keyboard("{Enter}");
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs", { scroll: false });
  });

  it("필터 초기화는 네 키만 지우고 다른 키는 남긴다", async () => {
    nav.search = "q=a&source=mss&sort=published&includeClosed=true&utm=x";
    render();
    await page.getByRole("button", { name: "필터 초기화" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids/programs?utm=x", { scroll: false });
  });

  it("주소의 틀린 값은 기본 값으로 보인다(오류 없이)", async () => {
    nav.search = "source=foo&sort=x&includeClosed=1";
    render();
    await expect
      .element(page.getByRole("combobox", { name: "출처" }))
      .toHaveTextContent("전체 (기본)");
    await expect
      .element(page.getByRole("combobox", { name: "정렬" }))
      .toHaveTextContent("마감 빠른 순 (기본)");
    await expect
      .element(page.getByRole("switch", { name: "마감 지난 공고 포함" }))
      .not.toBeChecked();
    expect(page.getByRole("button", { name: "필터 초기화" }).query()).toBeNull();
  });

  it("필터를 바꾸는 동안 표만 흐려지고 aria-busy 가 켜진다", async () => {
    nav.hold = true;
    const { host } = render();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    await page.getByRole("switch", { name: "마감 지난 공고 포함" }).click();
    await expect.poll(() => host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[aria-busy="true"] table')).not.toBeNull();
    expect(host.querySelector('[aria-busy="true"] [role="search"]')).toBeNull();
    expect(host.querySelector('[aria-busy="true"] [role="status"]')).toBeNull();
  });
});

describe("ProgramNoticeDrawer", () => {
  it("공고명 단추로 열면 첫 초점이 원문 보기이고, Esc 로 닫으면 초점이 그 단추로 돌아온다", async () => {
    const { host } = render();
    const trigger = page.getByRole("button", { name: BIZINFO.title, exact: true });
    await expect.element(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
    // 서랍이 열리면 바깥은 접근성 트리에서 숨는다(모달). 역할로 다시 찾지 않고 요소를 잡아 둔다.
    const button = trigger.element();
    const dialog = await openDrawer(BIZINFO.title);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(rowOf(host, BIZINFO.title).matches(":has([aria-expanded='true'])")).toBe(true);
    await expect
      .element(page.getByRole("link", { name: `원문 보기: ${BIZINFO.title} (새 창)` }))
      .toHaveFocus();
    for (let index = 0; index < 4; index++) {
      await userEvent.keyboard("{Tab}");
      await expect.poll(() => dialog.element().contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(trigger).toHaveFocus();
    await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("원문 보기는 새 창·noopener noreferrer 링크이고 이름에 공고명과 (새 창)이 붙는다", async () => {
    render();
    await openDrawer(BIZINFO.title);
    const link = page.getByRole("link", { name: `원문 보기: ${BIZINFO.title} (새 창)` });
    await expect.element(link).toHaveAttribute("href", BIZINFO.sourceUrl);
    await expect.element(link).toHaveAttribute("target", "_blank");
    await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
    await expect.element(link).toHaveTextContent("원문 보기");
  });

  it("원문 주소가 http·https 가 아니면 링크 대신 글자로 보이고 첫 초점은 닫기 단추다", async () => {
    render({ items: [{ ...BIZINFO, sourceUrl: "javascript:alert(1)" }] });
    await openDrawer(BIZINFO.title);
    expect(page.getByRole("link", { name: /원문 보기/ }).query()).toBeNull();
    await expect.element(page.getByText("원문 주소 javascript:alert(1)")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "닫기" })).toHaveFocus();
  });

  it("기업마당 공고는 평문으로 줄바꿈을 지키고 구역·태그·문의처 안내를 그린다", async () => {
    await page.viewport(1280, 900);
    render();
    const dialog = await openDrawer(BIZINFO.title);
    const box = dialog.element();
    await expect.poll(() => Math.round(box.getBoundingClientRect().width)).toBe(480);
    await expect.element(dialog.getByText("기업마당", { exact: true })).toBeVisible();
    await expect
      .element(page.getByRole("dialog", { name: BIZINFO.title }))
      .toHaveAccessibleDescription(BIZINFO.agency ?? "");
    await expect.element(dialog.getByText("2026-10-01 ~ 2026-10-31 (D-10)")).toBeVisible();
    await expect.element(dialog.getByText("2026-10-20", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("문의처는 원문에서 확인하세요")).toBeVisible();
    const headings = [...box.querySelectorAll("h3")].map((h) => h.textContent);
    expect(headings).toEqual(["사업개요", "신청방법", "지원대상", "분야·태그"]);
    const summary = [...box.querySelectorAll("p")].find((p) =>
      p.textContent?.startsWith("사업 목적"),
    ) as HTMLElement;
    expect(summary.textContent).toBe(BIZINFO.summary);
    expect(getComputedStyle(summary).whiteSpace).toBe("pre-line");
    expect(box.querySelector("b")).toBeNull();
    expect(
      dialog
        .getByRole("listitem")
        .elements()
        .map((li) => li.textContent),
    ).toEqual(["기술", "AI", "SW융합"]);
    expect(box.textContent).not.toMatch(/SOL Score|권고|분석|결정|관심 공고/);
  });

  it("중기부 공고처럼 내용이 없으면 제목과 등록일만 제공한다고 알리고 구역을 그리지 않는다", async () => {
    render();
    const dialog = await openDrawer(MSS.title);
    await expect
      .element(
        dialog.getByText(
          "이 출처는 제목과 등록일만 제공합니다. 사업 내용과 신청 기간은 원문에서 확인하세요.",
        ),
      )
      .toBeVisible();
    expect(dialog.element().querySelectorAll("h3")).toHaveLength(0);
    await expect.element(dialog.getByText("기간 미표기", { exact: true })).toBeVisible();
    await expect.element(dialog.getByText("문의처는 원문에서 확인하세요")).toBeVisible();
  });

  it("일부만 없으면 그 구역만 빠지고, 소관기관이 없으면 소관기관 미표기다", async () => {
    render({ items: [TODAY_END, CLOSED], query: { ...DEFAULT_QUERY, includeClosed: true } });
    const today = await openDrawer(TODAY_END.title);
    expect([...today.element().querySelectorAll("h3")].map((h) => h.textContent)).toEqual([
      "지원대상",
    ]);
    await expect.element(today.getByText("~ 2026-10-21 (D-Day)")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    const closed = await openDrawer(CLOSED.title);
    await expect.element(closed.getByText("소관기관 미표기")).toBeVisible();
    await expect.element(closed.getByText("2026-09-01 ~ 2026-09-30 (마감)")).toBeVisible();
  });

  it("목록 조건이 바뀌면 열린 서랍을 닫는다", async () => {
    const { root } = render();
    await openDrawer(BIZINFO.title);
    flushSync(() =>
      root.render(
        node({
          query: { ...DEFAULT_QUERY, source: "bizinfo" },
          search: "source=bizinfo",
          isDefault: false,
        }),
      ),
    );
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });
});
