import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { BidTable } from "@/components/bids/bid-table";
import { BID_LIST } from "@/components/bids/test-data";
import type { BidListItem } from "@/server/bids";
import type { WatchOutcome } from "./watch-bid";
import { WATCH_ADD_FAILED, WATCH_REMOVE_FAILED, WATCH_TOGGLE_LABEL } from "./watch-copy";
import { WatchToggle } from "./watch-toggle";

// ★ 토글(N3 디자인 §3·§4.1·§9 M1~M7·M10)을 진짜 브라우저에 그린다. 요청은 가짜(request prop)이고 토스트는 감시한다.
// 표 시험은 진짜 WatchToggle 을 BidTable 의 관심 열 슬롯에 꽂아 칸 폭·버튼 자리·초점 고리를 잰다.

const spies = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: spies.toastError } }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

const mounted: Root[] = [];
beforeEach(() => spies.toastError.mockReset());
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode, width = 960) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  host.className = "@container";
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const NOW = new Date("2026-10-16T00:00:00Z");
const BID_ID = "b1d00000-0000-4000-8000-000000000001";

const toggleOf = (host: ParentNode, bidId?: string): HTMLButtonElement => {
  const selector =
    bidId === undefined
      ? '[data-slot="watch-toggle"]'
      : `[data-slot="watch-toggle"][data-bid-id="${bidId}"]`;
  const found = host.querySelector<HTMLButtonElement>(selector);
  if (found === null) throw new Error(`${selector} 가 없다`);
  return found;
};

// 응답을 시험이 정할 때 돌려주는 가짜 요청.
function controlledRequest() {
  let settle: (outcome: WatchOutcome) => void = () => undefined;
  const request = vi.fn(
    (_bidId: string, _watched: boolean) =>
      new Promise<WatchOutcome>((resolve) => {
        settle = resolve;
      }),
  );
  return { request, settle: (outcome: WatchOutcome) => settle(outcome) };
}

const isBusy = (button: HTMLElement) => button.getAttribute("aria-disabled") === "true";

// 토큰 색을 같은 문서에서 계산해 비교한다(값을 시험에 적지 않는다).
const colorOf = (className: string) => {
  const probe = document.body.appendChild(document.createElement("span"));
  probe.className = className;
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
};

