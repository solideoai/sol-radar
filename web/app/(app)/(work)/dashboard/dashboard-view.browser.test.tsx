import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { BID_LIST } from "@/components/bids/test-data";
import { useTopbarStore } from "@/components/topbar-status";
import type { BidListItem, DashboardSummary } from "@/server/bids";
import { DashboardView } from "./dashboard-view";

// /dashboard 본문을 진짜 브라우저에 그린다. 화면(page.tsx)은 데이터를 읽어 이 부품에 넘기기만 한다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, title, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} className={className} title={title} aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
}));

const NOW = new Date("2026-10-19T00:00:00Z");

const SUMMARY: DashboardSummary = {
  generatedAt: NOW.toISOString(),
  dataFreshness: {
    lastIngestAt: "2026-10-18T23:48:00Z",
    lastIngestStatus: "SUCCEEDED",
    isDemo: true,
    lastIngestSummary: {
      created: 19,
      changed: 0,
      cancelled: 0,
      skippedDuplicate: 0,
      quarantined: 1,
      retried: 0,
    },
  },
  ai: { provider: "mock", kevEnabled: true, lastGatewayCheckAt: null, healthy: true },
  bids: {
    total: 19,
    byStage: { PLAN: 2, PRE_SPEC: 3, NOTICE: 14 },
    byStatus: { OPEN: 17, AMENDED: 1, CANCELLED: 1, CLOSED: 0 },
    deadlineWithin7Days: 4,
  },
  analyses: {
    total: 18,
    byRecommendation: { BID: 3, WATCH: 9, NO_BID: 6 },
    partial: 0,
    withReviewFlags: 5,
    latestByStatus: { completed: 18, partial: 0, failed: 0 },
  },
  reviews: { pending: 16, byDecision: { BID: 1, WATCH: 0, NO_BID: 1 }, disagreementWithSystem: 0 },
  upcoming: [],
  unreadNotifications: 2,
};

const mounted: Root[] = [];
beforeEach(() => useTopbarStore.getState().reset());
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

type ViewProps = React.ComponentProps<typeof DashboardView>;
const render = (overrides: Partial<ViewProps> = {}, width = 960) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  host.setAttribute("data-type-scale", "dashboard");
  const root = createRoot(host);
  const props: ViewProps = {
    summary: SUMMARY,
    recommended: BID_LIST.slice(0, 3),
    recommendedTotal: 3,
    deadline: BID_LIST.slice(1, 3),
    now: NOW,
    canRunIngestion: false,
    ...overrides,
  };
  flushSync(() => root.render(<DashboardView {...props} />));
  mounted.push(root);
  return host;
};

const cardValues = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-slot="card"][data-size="sm"]')].map((card) =>
    [...card.querySelectorAll("p")].map((p) => p.textContent),
  );

