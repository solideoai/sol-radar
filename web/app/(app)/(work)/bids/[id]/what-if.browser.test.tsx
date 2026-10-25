import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEvidenceStore } from "@/components/bids/evidence-store";
import {
  BID_LIST,
  FX01_VIEW,
  FX03_WHAT_IF_VIEW,
  whatIfSummaryOf,
} from "@/components/bids/test-data";
import type { AnalysisView, QualificationCheckView } from "@/server/bids";
import type { WhatIfSummary } from "@/server/scoring";
import { BidDetailView, type DetailBid } from "./bid-detail-view";

// BOOST-2 가정 재계산 흐름을 공고 상세 전체로 그린다(디자인 스펙 docs/plans/2026-10-20-boost2-what-if-ui.md §2·§4.4~§4.6).
// 요청은 fetch 를 가로채 손으로 응답한다. 응답 순서를 시험이 정해 연타 때 마지막 요청만 그리는지 본다(계획 Review Focus 5).
// 가로챈 fetch 는 취소(abort)돼도 실패하지 않는다 — 취소가 늦어 이미 도착한 응답도 버려야 한다(스펙 §4.4).

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

const W1 = "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다.";
const W2 = "결정 모델 의견은 가정에 포함하지 않았습니다.";
const W6 = "보유 가정을 켜면 저장하지 않고 권고와 점수를 다시 계산합니다.";
const W20 = "가정을 지웠습니다. 원래 분석 결과만 보입니다.";
const FORBIDDEN = /확률|승률|가능성|수주|%/;
const ICT = "ICT_CONSTRUCTION";
const DP = "DIRECT_PRODUCTION";
const ICT_SWITCH = "정보통신공사업 등록 보유 가정";
const DP_SWITCH = "직접생산확인증명서 보유 가정";

// 연타 시험용: 미충족 행을 하나 더 둔다.
const directProduction: QualificationCheckView = {
  ...FX03_WHAT_IF_VIEW.qualification.checks[1]!,
  id: "q3",
  requirementCode: DP,
  requirementName: "직접생산확인증명서",
  reason: "프로필에 확인서 없음",
  profileEvidence: [],
};
const TWO_CODES_VIEW: AnalysisView = {
  ...FX03_WHAT_IF_VIEW,
  qualification: {
    ...FX03_WHAT_IF_VIEW.qualification,
    checks: [...FX03_WHAT_IF_VIEW.qualification.checks, directProduction],
  },
};

const BEFORE = whatIfSummaryOf(FX03_WHAT_IF_VIEW);
const assumeHeld = (view: AnalysisView, codes: string[], overrides: Partial<WhatIfSummary>) => {
  const before = whatIfSummaryOf(view);
  return {
    ...before,
    ...overrides,
    checks: before.checks.map((check) =>
      check.requirementCode !== null && codes.includes(check.requirementCode)
        ? { ...check, outcome: "SATISFIED" as const }
        : check,
    ),
  };
};
const WATCH_AFTER = assumeHeld(FX03_WHAT_IF_VIEW, [ICT], {
  recommendation: "WATCH",
  qualificationStatus: "SATISFIED",
});

type Call = {
  url: string;
  init: RequestInit | undefined;
  codes: string[];
  resolve: (response: Response) => void;
};
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "X-Request-Id": `req-${status}` },
  });
const errorBody = (code: string, message: string, details: Record<string, unknown> = {}) => ({
  error: { code, message, details, requestId: `req-${code}` },
});
const respondOk = (
  call: Call | undefined,
  assumable: string[],
  before: WhatIfSummary,
  after = before,
) => call?.resolve(json({ assumable, before, after }));

const codesOf = (init: RequestInit | undefined): string[] => {
  if (typeof init?.body !== "string") return [];
  const body: unknown = JSON.parse(init.body);
  const assumptions =
    typeof body === "object" && body !== null && "assumptions" in body ? body.assumptions : [];
  return Array.isArray(assumptions)
    ? assumptions.map((a: { code?: unknown }) => String(a.code))
    : [];
};

const BID_ID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
const detail = (latestAnalysis: AnalysisView | null): DetailBid => ({
  ...BID_LIST[2]!,
  id: BID_ID,
  noticeId: "DEMO-2026-0003",
  source: "fixture",
  content: "정보통신공사업 등록 업체만 참가할 수 있습니다.",
  noticeAgency: null,
  sourceUrlKind: "NOTICE",
  documents: [],
  stageLinks: { planRef: null, preSpecRef: null },
  extractionStatus: "COMPLETED",
  latestAnalysis,
  reviews: [],
});

