import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
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
    () =>
      new Promise<WatchOutcome>((resolve) => {
        settle = resolve;
      }),
  );
  return { request, settle: (outcome: WatchOutcome) => settle(outcome) };
}

const isBusy = (button: HTMLElement) => button.getAttribute("aria-disabled") === "true";

describe("관심 토글 핵심 동작", () => {
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
});