describe("DashboardView", () => {
  it("요약 카드 5개에 S2 값을 보인다", () => {
    const host = render();
    expect(cardValues(host)).toEqual([
      ["BID 권고", "3"],
      ["검토 대기", "16"],
      ["마감 임박 (7일)", "4"],
      ["수집", "12분 전", "적재 19 · 격리 1"],
      ["분석 현황 (완료)", "18", "부분 0 · 실패 0"],
    ]);
  });

  // M4: "BID 권고" 카드는 아래 BID 표·전체 보기와 같은 정의(진행 중 공고의 최신 점수 권고 BID)의 건수다.
  // 요약의 byRecommendation(모든 상태·최신 끝난 분석 기준)과 다를 수 있어 카드는 그 값을 쓰지 않는다.
  it("BID 권고 카드는 표와 같은 조건의 건수를 보인다", () => {
    const host = render({
      summary: {
        ...SUMMARY,
        analyses: { ...SUMMARY.analyses, byRecommendation: { BID: 5, WATCH: 7, NO_BID: 6 } },
      },
      recommendedTotal: 4,
    });
    expect(cardValues(host)[0]).toEqual(["BID 권고", "4"]);
  });

  it("마지막 수집이 실패면 수집 카드 값이 실패이고 위험 색이다", () => {
    const host = render({
      summary: {
        ...SUMMARY,
        dataFreshness: { ...SUMMARY.dataFreshness, lastIngestStatus: "FAILED" },
      },
    });
    const card = host.querySelectorAll('[data-slot="card"][data-size="sm"]')[3];
    const value = card.querySelectorAll("p")[1];
    expect(value.textContent).toBe("실패");
    expect(value.className).toContain("text-destructive");
  });

  it("수집 기록이 없으면 값은 —, 힌트는 수집 기록 없음이다", () => {
    const host = render({
      summary: {
        ...SUMMARY,
        dataFreshness: {
          ...SUMMARY.dataFreshness,
          lastIngestAt: null,
          lastIngestStatus: null,
          lastIngestSummary: null,
        },
      },
    });
    expect(cardValues(host)[3]).toEqual(["수집", "—", "수집 기록 없음"]);
  });

  it("분석이 0건이면 분석 현황 힌트가 분석 기록 없음이다", () => {
    const host = render({
      summary: {
        ...SUMMARY,
        analyses: {
          ...SUMMARY.analyses,
          total: 0,
          latestByStatus: { completed: 0, partial: 0, failed: 0 },
        },
      },
    });
    expect(cardValues(host)[4]).toEqual(["분석 현황 (완료)", "0", "분석 기록 없음"]);
  });

  it("BID 권고 표는 받은 순서(점수 높은 순)대로 그리고, 전체 보기는 같은 조건의 목록으로 간다", async () => {
    render();
    const table = page.getByRole("table", { name: "BID 권고 (점수 높은 순)" });
    await expect.element(table).toBeVisible();
    const scores = [...table.element().querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelectorAll("td")[3].textContent,
    );
    expect(scores).toEqual(["94", "72", "68"]);
    const all = page.getByRole("link", { name: "BID 권고 전체 보기" });
    await expect.element(all).toHaveAttribute("href", "/bids?recommendation=BID&sort=score%3Adesc");
    await expect
      .element(page.getByRole("link", { name: "마감 임박 전체 보기" }))
      .toHaveAttribute("href", "/bids?sort=deadlineAt%3Aasc");
  });

  it("재분석 중인 공고는 끝난 분석의 점수·권고를 보이고 '재분석 중'을 붙인다(미결정 30-8)", async () => {
    const base = BID_LIST[0];
    const rerunning: BidListItem = {
      ...base,
      latestAnalysis: {
        ...(base.latestAnalysis as NonNullable<BidListItem["latestAnalysis"]>),
        id: "run-rerun",
        status: "RUNNING",
        solScore: null,
        recommendation: null,
        recommendationBasis: null,
      },
    };
    const rowsOf = () =>
      [
        ...page
          .getByRole("table", { name: "BID 권고 (점수 높은 순)" })
          .element()
          .querySelectorAll("tbody tr"),
      ].map((tr) => [...tr.querySelectorAll("td")].map((td) => td.textContent));
    // 값이 없으면 칸은 최신 run(진행 중)이라 "—"다. 이것이 고치기 전 모습이다.
    render({ recommended: [rerunning, BID_LIST[1]] });
    expect(rowsOf()[0]?.slice(3)).toEqual(["—", "—"]);
    mounted.splice(0).forEach((root) => root.unmount());
    document.body.replaceChildren();

    const host = render({
      recommended: [rerunning, BID_LIST[1]],
      recommendedFinished: {
        [rerunning.id]: { solScore: 94, recommendation: "BID", rerunning: true },
      },
    });
    const [first, second] = rowsOf();
    expect(first?.slice(3)).toEqual(["94", "BID재분석 중"]);
    expect(second?.join("")).not.toContain("재분석 중");
    // 960px 에서도 권고 칸 안에 든다.
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  });

  it("권고·마감 임박 표가 비면 각 자리에 빈 상태 글을 보인다", async () => {
    render({ recommended: [], deadline: [] });
    await expect.element(page.getByText("BID 권고 공고가 없습니다")).toBeVisible();
    await expect.element(page.getByText("7일 안에 마감되는 공고가 없습니다")).toBeVisible();
    expect(page.getByRole("table").query()).toBeNull();
  });

  const noBids = { ...SUMMARY, bids: { ...SUMMARY.bids, total: 0 } };

  it("공고가 0건이면 표 두 개 대신 빈 상태 하나를 보인다", async () => {
    render({ summary: noBids, recommended: [], deadline: [] });
    await expect.element(page.getByText("아직 수집된 공고가 없습니다")).toBeVisible();
    expect(page.getByText("BID 권고 공고가 없습니다").query()).toBeNull();
    expect(page.getByRole("table").query()).toBeNull();
  });

  it("ADMIN(canRunIngestion)이면 공고 0건 빈 상태에 [수집 실행] 단추가 /admin/ingestion 으로 가고 요청 문구는 없다", async () => {
    render({ summary: noBids, recommended: [], deadline: [], canRunIngestion: true });
    await expect.element(page.getByText("아직 수집된 공고가 없습니다")).toBeVisible();
    const action = page.getByRole("link", { name: "수집 실행", exact: true });
    await expect.element(action).toHaveAttribute("href", "/admin/ingestion");
    // 버튼 모양(outline, 기본 36px)의 링크다
    expect(action.element().getBoundingClientRect().height).toBe(36);
    expect(page.getByText("관리자에게 수집을 요청하세요").query()).toBeNull();
  });

  it("ADMIN 이 아니면 공고 0건 빈 상태에 단추 없이 '관리자에게 수집을 요청하세요'를 보인다", async () => {
    render({ summary: noBids, recommended: [], deadline: [], canRunIngestion: false });
    await expect.element(page.getByText("관리자에게 수집을 요청하세요")).toBeVisible();
    expect(page.getByRole("link", { name: "수집 실행" }).query()).toBeNull();
    expect(page.getByRole("button", { name: "수집 실행" }).query()).toBeNull();
    expect(document.querySelector('a[href="/admin/ingestion"]')).toBeNull();
  });

  it("상단바 AI 가 unavailable 일 때만 09 고정 PARTIAL 배너를 카드 위에 보인다", async () => {
    const host = render();
    const text =
      "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)";
    expect(page.getByText(text).query()).toBeNull();
    useTopbarStore.setState({ ai: "unavailable" });
    const banner = page.getByRole("status").filter({ hasText: text });
    await expect.element(banner).toBeVisible();
    const firstCard = host.querySelector('[data-slot="card"]') as HTMLElement;
    expect(banner.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      firstCard.getBoundingClientRect().top,
    );
    expect(banner.element().className).toContain("border-warning");
  });
});

