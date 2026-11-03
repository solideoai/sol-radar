import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  INSIGHT_DONE_HOLD_MS,
  INSIGHT_EXPECTED_MS,
  INSIGHT_FILL_MAX_MS,
  insightFillMs,
} from "@/components/bids/insight-progress";
import {
  INSIGHT_BID_ID as BID_ID,
  INSIGHT_BID_TITLE as BID_TITLE,
  INSIGHT_DONE_MODEL as DONE_OLD,
  INSIGHT_DONE_TEMPLATE as DONE_TEMPLATE,
  INSIGHT_DONE_V2 as DONE_V2,
  INSIGHT_FAILED as FAILED,
  INSIGHT_PAYLOAD as PAYLOAD_OLD,
  INSIGHT_PAYLOAD_V2 as PAYLOAD,
  INSIGHT_POLL_LIMIT_FOR_TEST as POLL_LIMIT_MS,
  INSIGHT_PROMPT_VERSION_FOR_TEST as PROMPT_VERSION,
  INSIGHT_REVIEW_REASON as REVIEW_REASON,
  INSIGHT_RUN as RUN,
  INSIGHT_V2_FIRST_SENTENCE as FIRST_SENTENCE,
  insightPendingAt as pendingAt,
} from "@/components/bids/insight-test-data";
import { FACTOR_LABEL } from "@/components/bids/labels";
import { RecommendationInsight, INSIGHT_NOTICE } from "@/components/bids/recommendation-insight";
import { INSIGHT_POLL_FAST_MS } from "@/components/bids/use-insight-request";
import type { InsightView } from "@/server/insight";

// 공고 상세 "추천 분석"(ADR-066·078, 스펙 2026-11-03-recommendation-insight-detail)을 진짜 브라우저로 그린다.
// 상세 화면 구역은 상태·판단 이유 첫 문장·버튼만 보이고, 버튼을 누르면 팝업이 열려 진행률(0~100%)과 섹션 8개를 보인다.
// 요청은 fetch 를 가로채 시험이 손으로 응답한다. 진행률·늦음은 가짜 시계로 본다(1초 갱신은 setInterval).
// 공고 상세에 붙인 모습은 app/(app)/(work)/bids/[id]/recommendation-insight-detail.browser.test.tsx 가 본다(부품 시험은 app 을 부를 수 없다, lodestar).

const spies = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("sonner", () => ({ toast: spies.toast }));

// 화면 문구 금지어(계획 전역 제약). `%` 는 진행 표시 안에서만 쓴다(ADR-078 3번).
const FORBIDDEN = /승률|확률|가능성|수주 금액|점유율|경쟁사|%/;
const RUN_ID = DONE_V2.scoreRunId;
const INSIGHT_URL = `/api/v1/bids/${BID_ID}/analyses/${RUN_ID}/insight`;
// 묻기 간격(setTimeout)·진행률 0.1초 갱신(setInterval)·경과(Date)를 함께 멈춘다.
const startFakeClock = () =>
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });

type Call = { url: string; init: RequestInit | undefined; resolve: (response: Response) => void };
const calls: Call[] = [];
const fetchMock = vi.fn<typeof fetch>();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const readBody = (insight: InsightView | null, previous: InsightView | null = null) =>
  json({ insight, previous });
const accepted = (status: InsightView["status"]) =>
  json({ insightId: "insight-new", status, deduplicated: false, pollUrl: INSIGHT_URL }, 202);
const waitCalls = (count: number) => expect.poll(() => calls.length).toBe(count);
// 가짜 시계에서 다음 읽기를 기다린다. 응답 처리(Response.json)는 진짜 비동기라 다음 타이머가 언제 잡힐지 몰라
// 시계를 조금씩 밀며 요청이 올 때까지 본다. 읽기는 앞 응답을 받아야 다음이 나가므로 한 번에 하나씩 는다.
const ADVANCE_STEP_MS = 500;
const advanceUntilCalls = (count: number) =>
  expect
    .poll(async () => {
      if (calls.length < count) await vi.advanceTimersByTimeAsync(ADVANCE_STEP_MS);
      return calls.length;
    })
    .toBe(count);
