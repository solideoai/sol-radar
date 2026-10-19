import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEvidenceStore } from "@/components/bids/evidence-store";
import {
  BID_DOCUMENTS,
  BID_LIST,
  FX01_PARTIAL_VIEW,
  FX01_VIEW,
  FX02_VIEW,
  FX03_VIEW,
  REVIEWS_FX01,
} from "@/components/bids/test-data";
import type { AnalysisView } from "@/server/bids";
import { BidDetailView, type AnalysisHistoryRow, type DetailBid } from "./bid-detail-view";
import Loading from "./loading";
import BidNotFound from "./not-found";

// /bids/[id] 본문을 진짜 브라우저에 그린다. 화면(page.tsx)은 데이터를 읽어 이 부품에 넘기기만 한다.
// 1280px·사이드바 펼침이면 본문 960px(주 영역 616 + 간격 24 + 레일 320), 1440px 이면 1120px(776 + 24 + 320)이다(스펙 §3.2·§5.4).
// 시험 상자 폭 = 화면 폭 - 사이드바 256px. 그 안에서 AppPage 가 좌우 32px 여백을 둔다.

const spies = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    router: { refresh, push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
    refresh,
    topbar: vi.fn(() => Promise.resolve()),
    toast: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => spies.router }));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: spies.topbar }));
vi.mock("sonner", () => ({ toast: spies.toast }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} className={className} aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
}));

const BID_ID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
const NOW = "2026-10-16T03:00:00Z";
const MEMBERS = [
  { id: "user-sales", name: "김영업" },
  { id: "user-analyst", name: "이분석" },
];

const detail = (overrides: Partial<DetailBid> = {}): DetailBid => ({
  ...BID_LIST[1]!,
  id: BID_ID,
  noticeId: "DEMO-2026-0002",
  source: "fixture",
  content: "경기도교육청 통합 LMS 구축 사업. 요구기술: Java, Spring Boot, React.",
  documents: BID_DOCUMENTS,
  stageLinks: { planRef: null, preSpecRef: "PRESPEC-2026-000456" },
  extractionStatus: "COMPLETED",
  latestAnalysis: null,
  reviews: [],
  ...overrides,
});

const historyOf = (
  ...views: AnalysisView[]
): { items: AnalysisHistoryRow[]; hasMore: boolean } => ({
  items: views.map((view) => ({
    id: view.id,
    status: view.status,
    at: view.finishedAt ?? view.queuedAt,
    solScore: view.solScore,
    recommendation: view.recommendation,
    runMode: view.runMode,
    errorCode: view.errorCode,
  })),
  hasMore: false,
});

type ViewProps = React.ComponentProps<typeof BidDetailView>;
const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  bid: detail(),
  previousScored: null,
  history: historyOf(),
  assessmentLabels: {},
  members: MEMBERS,
  currentUserId: "user-sales",
  canAnalyze: true,
  canDecide: true,
  backHref: "/bids",
  now: NOW,
  ...overrides,
});

const mounted: Root[] = [];
const render = (overrides: Partial<ViewProps> = {}, width = 1024) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(<BidDetailView {...props(overrides)} />));
  mounted.push(root);
  return { host, root };
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(async () => {
  await page.viewport(1280, 900);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  spies.refresh.mockReset();
  spies.topbar.mockClear();
  spies.toast.mockReset();
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  useEvidenceStore.setState({ open: false, context: null });
  vi.unstubAllGlobals();
});

const analyzeButton = () =>
  page.getByRole("button", { name: /분석 실행|재분석|분석 요청 중|분석 중/ });
const decisionButton = () => page.getByRole("button", { name: "결정 기록" });
const text = (host: HTMLElement) => host.textContent ?? "";

