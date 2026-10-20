import { startTransition, use, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { BID_LIST } from "@/components/bids/test-data";
import type { BidListItem } from "@/server/bids";
import { BidListMore } from "./bid-list-more";
import { BidListView } from "./bid-list-view";

// /bids 목록의 "더 보기"와 목록 화면 묶음(필터 + 결과 줄 + 표)을 진짜 브라우저에 그린다.
// 화면 이동과 fetch 는 가짜로 바꾸고, 부른 주소와 그려진 행만 잰다.
const nav = vi.hoisted(() => ({
  search: "",
  // true 면 push 를 기록만 하고 주소는 그대로 둔다. 대신 NavHarness 가 끝나지 않는 이동을 흉내 낸다.
  hold: false,
  navigate: null as ((href: string) => void) | null,
  listeners: new Set<() => void>(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  const subscribe = (fn: () => void) => {
    nav.listeners.add(fn);
    return () => nav.listeners.delete(fn);
  };
  return {
    __esModule: true,
    useRouter: () => ({
      push: (href: string, options?: { scroll: boolean }) => {
        nav.push(href, options);
        if (nav.hold) {
          nav.navigate?.(href);
          return;
        }
        nav.search = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
        nav.listeners.forEach((fn) => fn());
      },
      refresh: nav.refresh,
    }),
    usePathname: () => "/bids",
    useSearchParams: () =>
      new URLSearchParams(
        React.useSyncExternalStore(
          subscribe,
          () => nav.search,
          () => "",
        ),
      ),
  };
});
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, title, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className} title={title}>
      {children}
    </a>
  ),
}));

const NOW = "2026-10-16T00:00:00.000Z";
const FIRST = BID_LIST.slice(0, 2);
const MORE: BidListItem[] = [
  { ...BID_LIST[2], id: "bid-more-1" },
  { ...BID_LIST[3], id: "bid-more-2" },
];

const okPage = (items: BidListItem[], nextCursor: string | null) =>
  new Response(
    JSON.stringify({ items, pageInfo: { cursor: "c1", nextCursor, hasNext: nextCursor !== null } }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
const errorBody = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: "x", details: {}, requestId: "req-1" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Next 의 router.push 는 전환 안에서 라우터 상태를 바꾸고, 서버 응답이 올 때까지 그 렌더가 멈춘다(Suspense).
// 같은 모양으로: push 가 이 부품의 상태를 바꾸고, 바뀐 렌더가 끝나지 않는 약속을 기다린다. 그동안 전환은 대기 중이다.
const NEVER = new Promise<never>(() => undefined);
function Pending() {
  use(NEVER);
  return null;
}
function NavHarness({ children }: { children: React.ReactNode }) {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    nav.navigate = setTarget;
  }, []);
  return (
    <>
      {target === null ? null : <Pending />}
      {children}
    </>
  );
}

