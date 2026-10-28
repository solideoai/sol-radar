import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AppPage } from "@/components/app-page";
import { formatKrwCompact } from "@/components/bids/format";
import type { MarketOverview } from "@/server/market";
import { MARKET_DESCRIPTION, MARKET_SOURCE_BADGE, MARKET_TITLE } from "./market-copy";
import { MarketFilters, MarketView } from "./market-view";

// Next 의 라우터 런타임은 이 레이아웃 시험 범위 밖이다. 실제 링크 요소와 주소는 그대로 둔다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

// 값은 모두 가상이다(mock). 서버 집계(aggregateMarket)가 돌려주는 모양 그대로 둔다.
const NOW = new Date("2026-10-28T03:00:00.000Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AGENCIES = [
  "한국지능정보사회진흥원",
  "행정안전부 디지털정부혁신실 공공데이터정책과 데이터품질관리팀(가상)",
  "조달청",
  "한국토지주택공사",
  "국토교통부",
  "서울특별시",
  "경기도",
  "과학기술정보통신부",
  "한국전력공사",
  "국민건강보험공단",
];
const OVERVIEW: MarketOverview = {
  asOf: NOW.toISOString(),
  query: { period: 90, relevance: "relevant" },
  periodStartDate: "2026-07-31",
  readFromDate: "2026-07-31",
  totals: {
    notices: 412,
    knownBudgetKrw: "128450000000",
    unknownBudgetCount: 7,
    openNotices: 318,
    allIndustryNotices: 1198,
    cancelledNotices: 23,
  },
  agencyCount: 187,
  topAgencies: AGENCIES.map((name, index) => ({
    name,
    count: 31 - index * 3,
    knownBudgetKrw: String((12 - index) * 1_250_000_000),
  })),
  categories: [
    { key: "SI_SW", count: 254, knownBudgetKrw: "80200000000" },
    { key: "DATA", count: 121, knownBudgetKrw: "31500000000" },
    { key: "AI_AX", count: 88, knownBudgetKrw: "27400000000" },
    { key: "CLOUD", count: 41, knownBudgetKrw: "9800000000" },
    { key: "SECURITY", count: 30, knownBudgetKrw: "6100000000" },
    { key: "DIGITAL_TWIN", count: 12, knownBudgetKrw: "4300000000" },
    { key: "NONE", count: 5, knownBudgetKrw: "0" },
  ],
  budgetBands: [
    { key: "UNDER_1", minKrw: "0", maxKrw: "100000000", count: 151, knownBudgetKrw: "7300000000" },
    {
      key: "FROM_1_TO_5",
      minKrw: "100000000",
      maxKrw: "500000000",
      count: 162,
      knownBudgetKrw: "38600000000",
    },
    {
      key: "FROM_5_TO_20",
      minKrw: "500000000",
      maxKrw: "2000000000",
      count: 70,
      knownBudgetKrw: "52100000000",
    },
    {
      key: "FROM_20_TO_100",
      minKrw: "2000000000",
      maxKrw: "10000000000",
      count: 11,
      knownBudgetKrw: "30450000000",
    },
    { key: "OVER_100", minKrw: "10000000000", maxKrw: null, count: 0, knownBudgetKrw: "0" },
    { key: "UNKNOWN", minKrw: null, maxKrw: null, count: 7, knownBudgetKrw: "0" },
  ],
  weekly: Array.from({ length: 13 }, (_, index) => {
    const start = new Date(Date.UTC(2026, 7, 3 + index * 7));
    return {
      weekStart: start.toISOString().slice(0, 10),
      count: [18, 22, 25, 31, 27, 35, 29, 41, 38, 33, 44, 47, 12][index] ?? 0,
    };
  }),
  upcomingDays: 14,
  upcoming: Array.from({ length: 10 }, (_, index) => ({
    bidId: id(index + 1),
    title:
      index === 0
        ? "차세대 지능형 행정정보시스템 통합 구축 및 클라우드 전환, 데이터 품질 관리 체계 고도화 사업(가상)"
        : `공공 데이터 플랫폼 구축 사업 ${index + 1}(가상)`,
    agency: AGENCIES[index] ?? null,
    deadlineAt: new Date(NOW.getTime() + (index + 1) * 26 * 60 * 60 * 1000).toISOString(),
    budgetKrw: String((10 - index) * 980_000_000),
  })),
};

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

// 업무 틀의 사이드바(256px) 자리를 비워 둔다. 대시보드 시험과 같은 방식이다.
function render(overview: MarketOverview) {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "calc(100% - 256px)";
  host.style.marginLeft = "256px";
  const root = createRoot(host);
  root.render(
    <AppPage
      title={MARKET_TITLE}
      description={MARKET_DESCRIPTION}
      contentClassName="max-w-360"
      actions={<MarketFilters query={overview.query} periods={[30, 90]} />}
    >
      <MarketView
        overview={overview}
        reference={{ at: "2026-10-28T02:05:00.000Z", failed: false }}
        now={NOW}
      />
    </AppPage>,
  );
  mounted.push(root);
  return host;
}

