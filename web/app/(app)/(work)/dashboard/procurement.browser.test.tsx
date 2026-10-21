import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AppPage } from "@/components/app-page";
import { SOURCE_LABELS } from "@/components/bids/source-badge";
import { OpportunityTable } from "@/components/work/opportunities-table";
import type {
  OpportunityItem,
  OpportunitySummary,
  SourceFamily,
  SourceSummary,
} from "@/server/opportunities";
import { DashboardView } from "./dashboard-view";

// Next의 라우터 런타임은 이 레이아웃 시험 범위 밖이다. 실제 링크 요소와 URL은 유지한다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const mounted: Root[] = [];
const NOW = new Date("2026-10-21T05:00:00.000Z");
const BID: OpportunityItem = {
  id: "00000000-0000-4000-8000-000000000001",
  bidId: "00000000-0000-4000-8000-000000000002",
  revisionId: "00000000-0000-4000-8000-000000000003",
  source: "fixture:lh-notice",
  sourceFamily: "LH",
  sources: [
    {
      bidId: "00000000-0000-4000-8000-000000000002",
      source: "fixture:lh-notice",
      sourceFamily: "LH",
      url: "https://example.com/demo",
    },
  ],
  noticeId: "DEMO-LH-001",
  title: "공공주택 데이터 플랫폼 통합 구축 및 정보시스템 유지보수 사업 (가상)",
  agency: "한국토지주택공사 디지털정보기술사업본부",
  agencyId: null,
  companyId: null,
  stage: "NOTICE",
  status: "OPEN",
  budgetKrw: "0",
  publishedAt: NOW.toISOString(),
  deadlineAt: "2026-10-28T09:00:00.000Z",
  isDemo: true,
  firstSeenAt: NOW.toISOString(),
  categories: ["SI_SW", "DIGITAL_TWIN"],
  relevanceState: "RELEVANT",
  relevanceScore: 80,
  sourceCount: 1,
  latestAnalysis: {
    id: "00000000-0000-4000-8000-000000000004",
    status: "PARTIAL",
    solScore: 0,
    recommendation: "NO_BID",
  },
  latestDecision: null,
  latestDecisionAt: null,
  latestRun: { id: "00000000-0000-4000-8000-000000000007", status: "RUNNING" },
};
const CONFLICT: OpportunityItem = {
  ...BID,
  id: "00000000-0000-4000-8000-000000000008",
  bidId: "00000000-0000-4000-8000-000000000009",
  title: "출처 금액과 일정이 상충하는 입찰공고 (가상)",
  sourceConflict: true,
  budgetKrw: "999000000",
  latestAnalysis: {
    id: "00000000-0000-4000-8000-000000000010",
    status: "COMPLETED",
    solScore: 88,
    recommendation: "BID",
  },
  latestDecision: "WATCH",
};
const EARLY: OpportunityItem = {
  ...BID,
  id: "00000000-0000-4000-8000-000000000005",
  bidId: "00000000-0000-4000-8000-000000000006",
  sourceFamily: "KWATER",
  title: "스마트 물관리 시스템 사전규격 (가상)",
  stage: "PRE_SPEC",
  budgetKrw: null,
  deadlineAt: null,
  latestAnalysis: { ...BID.latestAnalysis!, solScore: 99, recommendation: "BID" },
};
const SUMMARY: OpportunitySummary = {
  generatedAt: NOW.toISOString(),
  origin: "demo",
  isDemo: true,
  newlyDiscovered: 1,
  pendingAnalysis: 0,
  bidRecommended: 0,
  closingSoon: 1,
  portfolio: { BID: 0, WATCH: 0, NO_BID: 1, PENDING: 0 },
  knownBudgetKrw: "0",
  unknownBudgetCount: 0,
  totalOpportunities: 1,
  potentialDuplicateCount: 0,
  earlyCount: 1,
};
const SOURCES: SourceSummary = {
  isDemo: true,
  generatedAt: NOW.toISOString(),
  groups: (["G2B", "KWATER", "LH", "KEPCO"] as SourceFamily[]).map((sourceFamily) => ({
    sourceFamily,
    label: SOURCE_LABELS[sourceFamily],
    services: [],
    healthyServices: 0,
    enabledServices: 0,
    lastSuccessAt: null,
    status: "NOT_CONFIGURED",
  })),
};

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

function render(content: React.ReactNode) {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "calc(100% - 256px)";
  host.style.marginLeft = "256px";
  const root = createRoot(host);
  root.render(content);
  mounted.push(root);
  return host;
}

