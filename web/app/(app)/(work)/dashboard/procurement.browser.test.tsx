import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { AppPage } from "@/components/app-page";
import { SOURCE_LABELS } from "@/components/bids/source-badge";
import { OpportunityTable } from "@/components/work/opportunities-table";
import type {
  OpportunityItem,
  OpportunityLiveMetrics,
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
  changedAt: NOW.toISOString(),
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
  references: [],
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

// 실제 수집 공고(G2B)와 출처 미확인 공고(is_demo=false 인데 source 가 데모 수집기)
const LIVE: OpportunityItem = {
  ...BID,
  id: "00000000-0000-4000-8000-000000000011",
  bidId: "00000000-0000-4000-8000-000000000012",
  source: "g2b-bid-notice",
  sourceFamily: "G2B",
  noticeId: "R25BK01000001",
  title: "실제 수집 입찰공고",
  isDemo: false,
};
const UNVERIFIED: OpportunityItem = {
  ...LIVE,
  id: "00000000-0000-4000-8000-000000000013",
  bidId: "00000000-0000-4000-8000-000000000014",
  source: "fixture",
  title: "출처가 확인되지 않은 공고",
};
const METRICS: OpportunityLiveMetrics = {
  generatedAt: NOW.toISOString(),
  origin: "demo",
  activeWatch: 2,
  topAgencies: [
    { name: "한국토지주택공사 디지털정보기술사업본부 스마트시티사업처", count: 3 },
    { name: "조달청", count: 1 },
  ],
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
    // 공고번호·게시일은 열을 늘리지 않고 제목 칸의 보조 줄로 보이며 칸 밖으로 넘치지 않는다.
    const titleCell = rows[0]?.querySelectorAll("td")[3];
    const meta = titleCell?.querySelector('[data-part="notice-meta"]');
    if (!titleCell || !meta) throw new Error("공고번호·게시일 보조 줄이 없습니다");
    expect(meta.textContent).toBe("DEMO-LH-001 · 게시 10. 21.");
    expect(meta.getBoundingClientRect().right).toBeLessThanOrEqual(
      titleCell.getBoundingClientRect().right,
    );
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/procurement-bids-demo-1280.png",
      fullPage: true,
    });
    scroll.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0);
  });

  it("실제 수집 공고에는 DEMO 배지가 없고, 출처 미확인 공고는 DEMO 대신 출처 미확인으로 보인다", async () => {
    await page.viewport(1280, 900);
    const host = render(<OpportunityTable items={[LIVE, UNVERIFIED, BID]} now={NOW} />);
    await expect.element(page.getByText("실제 수집 입찰공고")).toBeVisible();
    const titleCells = [...host.querySelectorAll("tbody tr")].map(
      (row) => row.querySelectorAll("td")[3],
    );
    const [live, unverified, demo] = titleCells;
    expect(live?.textContent).not.toContain("DEMO");
    expect(live?.querySelector('[data-part="unverified-origin"]')).toBeNull();
    expect(unverified?.textContent).not.toContain("DEMO");
    expect(unverified?.querySelector('[data-part="unverified-origin"]')?.textContent).toBe(
      "출처 미확인",
    );
    expect(demo?.textContent).toContain("DEMO");
    expect(demo?.querySelector('[data-part="unverified-origin"]')).toBeNull();
  });

  it("1440px의 2열 대시보드는 1280px에서 세로 배치되고 숫자 띠 5칸과 +3px 글자를 유지한다", async () => {
    await page.viewport(1440, 1100);
    const host = render(
      <AppPage title="대시보드" contentClassName="max-w-360" typeScale="dashboard">
        <DashboardView
          activeProjects={0}
          summary={{
            ...SUMMARY,
            portfolio: { ...SUMMARY.portfolio, BID: 0, NO_BID: 0 },
            sourceConflictCount: 1,
            unknownBudgetCount: 1,
            potentialDuplicateCount: 2,
          }}
          metrics={METRICS}
          nextIngest={{ at: "2026-10-21T06:00:00.000Z", failed: false }}
          review={[CONFLICT]}
          early={[EARLY]}
          sources={{
            ...SOURCES,
            groups: SOURCES.groups.map((group) =>
              group.sourceFamily === "G2B"
                ? { ...group, lastSuccessAt: "2026-10-21T04:30:00.000Z" }
                : group,
            ),
          }}
          reviewQuery="origin=demo"
          earlyQuery="origin=demo&includeEarly=true"
          now={NOW}
          canRunIngestion={false}
        />
      </AppPage>,
    );
    await expect.element(page.getByRole("heading", { name: "우선 검토할 입찰" })).toBeVisible();
    await expect.element(page.getByText("출처 간 확인 필요", { exact: true })).toBeVisible();
    await expect.element(page.getByText("검토 필요", { exact: true })).toBeVisible();
    // 업무 대시보드에는 카드 상자가 없다(2026-10-26 AI 티 걷어내기 수용 기준 2).
    expect(host.querySelectorAll('[data-slot="card"]')).toHaveLength(0);
    // 공공조달 요약은 한 줄 숫자 띠다. 칸마다 라벨·값·보조 줄이 있고 값은 +3px 제목 글자(33px)다.
    const strip = page.getByRole("region", { name: "공공조달 요약" });
    const figure = (label: string) => {
      const element = strip.getByText(label, { exact: true }).element().parentElement;
      if (element === null) throw new Error(`${label} 칸이 없습니다`);
      return element;
    };
    const figures: [string, string, string][] = [
      ["신규 발견", "1", "최근 24시간 · 입찰공고"],
      ["마감 임박 (7일)", "1", "정확한 마감 확인 · 진행 중"],
      ["분석 대기", "0", "현재 입력의 분석 결과 없음"],
      ["BID 권고", "0", "현재 유효 분석 · 진행 중"],
      ["진행 중 입찰 프로젝트", "0", "종료 제외 · 프로젝트 보기"],
    ];
    for (const [label] of figures)
      await expect.element(strip.getByText(label, { exact: true })).toBeVisible();
    const sameRow = () => {
      const tops = figures.map(([label]) => figure(label).getBoundingClientRect().top);
      return Math.max(...tops) - Math.min(...tops);
    };
    for (const [label, value, hint] of figures) {
      const [, valueCell, hintCell] = figure(label).children;
      if (!valueCell || !hintCell) throw new Error(`${label} 칸의 값·보조 줄이 없습니다`);
      expect(valueCell.textContent).toBe(value);
      expect(hintCell.textContent).toBe(hint);
      expect(getComputedStyle(valueCell).fontSize).toBe("33px");
    }
    expect(sameRow()).toBeLessThan(1);
    expect(
      strip.getByRole("link", { name: "종료 제외 · 프로젝트 보기" }).element().getAttribute("href"),
    ).toBe("/projects");
    // 중복 후보 안내는 "우선 검토할 입찰" 설명 줄 끝의 회색 글자다.
    const duplicate = page.getByText(/중복 후보 2건은 별도 사업기회로 집계됩니다\.$/).element();
    expect(duplicate.className).toContain("text-muted-foreground");
    expect(duplicate.closest("section")?.querySelector("h2")?.textContent).toBe("우선 검토할 입찰");
    // 실수집 지표(B3): 시각은 KST 절대 시각, 다음 수집은 "예정"으로 적는다.
    const stat = (label: string) => {
      const element = page
        .getByRole("region", { name: "수집 지표" })
        .getByText(label, { exact: true })
        .element().parentElement;
      if (element === null) throw new Error(`${label} 줄이 없습니다`);
      return element;
    };
    expect(stat("전체 수집 공고").textContent).toContain("1");
    expect(stat("진행 중 WATCH").textContent).toContain("2");
    expect(stat("마지막 수집 성공").textContent).toBe("마지막 수집 성공13:302026-10-21 KST");
    expect(stat("다음 수집 예정").textContent).toBe("다음 수집 예정15:002026-10-21 KST · 예정");
    const section = (name: string) => {
      const element = page.getByRole("heading", { name, exact: true }).element().closest("section");
      if (element === null) throw new Error(`${name} 구역이 없습니다`);
      return element;
    };
    const agencies = section("기관별 공고 수");
    expect([...agencies.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "한국토지주택공사 디지털정보기술사업본부 스마트시티사업처3건",
      "조달청1건",
    ]);
    const box = (name: string) => section(name).getBoundingClientRect();
    expect(Math.abs(box("우선 검토할 입찰").top - box("수집 지표").top)).toBeLessThan(1);
    expect(box("수집 지표").left).toBeGreaterThan(box("우선 검토할 입찰").right);
    expect(box("수집 소스 상태").left).toBeGreaterThan(box("우선 검토할 입찰").right);
    expect(box("수집 소스 상태").top).toBeGreaterThan(box("수집 지표").bottom);
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
      .poll(() => box("수집 소스 상태").top)
      .toBeGreaterThan(box("우선 검토할 입찰").bottom);
    expect(box("수집 지표").top).toBeGreaterThan(box("예정 사업 및 사전규격").bottom);
    // 1280px 에서도 숫자 띠는 한 줄 5칸이다.
    expect(sameRow()).toBeLessThan(1);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    // 긴 기관 이름은 구역 안에서 말줄임한다(1280px).
    const agencyName = agencies.querySelector("li span");
    if (agencyName === null) throw new Error("기관 이름이 없습니다");
    expect(agencyName.getBoundingClientRect().right).toBeLessThanOrEqual(
      agencies.getBoundingClientRect().right,
    );
    await page.screenshot({
      path: "../../../../test-results/vitest-screenshots/procurement-dashboard-demo-1280.png",
      fullPage: true,
    });
  });

  it("수집 주기를 모르면 다음 수집 예정을 숨기고, 지표 조회 실패는 값을 만들지 않는다", async () => {
    await page.viewport(1280, 900);
    render(
      <DashboardView
        activeProjects={0}
        summary={{ ...SUMMARY, origin: "live", isDemo: false }}
        metrics={null}
        nextIngest={null}
        review={[]}
        early={[]}
        sources={SOURCES}
        reviewQuery="origin=live"
        earlyQuery="origin=live&includeEarly=true"
        now={NOW}
        canRunIngestion={false}
      />,
    );
    const metrics = page.getByRole("region", { name: "수집 지표" });
    await expect.element(metrics.getByText("마지막 수집 성공", { exact: true })).toBeVisible();
    expect(metrics.element().textContent).not.toContain("다음 수집 예정");
    expect(metrics.element().textContent).toContain("성공 기록 없음");
    // 진행 중 WATCH 줄과 기관별 공고 수 구역 둘 다 값을 만들지 않고 실패를 알린다.
    expect(metrics.getByText("지표 조회 실패", { exact: true }).elements()).toHaveLength(1);
    expect(page.getByText("지표 조회 실패", { exact: true }).elements()).toHaveLength(2);
    expect(document.body.textContent).not.toContain("DEMO · 예시 공고 기준");
  });
});
