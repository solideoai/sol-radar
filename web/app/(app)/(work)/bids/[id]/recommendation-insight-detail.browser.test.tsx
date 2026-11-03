import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  INSIGHT_BID_ID as BID_ID,
  INSIGHT_DONE_MODEL as DONE_MODEL,
  INSIGHT_DONE_V2 as DONE_V2,
  INSIGHT_PAYLOAD as PAYLOAD,
  INSIGHT_POLL_LIMIT_FOR_TEST as POLL_LIMIT_MS,
  INSIGHT_PROMPT_VERSION_FOR_TEST as PROMPT_VERSION,
} from "@/components/bids/insight-test-data";
import { formatPoints } from "@/components/bids/format";
import { FACTOR_LABEL } from "@/components/bids/labels";
import { BID_LIST, FX01_VIEW } from "@/components/bids/test-data";
import type { AnalysisView } from "@/server/bids";
import type { InsightView } from "@/server/insight";
import { BidDetailView, type DetailBid } from "./bid-detail-view";

// 공고 상세에 붙인 "추천 분석" 구역(계획 Task 8·ADR-078). 구역·팝업 상태 자체는 components/bids/recommendation-insight.browser.test.tsx 가 본다.
// 점수 run(COMPLETED·PARTIAL)에만 구역이 있고, 서버가 준 첫 값이 다른 run 의 것이면 쓰지 않는다(재분석 뒤 옛 설명이 붙지 않는다).
// 팝업 머리·점수 요소 해설은 상세 화면이 가진 그 run 의 규칙 값(권고·점수·요소)을 쓴다.
// 분석 진행 중 run 은 상세가 진행 상태를 읽으므로 fetch 를 가로채 응답하지 않는다.

const spies = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
  topbar: vi.fn(() => Promise.resolve()),
}));
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => spies.router }));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: spies.topbar }));
vi.mock("sonner", () => ({ toast: vi.fn() }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const mounted: Root[] = [];
const unmountAll = () => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
};
// 팝업 본문 영역 이름("추천 분석 내용")과 섞이지 않게 이름을 정확히 맞춘다.
const panel = () => page.getByRole("region", { name: "추천 분석", exact: true });
const dialog = () => page.getByRole("dialog", { name: "추천 분석" });

beforeEach(async () => {
  await page.viewport(1440, 900);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => new Promise<Response>(() => {})),
  );
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
});

describe("공고 상세", () => {
  const detail = (latestAnalysis: AnalysisView): DetailBid => ({
    ...BID_LIST[0]!,
    id: BID_ID,
    noticeId: "DEMO-2026-0001",
    source: "fixture",
    content: "소프트웨어사업자 신고 업체만 참가할 수 있습니다.",
    noticeAgency: null,
    sourceUrlKind: "NOTICE",
    documents: [],
    stageLinks: { planRef: null, preSpecRef: null },
    extractionStatus: "COMPLETED",
    latestAnalysis,
    reviews: [],
    analysisReadiness: { ready: true, reason: null },
  });
  const renderDetail = (latest: AnalysisView, initial: InsightView | null) => {
    const host = document.body.appendChild(document.createElement("div"));
    host.style.width = "1184px";
    const root = createRoot(host);
    flushSync(() =>
      root.render(
        <BidDetailView
          bid={detail(latest)}
          previousScored={null}
          history={null}
          assessmentLabels={{}}
          members={[{ id: "user-sales", name: "김영업" }]}
          currentUserId="user-sales"
          canAnalyze
          canDecide
          backHref="/bids"
          now="2026-10-29T03:00:00Z"
          insight={{
            initial,
            previous: null,
            pollLimitMs: POLL_LIMIT_MS,
            currentPromptVersion: PROMPT_VERSION,
            canRequest: true,
          }}
        />,
      ),
    );
    mounted.push(root);
  };

  it("점수 run 이면 결정 모델 참고 지표 다음에 구역이 있고, 그 run 의 결과를 그린다", async () => {
    renderDetail(FX01_VIEW, DONE_MODEL);
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
    const headings = [...document.querySelectorAll("h2")].map((heading) => heading.textContent);
    expect(headings.indexOf("추천 분석")).toBe(headings.indexOf("결정 모델 참고 지표") + 1);
  });

  it("팝업 머리와 점수 요소 해설은 이 run 의 권고·점수·요소 값을 쓰고, 767px 이하에서는 공고명을 보인다", async () => {
    renderDetail(FX01_VIEW, DONE_V2);
    await userEvent.click(panel().getByRole("button", { name: "추천 분석 보기", exact: true }));
    await expect.element(dialog().getByText("94 / 100", { exact: true })).toBeVisible();
    await expect.element(dialog().getByText("추천", { exact: true })).toBeVisible();
    const skill = FX01_VIEW.scoreBreakdown.find((factor) => factor.factor === "skillMatch")!;
    await expect
      .element(dialog().getByText(FACTOR_LABEL.skillMatch, { exact: true }))
      .toBeVisible();
    await expect
      .element(
        dialog().getByText(`${formatPoints(skill.points)} / ${skill.maxPoints}`, { exact: true }),
      )
      .toBeVisible();
    // 768px 이상은 공고명이 상세 화면 제목으로 보이므로 팝업 머리에는 두지 않는다.
    await expect.element(dialog().getByText(BID_LIST[0]!.title, { exact: true })).not.toBeVisible();
    await page.viewport(390, 844);
    await expect.element(dialog().getByText(BID_LIST[0]!.title, { exact: true })).toBeVisible();
  });

  it("다른 run 의 설명은 붙이지 않고, 진행 중·실패 run 이면 구역이 없다", async () => {
    renderDetail({ ...FX01_VIEW, id: "run-fx-01-new" }, DONE_MODEL);
    await expect
      .element(panel().getByRole("button", { name: "추천 분석", exact: true }))
      .toBeVisible();
    await expect.element(panel().getByText(PAYLOAD.summary)).not.toBeInTheDocument();
    unmountAll();

    for (const status of ["RUNNING", "FAILED"] as const) {
      renderDetail({ ...FX01_VIEW, status, solScore: null, recommendation: null }, DONE_MODEL);
      await expect
        .element(page.getByRole("heading", { level: 1, name: BID_LIST[0]!.title }))
        .toBeVisible();
      await expect.element(panel()).not.toBeInTheDocument();
      unmountAll();
    }
  });
});