describe("BidDetailView 버튼과 권한(스펙 §5.4.1·§5.4.10)", () => {
  it("FX-02 미분석이면 [분석 실행]이 default 이고 결정 기록은 outline 이다", async () => {
    render();
    const analyze = page.getByRole("button", { name: "분석 실행" });
    await expect.element(analyze).toBeEnabled();
    expect(analyze.element().className).toContain("bg-primary");
    expect(decisionButton().element().className).not.toContain("bg-primary");
    expect(decisionButton().element().className).toContain("border-border");
    await expect.element(page.getByText("아직 분석하지 않았습니다")).toBeVisible();
    // ⑤~⑦은 그리지 않는다(빈 구역 대신 한 빈 상태로 묶는다).
    expect(page.getByText("SOL Score 분해").elements()).toHaveLength(0);
    expect(page.getByText("Kev 참고 지표").elements()).toHaveLength(0);
    // 첨부 상태는 공고 데이터라 미분석이어도 보인다(S7).
    await expect.element(page.getByRole("heading", { name: "첨부 상태" })).toBeVisible();
  });

  it("분석이 있으면 [재분석]은 outline 이고 [결정 기록]이 default 다", async () => {
    render({ bid: detail({ latestAnalysis: FX02_VIEW }) });
    const reanalyze = page.getByRole("button", { name: "재분석" });
    expect(reanalyze.element().className).not.toContain("bg-primary");
    expect(decisionButton().element().className).toContain("bg-primary");
  });

  it("VIEWER 면 분석 버튼이 비활성이고 이유를 보이는 글자로 둔다", async () => {
    render({ canAnalyze: false, canDecide: false });
    await expect.element(analyzeButton()).toBeDisabled();
    await expect
      .element(page.getByText("분석 요청은 ADMIN·SALES·ANALYST 역할만 할 수 있습니다"))
      .toBeVisible();
    await expect
      .element(page.getByText("결정은 ADMIN·SALES 역할만 기록할 수 있습니다"))
      .toBeVisible();
    await expect.element(decisionButton()).toBeDisabled();
  });

  it("ANALYST 는 분석은 되고 결정은 읽기 전용이다", async () => {
    render({ canAnalyze: true, canDecide: false });
    await expect.element(analyzeButton()).toBeEnabled();
    await expect.element(decisionButton()).toBeDisabled();
  });

  it("취소 공고는 분석·결정 버튼이 모두 비활성이고 취소 배너를 보인다", async () => {
    render({ bid: detail({ status: "CANCELLED", latestAnalysis: FX02_VIEW }) });
    await expect.element(analyzeButton()).toBeDisabled();
    await expect.element(decisionButton()).toBeDisabled();
    await expect
      .element(page.getByText("이 공고는 취소되었습니다. 기존 분석·결정 기록은 보존됩니다"))
      .toBeVisible();
  });
});

