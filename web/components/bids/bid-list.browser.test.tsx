import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { BidFilters } from "@/components/bids/bid-filters";
import { BidTable } from "@/components/bids/bid-table";
import { BID_LIST } from "@/components/bids/test-data";
import type { BidListItem } from "@/server/bids";

// 목록 표와 필터 막대를 진짜 브라우저에 그린다. 화면 이동은 가짜로 바꾸고 주소(쿼리)만 잰다.
const nav = vi.hoisted(() => ({
  search: "",
  // true 면 push 를 기록만 하고 주소는 그대로 둔다(서버가 아직 답하지 않은 이동).
  hold: false,
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
        if (nav.hold) return;
        nav.search = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
        nav.listeners.forEach((fn) => fn());
      },
    }),
    usePathname: () => "/bids",
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
  default: ({ href, className, title, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

const mounted: Root[] = [];
beforeEach(() => {
  nav.search = "";
  nav.hold = false;
  nav.push.mockClear();
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode, width = 960) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  host.className = "@container";
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const NOW = new Date("2026-10-16T00:00:00Z");
const byId = (id: string): BidListItem => {
  const found = BID_LIST.find((item) => item.id === id);
  if (!found) throw new Error(`BID_LIST 에 ${id} 가 없다`);
  return found;
};
const rowOf = (host: HTMLElement, id: string) => {
  const link = host.querySelector(`a[href="/bids/${id}"]`);
  const row = link?.closest("tr");
  if (!row) throw new Error(`${id} 행이 없다`);
  return row;
};

describe("BidTable", () => {
  it.each([960, 1120])("%ipx 에서 10열이 순서대로 있고 가로로 넘치지 않는다", (width) => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />, width);
    const heads = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual([
      "출처",
      "단계",
      "제목",
      "발주기관",
      "예산",
      "마감",
      "SOL Score",
      "권고",
      "분석 상태",
      "최종 결정",
    ]);
    const table = host.querySelector("table") as HTMLElement;
    expect(table.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    const widths = [...host.querySelectorAll("thead th")].map(
      (th) => th.getBoundingClientRect().width,
    );
    expect(widths.slice(0, 2)).toEqual([80, 72]); // 스펙 64 -> 80: DEMO 칩이 64 에 들어가지 않는다
    expect(widths.slice(3)).toEqual([120, 80, 72, 80, 88, 96, 88]);
    expect(widths[2]).toBeCloseTo(width - 776, 0);
  });

  it("120자 제목은 2줄에서 말줄임이고 title 에 전체가 있다", () => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />);
    const long = byId("bid-long");
    const link = rowOf(host, long.id).querySelector("a") as HTMLElement;
    const lineHeight = parseFloat(getComputedStyle(link).lineHeight);
    expect(link.title).toBe(long.title);
    expect(link.clientHeight).toBeLessThanOrEqual(lineHeight * 2 + 1);
    expect(link.scrollHeight).toBeGreaterThan(link.clientHeight);
    expect(rowOf(host, long.id).getBoundingClientRect().height).toBeLessThan(lineHeight * 3 + 20);
  });

  it("예산이 null 이면 —, 스크린리더에는 미공개를 읽힌다. 값이 있으면 전체 금액이 title 에 있다", () => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />);
    const cells = rowOf(host, "bid-null").querySelectorAll("td");
    expect(cells[4].textContent).toContain("—");
    expect(cells[4].querySelector(".sr-only")?.textContent).toBe("미공개");
    const full = rowOf(host, "bid-fx-01").querySelectorAll("td")[4];
    expect(full.textContent).toContain("12억");
    expect(full.querySelector("[title]")?.getAttribute("title")).toBe("1,200,000,000원");
  });

  it("null 필드 행은 기관·마감·점수를 —, 권고·분석 상태를 미분석, 결정을 미결정으로 보인다", () => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />);
    const cells = [...rowOf(host, "bid-null").querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[3]).toBe("—");
    expect(cells[5]).toBe("—");
    expect(cells[6]).toBe("—");
    expect(cells[7]).toBe("미분석");
    expect(cells[8]).toBe("미분석");
    expect(cells[9]).toBe("미결정");
  });

  it("마감은 D-n 과 날짜, 점수는 정수, 권고와 결정은 글자로 보인다", () => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />);
    const cells = [...rowOf(host, "bid-fx-01").querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[5]).toContain("D-21");
    expect(cells[5]).toContain("11. 6.");
    expect(cells[6]).toBe("94");
    expect(cells[7]).toBe("BID");
    expect(cells[8]).toBe("완료");
    expect(cells[9]).toBe("BID");
  });

  it("isDemo 행은 DEMO, 실제 공고 행은 나라장터를 보인다", () => {
    const live: BidListItem = {
      ...byId("bid-fx-02"),
      id: "bid-live",
      isDemo: false,
      origin: "live",
    };
    const host = render(
      <BidTable items={[byId("bid-fx-01"), live]} caption="공고 목록" now={NOW} />,
    );
    expect(rowOf(host, "bid-fx-01").querySelector("td")?.textContent).toBe("DEMO");
    expect(rowOf(host, "bid-live").querySelector("td")?.textContent).toBe("나라장터");
  });

  it("첨부 실패가 있는 행에만 첨부 원문 확인 필요를 읽힌다", () => {
    const warned: BidListItem = {
      ...byId("bid-fx-02"),
      id: "bid-warn",
      documentsStatus: { ...byId("bid-fx-02").documentsStatus, failed: 1 },
    };
    const host = render(
      <BidTable items={[byId("bid-fx-01"), warned]} caption="공고 목록" now={NOW} />,
    );
    expect(rowOf(host, "bid-warn").querySelector("td:nth-child(3) .sr-only")?.textContent).toBe(
      "첨부 원문 확인 필요",
    );
    expect(rowOf(host, "bid-fx-01").textContent).not.toContain("첨부 원문 확인 필요");
  });

  it("취소된 공고는 단계 아래에 취소됨을 보인다", () => {
    const cancelled: BidListItem = { ...byId("bid-fx-01"), status: "CANCELLED" };
    const host = render(<BidTable items={[cancelled]} caption="공고 목록" now={NOW} />);
    expect(host.querySelectorAll("tbody td")[1].textContent).toContain("취소됨");
  });

  // P3: 아이콘이 2줄 말줄임 상자 안에 있으면 긴 제목에서 잘려 보이지 않는다.
  it.each([false, true])(
    "첨부 경고 아이콘은 말줄임 상자 밖에 있고 긴 제목에서도 보인다 (compact %s)",
    (compact) => {
      const longWarned: BidListItem = {
        ...byId("bid-long"),
        documentsStatus: { ...byId("bid-long").documentsStatus, downloadFailed: 1 },
      };
      const host = render(
        <BidTable items={[longWarned]} caption="공고 목록" now={NOW} compact={compact} />,
      );
      const cell = host.querySelector("tbody td:nth-child(" + (compact ? 2 : 3) + ")");
      const clamp = cell?.querySelector('[class*="line-clamp"]') as HTMLElement;
      const icon = cell?.querySelector("svg.lucide-file-warning") as SVGElement;
      expect(clamp).not.toBeNull();
      expect(icon).not.toBeNull();
      expect(clamp.contains(icon)).toBe(false);
      const box = icon.getBoundingClientRect();
      const cellBox = (cell as HTMLElement).getBoundingClientRect();
      expect(box.width).toBeGreaterThan(0);
      expect(box.right).toBeLessThanOrEqual(cellBox.right);
      expect(box.top).toBeGreaterThanOrEqual(cellBox.top);
      expect(box.bottom).toBeLessThanOrEqual(cellBox.bottom);
      expect(cell?.querySelector(".sr-only")?.textContent).toBe("첨부 원문 확인 필요");
    },
  );

  it("listQuery 가 있으면 제목 링크에 목록 조건을 list 로 붙이고, 없으면 붙이지 않는다", () => {
    const withList = render(
      <BidTable
        items={[byId("bid-fx-01")]}
        caption="공고 목록"
        now={NOW}
        listQuery="sort=score%3Adesc"
      />,
    );
    const href = withList.querySelector("tbody a")?.getAttribute("href") ?? "";
    expect(href.startsWith("/bids/bid-fx-01?")).toBe(true);
    expect(href.endsWith("?list=sort%3Dscore%253Adesc")).toBe(true);
    const plain = render(<BidTable items={[byId("bid-fx-01")]} caption="공고 목록" now={NOW} />);
    expect(plain.querySelector("tbody a")?.getAttribute("href")).toBe("/bids/bid-fx-01");
  });

  it.each([960, 1120])("%ipx 에서 표 머리 글자가 칸을 넘지 않는다", (width) => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />, width);
    const spilled = [...host.querySelectorAll("thead th")].filter(
      (th) => th.scrollWidth > th.clientWidth,
    );
    expect(spilled.map((th) => `${th.textContent}:${th.scrollWidth}>${th.clientWidth}`)).toEqual(
      [],
    );
  });

  it("표 이름과 DEMO 설명이 연결되고, 흐린 상태에서는 aria-busy 가 켜진다", () => {
    const host = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} busy />);
    const table = host.querySelector("table") as HTMLElement;
    expect(table.querySelector("caption")?.textContent).toBe("공고 목록");
    const desc = document.getElementById(table.getAttribute("aria-describedby") ?? "");
    expect(desc?.textContent).toBe(
      "DEMO 표시는 데모용 가상 공고입니다. 실제 입찰 공고가 아닙니다.",
    );
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("footer 를 표 아래에 둔다", () => {
    render(
      <BidTable items={BID_LIST} caption="공고 목록" now={NOW} footer={<button>더 보기</button>} />,
    );
    expect(page.getByRole("button", { name: "더 보기" }).element()).toBeTruthy();
  });

  it("compact 표는 점수형 5열과 마감형 5열을 보이고 제목 링크가 초점을 받는다", () => {
    const score = render(<BidTable items={BID_LIST} caption="BID 권고" now={NOW} compact />);
    expect([...score.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "출처",
      "제목",
      "발주기관",
      "SOL Score",
      "권고",
    ]);
    const deadline = render(
      <BidTable items={BID_LIST} caption="마감 임박" now={NOW} compact compactKind="deadline" />,
    );
    const link = deadline.querySelector("tbody a") as HTMLAnchorElement;
    link.focus();
    expect(document.activeElement).toBe(link);
    expect([...deadline.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "출처",
      "제목",
      "마감",
      "권고",
      "결정",
    ]);
  });
});