// 팝업의 안내 줄(늦음·실패). 같은 문장이 화면 낭독기 알림 영역에도 있어 글자로 찾지 않고 안내 블록을 읽는다.
const noticeText = () =>
  dialogElement()?.querySelector('[data-slot="insight-notice"]')?.textContent ?? "";
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
        bidTitle={BID_TITLE}
        run={RUN}
        canRequest
        initialInsight={null}
        initialPrevious={null}
        pollLimitMs={POLL_LIMIT_MS}
        currentPromptVersion={PROMPT_VERSION}
        {...props}
      />,
    ),
  );
  mounted.push(root);
  return host;
};
// 팝업 본문 영역 이름("추천 분석 내용")과 섞이지 않게 이름을 정확히 맞춘다.
const panel = () => page.getByRole("region", { name: "추천 분석", exact: true });
const dialog = () => page.getByRole("dialog", { name: "추천 분석" });
const progress = () => dialog().getByRole("progressbar", { name: "추천 분석 진행률" });
const shownValue = () =>
  Number(dialogElement()?.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"));
const dialogElement = () => document.querySelector<HTMLElement>('[role="dialog"]');
const openWith = async (name: string) => {
  await userEvent.click(panel().getByRole("button", { name, exact: true }));
  await expect.element(dialog()).toBeVisible();
};
// 진행 표시 밖 글자. 진행 표시는 `%` 를 쓸 수 있다(ADR-078 3번).
const textOutsideProgress = (element: HTMLElement) => {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[data-slot="insight-progress"]').forEach((node) => node.remove());
  return copy.textContent ?? "";
};
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

describe("추천 분석 요청과 진행률", () => {
  it("[추천 분석] 을 누르면 팝업이 열리고 0% 에서 예상 시간(10초) 동안 고르게 오르다가, DONE 이면 100% 를 보인 뒤 내용을 그린다", async () => {
    startFakeClock();
    const clickedAt = Date.now();
    renderPanel();
    await openWith("추천 분석");
    await waitCalls(1);
    const [post] = calls;
    expect(post?.url).toBe(INSIGHT_URL);
    expect(post?.init?.method).toBe("POST");
    expect(post?.init?.body).toBeUndefined();
    expect(headersOf(post).get("X-Requested-With")).toBe("sol-radar");
    expect(headersOf(post).get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "0");
    await expect.element(dialog().getByText("0%", { exact: true })).toBeVisible();

    post?.resolve(accepted("PENDING"));
    await advanceUntilCalls(2);
    expect(calls[1]?.init?.method).toBeUndefined();
    calls[1]?.resolve(readBody(pendingAt(clickedAt)));
    // PENDING 이면 다음 간격에 다시 읽는다. 그 읽기는 응답을 주지 않고 기다리게 둔다.
    await advanceUntilCalls(3);
    // 예상 시간 10초의 절반이면 45%, 10초면 90%(1초에 9씩). 0.1초마다 다시 센다.
    await vi.advanceTimersByTimeAsync(clickedAt + INSIGHT_EXPECTED_MS / 2 + 50 - Date.now());
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "45");
    await expect.element(dialog().getByText("45%", { exact: true })).toBeVisible();
    await vi.advanceTimersByTimeAsync(clickedAt + INSIGHT_EXPECTED_MS + 50 - Date.now());
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "90");
    // DONE 이 없으면 대기 상한(3분)까지 천천히 올라 99% 에서 멈춘다.
    await vi.advanceTimersByTimeAsync(POLL_LIMIT_MS);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "99");
    expect(calls).toHaveLength(3);

    calls[2]?.resolve(readBody(DONE_V2));
    await vi.advanceTimersByTimeAsync(insightFillMs(99) + 50);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "100");
    await expect.element(dialog().getByText("100%", { exact: true })).toBeVisible();
    await vi.advanceTimersByTimeAsync(INSIGHT_DONE_HOLD_MS);
    await expect
      .element(dialog().getByRole("heading", { name: "판단 이유", exact: true }))
      .toBeVisible();
    await expect.element(progress()).not.toBeInTheDocument();
    expect(dialogElement()?.textContent).not.toMatch(FORBIDDEN);
  });

  it("예상보다 일찍 DONE 이 오면 그때 값에서 100% 까지 이어 채운다(한 번에 건너뛰지 않는다)", async () => {
    startFakeClock();
    const clickedAt = Date.now();
    renderPanel();
    await openWith("추천 분석");
    await waitCalls(1);
    calls[0]?.resolve(accepted("PENDING"));
    await advanceUntilCalls(2);
    calls[1]?.resolve(readBody(pendingAt(clickedAt)));
    await advanceUntilCalls(3);
    await vi.advanceTimersByTimeAsync(clickedAt + INSIGHT_EXPECTED_MS / 2 + 50 - Date.now());
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "45");

    calls[2]?.resolve(readBody(DONE_V2));
    // 45 에서 100 까지 0.8초에 고르게 채운다. 절반쯤이면 그 사이 값이다.
    await vi.advanceTimersByTimeAsync(INSIGHT_FILL_MAX_MS / 2);
    expect(shownValue()).toBeGreaterThan(60);
    expect(shownValue()).toBeLessThan(85);
    await vi.advanceTimersByTimeAsync(INSIGHT_FILL_MAX_MS / 2);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "100");
    await vi.advanceTimersByTimeAsync(INSIGHT_DONE_HOLD_MS);
    await expect.element(dialog().getByText(PAYLOAD.summary)).toBeVisible();
  });

  it("POST 가 403 이면 toast 로 알리고, 팝업을 닫으면 [추천 분석] 으로 돌아간다", async () => {
    renderPanel();
    await openWith("추천 분석");
    await waitCalls(1);
    calls[0]?.resolve(
      json({ error: { code: "FORBIDDEN", message: "이 작업을 할 권한이 없습니다." } }, 403),
    );
    await expect.poll(() => spies.toast.mock.calls[0]?.[0]).toBe("이 작업을 할 권한이 없습니다.");
    await expect.element(dialog().getByText("아직 추천 분석이 없습니다.")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(panel().getByRole("button", { name: "추천 분석", exact: true }))
      .toBeVisible();
  });

  it("POST 가 503 이면 팝업 안 [추천 분석] 으로 다시 요청할 수 있다", async () => {
    renderPanel();
    await openWith("추천 분석");
    await waitCalls(1);
    calls[0]?.resolve(
      json({ error: { code: "SERVICE_UNAVAILABLE", message: "잠시 뒤 다시 시도하세요." } }, 503),
    );
    await expect.poll(() => spies.toast.mock.calls[0]?.[0]).toBe("잠시 뒤 다시 시도하세요.");
    await dialog().getByRole("button", { name: "추천 분석", exact: true }).click();
    await waitCalls(2);
    expect(calls[1]?.init?.method).toBe("POST");
  });

  it("3분 넘게 PENDING 이면 99% 에 늦음 안내와 [다시 확인] 을 보이고, 다시 확인하면 바로 읽는다", async () => {
    startFakeClock();
    // 늦음은 행의 createdAt 부터 3분을 센다(계획 Q3). 이 시험의 행은 지금 막 요청됐다.
    const row = pendingAt(Date.now());
    renderPanel({ initialInsight: row });
    await expect.element(panel().getByText("추천 분석을 만들고 있습니다.")).toBeVisible();
    await openWith("추천 분석 보기");
    await advanceUntilCalls(1);
    // 첫 응답 사이에 3분이 지났다.
    vi.setSystemTime(Date.now() + POLL_LIMIT_MS);
    calls[0]?.resolve(readBody(row));
    await expect
      .element(dialog().getByRole("button", { name: "다시 확인", exact: true }))
      .toBeVisible();
    expect(noticeText()).toContain("응답이 늦어지고 있습니다. 잠시 뒤 다시 확인하세요.");
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "99");
    await vi.advanceTimersByTimeAsync(INSIGHT_POLL_FAST_MS * 3);
    expect(calls).toHaveLength(1);

    await userEvent.click(dialog().getByRole("button", { name: "다시 확인" }));
    await waitCalls(2);
    // 아직 PENDING 이어도 누른 때부터 다시 기다린다(디자인 스펙 7절). 숫자는 99% 그대로다.
    calls[1]?.resolve(readBody(row));
    await advanceUntilCalls(3);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "99");
    expect(noticeText()).toBe("");
    calls[2]?.resolve(readBody(DONE_V2));
    await vi.advanceTimersByTimeAsync(insightFillMs(99) + 50);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "100");
    await vi.advanceTimersByTimeAsync(INSIGHT_DONE_HOLD_MS);
    await expect.element(dialog().getByText(PAYLOAD.summary)).toBeVisible();
  });

  it("이 화면에서 누른 요청은 누른 시각부터 센다. 서버 createdAt 이 기기 시계보다 이르러도 숫자가 튀지 않는다", async () => {
    startFakeClock();
    const clickedAt = Date.now();
    renderPanel();
    await openWith("추천 분석");
    await waitCalls(1);
    calls[0]?.resolve(accepted("PENDING"));
    await advanceUntilCalls(2);
    // 기기 시계가 서버보다 200초 빠르다.
    calls[1]?.resolve(readBody(pendingAt(clickedAt - 200_000)));
    await advanceUntilCalls(3);
    // 누른 때부터 약 4초라 36% 안팎이다. 서버 createdAt(204초 전)부터 셌다면 99% 와 늦음 안내가 나왔다.
    expect(shownValue()).toBeLessThan(50);
    expect(noticeText()).toBe("");
  });

  it("POST 가 이미 있던 요청으로 묶이면(deduplicated) 그 행의 createdAt 부터 센다", async () => {
    startFakeClock();
    renderPanel();
    await openWith("추천 분석");
    await waitCalls(1);
    calls[0]?.resolve(
      json(
        { insightId: "insight-other", status: "PENDING", deduplicated: true, pollUrl: INSIGHT_URL },
        202,
      ),
    );
    await advanceUntilCalls(2);
    calls[1]?.resolve(readBody(pendingAt(Date.now() - 60_000)));
    // 60초는 예상 시간(10초)을 지났다: floor(90 + 9 × 50초 / 170초) = 92
    await vi.advanceTimersByTimeAsync(100);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "92");
  });

  it("createdAt 이 5초 전인 PENDING 으로 열면 0% 가 아니라 5초만큼 진행된 값에서 시작해 이어 오른다", async () => {
    startFakeClock();
    renderPanel({ initialInsight: pendingAt(Date.now() - 5_000) });
    await openWith("추천 분석 보기");
    // floor(90 × 5초 / 10초) = 45
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "45");
    await vi.advanceTimersByTimeAsync(1_000);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "54");
    await vi.advanceTimersByTimeAsync(2_000);
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "72");
  });
});

