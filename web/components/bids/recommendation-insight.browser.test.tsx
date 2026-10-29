import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { RecommendationInsight, INSIGHT_NOTICE } from "@/components/bids/recommendation-insight";
import {
  INSIGHT_BID_ID as BID_ID,
  INSIGHT_DONE_MODEL as DONE_MODEL,
  INSIGHT_DONE_TEMPLATE as DONE_TEMPLATE,
  INSIGHT_FAILED as FAILED,
  INSIGHT_PAYLOAD as PAYLOAD,
  INSIGHT_PENDING as PENDING,
  INSIGHT_POLL_LIMIT_FOR_TEST as POLL_LIMIT_MS,
} from "@/components/bids/insight-test-data";
import { INSIGHT_POLL_FAST_MS } from "@/components/bids/use-insight-request";
import type { InsightView } from "@/server/insight";

// 공고 상세 "추천 분석" 패널(스펙 2026-10-29-recommendation-insight §4.6, 계획 Task 8)을 진짜 브라우저로 그린다.
// 요청은 fetch 를 가로채 시험이 손으로 응답한다(경로는 0f 의 Task 7 이 만든다). PENDING 늦음은 가짜 시계로 본다.
// 계획 Review Focus 3(늦음 안내)·4(읽기 전용은 버튼 없음, POST 403)를 여기서 본다. 공고 상세에 붙인 모습(Review Focus 5)은
// app/(app)/(work)/bids/[id]/recommendation-insight-detail.browser.test.tsx 가 본다(부품 시험은 app 을 부를 수 없다, lodestar).

const spies = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: spies.toast }));

// 새 화면 문구 금지어(계획 전역 제약). 고지 "수주 확률이 아닙니다" 는 이 패널에 없다.
const FORBIDDEN = /승률|확률|가능성|수주 금액|점유율|경쟁사|%/;
const RUN_ID = DONE_MODEL.scoreRunId;
const INSIGHT_URL = `/api/v1/bids/${BID_ID}/analyses/${RUN_ID}/insight`;

type Call = { url: string; init: RequestInit | undefined; resolve: (response: Response) => void };
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const accepted = (status: InsightView["status"]) =>
  json({ insightId: PENDING.id, status, deduplicated: false, pollUrl: INSIGHT_URL }, 202);
const waitCalls = (count: number) => expect.poll(() => calls.length).toBe(count);
const headersOf = (call: Call | undefined) => new Headers(call?.init?.headers);

const mounted: Root[] = [];
type PanelProps = React.ComponentProps<typeof RecommendationInsight>;
const renderPanel = (props: Partial<PanelProps> = {}) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "880px";
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <RecommendationInsight
        bidId={BID_ID}
        runId={RUN_ID}
        canRequest
        initialInsight={null}
        pollLimitMs={POLL_LIMIT_MS}
        {...props}
      />,
    ),
  );
  mounted.push(root);
  return host;
};
const panel = () => page.getByRole("region", { name: "추천 분석" });
const unmountAll = () => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
};