describe("WatchToggle", () => {
  it("이름은 상태와 상관없이 '관심 공고'이고 상태는 aria-pressed 로 알린다. 아이콘은 aria-hidden 이다", () => {
    const host = render(
      <>
        <WatchToggle bidId="off" initialWatched={false} size="row" request={vi.fn()} />
        <WatchToggle bidId="on" initialWatched size="row" request={vi.fn()} />
      </>,
    );
    for (const [bidId, pressed] of [
      ["off", "false"],
      ["on", "true"],
    ] as const) {
      const button = toggleOf(host, bidId);
      expect(button.tagName).toBe("BUTTON");
      expect(button.type).toBe("button");
      expect(button.getAttribute("aria-label")).toBe(WATCH_TOGGLE_LABEL);
      expect(button.getAttribute("aria-pressed")).toBe(pressed);
      expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("누르면 응답 전에 바로 켜지고, 응답 전 다시 눌러도 요청은 한 번이며, 성공 뒤 초점이 버튼에 남는다", async () => {
    const { request, settle } = controlledRequest();
    const onSettled = vi.fn();
    const host = render(
      <WatchToggle
        bidId={BID_ID}
        initialWatched={false}
        size="row"
        request={request}
        onSettled={onSettled}
      />,
    );
    const button = toggleOf(host);
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe(WATCH_TOGGLE_LABEL);
    expect(isBusy(button)).toBe(true);
    expect(onSettled).not.toHaveBeenCalled();

    // 요청 중(aria-disabled)에는 Playwright 클릭이 기다리므로 DOM 클릭으로 연타를 흉내 낸다.
    button.click();
    button.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(BID_ID, true);

    settle({ ok: true, watched: true, watcherCount: 1 });
    await expect.poll(() => isBusy(button)).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith({ watched: true, watcherCount: 1 });
    expect(document.activeElement).toBe(button);
    expect(spies.toastError).not.toHaveBeenCalled();

    // 다시 누르면 끄기(DELETE 쪽)를 부른다.
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(request).toHaveBeenLastCalledWith(BID_ID, false);
    settle({ ok: true, watched: false, watcherCount: 0 });
    await expect.poll(() => isBusy(button)).toBe(false);
    expect(onSettled).toHaveBeenLastCalledWith({ watched: false, watcherCount: 0 });
  });

  it("응답 전에는 되돌리지 않고, 응답이 오면 응답의 watched 로 확정한다", async () => {
    const { request, settle } = controlledRequest();
    const host = render(
      <WatchToggle bidId={BID_ID} initialWatched={false} size="row" request={request} />,
    );
    const button = toggleOf(host);
    await userEvent.click(button);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    settle({ ok: true, watched: false, watcherCount: 0 });
    await expect.poll(() => isBusy(button)).toBe(false);
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(spies.toastError).not.toHaveBeenCalled();
  });

  it.each([
    [false, "true", WATCH_ADD_FAILED],
    [true, "false", WATCH_REMOVE_FAILED],
  ] as const)(
    "처음 %s 에서 누른 요청이 실패하면 되돌리고 방향에 맞는 토스트를 한 번 내며 초점은 버튼에 남는다",
    async (initialWatched, pressedWhilePending, message) => {
      const { request, settle } = controlledRequest();
      const onSettled = vi.fn();
      const host = render(
        <WatchToggle
          bidId={BID_ID}
          initialWatched={initialWatched}
          size="header"
          request={request}
          onSettled={onSettled}
        />,
      );
      const button = toggleOf(host);
      await userEvent.click(button);
      expect(button.getAttribute("aria-pressed")).toBe(pressedWhilePending);
      settle({ ok: false });
      await expect.poll(() => isBusy(button)).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe(String(initialWatched));
      expect(spies.toastError).toHaveBeenCalledTimes(1);
      expect(spies.toastError).toHaveBeenCalledWith(message);
      expect(onSettled).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(button);
    },
  );

  it("Enter·Space 로도 토글한다", async () => {
    const request = vi.fn(async (_bidId: string, watched: boolean) => ({
      ok: true as const,
      watched,
      watcherCount: watched ? 1 : 0,
    }));
    const host = render(
      <WatchToggle bidId={BID_ID} initialWatched={false} size="row" request={request} />,
    );
    const button = toggleOf(host);
    button.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => button.getAttribute("aria-pressed")).toBe("true");
    await expect.poll(() => isBusy(button)).toBe(false);
    await userEvent.keyboard(" ");
    await expect.poll(() => button.getAttribute("aria-pressed")).toBe("false");
    expect(request.mock.calls.map(([, watched]) => watched)).toEqual([true, false]);
  });

  it("켜진 별은 brand 로 채우고, 꺼진 별은 muted-foreground 선만 둔다(D2)", () => {
    const host = render(
      <>
        <WatchToggle bidId="off" initialWatched={false} size="row" request={vi.fn()} />
        <WatchToggle bidId="on" initialWatched size="row" request={vi.fn()} />
      </>,
    );
    const offIcon = toggleOf(host, "off").querySelector("svg") as SVGElement;
    const onIcon = toggleOf(host, "on").querySelector("svg") as SVGElement;
    const brand = colorOf("text-brand");
    expect(getComputedStyle(onIcon).color).toBe(brand);
    expect(getComputedStyle(onIcon).fill).toBe(brand);
    expect(getComputedStyle(offIcon).color).toBe(colorOf("text-muted-foreground"));
    expect(getComputedStyle(offIcon).fill).toBe("none");
  });

  it("표 행은 32px, 상세 머리는 36px 버튼이고 아이콘은 16px 다", () => {
    const host = render(
      <>
        <WatchToggle bidId="row" initialWatched={false} size="row" request={vi.fn()} />
        <WatchToggle bidId="header" initialWatched={false} size="header" request={vi.fn()} />
      </>,
    );
    for (const [bidId, size] of [
      ["row", 32],
      ["header", 36],
    ] as const) {
      const button = toggleOf(host, bidId);
      const rect = button.getBoundingClientRect();
      expect([rect.width, rect.height]).toEqual([size, size]);
      const icon = (button.querySelector("svg") as SVGElement).getBoundingClientRect();
      expect([icon.width, icon.height]).toEqual([16, 16]);
    }
  });
});

// ── BidTable 관심 열(디자인 §4.1, §9 M1~M7) ──

const WATCHED = new Set([BID_LIST[0]?.id]);
// 표 시험의 요청은 끝나지 않는다(누른 뒤 모양만 본다).
const neverSettles = () => new Promise<WatchOutcome>(() => undefined);
const watchSlot = (item: BidListItem, titleId: string) => (
  <WatchToggle
    key={`${item.id}:${WATCHED.has(item.id)}`}
    bidId={item.id}
    initialWatched={WATCHED.has(item.id)}
    size="row"
    describedBy={titleId}
    request={neverSettles}
  />
);

const headsOf = (host: HTMLElement) =>
  [...host.querySelectorAll("thead th")].map((th) => th.textContent);

async function loadFonts(host: HTMLElement) {
  const shown = host.textContent ?? "";
  await Promise.all(
    ["400", "500", "600", "700"].map((weight) =>
      document.fonts.load(`${weight} 16px "Pretendard Variable"`, shown),
    ),
  );
  await document.fonts.ready;
}

describe("BidTable 관심 열", () => {
  it.each([960, 1120, 1216, 1376])(
    "%ipx 에서 맨 앞 40px 관심 열을 더한 11열이고 제목 열만 줄며 가로로 넘치지 않는다(M1·M2·M5)",
    async (width) => {
      const host = render(
        <BidTable items={BID_LIST} caption="공고 목록" now={NOW} watch={watchSlot} />,
        width,
      );
      await loadFonts(host);
      expect(headsOf(host)).toEqual([
        "관심",
        "출처",
        "단계",
        "제목",
        "발주기관",
        "예산",
        "마감",
        "SOL Score",
        "권고",
        "분석 상태",
        "최종 결정",
      ]);
      const widths = [...host.querySelectorAll("thead th")].map(
        (th) => th.getBoundingClientRect().width,
      );
      expect(widths.slice(0, 3)).toEqual([40, 80, 72]);
      expect(widths.slice(4)).toEqual([120, 80, 72, 80, 88, 96, 88]);
      expect(widths[3]).toBeCloseTo(width - 816, 0);
      const table = host.querySelector("table") as HTMLElement;
      expect(table.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
      const spilled = [
        ...host.querySelectorAll("thead th"),
        ...host.querySelectorAll("tbody tr td:first-child"),
      ].filter((cell) => cell.scrollWidth > cell.clientWidth);
      expect(spilled.map((cell) => cell.textContent)).toEqual([]);
    },
  );

  it("★ 는 32px 이고 칸 가운데에 있으며, 3px 초점 고리가 칸 안에 든다(M3)", () => {
    const host = render(
      <BidTable items={BID_LIST} caption="공고 목록" now={NOW} watch={watchSlot} />,
      960,
    );
    for (const row of host.querySelectorAll("tbody tr")) {
      const cell = row.querySelector("td") as HTMLElement;
      const button = toggleOf(cell);
      const b = button.getBoundingClientRect();
      const c = cell.getBoundingClientRect();
      expect([b.width, b.height]).toEqual([32, 32]);
      expect(b.left + b.width / 2).toBeCloseTo(c.left + c.width / 2, 0);
      expect(b.top + b.height / 2).toBeCloseTo(c.top + c.height / 2, 0);
      expect(b.left - 3).toBeGreaterThanOrEqual(c.left);
      expect(b.right + 3).toBeLessThanOrEqual(c.right);
      expect(b.top - 3).toBeGreaterThanOrEqual(c.top);
      expect(b.bottom + 3).toBeLessThanOrEqual(c.bottom);
    }
  });

  it("관심 열을 켜도 행 높이가 같다(M4)", () => {
    const heightsOf = (host: HTMLElement) =>
      [...host.querySelectorAll("tbody tr")].map((tr) => tr.getBoundingClientRect().height);
    // ★ 칸 자체가 행을 키우지 않는지 본다. ★ 열(40px)만큼 제목 열이 줄면 한 줄 제목이 두 줄이 될 수 있어(1120 에서 344 → 304px),
    // ★ 없는 표는 40px 좁게 그려 두 표의 제목 열을 304px 로 맞춘다(디자인 §4.1 열 폭 표).
    const without = render(<BidTable items={BID_LIST} caption="공고 목록" now={NOW} />, 1080);
    const withWatch = render(
      <BidTable items={BID_LIST} caption="공고 목록" now={NOW} watch={watchSlot} />,
      1120,
    );
    const before = heightsOf(without);
    const after = heightsOf(withWatch);
    expect(after).toHaveLength(before.length);
    after.forEach((height, i) => expect(height).toBeCloseTo(before[i] ?? 0, 0));
  });

  it("★ 는 링크 밖에 있고 같은 행 제목 링크를 aria-describedby 로 가리키며, 제목 링크 주소는 그대로다(M7)", async () => {
    const host = render(
      <BidTable
        items={BID_LIST}
        caption="공고 목록"
        now={NOW}
        listQuery="watched=me"
        watch={watchSlot}
      />,
    );
    for (const row of host.querySelectorAll("tbody tr")) {
      const button = toggleOf(row);
      expect(button.closest("a")).toBeNull();
      const describedBy = button.getAttribute("aria-describedby") ?? "";
      const title = document.getElementById(describedBy);
      expect(title?.tagName).toBe("A");
      expect(row.contains(title)).toBe(true);
      expect(title?.getAttribute("href")).toBe(
        `/bids/${button.dataset.bidId}?list=${encodeURIComponent("watched=me")}`,
      );
    }
    const first = BID_LIST[0]?.id ?? "";
    expect(toggleOf(host, first).getAttribute("aria-pressed")).toBe("true");
    // ★ 를 눌러도 링크 클릭이 일어나지 않는다.
    const clicks = vi.fn((event: Event) => event.preventDefault());
    host.querySelectorAll("a").forEach((a) => a.addEventListener("click", clicks));
    await userEvent.click(toggleOf(host, first));
    expect(clicks).not.toHaveBeenCalled();
  });

  it("compact 표는 watch 를 주어도 관심 열을 그리지 않는다(M6)", () => {
    const host = render(
      <BidTable items={BID_LIST} caption="표" now={NOW} compact watch={watchSlot} />,
      1118,
    );
    expect(headsOf(host)).not.toContain("관심");
    expect(host.querySelector('[data-slot="watch-toggle"]')).toBeNull();
  });
});