describe("상세 화면 구역", () => {
  it("상태·판단 이유 첫 문장·[추천 분석 보기] 만 보이고 목록·칩은 두지 않는다", async () => {
    const host = renderPanel({ initialInsight: DONE_V2 });
    await expect.element(panel().getByRole("heading", { name: "추천 분석" })).toBeVisible();
    await expect.element(panel().getByText(INSIGHT_NOTICE)).toBeVisible();
    await expect.element(panel().getByText(/작성$/)).toBeVisible();
    await expect.element(panel().getByText(FIRST_SENTENCE, { exact: true })).toBeVisible();
    expect(host.textContent).not.toContain(PAYLOAD.summary.slice(FIRST_SENTENCE.length + 1));
    expect(host.querySelectorAll("h3, ul, figure")).toHaveLength(0);
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "추천 분석 보기",
    ]);
  });

  it("canRequest false 면 요청 버튼이 없고, 결과는 팝업에서 읽을 수 있다", async () => {
    renderPanel({ canRequest: false });
    await expect.element(panel().getByText("아직 추천 분석이 없습니다.")).toBeVisible();
    await expect.element(panel().getByRole("button")).not.toBeInTheDocument();
    unmountAll();

    renderPanel({ canRequest: false, initialInsight: DONE_TEMPLATE });
    await openWith("추천 분석 보기");
    await expect.element(dialog().getByText(PAYLOAD.summary)).toBeVisible();
    await expect
      .element(dialog().getByRole("button", { name: "다시 요청" }))
      .not.toBeInTheDocument();
  });
});