// 가장 긴 값 조합: 단계 "입찰공고"+"취소됨", 결정 NO-BID, 분석 "부분 완료", 권고 WATCH, 예산·점수·마감 최대 자릿수.
const WIDEST: BidListItem = {
  ...byId("bid-fx-02"),
  id: "bid-widest",
  status: "CANCELLED",
  agency: "한국지능정보사회진흥원 아주 긴 기관 이름",
  budgetKrw: "99999999999",
  deadlineAt: "2026-12-31T09:00:00Z",
  latestAnalysis: {
    ...(byId("bid-fx-02").latestAnalysis as NonNullable<BidListItem["latestAnalysis"]>),
    status: "PARTIAL",
    solScore: 100,
    recommendation: "WATCH",
  },
  latestReview: { decision: "NO_BID", decidedAt: "2026-10-16T02:00:00Z", reviewerName: "김영업" },
};

// 제목 열은 line-clamp 로 줄이는 것이 의도라 뺀다. 나머지 셀은 overflow-hidden 이라 넘침이 가려지므로
// scrollWidth 가 clientWidth 를 넘는지로 잘림을 잡는다. 기관은 truncate(말줄임)가 의도라 함께 뺀다.
// 표 머리 칸은 overflow 가 보이는 채라 넘친 글자가 옆 칸을 덮는다. 같은 방법으로 함께 잡는다.
const clippedCells = (host: HTMLElement) => [
  ...[...host.querySelectorAll("tbody td")].filter((td, i, all) => {
    const col = i % (all.length / host.querySelectorAll("tbody tr").length);
    const head = host.querySelectorAll("thead th")[col]?.textContent;
    return head !== "제목" && head !== "발주기관" && td.scrollWidth > td.clientWidth;
  }),
  ...[...host.querySelectorAll("thead th")].filter((th) => th.scrollWidth > th.clientWidth),
];