beforeEach(async () => {
  await page.viewport(1440, 900);
  calls.splice(0);
  spies.toast.mockReset();
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    (input, init) =>
      new Promise<Response>((resolve) => {
        calls.push({ url: String(input), init, resolve });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  unmountAll();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("추천 분석 요청", () => {
  it("요청 가능하면 [추천 분석] 을 누르면 POST 하고 진행 표시를 보인 뒤, 끝나면 결과를 그린다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    renderPanel();
    await userEvent.click(panel().getByRole("button", { name: "추천 분석" }));
    await waitCalls(1);
    const [post] = calls;
    expect(post?.url).toBe(INSIGHT_URL);
    expect(post?.init?.method).toBe("POST");
    expect(post?.init?.body).toBeUndefined();
    expect(headersOf(post).get("X-Requested-With")).toBe("sol-radar");
    expect(headersOf(post).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    await expect
      .element(panel().getByText("공고와 회사 자료를 읽고 정리하고 있습니다."))
      .toBeVisible();

    post?.resolve(accepted("PENDING"));
    // 202 를 읽고 첫 간격 타이머를 건 뒤에 시계를 넘긴다.
    await expect.poll(() => vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_FAST_MS);
    await waitCalls(2);
    expect(calls[1]?.url).toBe(INSIGHT_URL);
    expect(calls[1]?.init?.method).toBeUndefined();
    calls[1]?.resolve(json({ insight: DONE_MODEL }));
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
    await expect
      .element(panel().getByText("공고와 회사 자료를 읽고 정리하고 있습니다."))
      .not.toBeInTheDocument();
  });

  it("POST 가 403 이면 toast 로 알리고 [추천 분석] 으로 돌아간다", async () => {
    renderPanel();
    await userEvent.click(panel().getByRole("button", { name: "추천 분석" }));
    await waitCalls(1);
    calls[0]?.resolve(
      json({ error: { code: "FORBIDDEN", message: "이 작업을 할 권한이 없습니다." } }, 403),
    );
    await expect.poll(() => spies.toast.mock.calls[0]?.[0]).toBe("이 작업을 할 권한이 없습니다.");
    await expect.element(panel().getByRole("button", { name: "추천 분석" })).toBeVisible();
  });
});

describe("결과", () => {
  it("DONE·MODEL 이면 판단 이유·강점·보완할 점과 근거 칩을 보이고, 칩을 누르면 인용문이 보인다", async () => {
    renderPanel({ initialInsight: DONE_MODEL });
    const region = panel();
    for (const title of ["판단 이유", "강점", "보완할 점"]) {
      await expect.element(region.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    await expect.element(region.getByText(PAYLOAD.summary)).toBeVisible();
    await expect.element(region.getByText(PAYLOAD.strengths[0]!.text)).toBeVisible();
    await expect.element(region.getByText(PAYLOAD.improvements[0]!.text)).toBeVisible();
    await expect.element(region.getByText(/Qwen3\.8-Flash-Next-AWQ-INT4/)).toBeVisible();

    const chip = region.getByRole("button", { name: "공고문 B1" });
    await expect.element(chip).toHaveAttribute("aria-expanded", "false");
    await expect.element(region.getByRole("button", { name: "회사 자료 C1" })).toBeVisible();
    await expect.element(region.getByText(PAYLOAD.refs[0]!.quotedText)).not.toBeInTheDocument();
    await userEvent.click(chip);
    await expect.element(chip).toHaveAttribute("aria-expanded", "true");
    await expect.element(region.getByText(PAYLOAD.refs[0]!.label)).toBeVisible();
    await expect.element(region.getByText(PAYLOAD.refs[0]!.quotedText)).toBeVisible();
    // 모델 결과에는 [다시 요청] 이 없다. 처음부터 끝난 행이라 읽지도 않는다.
    await expect.element(region.getByRole("button", { name: "다시 요청" })).not.toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it("mock 응답(modelName mock)이면 모델 이름 대신 Mock 응답이라고 쓴다", async () => {
    // ADR-034 15번: mock 응답이 실제 모델처럼 보이면 안 된다. gateway mock 의 model 값이 "mock" 이다.
    const host = renderPanel({ initialInsight: { ...DONE_MODEL, modelName: "mock" } });
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
    await expect.element(panel().getByText(/Mock 응답\(데모 데이터\)/)).toBeVisible();
    expect(host.textContent).not.toMatch(/mock/);
  });

  it("DONE·TEMPLATE 이면 대체 안내와 [다시 요청] 이 있고, 누르면 다시 POST 한다", async () => {
    renderPanel({ initialInsight: DONE_TEMPLATE });
    await expect
      .element(panel().getByText("모델 설명을 쓰지 못해 규칙 결과로 정리했습니다."))
      .toBeVisible();
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
    await userEvent.click(panel().getByRole("button", { name: "다시 요청" }));
    await waitCalls(1);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("TEMPLATE·INJECTION_SUSPECTED 면 지시문 의심 안내를 보이고 [다시 요청] 이 없다", async () => {
    // 보안 리뷰 중-2: 입력이 의심스러우면 모델을 부르지 않는다. 같은 입력이면 다시 요청해도 같은 결과다.
    const host = renderPanel({
      initialInsight: { ...DONE_TEMPLATE, fallbackReason: "INJECTION_SUSPECTED" },
    });
    await expect
      .element(panel().getByText(/지시문으로 의심되는 글이 있어 모델을 부르지 않고/))
      .toBeVisible();
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
    await expect.element(panel().getByText(/규칙 결과로 정리 ·/)).toBeVisible();
    await expect
      .element(panel().getByText("모델 설명을 쓰지 못해 규칙 결과로 정리했습니다."))
      .not.toBeInTheDocument();
    await expect
      .element(panel().getByRole("button", { name: "다시 요청" }))
      .not.toBeInTheDocument();
    expect(host.textContent).not.toMatch(FORBIDDEN);
  });

  it("FAILED 이면 만들지 못했다는 안내와 [다시 요청] 이 있다", async () => {
    renderPanel({ initialInsight: FAILED });
    await expect.element(panel().getByText("추천 분석을 만들지 못했습니다.")).toBeVisible();
    await expect.element(panel().getByText("GATEWAY_UNAVAILABLE")).toBeVisible();
    await userEvent.click(panel().getByRole("button", { name: "다시 요청" }));
    await waitCalls(1);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("3분 넘게 PENDING 이면 늦음 안내와 [다시 확인] 을 보이고, 다시 확인하면 바로 읽는다", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    renderPanel({ initialInsight: PENDING });
    await expect
      .element(panel().getByText("공고와 회사 자료를 읽고 정리하고 있습니다."))
      .toBeVisible();
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_FAST_MS);
    await waitCalls(1);
    // 첫 응답 사이에 3분이 지났다.
    vi.setSystemTime(Date.now() + POLL_LIMIT_MS);
    calls[0]?.resolve(json({ insight: PENDING }));
    await expect.element(panel().getByText(/응답이 늦어지고 있습니다/)).toBeVisible();
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_FAST_MS * 3);
    expect(calls).toHaveLength(1);

    await userEvent.click(panel().getByRole("button", { name: "다시 확인" }));
    await waitCalls(2);
    calls[1]?.resolve(json({ insight: DONE_MODEL }));
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
  });

  it("canRequest false 면 버튼이 없고, 결과는 읽을 수 있다", async () => {
    renderPanel({ canRequest: false });
    await expect.element(panel().getByText("아직 추천 분석이 없습니다.")).toBeVisible();
    await expect.element(panel().getByRole("button")).not.toBeInTheDocument();
    unmountAll();

    renderPanel({ canRequest: false, initialInsight: DONE_TEMPLATE });
    await expect.element(panel().getByText(PAYLOAD.summary)).toBeVisible();
    await expect
      .element(panel().getByRole("button", { name: "다시 요청" }))
      .not.toBeInTheDocument();
  });

  it("어느 상태에서나 고지를 보이고, 패널 글자에 금지어가 없다", async () => {
    const cases: Partial<PanelProps>[] = [
      { initialInsight: null },
      { initialInsight: null, canRequest: false },
      { initialInsight: PENDING },
      { initialInsight: DONE_MODEL },
      { initialInsight: DONE_TEMPLATE },
      { initialInsight: FAILED },
    ];
    for (const props of cases) {
      const host = renderPanel(props);
      await expect.element(panel().getByText(INSIGHT_NOTICE)).toBeVisible();
      // 근거 칩을 모두 펼쳐 인용까지 본다.
      for (const chip of host.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")) {
        chip.click();
      }
      expect(host.textContent).not.toMatch(FORBIDDEN);
      unmountAll();
    }
  });
});