type ViewProps = React.ComponentProps<typeof BidDetailView>;
const props = (latestAnalysis: AnalysisView | null): ViewProps => ({
  bid: detail(latestAnalysis),
  previousScored: null,
  history: null,
  assessmentLabels: {},
  members: [{ id: "user-sales", name: "김영업" }],
  currentUserId: "user-sales",
  canAnalyze: true,
  canDecide: true,
  backHref: "/bids",
  now: "2026-10-16T03:00:00Z",
});

const mounted: Root[] = [];
const render = (view: AnalysisView | null = FX03_WHAT_IF_VIEW) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "1184px";
  const root = createRoot(host);
  flushSync(() => root.render(<BidDetailView {...props(view)} />));
  mounted.push(root);
  return { host, root };
};

beforeEach(async () => {
  await page.viewport(1440, 900);
  calls.splice(0);
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    (input, init) =>
      new Promise<Response>((resolve) => {
        calls.push({ url: String(input), init, codes: codesOf(init), resolve });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  useEvidenceStore.setState({ open: false, context: null });
  vi.unstubAllGlobals();
});

const bandOf = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="what-if-band"]');
const liveOf = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-slot="what-if-live"]')?.textContent ?? "";
const railOf = (host: HTMLElement) =>
  host.querySelector<HTMLElement>('[data-slot="bid-detail-rail"]')?.textContent ?? "";
const comparisonRow = (index: number) =>
  page.getByRole("table", { name: "원래 결과와 가정 결과 비교" }).getByRole("row").nth(index);
const waitCalls = (count: number) => vi.waitFor(() => expect(calls).toHaveLength(count));

// 진입 호출(빈 가정)에 응답해 스위치가 나올 때까지.
async function enter(view: AnalysisView, assumable: string[]) {
  const rendered = render(view);
  await waitCalls(1);
  respondOk(calls[0], assumable, whatIfSummaryOf(view));
  await expect.element(page.getByRole("switch").first()).toBeVisible();
  return rendered;
}

describe("진입 호출(스펙 §4.5)", () => {
  it("최신 점수 run 으로 빈 가정을 한 번 보내고, 응답 전에는 스위치가 없다", async () => {
    const { host } = render();
    await waitCalls(1);
    const [call] = calls;
    expect(call?.url).toBe("/api/v1/analyses/run-fx-03/what-if");
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Requested-With": "sol-radar",
    });
    expect(JSON.parse(String(call?.init?.body))).toEqual({ assumptions: [] });
    // D6: 불러오는 중에는 지금 화면 그대로다.
    expect(page.getByRole("switch").elements()).toHaveLength(0);
    expect(host.textContent).not.toContain(W6);
    respondOk(call, [ICT], BEFORE);
    await expect.element(page.getByRole("switch", { name: ICT_SWITCH })).toBeVisible();
    expect(page.getByRole("switch").elements()).toHaveLength(1);
    await expect.element(page.getByText(W6, { exact: true })).toBeVisible();
    expect(bandOf(host)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("필수 항목에 미충족·회사 증빙 없음이 없으면 부르지 않는다", async () => {
    const { host } = render(FX01_VIEW);
    await expect.element(page.getByRole("heading", { name: /필수자격/ })).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(0);
    expect(host.querySelector('[data-slot="what-if-switch"]')).toBeNull();
  });

  it("assumable 이 비면 스위치·안내가 없다", async () => {
    const { host } = render();
    await waitCalls(1);
    respondOk(calls[0], [], BEFORE);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(page.getByRole("switch").elements()).toHaveLength(0);
    expect(host.textContent).not.toContain(W6);
  });

  it("404 NO_SNAPSHOT 이면 입력 기록 없음 한 줄만 보이고 다시 시도가 없다", async () => {
    const { host } = render();
    await waitCalls(1);
    calls[0]?.resolve(
      json(
        errorBody("NOT_FOUND", "가정 재계산에 쓸 입력 스냅샷이 없습니다", {
          resource: "analysis",
          reason: "NO_SNAPSHOT",
        }),
        404,
      ),
    );
    await expect
      .element(
        page.getByText(
          "이 분석에는 가정 계산에 쓸 입력 기록이 없습니다. 재분석하면 보유 가정을 켤 수 있습니다.",
        ),
      )
      .toBeVisible();
    expect(page.getByRole("switch").elements()).toHaveLength(0);
    expect(host.querySelector('[data-slot="what-if-load-error"]')).toBeNull();
  });

  it("그 밖 실패는 불러오기 실패 줄과 [다시 시도], 다시 시도하면 스위치가 나온다", async () => {
    const { host } = render();
    await waitCalls(1);
    calls[0]?.resolve(json(errorBody("INTERNAL_ERROR", "요청을 처리하지 못했습니다."), 500));
    const line = page.getByText("보유 가정을 불러오지 못했습니다");
    await expect.element(line).toBeVisible();
    expect(host.querySelector('[data-slot="what-if-load-error"]')?.textContent).toContain(
      "INTERNAL_ERROR · req-INTERNAL_ERROR",
    );
    expect(page.getByRole("switch").elements()).toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "다시 시도" }));
    await waitCalls(2);
    expect(calls[1]?.codes).toEqual([]);
    respondOk(calls[1], [ICT], BEFORE);
    await expect.element(page.getByRole("switch", { name: ICT_SWITCH })).toBeVisible();
    expect(host.querySelector('[data-slot="what-if-load-error"]')).toBeNull();
  });

  it("다시 계산한 원래 값이 저장된 run 과 다르면(D9) 안내만 보이고 스위치가 없다", async () => {
    render();
    await waitCalls(1);
    respondOk(calls[0], [ICT], { ...BEFORE, recommendation: "WATCH" });
    await expect
      .element(
        page.getByText(
          "저장된 분석과 지금 규칙으로 다시 계산한 값이 달라 가정을 켤 수 없습니다. 재분석하면 쓸 수 있습니다.",
        ),
      )
      .toBeVisible();
    expect(page.getByRole("switch").elements()).toHaveLength(0);
  });
});