// 대시보드는 본문 글자를 +3px 키운다(ADR-030 B25). 대시보드 표는 그 범위 안에서 잰다.
const renderDashboard = (node: React.ReactNode, width: number) => {
  const host = render(<div data-type-scale="dashboard">{node}</div>, width);
  return host;
};

describe("셀 잘림", () => {
  it.each([960, 1120])("10열 표는 %ipx 에서 가장 긴 값도 잘리지 않는다", (width) => {
    const host = render(
      <BidTable items={[WIDEST, ...BID_LIST]} caption="공고 목록" now={NOW} />,
      width,
    );
    expect(
      clippedCells(host).map((td) => `${td.textContent}:${td.scrollWidth}>${td.clientWidth}`),
    ).toEqual([]);
  });

  // 대시보드 표 폭(카드 테두리 2px 를 뺀 표 폭). 글자가 +3px 라 두 표를 늘 위아래로 쌓으므로 표 폭 = 본문 폭 - 2.
  // 본문 960(1280·펼침)·1120(1440·펼침)·1216(1280·접힘)·1376(1440·접힘) -> 958·1118·1214·1374.
  it.each([
    ["recommended", 958, true],
    ["recommended", 1118, true],
    ["recommended", 1374, true],
    ["deadline", 958, null],
    ["deadline", 1214, null],
  ] as const)(
    "대시보드 compact %s 표는 %ipx(+3px 글자)에서 잘리지 않고 발주기관 열이 맞게 보인다",
    (kind, width, agencyShown) => {
      const host = renderDashboard(
        <BidTable
          items={[WIDEST, ...BID_LIST]}
          caption="표"
          now={NOW}
          compact
          compactKind={kind}
        />,
        width,
      );
      expect(getComputedStyle(host.querySelector("tbody td") as Element).fontSize).toBe("17px");
      expect(
        clippedCells(host).map((td) => `${td.textContent}:${td.scrollWidth}>${td.clientWidth}`),
      ).toEqual([]);
      const table = host.querySelector("table") as HTMLElement;
      expect(table.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      if (agencyShown !== null) {
        const agency = [...host.querySelectorAll("thead th")].find(
          (th) => th.textContent === "발주기관",
        );
        expect(agency && getComputedStyle(agency).display !== "none").toBe(agencyShown);
      }
      // 가장 좁은 폭에서도 제목 칸이 공고 이름을 읽을 만큼 남는다.
      const title = [...host.querySelectorAll("thead th")].find((th) => th.textContent === "제목");
      expect(title?.getBoundingClientRect().width).toBeGreaterThanOrEqual(480);
    },
  );

  it("대시보드 compact 표의 첫·끝 칸 글자는 카드 여백(24px)에 맞춘다", () => {
    const host = renderDashboard(
      <BidTable items={BID_LIST} caption="표" now={NOW} compact compactKind="deadline" />,
      958,
    );
    const first = host.querySelector("thead th") as HTMLElement;
    const last = host.querySelector("thead th:last-child") as HTMLElement;
    expect(getComputedStyle(first).paddingLeft).toBe("24px");
    expect(getComputedStyle(last).paddingRight).toBe("24px");
    const firstCell = host.querySelector("tbody td") as HTMLElement;
    expect(getComputedStyle(firstCell).paddingLeft).toBe("24px");
  });

  it("compact 표의 제목은 1줄이라 모든 행의 높이가 같다", () => {
    const host = renderDashboard(<BidTable items={BID_LIST} caption="표" now={NOW} compact />, 958);
    // +3px 글자에서는 칸마다 줄 상자가 0.5px 씩 어긋난다. 한 줄(25px) 차이를 잡는 시험이라 정수로 반올림해 비교한다.
    const heights = [...host.querySelectorAll("tbody tr")].map((tr) =>
      Math.round(tr.getBoundingClientRect().height),
    );
    expect(new Set(heights).size).toBe(1);
    const long = rowOf(host, "bid-long").querySelector("a") as HTMLElement;
    expect(long.clientHeight).toBeLessThanOrEqual(
      parseFloat(getComputedStyle(long).lineHeight) + 1,
    );
  });
});

describe("BidFilters", () => {
  it("정렬을 점수 높은 순으로 바꾸면 sort 만 주소에 적히고, 기본으로 돌리면 사라진다", async () => {
    render(<BidFilters defaultOrigin="demo" />);
    expect(page.getByRole("button", { name: "필터 초기화" }).query()).toBeNull();
    await page.getByRole("combobox", { name: "정렬" }).click();
    await page.getByRole("option", { name: "점수 높은 순" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids?sort=score%3Adesc", { scroll: false });
    await expect.element(page.getByRole("button", { name: "필터 초기화" })).toBeVisible();
    await page.getByRole("combobox", { name: "정렬" }).click();
    await page.getByRole("option", { name: "최근 공고 순" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids", { scroll: false });
    expect(page.getByRole("button", { name: "필터 초기화" }).query()).toBeNull();
  });

  it("필터를 바꾸면 cursor 를 지우고 다른 조건은 남긴다", async () => {
    nav.search = "recommendation=BID&cursor=abc";
    render(<BidFilters defaultOrigin="demo" />);
    await page.getByRole("combobox", { name: "단계" }).click();
    await page.getByRole("option", { name: "입찰공고" }).click();
    const href = nav.push.mock.lastCall?.[0] as string;
    const params = new URL(href, "http://x").searchParams;
    expect(params.get("stage")).toBe("NOTICE");
    expect(params.get("recommendation")).toBe("BID");
    expect(params.has("cursor")).toBe(false);
  });

  it("출처 기본값은 주소에 적지 않고 기본 항목 옆에 (기본)을 붙인다", async () => {
    render(<BidFilters defaultOrigin="live" />);
    await page.getByRole("combobox", { name: "출처" }).click();
    await expect.element(page.getByRole("option", { name: "실제 공고 (기본)" })).toBeVisible();
    await page.getByRole("option", { name: "전체" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids?origin=all", { scroll: false });
    await page.getByRole("combobox", { name: "출처" }).click();
    await page.getByRole("option", { name: "실제 공고 (기본)" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids", { scroll: false });
  });

  it("검색어는 Enter 로 적용하고 비우면 q 가 사라진다", async () => {
    nav.search = "q=%EC%84%B8%EC%A2%85&cursor=x";
    render(<BidFilters defaultOrigin="demo" />);
    const input = page.getByRole("searchbox", { name: "공고 검색" });
    await expect.element(input).toHaveValue("세종");
    await input.fill("광주");
    await userEvent.keyboard("{Enter}");
    const params = new URL(nav.push.mock.lastCall?.[0] as string, "http://x").searchParams;
    expect(params.get("q")).toBe("광주");
    expect(params.has("cursor")).toBe(false);
    await input.fill("");
    await userEvent.keyboard("{Enter}");
    expect(nav.push).toHaveBeenLastCalledWith("/bids", { scroll: false });
  });

  it("필터 초기화는 일곱 키와 cursor 를 지운다", async () => {
    nav.search =
      "q=a&stage=PLAN&status=OPEN&status=AMENDED&status=CANCELLED&recommendation=BID&decision=NONE&origin=all&sort=score%3Adesc&cursor=z";
    render(<BidFilters defaultOrigin="demo" />);
    await page.getByRole("button", { name: "필터 초기화" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids", { scroll: false });
  });

  // ADR-029 A7: 기본은 진행 중(OPEN·AMENDED)이고 "취소 포함"은 CANCELLED 를 더한다.
  it("상태를 취소 포함으로 고르면 status 세 값이 주소에 적히고, 기본으로 돌리면 status 키가 없다", async () => {
    nav.search = "sort=score%3Adesc&cursor=c";
    render(<BidFilters defaultOrigin="demo" />);
    await expect
      .element(page.getByRole("combobox", { name: "상태" }))
      .toHaveTextContent("진행 중 (기본)");
    await page.getByRole("combobox", { name: "상태" }).click();
    await page.getByRole("option", { name: "취소 포함" }).click();
    const params = new URL(nav.push.mock.lastCall?.[0] as string, "http://x").searchParams;
    expect(params.getAll("status")).toEqual(["OPEN", "AMENDED", "CANCELLED"]);
    expect(params.get("sort")).toBe("score:desc");
    expect(params.has("cursor")).toBe(false);
    await expect
      .element(page.getByRole("combobox", { name: "상태" }))
      .toHaveTextContent("취소 포함");
    await expect.element(page.getByRole("button", { name: "필터 초기화" })).toBeVisible();
    await page.getByRole("combobox", { name: "상태" }).click();
    await page.getByRole("option", { name: "진행 중 (기본)" }).click();
    const back = new URL(nav.push.mock.lastCall?.[0] as string, "http://x").searchParams;
    expect(back.has("status")).toBe(false);
    expect(back.get("sort")).toBe("score:desc");
  });

  it("주소에 취소 공고가 들어 있으면 상태 칸이 취소 포함을 보인다", async () => {
    nav.search = "status=OPEN&status=AMENDED&status=CANCELLED";
    render(<BidFilters defaultOrigin="demo" />);
    await expect
      .element(page.getByRole("combobox", { name: "상태" }))
      .toHaveTextContent("취소 포함");
  });

  it("startTransition 을 받으면 주소 이동을 그 안에서 하고, 이동이 끝나기 전에도 고른 값을 보인다", async () => {
    const React = await import("react");
    nav.hold = true;
    const gate = Promise.withResolvers<void>();
    const wrapped = vi.fn((callback: () => void) =>
      React.startTransition(async () => {
        callback();
        await gate.promise;
      }),
    );
    render(<BidFilters defaultOrigin="demo" startTransition={wrapped} />);
    await page.getByRole("combobox", { name: "권고" }).click();
    await page.getByRole("option", { name: "WATCH" }).click();
    expect(wrapped).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenLastCalledWith("/bids?recommendation=WATCH", { scroll: false });
    expect(nav.search).toBe("");
    await expect.element(page.getByRole("combobox", { name: "권고" })).toHaveTextContent("WATCH");
    gate.resolve();
  });

  it("알 수 없는 쿼리 값은 기본으로 보고 초기화 단추를 띄우지 않는다", () => {
    nav.search = "stage=BOGUS&sort=nope";
    render(<BidFilters defaultOrigin="demo" />);
    expect(page.getByRole("button", { name: "필터 초기화" }).query()).toBeNull();
  });
});
