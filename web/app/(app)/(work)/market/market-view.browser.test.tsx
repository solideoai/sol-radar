import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { AppPage } from "@/components/app-page";
import { formatKrwCompact } from "@/components/bids/format";
import type { MarketGapCounts, MarketOverview } from "@/server/market";
import { MARKET_DESCRIPTION, MARKET_SOURCE_BADGE, MARKET_TITLE } from "./market-copy";
import { MarketFilters, MarketView, type MarketGapCopy } from "./market-view";

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
  upcomingFromDate: "2026-08-03",
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
  // 1단계 시험은 회사 프로필이 없는 조직이다. 겹쳐 보기만 빠지고 1단계 화면은 그대로여야 한다.
  gapOverlay: { status: "NO_PROFILE" },
};

// 겹쳐 보기(§6 B2) 문구. 페이지는 서버 배럴(GAP_BUCKET_LABELS·gapRadarHref)에서 같은 값을 내린다.
const GAP_COPY: MarketGapCopy = {
  bucketLabels: {
    ELIGIBLE: "참가 가능(API 기준)",
    MISSING_RECORD: "회사 기록 없음",
    NOT_HELD: "미보유",
    NEEDS_REVIEW: "사람 확인 필요",
  },
  gapsHref: "/gaps",
};
const counts = (
  open: number,
  [eligible, missing, notHeld, review]: [number, number, number, number],
): MarketGapCounts => ({
  open,
  buckets: { ELIGIBLE: eligible, MISSING_RECORD: missing, NOT_HELD: notHeld, NEEDS_REVIEW: review },
});
// 기관 i 의 마감 전 공고는 27 - 3i 건(마지막 기관은 0건). 두 번째 기관은 판정을 찾지 못한 2건이 있다.
const WITH_GAPS: MarketOverview = {
  ...OVERVIEW,
  gapOverlay: {
    status: "READY",
    profile: { revision: 9, isDemo: true, name: "가상 회사" },
    openNotices: 233,
    unmatched: 2,
    agencies: Object.fromEntries(
      AGENCIES.slice(0, 9).map((name, index) => {
        const open = 27 - index * 3;
        const eligible = Math.floor(open / 3);
        const missing = Math.floor(open / 5);
        const notHeld = index % 4 === 0 ? 1 : 0;
        const lost = index === 1 ? 2 : 0;
        return [
          name,
          counts(open, [eligible, missing, notHeld, open - eligible - missing - notHeld - lost]),
        ];
      }),
    ),
    categories: {
      SI_SW: counts(197, [61, 44, 3, 89]),
      DATA: counts(93, [0, 31, 0, 62]),
      AI_AX: counts(66, [19, 0, 2, 45]),
      CLOUD: counts(33, [12, 9, 0, 12]),
      SECURITY: counts(23, [0, 0, 0, 23]),
      DIGITAL_TWIN: counts(9, [4, 0, 0, 5]),
    },
  },
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
        gapCopy={GAP_COPY}
      />
    </AppPage>,
  );
  mounted.push(root);
  return host;
}