describe("공공조달 업무 화면", () => {
  it("1280px에서 11열은 표 안에서만 이동하고 LH 배지·0점·early 권고를 정확히 표시한다", async () => {
    await page.viewport(1280, 900);
    const host = render(
      <AppPage title="입찰 공고" contentClassName="max-w-360">
        <OpportunityTable items={[BID, EARLY, CONFLICT]} now={NOW} />
      </AppPage>,
    );
    const region = page.getByRole("region", { name: "입찰 공고 표, 가로 스크롤 가능" });
    await expect
      .element(page.getByText("표를 좌우로 이동해 모든 열을 확인할 수 있습니다."))
      .toBeVisible();
    expect(host.querySelectorAll("th")).toHaveLength(11);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    const scroll = region.element();
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
    const badge = host.querySelector('[data-slot="source-badge"]');
    if (badge === null) throw new Error("출처 배지가 없습니다");
    const text = document.createRange();
    text.selectNodeContents(badge);
    const box = badge.getBoundingClientRect();
    const glyph = text.getBoundingClientRect();
    expect(box.height).toBe(28);
    expect(box.width).toBeGreaterThanOrEqual(76);
    expect(Math.abs((box.left + box.right) / 2 - (glyph.left + glyph.right) / 2)).toBeLessThan(1);
    expect(Math.abs((box.top + box.bottom) / 2 - (glyph.top + glyph.bottom) / 2)).toBeLessThan(3);
    const rows = host.querySelectorAll("tbody tr");
    expect(rows[0]?.querySelectorAll("td")[7]?.textContent).toBe("0");
    expect(rows[1]?.querySelectorAll("td")[7]?.textContent).toBe("—");
    expect(rows[1]?.querySelectorAll("td")[8]?.textContent).toBe("—");
    expect(rows[0]?.querySelectorAll("td")[9]?.textContent).toBe("분석 중");
    expect(rows[2]?.querySelectorAll("td")[5]?.textContent).toBe("확인 필요");
    expect(rows[2]?.querySelectorAll("td")[6]?.textContent).toBe("확인 필요");
    expect(rows[2]?.querySelectorAll("td")[8]?.textContent).toBe("검토 필요");
    expect(rows[2]?.querySelectorAll("td")[10]?.textContent).toBe("WATCH");
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/procurement-bids-demo-1280.png",
      fullPage: true,
    });
    scroll.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0);
  });

  it("1440px의 2열 대시보드는 1280px에서 세로 배치되고 KPI5와 +3px 글자를 유지한다", async () => {
    await page.viewport(1440, 1100);
    render(
      <AppPage title="대시보드" contentClassName="max-w-360" typeScale="dashboard">
        <DashboardView
          summary={{
            ...SUMMARY,
            portfolio: { ...SUMMARY.portfolio, BID: 0, NO_BID: 0 },
            sourceConflictCount: 1,
            unknownBudgetCount: 1,
          }}
          review={[CONFLICT]}
          early={[EARLY]}
          sources={SOURCES}
          reviewQuery="origin=demo"
          earlyQuery="origin=demo&includeEarly=true"
          now={NOW}
          canRunIngestion={false}
          runMode="mock"
        />
      </AppPage>,
    );
    await expect.element(page.getByRole("heading", { name: "우선 검토할 입찰" })).toBeVisible();
    await expect.element(page.getByText("출처 간 확인 필요", { exact: true })).toBeVisible();
    await expect.element(page.getByText("검토 필요", { exact: true })).toBeVisible();
    for (const label of ["신규 발견", "분석 대기", "BID 권고", "마감 임박 (7일)", "수집 상태"])
      await expect.element(page.getByText(label, { exact: true }).first()).toBeVisible();
    const card = (name: string) => {
      const element = page
        .getByRole("heading", { name, exact: true })
        .element()
        .closest('[data-slot="card"]');
      if (element === null) throw new Error(`${name} 카드가 없습니다`);
      return element.getBoundingClientRect();
    };
    expect(Math.abs(card("우선 검토할 입찰").top - card("수집 소스 상태").top)).toBeLessThan(1);
    expect(card("수집 소스 상태").left).toBeGreaterThan(card("우선 검토할 입찰").right);
    expect(
      getComputedStyle(page.getByRole("heading", { name: "대시보드", exact: true }).element())
        .fontSize,
    ).toBe("33px");
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/procurement-dashboard-demo-1440.png",
      fullPage: true,
    });
    await page.viewport(1280, 1100);
    await expect
      .poll(() => card("수집 소스 상태").top)
      .toBeGreaterThan(card("우선 검토할 입찰").bottom);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/procurement-dashboard-demo-1280.png",
      fullPage: true,
    });
  });
});