describe("BidDetailView 상단 요약(스펙 §5.4.1)", () => {
  it("뒤로 링크는 받은 목록 주소로 가고 요약 두 줄과 원문 링크를 보인다", async () => {
    const { host } = render({ backHref: "/bids?sort=score%3Adesc" });
    const back = page.getByRole("link", { name: "공고 목록" });
    await expect.element(back).toHaveAttribute("href", "/bids?sort=score%3Adesc");
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("경기도교육청 통합 LMS 구축 (가상)");
    expect(text(host)).toContain("발주기관 경기도교육청");
    expect(text(host)).toContain("예산 2,800,000,000원");
    expect(text(host)).toContain("마감 2026-10-31 18:00 (D-15)");
    expect(text(host)).toContain("공고번호 DEMO-2026-0002");
    expect(text(host)).toContain("revision 1");
    expect(text(host)).toContain("출처 fixture");
    const original = page.getByRole("link", { name: "원문 보기 (새 탭)" });
    await expect.element(original).toHaveAttribute("target", "_blank");
    await expect.element(original).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("live 공고는 DEMO 없이 나라장터 출처와 '실제 공고 × 가상 회사 프로필'을 보인다", async () => {
    const live = { ...FX01_VIEW, runMode: "live" as const };
    const { host } = render({
      bid: detail({
        isDemo: false,
        origin: "live",
        source: "g2b-bid-notice",
        noticeId: "R26BK00000001",
        latestAnalysis: live,
      }),
    });
    expect(text(host)).not.toContain("DEMO");
    expect(text(host)).toContain("출처 나라장터 입찰공고 (g2b-bid-notice)");
    expect(text(host)).toContain("분석 실행 모드: live");
    expect(text(host)).toContain("가상 회사 프로필로 분석");
    expect(text(host)).toContain("실제 공고 × 가상 회사 프로필");
  });

  it("첨부 다운로드 링크를 그리지 않는다(라우트가 없어 죽은 링크가 된다)", () => {
    const withPath = BID_DOCUMENTS.map((doc) => ({
      ...doc,
      downloadPath: `/api/v1/bids/${BID_ID}/documents/${doc.id}/download`,
    }));
    const { host } = render({ bid: detail({ documents: withPath, latestAnalysis: FX01_VIEW }) });
    expect(host.querySelectorAll('a[href*="/documents/"]')).toHaveLength(0);
  });
});

describe("BidDetailView 분석 결과(스펙 §5.4.2~§5.4.8)", () => {
  it("FX-01: 띠·자격·점수 분해·Kev·근거를 06 순서로 그린다", async () => {
    const { host } = render({
      bid: detail({ latestAnalysis: FX01_VIEW, reviews: REVIEWS_FX01 }),
      history: historyOf(FX01_VIEW, FX01_PARTIAL_VIEW),
    });
    const headings = Array.from(host.querySelectorAll("main h2")).map((h) => h.textContent ?? "");
    const order = ["단계 이력", "필수자격", "SOL Score 분해", "Kev 참고 지표", "근거 인용"].map(
      (name) => headings.findIndex((h) => h.startsWith(name)),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text(host)).toContain("분석 실행 모드: fixture");
    expect(text(host)).toContain("AI: mock");
    expect(text(host)).toContain("알고리즘 sol-v0.1.0 · 프로필 rev 2");
    expect(text(host)).toContain("규칙 권고와 같음");
    expect(text(host)).toContain("마지막 결정: BID · 김영업");
    await expect.element(page.getByText("분석 이력 2건")).toBeVisible();
  });

  it("분석 이력은 펼치면 최신 위로 시각·상태·점수·권고·분석 실행 모드를 보인다", async () => {
    const failed: AnalysisView = {
      ...FX02_VIEW,
      id: "run-failed",
      status: "FAILED",
      solScore: null,
      recommendation: null,
      errorCode: "ANALYSIS_RUN_SUPERSEDED",
      finishedAt: "2026-10-16T02:00:00Z",
    };
    render({
      bid: detail({ latestAnalysis: FX02_VIEW }),
      history: historyOf(FX02_VIEW, failed),
    });
    await userEvent.click(page.getByText("분석 이력 2건"));
    const rows = page.getByRole("table", { name: "분석 이력" }).getByRole("row");
    await expect
      .element(rows.nth(1))
      .toHaveTextContent(/2026-10-16 09:00.*완료.*72.*WATCH.*fixture/);
    await expect.element(rows.nth(2)).toHaveTextContent(/실패.*ANALYSIS_RUN_SUPERSEDED/);
  });

  it("이력을 읽지 못했으면 띠에 그 사실만 적고 화면은 그린다", async () => {
    render({ bid: detail({ latestAnalysis: FX02_VIEW }), history: null });
    await expect.element(page.getByText("분석 이력을 불러오지 못했습니다")).toBeVisible();
    await expect.element(page.getByRole("heading", { name: /필수자격/ })).toBeVisible();
  });

  it("이력이 1건이면 이력 펼침이 없다", () => {
    const { host } = render({
      bid: detail({ latestAnalysis: FX02_VIEW }),
      history: historyOf(FX02_VIEW),
    });
    expect(host.querySelector("details summary")?.textContent ?? "").not.toContain("분석 이력");
  });

  it("FAILED(ANALYSIS_RUN_SUPERSEDED)는 실패 배너와 코드, 빈 결과를 보이고 레일은 직전 점수 run 을 쓴다", async () => {
    const failed: AnalysisView = {
      ...FX02_VIEW,
      id: "run-failed",
      status: "FAILED",
      solScore: null,
      recommendation: null,
      qualification: { status: "NEEDS_REVIEW", checks: [] },
      scoreBreakdown: [],
      errorCode: "ANALYSIS_RUN_SUPERSEDED",
    };
    const { host } = render({
      bid: detail({ latestAnalysis: failed }),
      previousScored: FX02_VIEW,
      history: historyOf(failed, FX02_VIEW),
    });
    await expect.element(page.getByText("분석에 실패했습니다.")).toBeVisible();
    expect(text(host)).toContain("ANALYSIS_RUN_SUPERSEDED");
    await expect.element(page.getByText("분석 결과가 없습니다")).toBeVisible();
    expect(page.getByText("SOL Score 분해").elements()).toHaveLength(0);
    // 결정은 직전 점수 run(FX-02 WATCH) 기준이다(§5.4.10).
    await expect.element(page.getByRole("radio", { name: "WATCH" })).toBeChecked();
    // 실패 배너의 [재분석] + 상단 [재분석]
    expect(page.getByRole("button", { name: "재분석" }).elements()).toHaveLength(2);
  });

  it("PARTIAL 은 09 고정 AI 불가 배너와 Kev '사용 불가'를 보인다", async () => {
    const { host } = render({ bid: detail({ latestAnalysis: FX01_PARTIAL_VIEW }) });
    await expect
      .element(
        page.getByText(
          "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)",
        ),
      )
      .toBeVisible();
    expect(text(host)).toContain("사용 불가");
  });

  it("kev_assist 가 비어 기록이 없는 run 은 Kev 구역에 '기록 없음'을 쓴다", async () => {
    const unrecorded: AnalysisView = {
      ...FX02_VIEW,
      reviewFlags: [],
      kev: { ...FX01_PARTIAL_VIEW.kev },
    };
    const { host } = render({ bid: detail({ latestAnalysis: unrecorded }) });
    expect(text(host)).toContain("기록 없음");
    expect(text(host)).not.toContain("사용 안 함");
  });

  it("Kev v0.2 항목별 분포는 넘겨받은 항목 문구를 쓴다", async () => {
    const v02: AnalysisView = {
      ...FX01_VIEW,
      kev: { ...FX01_VIEW.kev, questionSetVersion: "kev-qs/v0.2" },
    };
    render({
      bid: detail({ latestAnalysis: v02 }),
      assessmentLabels: { "qualifications[0]": "소프트웨어사업자 신고" },
    });
    await userEvent.click(page.getByText("항목별 분포 1건"));
    await expect.element(page.getByRole("cell", { name: "소프트웨어사업자 신고" })).toBeVisible();
  });

  it("근거 버튼은 근거 서랍을 연다", async () => {
    render({ bid: detail({ latestAnalysis: FX01_VIEW }) });
    await userEvent.click(page.getByRole("button", { name: "근거 p.3" }).first());
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.element(page.getByRole("dialog")).toHaveTextContent("소프트웨어사업자 신고 업체");
  });
});

describe("BidDetailView 결정(스펙 §5.4.9)", () => {
  it("analysis.id 가 바뀌어 다시 그리면 라디오 기본값이 새 권고다(P2)", async () => {
    const { root } = render({ bid: detail({ latestAnalysis: FX01_VIEW }) });
    await expect.element(page.getByRole("radio", { name: "BID", exact: true })).toBeChecked();
    flushSync(() =>
      root.render(<BidDetailView {...props({ bid: detail({ latestAnalysis: FX02_VIEW }) })} />),
    );
    await expect.element(page.getByRole("radio", { name: "WATCH" })).toBeChecked();
  });

  it("결정 기록이 201 이면 토스트를 띄우고 다시 그리며 상단바를 읽는다", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "r" }), { status: 201 }));
    render({ bid: detail({ latestAnalysis: FX02_VIEW }) });
    await userEvent.fill(
      page.getByRole("textbox", { name: "사유" }),
      "일정 위험이 있어 지켜봅니다.",
    );
    await userEvent.click(decisionButton());
    await vi.waitFor(() => expect(spies.toast).toHaveBeenCalledWith("결정을 기록했습니다"));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/v1/bids/${BID_ID}/reviews`);
    expect(JSON.parse(String(init?.body))).toMatchObject({
      decision: "WATCH",
      scoreRunId: FX02_VIEW.id,
    });
    expect(spies.refresh).toHaveBeenCalledTimes(1);
    expect(spies.topbar).toHaveBeenCalledTimes(1);
  });
});

describe("BidDetailView 분석 실행(스펙 §5.4.2 흐름)", () => {
  it("[분석 실행] → 202 이면 버튼이 잠기고 ④~⑦·레일 위가 skeleton 이며 상태를 한 곳에서 읽는다", async () => {
    fetchMock.mockImplementation(async (_input, init) =>
      init?.method === "POST"
        ? new Response(
            JSON.stringify({
              analysisId: "run-new",
              status: "QUEUED",
              deduplicated: false,
              pollUrl: "/api/v1/analyses/run-new",
            }),
            { status: 202 },
          )
        : new Response(JSON.stringify({ id: "run-new", status: "RUNNING" }), { status: 200 }),
    );
    const { host } = render({ bid: detail({ latestAnalysis: FX02_VIEW }) });
    await userEvent.click(page.getByRole("button", { name: "재분석" }));
    await expect.element(page.getByRole("button", { name: "분석 중…" })).toBeDisabled();
    const live = host.querySelector('[data-slot="analysis-live"]');
    expect(live?.getAttribute("role")).toBe("status");
    expect(live?.getAttribute("aria-live")).toBe("polite");
    await vi.waitFor(() => expect(live?.textContent).toBe("분석 대기 중"));
    expect(host.querySelector('[data-slot="analysis-pending"]')).not.toBeNull();
    expect(page.getByText("SOL Score 분해").elements()).toHaveLength(0);
    expect(host.querySelector('[data-slot="decision-pending"]')).not.toBeNull();
    // 결정 폼은 지난 분석 기준으로 쓸 수 있다(§5.4.10).
    await expect.element(decisionButton()).toBeEnabled();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({ force: true });
  });

  it("분석 요청이 실패하면 버튼 곁에 오류 코드와 요청 ID 를 보인다", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "분석 요청이 너무 많습니다",
            details: {},
            requestId: "req-429",
          },
        }),
        { status: 429 },
      ),
    );
    render();
    await userEvent.click(page.getByRole("button", { name: "분석 실행" }));
    const alert = page.getByRole("alert");
    await expect.element(alert).toHaveTextContent("분석을 요청하지 못했습니다");
    await expect.element(alert).toHaveTextContent("분석 요청이 너무 많습니다");
    await expect.element(alert).toHaveTextContent("RATE_LIMITED · req-429");
    await expect.element(page.getByRole("button", { name: "분석 실행" })).toBeEnabled();
  });
});

describe("BidDetailView 폭(스펙 §3.2)", () => {
  const busy = () =>
    props({
      bid: detail({
        title: `${"차세대 지능형 행정정보시스템 고도화 및 클라우드 전환 "}`.repeat(4),
        agency: "세종특별자치시 행정안전국 정보화담당관실",
        latestAnalysis: FX03_VIEW,
        reviews: [
          ...REVIEWS_FX01,
          {
            ...REVIEWS_FX01[0]!,
            id: "review-deleted",
            reviewer: { id: "deleted-user", name: "탈퇴한 사용자", role: null },
            reason: "가".repeat(400),
          },
        ],
      }),
      history: historyOf(FX03_VIEW, FX01_VIEW),
    });

  it.each([
    [1280, 1024, 616],
    [1440, 1184, 776],
  ])(
    "%ipx·사이드바 펼침(상자 %ipx)에서 주 영역 %ipx·레일 320px 이고 가로로 넘치지 않는다",
    async (screen, box, main) => {
      await page.viewport(screen, 900);
      const host = document.body.appendChild(document.createElement("div"));
      host.style.width = `${box}px`;
      const root = createRoot(host);
      flushSync(() => root.render(<BidDetailView {...busy()} />));
      mounted.push(root);
      // 운영 글꼴(Pretendard)의 글자 조각을 모두 받은 뒤에 잰다. 시스템 글꼴이면 라틴 글자 폭이 좁아 넘침을 놓친다.
      const shown = host.textContent ?? "";
      await Promise.all(
        ["400", "500", "600", "700"].map((weight) =>
          document.fonts.load(`${weight} 16px "Pretendard Variable"`, shown),
        ),
      );
      await document.fonts.ready;
      expect(getComputedStyle(host.querySelector("h1") as Element).fontFamily).toContain(
        "Pretendard",
      );
      const mainColumn = host.querySelector<HTMLElement>('[data-slot="bid-detail-main"]');
      const rail = host.querySelector<HTMLElement>('[data-slot="bid-detail-rail"]');
      expect(mainColumn?.getBoundingClientRect().width).toBe(main);
      expect(rail?.getBoundingClientRect().width).toBe(320);
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      for (const column of [mainColumn, rail]) {
        if (column === null) throw new Error("단이 없다");
        expect(column.scrollWidth).toBeLessThanOrEqual(column.clientWidth);
        const right = column.getBoundingClientRect().right;
        const outside = Array.from(column.querySelectorAll<HTMLElement>("*")).filter(
          (el) => !el.closest(".sr-only") && el.getBoundingClientRect().right > right + 0.5,
        );
        expect(outside.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
      }
    },
  );

  it("수주·낙찰 확률은 아님 문장 안에서만 나온다", () => {
    const { host } = render(busy());
    expect(text(host)).not.toMatch(/수주\s?확률(?!.{0,20}아)/);
    expect(text(host)).not.toMatch(/낙찰\s?확률(?!.{0,20}아)/);
  });
});

describe("상세 경계 화면(스펙 §3.5·§5.4.11)", () => {
  const draw = (node: React.ReactNode) => {
    const host = document.body.appendChild(document.createElement("div"));
    host.style.width = "1024px";
    const root = createRoot(host);
    flushSync(() => root.render(node));
    mounted.push(root);
    return host;
  };

  it("없는 공고는 앱 틀 안에서 고정 문구와 [공고 목록으로] outline 링크를 보인다", async () => {
    draw(<BidNotFound />);
    await expect
      .element(page.getByRole("heading", { level: 1 }))
      .toHaveTextContent("공고를 찾을 수 없습니다");
    await expect.element(page.getByText("주소가 맞는지 확인하세요.")).toBeVisible();
    const back = page.getByRole("link", { name: "공고 목록으로" });
    await expect.element(back).toHaveAttribute("href", "/bids");
    expect(back.element().className).toContain("border-border");
  });

  it("읽는 중은 레이아웃과 같은 skeleton 이고 role=status 로 알린다(스피너 단독 아님)", () => {
    const host = draw(<Loading />);
    const status = host.querySelector('[role="status"]');
    expect(status?.textContent).toContain("공고를 불러오는 중…");
    expect(host.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(10);
    expect(host.querySelector("h1")?.textContent).toBe("공고 상세");
    // 제목·설명 안에는 글줄 내용만 둔다(div 를 넣으면 하이드레이션이 깨진다).
    expect(host.querySelector("h1 div, main p div")).toBeNull();
  });
});