// 시험 창(1280×720)보다 큰 화면은 줄여 그려지고, 화면 밖은 찍히지 않는다(fullPage 도 빈칸).
// 그래서 줄임이 가장 적은 높이(1280 → 720, 1440 → 810)로 창을 두고 아래로 넘기며 나눠 찍는다.
// 파일 이름의 y 는 그 장의 스크롤 위치(CSS px)다. 증거 폴더에 옮길 때 이 값으로 한 장으로 잇는다.
async function shoot(width: number) {
  const height = Math.round((width * 720) / 1280);
  await page.viewport(width, height);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  for (let y = 0; ; y = Math.min(y + height, max)) {
    window.scrollTo(0, y);
    await page.screenshot({
      path: `../../../../test-results/vitest-screenshots/market-overview-${width}-y${String(y).padStart(4, "0")}.png`,
    });
    if (y >= max) break;
  }
  window.scrollTo(0, 0);
}

describe("발주 현황 화면", () => {
  it("요약·기관 10곳·분야·예산 구간·13주·마감 임박 10건을 그리고 1440·1280에서 넘치지 않는다", async () => {
    await page.viewport(1440, 900);
    const host = render(OVERVIEW);
    await expect.element(page.getByRole("heading", { level: 1, name: MARKET_TITLE })).toBeVisible();
    await expect.element(page.getByText(MARKET_SOURCE_BADGE)).toBeVisible();
    for (const name of [
      "상위 발주기관",
      "분야별 공고",
      "예산 규모별 공고",
      "주별 게시 추이",
      "마감 다가오는 큰 사업",
    ])
      await expect.element(page.getByRole("heading", { level: 2, name })).toBeVisible();

    // 요약 띠 4칸: 기간 내 공고·배정 예산 합·마감 전·기준 시각(KST)
    const figures = [...host.querySelectorAll('[aria-label="발주 현황 요약"] dd.type-title')].map(
      (node) => node.textContent,
    );
    expect(figures).toEqual([
      "412",
      formatKrwCompact(OVERVIEW.totals.knownBudgetKrw).text,
      "318",
      "11:05",
    ]);

    expect(
      page.getByRole("list", { name: "공고 수 상위 발주기관" }).element().children,
    ).toHaveLength(10);
    expect(page.getByRole("list", { name: "예산 구간별 공고 수" }).element().textContent).toContain(
      "5억 이상 20억 미만",
    );
    expect(page.getByRole("list", { name: "분야별 공고 수" }).element().textContent).toContain(
      "분야 미분류",
    );

    // 공고 링크는 live 출처로 상세를 연다
    const links = host.querySelectorAll<HTMLAnchorElement>("tbody a");
    expect(links).toHaveLength(10);
    expect(links[0]?.getAttribute("href")).toBe(`/bids/${id(1)}?origin=live`);
    // 고르는 범위(읽은 범위 첫날 이후 게시분)를 설명에 그대로 적는다
    await expect
      .element(page.getByText("기간 선택과 별개로 7. 31. 이후 게시분 중", { exact: false }))
      .toBeVisible();

    // 지금 거르기는 주소 링크의 aria-current 로 보인다
    expect(
      page.getByRole("link", { name: "최근 90일" }).element().getAttribute("aria-current"),
    ).toBe("page");
    expect(page.getByRole("link", { name: "전체 업종" }).element().getAttribute("href")).toBe(
      "/market?period=90&relevance=all",
    );

    // 정직한 표현: 시장 분석·점유율·경쟁사·승률·확률·수주 같은 말이 없다(낙찰은 고정 배지의 "수집하지 않습니다"만)
    const text = host.textContent ?? "";
    for (const word of ["시장", "점유율", "경쟁사", "승률", "확률", "수주"])
      expect(text).not.toContain(word);
    expect(text.split("낙찰")).toHaveLength(2);

    for (const width of [1440, 1280]) {
      await page.viewport(width, 900);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
      // 2칸 배치(기관 | 분야·예산)가 두 폭 모두 유지된다
      const agencies = page.getByRole("heading", { level: 2, name: "상위 발주기관" }).element();
      const categories = page.getByRole("heading", { level: 2, name: "분야별 공고" }).element();
      expect(categories.getBoundingClientRect().left).toBeGreaterThan(
        agencies.getBoundingClientRect().right,
      );
      await shoot(width);
    }
  });
});