const fetchMock = vi.fn<typeof fetch>();
const mounted: Root[] = [];
beforeEach(() => {
  nav.search = "";
  nav.hold = false;
  nav.navigate = null;
  nav.push.mockClear();
  nav.refresh.mockClear();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
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

const more = (props: Partial<React.ComponentProps<typeof BidListMore>> = {}) =>
  render(
    <BidListMore
      initialItems={FIRST}
      initialNextCursor="c1"
      query="sort=score%3Adesc"
      now={NOW}
      empty={<p>비었다</p>}
      {...props}
    />,
  );
const rowCount = (host: HTMLElement) => host.querySelectorAll("tbody tr").length;
const urlOf = (call: Parameters<typeof fetch> | undefined) => String(call?.[0] ?? "");

describe("BidListMore", () => {
  it("[더 보기]를 누르면 같은 조건과 커서로 다음 쪽을 읽어 아래에 붙인다", async () => {
    fetchMock.mockResolvedValueOnce(okPage(MORE, null));
    const host = more();
    expect(rowCount(host)).toBe(2);
    await expect.element(page.getByRole("status")).toHaveTextContent("공고 2건 표시");
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.poll(() => rowCount(host)).toBe(4);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock.mock.lastCall)).toBe("/api/v1/bids?sort=score%3Adesc&cursor=c1");
    expect(
      host.querySelector('a[href="/bids/bid-more-1?list=sort%3Dscore%253Adesc"]'),
    ).not.toBeNull();
    await expect.element(page.getByRole("status")).toHaveTextContent("공고 4건 표시");
    // 다음 쪽이 없으면 단추가 사라지고 초점은 새로 붙은 첫 행으로 간다.
    expect(page.getByRole("button", { name: "더 보기" }).query()).toBeNull();
    await expect
      .poll(() => document.activeElement?.getAttribute("href"))
      .toBe("/bids/bid-more-1?list=sort%3Dscore%253Adesc");
  });

  it("조건이 없으면 커서만 붙여 읽는다", async () => {
    fetchMock.mockResolvedValueOnce(okPage(MORE, "c2"));
    more({ query: "" });
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.poll(() => urlOf(fetchMock.mock.lastCall)).toBe("/api/v1/bids?cursor=c1");
    // 다음 쪽이 더 있으면 단추가 남는다.
    await expect.element(page.getByRole("button", { name: "더 보기" })).toBeEnabled();
  });

  it("읽는 동안 단추는 불러오는 중…이고, 다시 눌러도 요청은 한 번이다", async () => {
    const pending = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const host = more();
    await page.getByRole("button", { name: "더 보기" }).click();
    const loading = page.getByRole("button", { name: "불러오는 중…" });
    await expect.element(loading).toHaveAttribute("aria-disabled", "true");
    (loading.element() as HTMLButtonElement).click();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    pending.resolve(okPage(MORE, null));
    await expect.poll(() => rowCount(host)).toBe(4);
  });

  it("400 INVALID_CURSOR 면 목록이 바뀌었다고 알리고 [처음부터 보기]로 같은 조건의 첫 쪽으로 간다", async () => {
    fetchMock.mockResolvedValueOnce(errorBody(400, "INVALID_CURSOR"));
    const transition = vi.fn((callback: () => void) => startTransition(callback));
    const host = more({ startTransition: transition });
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.element(page.getByText("목록이 바뀌었습니다")).toBeVisible();
    expect(page.getByText("더 불러오지 못했습니다").query()).toBeNull();
    expect(rowCount(host)).toBe(2);
    // 단추는 같은 자리의 같은 단추라 누른 초점이 사라지지 않는다.
    const restart = page.getByRole("button", { name: "처음부터 보기" });
    expect(document.activeElement).toBe(restart.element());
    await restart.click();
    // 이동은 전환 안에서 한 번만 한다(같은 주소면 refresh 를 따로 보내지 않는다).
    expect(transition).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push.mock.lastCall?.[0]).toBe("/bids?sort=score%3Adesc");
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("조건이 없을 때 [처음부터 보기]는 /bids 로 간다", async () => {
    fetchMock.mockResolvedValueOnce(errorBody(400, "INVALID_CURSOR"));
    more({ query: "" });
    await page.getByRole("button", { name: "더 보기" }).click();
    await page.getByRole("button", { name: "처음부터 보기" }).click();
    expect(nav.push.mock.lastCall?.[0]).toBe("/bids");
  });

  it.each([
    ["500 오류", () => Promise.resolve(errorBody(500, "INTERNAL_ERROR"))],
    ["네트워크 오류", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["모양이 다른 응답", () => Promise.resolve(new Response("{}", { status: 200 }))],
  ])("%s 면 더 불러오지 못했다고 알리고 [다시 시도]로 같은 커서를 다시 읽는다", async (_, fail) => {
    fetchMock.mockImplementationOnce(fail).mockResolvedValueOnce(okPage(MORE, null));
    const host = more();
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.element(page.getByText("더 불러오지 못했습니다")).toBeVisible();
    expect(rowCount(host)).toBe(2);
    // 실패해도 초점은 같은 단추([다시 시도])에 남는다.
    const retry = page.getByRole("button", { name: "다시 시도" });
    expect(document.activeElement).toBe(retry.element());
    await retry.click();
    await expect.poll(() => rowCount(host)).toBe(4);
    expect(fetchMock.mock.calls.map(urlOf)).toEqual([
      "/api/v1/bids?sort=score%3Adesc&cursor=c1",
      "/api/v1/bids?sort=score%3Adesc&cursor=c1",
    ]);
    expect(page.getByText("더 불러오지 못했습니다").query()).toBeNull();
  });

  it("다음 쪽에 이미 보이는 공고가 다시 오면 한 번만 그린다", async () => {
    fetchMock.mockResolvedValueOnce(okPage([FIRST[1], ...MORE], null));
    const host = more();
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.poll(() => rowCount(host)).toBe(4);
  });

  it("다음 쪽이 없으면 [더 보기]를 그리지 않고, 0건이면 빈 상태를 그린다", async () => {
    more({ initialNextCursor: null });
    expect(page.getByRole("button", { name: "더 보기" }).query()).toBeNull();
    mounted.splice(0).forEach((root) => root.unmount());
    document.body.replaceChildren();
    more({ initialItems: [], initialNextCursor: null });
    await expect.element(page.getByText("비었다")).toBeVisible();
    await expect.element(page.getByRole("status")).toHaveTextContent("공고 0건 표시");
  });

  it("서버가 새 첫 쪽을 주면 붙인 행과 실패 알림을 버리고 새 쪽부터 보인다", async () => {
    fetchMock
      .mockResolvedValueOnce(okPage(MORE, "c2"))
      .mockResolvedValueOnce(errorBody(500, "INTERNAL_ERROR"));
    const host = document.body.appendChild(document.createElement("div"));
    host.style.width = "960px";
    const root = createRoot(host);
    mounted.push(root);
    const draw = (items: BidListItem[], cursor: string | null) =>
      flushSync(() =>
        root.render(
          <BidListMore
            initialItems={items}
            initialNextCursor={cursor}
            query=""
            now={NOW}
            empty={null}
          />,
        ),
      );
    draw(FIRST, "c1");
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.poll(() => rowCount(host)).toBe(4);
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.element(page.getByText("더 불러오지 못했습니다")).toBeVisible();
    draw([BID_LIST[4]], null);
    await expect.poll(() => rowCount(host)).toBe(1);
    expect(page.getByText("더 불러오지 못했습니다").query()).toBeNull();
    expect(page.getByRole("button", { name: "다시 시도" }).query()).toBeNull();
  });

  // 첫 쪽이 바뀌는 렌더(전환)가 화면에 붙은 뒤, 정리 effect(abort)가 돌기 전에 옛 응답이 오는 경우.
  // 그 응답은 새 첫 쪽에 붙지 않아야 한다.
  it("첫 쪽이 바뀐 뒤 늦게 온 옛 응답은 새 목록에 붙지 않는다", async () => {
    const late = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(late.promise);
    const host = document.body.appendChild(document.createElement("div"));
    host.style.width = "960px";
    const root = createRoot(host);
    mounted.push(root);
    const view = (items: BidListItem[], cursor: string | null, extra?: React.ReactNode) => (
      <>
        <BidListMore
          initialItems={items}
          initialNextCursor={cursor}
          query=""
          now={NOW}
          empty={null}
        />
        {extra}
      </>
    );
    flushSync(() => root.render(view(FIRST, "c1")));
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.element(page.getByRole("button", { name: "불러오는 중…" })).toBeVisible();
    // 옛 응답은 마이크로태스크만으로 끝나게 만든다(실제 Response 의 본문 읽기는 다른 태스크로 넘어갈 수 있다).
    const body = { items: MORE, pageInfo: { cursor: "c1", nextCursor: null, hasNext: false } };
    const settleOld = () =>
      late.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    function ResolveDuringRender() {
      settleOld();
      return null;
    }
    startTransition(() => root.render(view([BID_LIST[4]], null, <ResolveDuringRender />)));
    await expect.poll(() => rowCount(host)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rowCount(host)).toBe(1);
    expect(host.querySelector('a[href="/bids/bid-more-1"]')).toBeNull();
  });

  it("화면을 떠나면 진행 중인 요청을 abort 한다", async () => {
    const pending = Promise.withResolvers<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    more();
    await page.getByRole("button", { name: "더 보기" }).click();
    const signal = fetchMock.mock.lastCall?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    mounted.splice(0).forEach((root) => root.unmount());
    expect(signal?.aborted).toBe(true);
    pending.resolve(okPage(MORE, null));
  });
});

describe("BidListView", () => {
  const view = (props: Partial<React.ComponentProps<typeof BidListView>> = {}, width = 960) =>
    render(
      <NavHarness>
        <BidListView
          defaultOrigin="demo"
          items={BID_LIST}
          nextCursor="c1"
          query=""
          now={NOW}
          showIngestHint={false}
          {...props}
        />
      </NavHarness>,
      width,
    );

  it.each([960, 1120])("%ipx 에서 필터 막대·결과 줄·표가 가로로 넘치지 않는다", (width) => {
    const host = view({}, width);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    const right = host.getBoundingClientRect().right;
    const overflowing = [...host.querySelectorAll("*")].filter((el) => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.right > right + 0.5;
    });
    expect(overflowing.map((el) => `${el.tagName}.${el.className}`)).toEqual([]);
    expect(host.querySelectorAll("thead th")).toHaveLength(10);
  });

  it("필터를 바꾸는 동안 표만 흐려지고 aria-busy 가 켜진다", async () => {
    nav.hold = true;
    const host = view();
    expect(host.querySelector('[aria-busy="true"]')).toBeNull();
    await page.getByRole("combobox", { name: "정렬" }).click();
    await page.getByRole("option", { name: "점수 높은 순" }).click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids?sort=score%3Adesc", { scroll: false });
    await expect.poll(() => host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(host.querySelector('[aria-busy="true"] table')).not.toBeNull();
    expect(host.querySelector('[aria-busy="true"] [role="search"]')).toBeNull();
  });

  it("조건이 있는데 0건이면 조건에 맞는 공고가 없다고 하고 [필터 초기화]로 /bids 에 간다", async () => {
    view({ items: [], nextCursor: null, query: "recommendation=BID" });
    await expect.element(page.getByText("조건에 맞는 공고가 없습니다")).toBeVisible();
    const buttons = page.getByRole("button", { name: "필터 초기화" });
    await buttons.last().click();
    expect(nav.push).toHaveBeenLastCalledWith("/bids", { scroll: false });
  });

  it("조건 없이 0건이면 아직 수집된 공고가 없다고 하고, 요청 안내는 showIngestHint 일 때만 보인다", async () => {
    view({ items: [], nextCursor: null, showIngestHint: true });
    await expect.element(page.getByText("아직 수집된 공고가 없습니다")).toBeVisible();
    await expect.element(page.getByText("관리자에게 수집을 요청하세요")).toBeVisible();
    expect(page.getByText("조건에 맞는 공고가 없습니다").query()).toBeNull();
  });

  it("결과 줄은 표 위에 있고 행 링크에 목록 조건을 붙인다", async () => {
    const host = view({ query: "decision=NONE" });
    const status = page.getByRole("status").filter({ hasText: "공고" });
    await expect.element(status).toHaveTextContent("공고 5건 표시");
    const table = host.querySelector("table") as HTMLElement;
    expect(status.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      table.getBoundingClientRect().top,
    );
    expect(host.querySelector('a[href="/bids/bid-fx-01?list=decision%3DNONE"]')).not.toBeNull();
  });
});