// 시험 창(1280×720)보다 큰 화면은 줄여 그려지고, 화면 밖은 찍히지 않는다(fullPage 도 빈칸).
// 그래서 줄임이 가장 적은 높이(1280 → 720, 1440 → 810)로 창을 두고 아래로 넘기며 나눠 찍는다.
// 파일 이름의 y 는 그 장의 스크롤 위치(CSS px)다. 증거 폴더에 옮길 때 이 값으로 한 장으로 잇는다.
async function shoot(width: number, name = "market-overview") {
  const height = Math.round((width * 720) / 1280);
  await page.viewport(width, height);
  const max = document.documentElement.scrollHeight - window.innerHeight;
  for (let y = 0; ; y = Math.min(y + height, max)) {
    window.scrollTo(0, y);
    await page.screenshot({
      path: `../../../../test-results/vitest-screenshots/${name}-${width}-y${String(y).padStart(4, "0")}.png`,
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
      .element(page.getByText("기간 선택과 별개로 8. 3. 이후 게시분 중", { exact: false }))
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
    // 회사 프로필이 없으면 겹쳐 보기(행 아래 줄·안내)를 그리지 않는다
    expect(host.querySelectorAll('[data-slot^="market-gap"]')).toHaveLength(0);

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

  it("판정 묶음 겹쳐 보기: 기관·분야 행 아래 마감 전 공고 기준 분포를 글자·아이콘으로 그리고 1440·1280에서 넘치지 않는다", async () => {
    await page.viewport(1440, 900);
    const host = render(WITH_GAPS);
    await expect
      .element(page.getByRole("link", { name: "자격 갭 레이더에서 근거 보기" }))
      .toBeVisible();
    // 행 근처 한 줄: 마감 전 공고 기준·프로필·판정 못 찾은 건수·/gaps 링크
    const note = host.querySelector('[data-slot="market-gap-note"]');
    // 범위가 /gaps(게시 기간 무관 마감 전 전부)와 다르다는 것을 1단계 카드와 같은 말로 밝힌다
    expect(note?.textContent).toContain("기간 내 공고 중 지금 마감이 남은 것(마감 전 공고) 기준");
    expect(note?.textContent).toContain("게시 기간과 무관하게 마감 전 공고 전부");
    expect(note?.textContent).toContain("회사 프로필 r9(가상)");
    expect(note?.textContent).toContain("판정을 찾지 못한 2건은 묶음에서 뺌");
    expect(
      page
        .getByRole("link", { name: "자격 갭 레이더에서 근거 보기" })
        .element()
        .getAttribute("href"),
    ).toBe("/gaps");

    const agencyLines = page
      .getByRole("list", { name: "공고 수 상위 발주기관" })
      .element()
      .querySelectorAll('[data-slot="market-gap-line"]');
    expect(agencyLines).toHaveLength(10);
    // 1위 기관: 마감 전 27건 = 참가 가능 9 + 회사 기록 없음 5 + 미보유 1 + 사람 확인 필요 12, 묶음마다 아이콘과 이름
    expect(agencyLines[0]?.textContent).toBe(
      "마감 전 27건참가 가능(API 기준) 9건회사 기록 없음 5건미보유 1건사람 확인 필요 12건",
    );
    for (const bucket of agencyLines[0]?.querySelectorAll("[data-bucket]") ?? [])
      expect(bucket.querySelector("svg")).not.toBeNull();
    // 0건 묶음은 빼고, 마감 전 공고가 없는 기관은 그렇게 적는다
    expect(agencyLines[1]?.querySelector('[data-bucket="NOT_HELD"]')).toBeNull();
    expect(agencyLines[9]?.textContent).toBe("마감 전 공고 없음");

    const categoryLines = page
      .getByRole("list", { name: "분야별 공고 수" })
      .element()
      .querySelectorAll('[data-slot="market-gap-line"]');
    expect(categoryLines).toHaveLength(7);
    expect(categoryLines[1]?.textContent).toBe(
      "마감 전 93건회사 기록 없음 31건사람 확인 필요 62건",
    );
    expect(categoryLines[6]?.textContent).toBe("마감 전 공고 없음");
    // 예산 구간 행에는 겹치지 않는다
    expect(
      page
        .getByRole("list", { name: "예산 구간별 공고 수" })
        .element()
        .querySelectorAll('[data-slot="market-gap-line"]'),
    ).toHaveLength(0);

    const text = host.textContent ?? "";
    for (const word of ["점유율", "경쟁사", "승률", "확률", "가능성", "수주", "%"])
      expect(text).not.toContain(word);

    for (const width of [1440, 1280]) {
      await page.viewport(width, 900);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        document.documentElement.clientWidth,
      );
      for (const line of host.querySelectorAll('[data-slot^="market-gap"]'))
        expect(line.scrollWidth).toBeLessThanOrEqual(line.clientWidth);
      await shoot(width, "market-b2");
    }
  });

  it("판정 묶음을 읽지 못하면 안내 한 줄만 보이고 행 아래 줄은 그리지 않는다", async () => {
    await page.viewport(1440, 900);
    const host = render({ ...OVERVIEW, gapOverlay: { status: "FAILED" } });
    await expect
      .element(page.getByText("자격 판정 묶음을 불러오지 못해", { exact: false }))
      .toBeVisible();
    expect(host.querySelector('[data-slot="market-gap-note"]')?.textContent).toContain(
      "자격 판정 묶음을 불러오지 못해",
    );
    expect(host.querySelectorAll('[data-slot="market-gap-line"]')).toHaveLength(0);
    expect(
      page.getByRole("list", { name: "공고 수 상위 발주기관" }).element().children,
    ).toHaveLength(10);
  });
});