describe("가정 시나리오(스펙 §4.3·§4.4)", () => {
  it("스위치 한 번이면 띠가 NO-BID → WATCH, 68 → 68 을 보이고 결정 패널은 원래 값 그대로다", async () => {
    const { host } = await enter(FX03_WHAT_IF_VIEW, [ICT]);
    const railBefore = railOf(host);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(2);
    expect(calls[1]?.url).toBe("/api/v1/analyses/run-fx-03/what-if");
    expect(JSON.parse(String(calls[1]?.init?.body))).toEqual({
      assumptions: [{ kind: "QUALIFICATION", code: ICT }],
    });
    // 띠는 바로 생기고 응답 전에는 계산 중이다.
    await vi.waitFor(() => expect(bandOf(host)?.getAttribute("aria-busy")).toBe("true"));
    respondOk(calls[1], [ICT], BEFORE, WATCH_AFTER);
    await expect.element(comparisonRow(1)).toHaveTextContent(/^권고NO-BIDWATCH$/);
    await expect.element(comparisonRow(2)).toHaveTextContent(/68\/ 100참고68\/ 100변화 없음$/);
    await expect.element(comparisonRow(3)).toHaveTextContent(/^필수자격미충족충족$/);
    await expect.element(page.getByText(W1, { exact: true })).toBeVisible();
    await expect.element(page.getByText(W2, { exact: true })).toBeVisible();
    expect(bandOf(host)?.getAttribute("aria-busy")).not.toBe("true");
    // 결정 패널(권고·점수·라디오 기본값)과 필수자격 행 배지는 원래 값이다.
    expect(railOf(host)).toBe(railBefore);
    expect(railOf(host)).toContain("권고NO-BID");
    await expect.element(page.getByRole("radio", { name: "NO-BID" })).toBeChecked();
    const row = page.getByRole("switch", { name: ICT_SWITCH }).element().closest("li");
    expect(row?.textContent).toContain("미충족");
    expect(liveOf(host)).toBe(
      "가정 결과. 권고 NO-BID에서 WATCH로 바뀜. SOL Score 68 그대로. 필수자격 미충족에서 충족으로 바뀜.",
    );
    const switchGroup = page.getByRole("switch").element().parentElement?.textContent ?? "";
    for (const shown of [bandOf(host)?.textContent ?? "", switchGroup, W6, liveOf(host)]) {
      expect(shown).not.toMatch(FORBIDDEN);
    }
  });

  it("띠는 분석 요약 띠 아래, 단계 이력 위에 둔다", async () => {
    const { host } = await enter(FX03_WHAT_IF_VIEW, [ICT]);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(2);
    const main = host.querySelector('[data-slot="bid-detail-main"]');
    const order = Array.from(main?.children ?? [], (child) =>
      child.getAttribute("data-slot") === "what-if-band"
        ? "band"
        : (child.querySelector("h2")?.textContent ?? ""),
    );
    expect(order.slice(0, 3)).toEqual(["분석 요약", "band", "단계 이력"]);
  });

  it("연타하면 마지막 요청의 응답만 그린다(앞 요청은 취소하고 늦게 와도 버린다)", async () => {
    const { host } = await enter(TWO_CODES_VIEW, [ICT, DP]);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await userEvent.click(page.getByRole("switch", { name: DP_SWITCH }));
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(4);
    expect(calls.slice(1).map((call) => call.codes)).toEqual([[ICT], [DP, ICT], [DP]]);
    expect(calls.slice(1, 3).map((call) => call.init?.signal?.aborted)).toEqual([true, true]);
    expect(calls[3]?.init?.signal?.aborted).toBe(false);
    // 칩 줄은 지금 켠 집합을 바로 보인다.
    await expect.element(page.getByText("직접생산확인증명서 보유", { exact: true })).toBeVisible();
    expect(bandOf(host)?.textContent).not.toContain("정보통신공사업 등록 보유");

    const twoBefore = whatIfSummaryOf(TWO_CODES_VIEW);
    // 앞 요청이 먼저 와도 그리지 않는다.
    respondOk(
      calls[1],
      [ICT, DP],
      twoBefore,
      assumeHeld(TWO_CODES_VIEW, [ICT], { recommendation: "BID", score: 90 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bandOf(host)?.getAttribute("aria-busy")).toBe("true");
    expect(bandOf(host)?.textContent).not.toContain("BID");
    // 마지막 요청만 그린다.
    respondOk(calls[3], [ICT, DP], twoBefore, assumeHeld(TWO_CODES_VIEW, [DP], { score: 70 }));
    await expect.element(comparisonRow(2)).toHaveTextContent(/68\/ 100참고70\/ 100참고\+2점$/);
    const drawn = bandOf(host)?.textContent;
    const live = liveOf(host);
    // 그 뒤에 온 앞 요청도 버린다.
    respondOk(
      calls[2],
      [ICT, DP],
      twoBefore,
      assumeHeld(TWO_CODES_VIEW, [ICT, DP], { recommendation: "WATCH", score: 80 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bandOf(host)?.textContent).toBe(drawn);
    expect(liveOf(host)).toBe(live);
    expect(live).toBe("가정 결과. 권고 NO-BID 그대로. SOL Score 68에서 70으로 바뀜.");
  });

  it("가정 지우기는 띠를 없애고 스위치를 끄고 처음 켠 스위치로 초점을 옮긴다", async () => {
    const { host } = await enter(TWO_CODES_VIEW, [ICT, DP]);
    // 목록 순서로 첫 번째(정보통신공사업)가 초점을 받는다. 누른 순서와 상관없다.
    await userEvent.click(page.getByRole("switch", { name: DP_SWITCH }));
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(3);
    respondOk(calls[2], [ICT, DP], whatIfSummaryOf(TWO_CODES_VIEW));
    await expect.element(comparisonRow(1)).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "가정 지우기" }));
    expect(bandOf(host)).toBeNull();
    await expect
      .element(page.getByRole("switch", { name: ICT_SWITCH }))
      .toHaveAttribute("aria-checked", "false");
    await expect
      .element(page.getByRole("switch", { name: DP_SWITCH }))
      .toHaveAttribute("aria-checked", "false");
    expect(document.activeElement).toBe(page.getByRole("switch", { name: ICT_SWITCH }).element());
    expect(liveOf(host)).toBe(W20);
    expect(calls).toHaveLength(3);
  });

  it("마지막 스위치를 끄면 진행 중 요청을 취소하고 띠를 없애며 초점은 그 스위치에 남는다", async () => {
    const { host } = await enter(FX03_WHAT_IF_VIEW, [ICT]);
    const only = page.getByRole("switch", { name: ICT_SWITCH });
    await userEvent.click(only);
    await waitCalls(2);
    await userEvent.click(only);
    expect(calls[1]?.init?.signal?.aborted).toBe(true);
    expect(bandOf(host)).toBeNull();
    expect(document.activeElement).toBe(only.element());
    expect(liveOf(host)).toBe(W20);
    // 취소가 늦어 도착한 응답도 띠·낭독을 되살리지 않는다.
    respondOk(calls[1], [ICT], BEFORE, WATCH_AFTER);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(bandOf(host)).toBeNull();
    expect(liveOf(host)).toBe(W20);
    expect(calls).toHaveLength(2);
  });

  it("계산이 실패하면 띠 안에 실패 줄을 두고, 다시 시도는 같은 가정으로 다시 보낸다", async () => {
    const { host } = await enter(FX03_WHAT_IF_VIEW, [ICT]);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(2);
    calls[1]?.resolve(json(errorBody("ANALYSIS_IN_PROGRESS", "분석이 아직 진행 중입니다"), 409));
    // 화면 글자(마침표 없음)와 낭독 문장(마침표 있음)이 따로 있다.
    await expect
      .element(page.getByText("가정 결과를 계산하지 못했습니다", { exact: true }))
      .toBeVisible();
    expect(host.querySelector('[data-slot="what-if-calc-error"]')?.textContent).toContain(
      "ANALYSIS_IN_PROGRESS · req-ANALYSIS_IN_PROGRESS",
    );
    expect(liveOf(host)).toBe("가정 결과를 계산하지 못했습니다.");
    await userEvent.click(page.getByRole("button", { name: "다시 시도" }));
    await waitCalls(3);
    expect(calls[2]?.codes).toEqual([ICT]);
    respondOk(calls[2], [ICT], BEFORE, WATCH_AFTER);
    await expect.element(comparisonRow(1)).toHaveTextContent(/^권고NO-BIDWATCH$/);
    expect(host.querySelector('[data-slot="what-if-calc-error"]')).toBeNull();
  });

  it("'가정 시나리오 보기'는 띠 제목으로 초점을 옮긴다", async () => {
    await enter(FX03_WHAT_IF_VIEW, [ICT]);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(2);
    respondOk(calls[1], [ICT], BEFORE, WATCH_AFTER);
    await userEvent.click(page.getByRole("button", { name: "가정 시나리오 보기" }));
    expect(document.activeElement).toBe(
      page.getByRole("heading", { level: 2, name: "가정 시나리오" }).element(),
    );
  });

  it("재분석이 시작되면 가정을 비우고, 같은 run 으로 돌아와도 되살리지 않는다", async () => {
    const { host, root } = await enter(FX03_WHAT_IF_VIEW, [ICT]);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(2);
    respondOk(calls[1], [ICT], BEFORE, WATCH_AFTER);
    await expect.element(comparisonRow(1)).toBeVisible();
    const running: AnalysisView = { ...FX03_WHAT_IF_VIEW, id: "run-fx-03-next", status: "RUNNING" };
    flushSync(() => root.render(<BidDetailView {...props(running)} />));
    expect(bandOf(host)).toBeNull();
    expect(host.querySelector('[data-slot="what-if-switch"]')).toBeNull();
    flushSync(() => root.render(<BidDetailView {...props(FX03_WHAT_IF_VIEW)} />));
    expect(bandOf(host)).toBeNull();
    // 같은 run 이라도 진입 호출을 다시 하고, 스위치는 꺼진 채 나온다.
    await vi.waitFor(() =>
      expect(calls.filter((call) => call.url.endsWith("/what-if"))).toHaveLength(3),
    );
    respondOk(calls.filter((call) => call.url.endsWith("/what-if"))[2], [ICT], BEFORE);
    await expect
      .element(page.getByRole("switch", { name: ICT_SWITCH }))
      .toHaveAttribute("aria-checked", "false");
    expect(bandOf(host)).toBeNull();
  });

  it("최신 run id 가 바뀌면 가정을 비우고 새 run 으로 진입 호출을 다시 한다", async () => {
    const { host, root } = await enter(FX03_WHAT_IF_VIEW, [ICT]);
    await userEvent.click(page.getByRole("switch", { name: ICT_SWITCH }));
    await waitCalls(2);
    const next: AnalysisView = { ...FX03_WHAT_IF_VIEW, id: "run-fx-03-b" };
    flushSync(() => root.render(<BidDetailView {...props(next)} />));
    expect(bandOf(host)).toBeNull();
    expect(calls[1]?.init?.signal?.aborted).toBe(true);
    await waitCalls(3);
    expect(calls[2]?.url).toBe("/api/v1/analyses/run-fx-03-b/what-if");
    expect(calls[2]?.codes).toEqual([]);
  });
});