describe("팝업 내용", () => {
  it("v0.2 결과면 머리(권고·점수·고지)와 섹션 8개를 보이고, 칩을 누르면 그 자리에 인용이 펼쳐진다", async () => {
    renderPanel({ initialInsight: DONE_V2 });
    await openWith("추천 분석 보기");
    const popup = dialog();
    await expect.element(popup.getByText(INSIGHT_NOTICE)).toBeVisible();
    await expect.element(popup.getByText("추천", { exact: true })).toBeVisible();
    await expect.element(popup.getByText("94 / 100", { exact: true })).toBeVisible();
    for (const title of [
      "판단 이유",
      "점수 요소별 해설",
      "자격 요건 해설",
      "강점",
      "보완할 점",
      "참여 전 확인할 것",
      "사업 기간 인력 가용",
      "근거 원문",
    ]) {
      await expect.element(popup.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    await expect.element(popup.getByText(PAYLOAD.summary)).toBeVisible();

    // 점수 요소는 FACTOR_ORDER 순, 점수는 이 run 의 요소 값이다. 해설이 없는 요소(전략적 선호)는 그리지 않는다.
    const factorNames = [...dialogElement()!.querySelectorAll('[data-slot="factor-note"]')].map(
      (row) => row.querySelector('[data-slot="factor-name"]')?.textContent,
    );
    expect(factorNames).toEqual(
      (["skillMatch", "pastPerformance", "staffAvailability", "scaleFit"] as const).map(
        (key) => FACTOR_LABEL[key],
      ),
    );
    await expect.element(popup.getByText("24.0 / 30", { exact: true })).toBeVisible();

    // 같은 이름 자격이 둘이면 충족 자격을 건너뛰고 확인 필요 자격과 짝짓는다. 짝이 없으면 배지·"걸린 것" 없이 해설만.
    const [reviewed, unmatched] = dialogElement()!.querySelectorAll('[data-slot="check-note"]');
    expect(reviewed?.textContent).toContain("확인 필요");
    expect(reviewed?.textContent).toContain(`걸린 것${REVIEW_REASON}`);
    expect(unmatched?.textContent).toContain(PAYLOAD.checkNotes![1]!.text);
    expect(unmatched?.textContent).not.toContain("걸린 것");
    expect(unmatched?.textContent).not.toMatch(/충족|확인 필요/);

    await expect.element(popup.getByText(PAYLOAD.nextSteps![0]!.text)).toBeVisible();
    await expect
      .element(popup.getByText("사업 기간 2026-12-01~2027-06-30 · 가용 3.5 FTE · 대상 인원 6명"))
      .toBeVisible();
    await expect
      .element(popup.getByText(`공고문 B3 · ${PAYLOAD.refs[2]!.label}`, { exact: true }))
      .toBeVisible();
    await expect
      .element(popup.getByText(`회사 자료 C3 · ${PAYLOAD.refs[6]!.label}`, { exact: true }))
      .toBeVisible();

    // 칩은 그 항목 아래에 인용을 펼친다(근거 원문 목록과 별개).
    const chip = popup.getByRole("button", { name: "공고문 B1" }).first();
    await expect.element(chip).toHaveAttribute("aria-expanded", "false");
    const quoteBox = () =>
      document.getElementById(chip.element().getAttribute("aria-controls") ?? "");
    expect(quoteBox()?.textContent).toBe("");
    await userEvent.click(chip);
    await expect.element(chip).toHaveAttribute("aria-expanded", "true");
    expect(quoteBox()?.textContent).toContain(PAYLOAD.refs[0]!.quotedText);

    // 모델명은 펼쳐도 볼 수 없다(2026-11-03 사용자 지시).
    expect(dialogElement()?.textContent).not.toMatch(/Qwen|생성 정보/);
    // 새 형식 모델 결과에는 요청 버튼이 없다. 처음부터 끝난 행이라 읽지도 않는다.
    expect(dialogElement()?.textContent).not.toMatch(/다시 요청|새 형식으로 다시 분석/);
    expect(calls).toHaveLength(0);
  });

  it("같은 이름 자격이 둘 다 걸리면 요청과 같은 순서(같은 이름은 id 순)의 첫 자격과 짝짓는다", async () => {
    const review = RUN.checks[3]!;
    const notSatisfiedReason = "인증서 사본을 제출하지 않았습니다.";
    // 화면 데이터에는 id 가 큰 자격이 먼저 온다. Worker 는 id 순으로 보내므로 q5 와 짝지어야 한다.
    const checks = [
      { ...review, id: "q9", outcome: "NOT_SATISFIED" as const, reason: notSatisfiedReason },
      { ...review, id: "q5" },
    ];
    renderPanel({ initialInsight: DONE_V2, run: { ...RUN, checks } });
    await openWith("추천 분석 보기");
    await expect.element(dialog().getByText(PAYLOAD.checkNotes![0]!.text)).toBeVisible();
    const [paired] = dialogElement()!.querySelectorAll('[data-slot="check-note"]');
    expect(paired?.textContent).toContain(`걸린 것${REVIEW_REASON}`);
    expect(paired?.textContent).not.toContain(notSatisfiedReason);
  });

  it("미충족·확인 필요 자격이 없는 run 이면 자격 요건 해설에 그렇다고 쓴다", async () => {
    // FX-01(필수 자격 3건 충족) 모양. 촬영 화면이 이 상태다(사전 리뷰 QA S3).
    renderPanel({
      initialInsight: { ...DONE_V2, payload: { ...PAYLOAD, checkNotes: [] } },
      run: { ...RUN, checks: RUN.checks.filter((check) => check.outcome === "SATISFIED") },
    });
    await openWith("추천 분석 보기");
    await expect
      .element(dialog().getByText("미충족·확인 필요 자격이 없습니다.", { exact: true }))
      .toBeVisible();
  });

  it("새 형식인데 staffing 이 null 이면 인력 가용 칸에 계산하지 않은 이유를 쓴다", async () => {
    // null 은 필요 인력을 모르거나 인력 명부가 빈 경우다(사업 기간은 모르면 기본 기간을 쓴다).
    renderPanel({ initialInsight: { ...DONE_V2, payload: { ...PAYLOAD, staffing: null } } });
    await openWith("추천 분석 보기");
    await expect
      .element(dialog().getByRole("heading", { name: "사업 기간 인력 가용", exact: true }))
      .toBeVisible();
    await expect
      .element(
        dialog().getByText(
          "필요 인력이나 인력 명부를 알 수 없어 인력 가용을 계산하지 않았습니다.",
          {
            exact: true,
          },
        ),
      )
      .toBeVisible();
  });

  it("옛 형식 결과는 있는 칸만 보이고, 요청 가능 역할에게만 [새 형식으로 다시 분석] 이 보인다. 누르면 POST 한다", async () => {
    startFakeClock();
    renderPanel({ initialInsight: DONE_OLD });
    await openWith("추천 분석 보기");
    const popup = dialog();
    await expect
      .element(
        popup.getByText(
          "이전 형식으로 만든 분석이라 점수 요소별 해설, 자격 요건 해설, 참여 전 확인할 것, 사업 기간 인력 가용이 없습니다.",
        ),
      )
      .toBeVisible();
    for (const title of ["판단 이유", "강점", "보완할 점", "근거 원문"]) {
      await expect.element(popup.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    for (const title of [
      "점수 요소별 해설",
      "자격 요건 해설",
      "참여 전 확인할 것",
      "사업 기간 인력 가용",
    ]) {
      await expect
        .element(popup.getByRole("heading", { name: title, exact: true }))
        .not.toBeInTheDocument();
    }
    await expect.element(popup.getByText(PAYLOAD_OLD.summary)).toBeVisible();
    await userEvent.click(popup.getByRole("button", { name: "새 형식으로 다시 분석" }));
    await waitCalls(1);
    expect(calls[0]?.init?.method).toBe("POST");
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "0");
    vi.useRealTimers();
    unmountAll();

    renderPanel({ canRequest: false, initialInsight: DONE_OLD });
    await openWith("추천 분석 보기");
    await expect.element(dialog().getByText(/이전 형식으로 만든 분석이라/)).toBeVisible();
    await expect
      .element(dialog().getByRole("button", { name: "새 형식으로 다시 분석" }))
      .not.toBeInTheDocument();
  });

  it("최신이 FAILED 이고 이전 모델 결과가 있으면 실패 안내·[다시 요청] 아래에 이전 결과를 그린다", async () => {
    renderPanel({ initialInsight: FAILED, initialPrevious: DONE_OLD });
    await expect.element(panel().getByText("추천 분석을 만들지 못했습니다.")).toBeVisible();
    await expect.element(panel().getByText(PAYLOAD_OLD.summary)).toBeVisible();
    await openWith("추천 분석 보기");
    const popup = dialog();
    await expect.element(popup.getByText("GATEWAY_UNAVAILABLE")).toBeVisible();
    expect(noticeText()).toContain("추천 분석을 만들지 못했습니다.");
    await expect.element(popup.getByText(PAYLOAD_OLD.summary)).toBeVisible();
    // 버튼은 하나만 둔다(옛 형식 안내에는 버튼을 붙이지 않는다).
    await expect
      .element(popup.getByRole("button", { name: "새 형식으로 다시 분석" }))
      .not.toBeInTheDocument();
    await userEvent.click(popup.getByRole("button", { name: "다시 요청" }));
    await waitCalls(1);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("FAILED 만 있으면 구역의 [다시 요청] 이 팝업을 열고 다시 POST 한다", async () => {
    renderPanel({ initialInsight: FAILED });
    await expect.element(panel().getByText("추천 분석을 만들지 못했습니다.")).toBeVisible();
    await openWith("다시 요청");
    await waitCalls(1);
    expect(calls[0]?.init?.method).toBe("POST");
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "0");
  });

  it("mock 응답(modelName mock)이면 모델 이름 대신 Mock 응답이라고 쓴다", async () => {
    // ADR-034 15번: mock 응답이 실제 모델처럼 보이면 안 된다. gateway mock 의 model 값이 "mock" 이다.
    const host = renderPanel({ initialInsight: { ...DONE_V2, modelName: "mock" } });
    await expect.element(panel().getByText(/Mock 응답\(데모 데이터\)/)).toBeVisible();
    expect(host.textContent).not.toMatch(/mock/);
    await openWith("추천 분석 보기");
    await expect.element(dialog().getByText(/Mock 응답\(데모 데이터\) · /)).toBeVisible();
    expect(dialogElement()?.textContent).not.toMatch(/mock|생성 정보/);
  });

  it("DONE·TEMPLATE 이면 대체 안내와 [다시 요청] 이 있고, 누르면 다시 POST 한다", async () => {
    renderPanel({ initialInsight: DONE_TEMPLATE });
    await openWith("추천 분석 보기");
    await expect
      .element(dialog().getByText("모델 설명을 쓰지 못해 규칙 결과로 정리했습니다."))
      .toBeVisible();
    await expect.element(dialog().getByText(PAYLOAD.summary)).toBeVisible();
    await userEvent.click(dialog().getByRole("button", { name: "다시 요청" }));
    await waitCalls(1);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("판단 이유의 모델 이름(Bosun)은 구역·팝업 모두 '결정 모델'로 보인다", async () => {
    // gateway 대체 문장(BASIS_TEXT)이 저장한 글 그대로다. 저장 값은 두고 화면에서만 바꾼다(2026-11-03 사용자 지시).
    const summary = "Bosun 참고 지표를 함께 봤습니다. SOL Score 94점.";
    const host = renderPanel({
      initialInsight: { ...DONE_TEMPLATE, payload: { ...PAYLOAD, summary } },
    });
    await expect.element(panel().getByText("결정 모델 참고 지표를 함께 봤습니다.")).toBeVisible();
    expect(host.textContent).not.toContain("Bosun");
    await openWith("추천 분석 보기");
    await expect
      .element(dialog().getByText("결정 모델 참고 지표를 함께 봤습니다. SOL Score 94점."))
      .toBeVisible();
    expect(dialogElement()?.textContent).not.toContain("Bosun");
  });

  it("모델 글의 KEV 는 '결정 모델'로, 괄호 속 검토 신호 코드는 지워서 보인다(판단 이유·항목 모두)", async () => {
    // 2026-11-03 운영 FX-01 결과(a31220fa)에 실제로 나온 문장 모양이다. 저장 값은 두고 화면에서만 바꾼다(사용자 지시).
    const payload = {
      ...PAYLOAD,
      summary:
        "규칙 엔진이 추천으로 판정했습니다. 의견 불일치 및 KEV 필수 리스크 플래그가 있습니다.",
      improvements: [
        { text: "Kev 의견을 확인하세요.", refIds: ["B4"] },
        ...PAYLOAD.improvements.slice(1),
      ],
      factorNotes: [
        { factor: "scaleFit" as const, text: "KEV 기준으로도 규모가 맞습니다.", refIds: [] },
      ],
      nextSteps: [
        { text: "의견 불일치(MODEL_RULE_DISAGREEMENT)의 원인을 확인해야 합니다.", refIds: [] },
        {
          text: "KEV 필수 리스크(KEV_MANDATORY_RISK)에 해당하는 사항을 확인해야 합니다.",
          refIds: [],
        },
      ],
    };
    const host = renderPanel({ initialInsight: { ...DONE_V2, payload } });
    await expect.element(panel().getByText("규칙 엔진이 추천으로 판정했습니다.")).toBeVisible();
    await openWith("추천 분석 보기");
    await expect
      .element(
        dialog().getByText(
          "규칙 엔진이 추천으로 판정했습니다. 의견 불일치 및 결정 모델 필수 리스크 플래그가 있습니다.",
        ),
      )
      .toBeVisible();
    await expect.element(dialog().getByText("결정 모델 의견을 확인하세요.")).toBeVisible();
    await expect.element(dialog().getByText("결정 모델 기준으로도 규모가 맞습니다.")).toBeVisible();
    await expect.element(dialog().getByText("의견 불일치의 원인을 확인해야 합니다.")).toBeVisible();
    await expect
      .element(dialog().getByText("결정 모델 필수 리스크에 해당하는 사항을 확인해야 합니다."))
      .toBeVisible();
    const shown = `${host.textContent ?? ""} ${dialogElement()?.textContent ?? ""}`;
    for (const word of ["KEV", "Kev", "MODEL_RULE_DISAGREEMENT", "KEV_MANDATORY_RISK"]) {
      expect(shown).not.toContain(word);
    }
  });

  it("TEMPLATE·INJECTION_SUSPECTED 면 지시문 의심 안내를 보이고 [다시 요청] 이 없다", async () => {
    // 보안 리뷰 중-2: 입력이 의심스러우면 모델을 부르지 않는다. 같은 입력이면 다시 요청해도 같은 결과다.
    renderPanel({
      initialInsight: { ...DONE_TEMPLATE, fallbackReason: "INJECTION_SUSPECTED" },
    });
    await openWith("추천 분석 보기");
    const popup = dialog();
    await expect
      .element(popup.getByText(/지시문으로 의심되는 글이 있어 모델을 부르지 않고/))
      .toBeVisible();
    await expect.element(popup.getByText(PAYLOAD.summary)).toBeVisible();
    await expect.element(popup.getByText(/규칙 결과로 정리 ·/)).toBeVisible();
    await expect
      .element(popup.getByText("모델 설명을 쓰지 못해 규칙 결과로 정리했습니다."))
      .not.toBeInTheDocument();
    await expect.element(popup.getByRole("button", { name: "다시 요청" })).not.toBeInTheDocument();
  });

  it("Esc 로 닫히고, 닫으면 초점이 구역 버튼으로 돌아간다", async () => {
    renderPanel({ initialInsight: DONE_V2 });
    await openWith("추천 분석 보기");
    await expect.element(dialog().getByRole("region", { name: "추천 분석 내용" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect
      .element(panel().getByRole("button", { name: "추천 분석 보기", exact: true }))
      .toHaveFocus();
  });
});

describe("고지와 금지어", () => {
  // 근거 칩을 모두 펼쳐 인용까지 본다.
  const expandChips = (root: ParentNode) => {
    for (const chip of root.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")) {
      chip.click();
    }
  };

  it("결과 상태에서는 구역·팝업 어디에도 금지어(% 포함)가 없고 고지가 보인다", async () => {
    const cases: Partial<PanelProps>[] = [
      { initialInsight: null },
      { initialInsight: null, canRequest: false },
      { initialInsight: DONE_V2 },
      { initialInsight: DONE_OLD },
      { initialInsight: DONE_TEMPLATE },
      { initialInsight: FAILED },
      { initialInsight: FAILED, initialPrevious: DONE_V2 },
    ];
    for (const props of cases) {
      const host = renderPanel(props);
      await expect.element(panel().getByText(INSIGHT_NOTICE)).toBeVisible();
      expect(host.textContent).not.toMatch(FORBIDDEN);
      const viewButton = host.querySelector("button");
      if (viewButton?.textContent === "추천 분석 보기") {
        await openWith("추천 분석 보기");
        await expect.element(dialog().getByText(INSIGHT_NOTICE)).toBeVisible();
        expandChips(dialogElement()!);
        expect(dialogElement()?.textContent).not.toMatch(FORBIDDEN);
      }
      unmountAll();
    }
  });

  it("진행 상태에서는 진행 표시 밖 글자에 금지어가 없고, 진행 표시는 % 하나만 쓴다", async () => {
    startFakeClock();
    const host = renderPanel({ initialInsight: pendingAt(Date.now() - 75_000) });
    expect(host.textContent).not.toMatch(FORBIDDEN);
    await openWith("추천 분석 보기");
    // 75초 전 요청: floor(90 + 9 × 65초 / 170초) = 93
    await expect.element(progress()).toHaveAttribute("aria-valuenow", "93");
    await expect.element(dialog().getByText(INSIGHT_NOTICE)).toBeVisible();
    const element = dialogElement()!;
    expect(textOutsideProgress(element)).not.toMatch(FORBIDDEN);
    const progressText = element.querySelector('[data-slot="insight-progress"]')?.textContent ?? "";
    expect(progressText.match(/%/g)).toHaveLength(1);
    expect(progressText.replace("%", "")).not.toMatch(FORBIDDEN);
  });
});
