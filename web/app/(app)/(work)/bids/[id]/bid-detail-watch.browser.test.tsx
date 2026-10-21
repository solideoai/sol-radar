import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { useEvidenceStore } from "@/components/bids/evidence-store";
import { BID_DOCUMENTS, BID_LIST, FX03_VIEW } from "@/components/bids/test-data";
import { WATCH_ADD_FAILED, WATCH_TOGGLE_LABEL } from "@/app/(app)/(work)/watch-copy";
import { BidDetailView, type DetailBid } from "./bid-detail-view";

// /bids/[id] 머리의 ★ 와 "관심 N명"(N3 디자인 §4.3, §9 M8·M9·M11, D5~D7·D14·D15).
// 요청은 진짜 requestWatch 가 fetch 를 부르고, fetch 는 가짜다. 분석 요청은 끝나지 않게 두어 "분석 요청 중…" 상태를 만든다.

const spies = vi.hoisted(() => {
  const toast = vi.fn();
  return {
    router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() },
    topbar: vi.fn(() => Promise.resolve()),
    toast,
    toastError: vi.fn(),
  };
});
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => spies.router }));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: spies.topbar }));
vi.mock("sonner", () => ({ toast: Object.assign(spies.toast, { error: spies.toastError }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const BID_ID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
const NOW = "2026-10-16T03:00:00Z";

const detail = (overrides: Partial<DetailBid> = {}): DetailBid => ({
  ...BID_LIST[1]!,
  id: BID_ID,
  noticeId: "DEMO-2026-0002",
  source: "fixture",
  content: "경기도교육청 통합 LMS 구축 사업.",
  documents: BID_DOCUMENTS,
  stageLinks: { planRef: null, preSpecRef: null },
  extractionStatus: "COMPLETED",
  latestAnalysis: null,
  reviews: [],
  ...overrides,
});

type ViewProps = React.ComponentProps<typeof BidDetailView>;
const props = (overrides: Partial<ViewProps> = {}): ViewProps => ({
  bid: detail(),
  previousScored: null,
  history: { items: [], hasMore: false },
  assessmentLabels: {},
  members: [{ id: "user-sales", name: "김영업" }],
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
  return host;
};

// /watch 요청만 시험이 정한 응답을 돌려주고, 그 밖(분석 요청 등)은 끝나지 않는다.
type WatchReply = { status: number; body: unknown };
const watchReplies: Array<(reply: WatchReply) => void> = [];
const fetchMock = vi.fn<typeof fetch>(async (input) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.endsWith("/watch")) return new Promise<Response>(() => undefined);
  const reply = await new Promise<WatchReply>((resolve) => watchReplies.push(resolve));
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
});
const replyWatch = (reply: WatchReply) => {
  const next = watchReplies.shift();
  if (next === undefined) throw new Error("기다리는 /watch 요청이 없다");
  next(reply);
};

beforeEach(async () => {
  await page.viewport(1280, 900);
  fetchMock.mockClear();
  watchReplies.splice(0);
  vi.stubGlobal("fetch", fetchMock);
  spies.toast.mockReset();
  spies.toastError.mockReset();
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  useEvidenceStore.setState({ open: false, context: null });
  vi.unstubAllGlobals();
});

const toggleOf = (host: HTMLElement) =>
  host.querySelector<HTMLButtonElement>('[data-slot="watch-toggle"]');
const countOf = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-slot="watch-count"]');
const isBusy = (button: HTMLElement) => button.getAttribute("aria-disabled") === "true";

describe("BidDetailView 관심 공고", () => {
  it("관심 요약이 없거나 null 이면 ★ 와 인원 글자 없이 머리를 그린다(D15)", () => {
    for (const watch of [undefined, null]) {
      const host = render(watch === undefined ? {} : { watch });
      expect(toggleOf(host)).toBeNull();
      expect(countOf(host)).toBeNull();
      expect(host.querySelector("h1")).not.toBeNull();
      mounted.splice(0).forEach((root) => root.unmount());
      document.body.replaceChildren();
    }
  });

  it("처음 값을 그리고, 숫자는 응답의 watcherCount 로만 바뀐다(D7·M11)", async () => {
    const host = render({ watch: { watched: false, watcherCount: 3 } });
    const toggle = toggleOf(host);
    const count = countOf(host);
    if (toggle === null || count === null) throw new Error("★·인원 글자가 없다");
    expect(toggle.getAttribute("aria-label")).toBe(WATCH_TOGGLE_LABEL);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(count.textContent).toBe("관심 3명");
    expect(count.getAttribute("aria-live")).toBe("polite");
    expect(toggle.getAttribute("aria-describedby")).toBe(count.id);

    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(count.textContent).toBe("관심 3명");
    const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
    expect(url).toBe(`/api/v1/bids/${BID_ID}/watch`);
    expect(init?.method).toBe("PUT");
    replyWatch({ status: 200, body: { bidId: BID_ID, watched: true, watcherCount: 4 } });
    await expect.poll(() => count.textContent).toBe("관심 4명");
    expect(isBusy(toggle)).toBe(false);

    await userEvent.click(toggle);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    replyWatch({ status: 200, body: { bidId: BID_ID, watched: false, watcherCount: 0 } });
    await expect.poll(() => count.textContent).toBe("");
    // 0명이어도 낭독 영역은 DOM 에 남고, ★ 는 빈 글자를 가리키지 않는다.
    expect(countOf(host)).toBe(count);
    expect(toggle.getAttribute("aria-describedby")).toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("요청이 실패하면 별을 되돌리고 숫자는 그대로이며 토스트 한 줄이다", async () => {
    const host = render({ watch: { watched: false, watcherCount: 2 } });
    const toggle = toggleOf(host);
    if (toggle === null) throw new Error("★ 가 없다");
    await userEvent.click(toggle);
    replyWatch({ status: 500, body: { error: { code: "INTERNAL_ERROR" } } });
    await expect.poll(() => toggle.getAttribute("aria-pressed")).toBe("false");
    expect(countOf(host)?.textContent).toBe("관심 2명");
    expect(spies.toastError).toHaveBeenCalledTimes(1);
    expect(spies.toastError).toHaveBeenCalledWith(WATCH_ADD_FAILED);
    expect(document.activeElement).toBe(toggle);
  });

  it("취소 공고·분석 권한 없음에도 ★ 는 누를 수 있다", () => {
    const host = render({
      bid: detail({ status: "CANCELLED" }),
      canAnalyze: false,
      canDecide: false,
      watch: { watched: true, watcherCount: 1 },
    });
    const toggle = toggleOf(host);
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-disabled")).not.toBe("true");
    expect(toggle?.disabled).toBe(false);
  });

  it("0명(글자 없음)과 3명일 때 ★ 의 가로 자리가 같다(M9)", () => {
    const zero = render({ watch: { watched: false, watcherCount: 0 } });
    const three = render({ watch: { watched: false, watcherCount: 3 } });
    const leftOf = (host: HTMLElement) =>
      (toggleOf(host)?.getBoundingClientRect().left ?? Number.NaN) -
      host.getBoundingClientRect().left;
    expect(countOf(zero)?.textContent).toBe("");
    expect(leftOf(zero)).toBeCloseTo(leftOf(three), 0);
  });

  it("관심 공고에서 열었으면 뒤로 링크가 '관심 공고'이고 /watchlist 로 간다(D14)", async () => {
    render({ backHref: "/watchlist?sort=deadlineAt%3Aasc", watch: null });
    await expect
      .element(page.getByRole("link", { name: "관심 공고" }))
      .toHaveAttribute("href", "/watchlist?sort=deadlineAt%3Aasc");
    expect(page.getByRole("link", { name: "공고 목록" }).elements()).toHaveLength(0);
  });

  it("목록에서 열었으면 뒤로 링크는 그대로 '공고 목록'이다", async () => {
    render({ backHref: "/bids?sort=score%3Adesc", watch: null });
    await expect
      .element(page.getByRole("link", { name: "공고 목록" }))
      .toHaveAttribute("href", "/bids?sort=score%3Adesc");
  });

  it.each([
    [1280, 1024],
    [1440, 1184],
  ])(
    "%ipx(상자 %ipx)에서 '관심 999명'·★·[원문 보기]·[분석 요청 중…]이 한 줄이고 ★ 는 36px 다(M8)",
    async (screen, box) => {
      await page.viewport(screen, 900);
      const host = render(
        {
          bid: detail({ latestAnalysis: FX03_VIEW }),
          watch: { watched: true, watcherCount: 999 },
        },
        box,
      );
      const shown = host.textContent ?? "";
      await Promise.all(
        ["400", "500", "600", "700"].map((weight) =>
          document.fonts.load(`${weight} 16px "Pretendard Variable"`, shown),
        ),
      );
      await document.fonts.ready;
      await userEvent.click(page.getByRole("button", { name: /분석 실행|재분석/ }));
      const analyze = page.getByRole("button", { name: /분석 요청 중/ });
      await expect.element(analyze).toBeInTheDocument();

      const toggle = toggleOf(host);
      const count = countOf(host);
      const original = page.getByRole("link", { name: "원문 보기 (새 탭)" }).element();
      if (toggle === null || count === null) throw new Error("★·인원 글자가 없다");
      expect(count.textContent).toBe("관심 999명");
      const t = toggle.getBoundingClientRect();
      expect([t.width, t.height]).toEqual([36, 36]);
      const middle = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return rect.top + rect.height / 2;
      };
      for (const element of [count, original, analyze.element()]) {
        expect(middle(element)).toBeCloseTo(middle(toggle), 0);
      }
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    },
  );
});