// 대시보드 본문 폭(1280·펼침 960, 1440·펼침 1120, 1440·접힘 1376). +3px 글자에서 잰다.
// 두 표는 늘 위아래로 쌓는다(dashboard-view 머리 주석).
describe("DashboardView 폭", () => {
  const WIDEST: BidListItem = {
    ...BID_LIST[1],
    id: "bid-widest",
    agency: "한국지능정보사회진흥원 아주 긴 기관 이름",
    latestAnalysis: {
      ...(BID_LIST[1].latestAnalysis as NonNullable<BidListItem["latestAnalysis"]>),
      status: "PARTIAL",
      solScore: 100,
      recommendation: "WATCH",
    },
    latestReview: { decision: "NO_BID", decidedAt: "2026-10-16T02:00:00Z", reviewerName: "김영업" },
  };

  it.each([960, 1120, 1376])("%ipx 에서 가로로 넘치지 않고 카드 5개가 한 줄이다", (width) => {
    const host = render(
      { recommended: [WIDEST, ...BID_LIST], deadline: [WIDEST, ...BID_LIST] },
      width,
    );
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    const overflowing = [...host.querySelectorAll("*")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.right > host.getBoundingClientRect().right + 0.5;
    });
    expect(overflowing.map((el) => el.tagName)).toEqual([]);
    const tops = [...host.querySelectorAll('[data-slot="card"][data-size="sm"]')].map((card) =>
      Math.round(card.getBoundingClientRect().top),
    );
    expect(tops).toHaveLength(5);
    expect(new Set(tops).size).toBe(1);
  });

  it.each([960, 1120, 1376])(
    "%ipx 에서 두 표는 위아래로 쌓이고 폭이 본문과 같다",
    async (width) => {
      const host = render({}, width);
      const [top, bottom] = [
        page.getByRole("table", { name: "BID 권고 (점수 높은 순)" }),
        page.getByRole("table", { name: "마감 임박 (7일)" }),
      ].map((t) =>
        (t.element().closest('[data-slot="card"]') as HTMLElement).getBoundingClientRect(),
      );
      expect(bottom.top).toBeGreaterThanOrEqual(top.bottom);
      expect(Math.round(top.width)).toBe(Math.round(host.getBoundingClientRect().width));
      expect(Math.round(bottom.width)).toBe(Math.round(top.width));
    },
  );
});
