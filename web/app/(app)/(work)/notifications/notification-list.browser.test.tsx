import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { page } from "vitest/browser";
import { Toaster } from "@/components/ui/sonner";
import type { Notification } from "@/server/bids";
import { NotificationList } from "./notification-list";

// /notifications 목록을 진짜 브라우저에 그린다. 화면 이동과 fetch 는 가짜로 바꾸고, 보낸 요청과 이동만 잰다.
const spies = vi.hoisted(() => ({ push: vi.fn(), refreshTopbar: vi.fn() }));
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => ({ push: spies.push, refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, onClick, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/topbar-status", () => ({ refreshTopbarStatus: spies.refreshTopbar }));

const NOW = "2026-10-20T03:00:00.000Z";

// C7 가 만드는 실제 행과 같은 모양: 제목은 공고명, 내용은 고정 문장, 링크는 /bids/<id>.
const make = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  type: "REVIEW_ASSIGNED",
  channel: "IN_APP",
  status: "SENT",
  payload: {
    bidId: `bid-${id}`,
    title: `공고 ${id} 정보시스템 고도화 사업`,
    message: "결정 담당으로 지정되었습니다.",
    link: `/bids/bid-${id}`,
  },
  readAt: null,
  createdAt: "2026-10-20T02:00:00.000Z",
  ...over,
});
const UNREAD = make("n1");
const READ = make("n2", {
  type: "ANALYSIS_COMPLETE",
  payload: {
    bidId: "bid-n2",
    title: "공고 n2 클라우드 전환",
    message: "분석이 끝났습니다.",
    link: "/bids/bid-n2",
  },
  readAt: "2026-10-20T02:30:00.000Z",
});

const okPage = (items: Notification[], nextCursor: string | null) =>
  new Response(
    JSON.stringify({ items, pageInfo: { cursor: "c1", nextCursor, hasNext: nextCursor !== null } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const fetchMock = vi.fn<typeof fetch>();
const mounted: Root[] = [];
beforeEach(async () => {
  // 1280px 화면(사이드바 펼침 시 본문 960px)에서 잰다.
  await page.viewport(1280, 800);
  spies.push.mockReset();
  spies.refreshTopbar.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  // sonner 의 토스트 목록은 모듈 전역이라 시험 사이에 비운다.
  toast.dismiss();
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const render = (props: Partial<React.ComponentProps<typeof NotificationList>> = {}) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "960px";
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <>
        <NotificationList
          items={[UNREAD, READ]}
          nextCursor={null}
          unreadOnly={false}
          now={NOW}
          {...props}
        />
        <Toaster />
      </>,
    ),
  );
  mounted.push(root);
  return host;
};
const patchCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");

describe("NotificationList", () => {
  it("행 전체가 링크이고 유형·공고명·내용·상대 시각을 보인다", async () => {
    const host = render();
    const links = host.querySelectorAll("li a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/bids/bid-n1");
    await expect.element(page.getByText("결정 담당 지정")).toBeVisible();
    await expect.element(page.getByText("공고 n1 정보시스템 고도화 사업")).toBeVisible();
    await expect.element(page.getByText("분석이 끝났습니다.")).toBeVisible();
    expect(host.textContent).toContain("1시간 전");
    expect(host.querySelector("time")?.getAttribute("datetime")).toBe(UNREAD.createdAt);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  });

  it("안 읽은 행에만 점이 있고 스크린리더 글자 '안 읽음'을 읽는다", () => {
    const host = render();
    const rows = host.querySelectorAll("li");
    expect(rows[0].querySelector(".sr-only")?.textContent).toBe("안 읽음");
    expect(rows[0].querySelector('[data-part="unread-dot"]')).not.toBeNull();
    expect(rows[1].querySelector(".sr-only")).toBeNull();
    expect(rows[1].querySelector('[data-part="unread-dot"]')).toBeNull();
  });

  it("안 읽은 행을 누르면 PATCH 가 한 번(keepalive·CSRF 머리글)이고 그 뒤 링크로 이동한다", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    render();
    await page.getByRole("link", { name: /공고 n1/ }).click();
    expect(patchCalls()).toHaveLength(1);
    const [url, init] = patchCalls()[0];
    expect(String(url)).toBe("/api/v1/notifications/n1/read");
    expect(init?.keepalive).toBe(true);
    expect(init?.headers).toEqual({ "X-Requested-With": "sol-radar" });
    expect(spies.push).toHaveBeenCalledWith("/bids/bid-n1");
    // 읽음 처리가 끝나면 상단바 벨 수를 다시 읽고, 행은 읽은 모양이 된다.
    await expect.poll(() => spies.refreshTopbar.mock.calls.length).toBe(1);
    await expect.poll(() => document.querySelectorAll('[data-part="unread-dot"]').length).toBe(0);
  });

  it("읽은 행을 누르면 PATCH 없이 이동만 한다", async () => {
    render();
    await page.getByRole("link", { name: /공고 n2/ }).click();
    expect(patchCalls()).toHaveLength(0);
    expect(spies.push).toHaveBeenCalledWith("/bids/bid-n2");
  });

  it("PATCH 가 500 이어도 이동하고, 토스트로 알린다", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
    render();
    await page.getByRole("link", { name: /공고 n1/ }).click();
    expect(spies.push).toHaveBeenCalledWith("/bids/bid-n1");
    await expect.element(page.getByText("읽음으로 표시하지 못했습니다")).toBeVisible();
    expect(spies.refreshTopbar).not.toHaveBeenCalled();
    // 실패한 행은 여전히 안 읽음이다.
    expect(document.querySelectorAll('[data-part="unread-dot"]').length).toBe(1);
  });

  it("PATCH 요청이 던져도(네트워크 끊김) 이동하고 토스트로 알린다", async () => {
    fetchMock.mockRejectedValue(new TypeError("network"));
    render();
    await page.getByRole("link", { name: /공고 n1/ }).click();
    expect(spies.push).toHaveBeenCalledWith("/bids/bid-n1");
    await expect.element(page.getByText("읽음으로 표시하지 못했습니다")).toBeVisible();
  });

  it("안 읽은 알림만 보기에서 0건이면 안내와 [전체 보기] 링크를 보인다", async () => {
    const host = render({ items: [], unreadOnly: true });
    await expect.element(page.getByText("안 읽은 알림이 없습니다")).toBeVisible();
    expect(host.querySelector('a[href="/notifications"]')?.textContent).toContain("전체 보기");
  });

  it("전체 보기에서 0건이면 06 원문 안내를 보인다", async () => {
    const host = render({ items: [], unreadOnly: false });
    await expect
      .element(page.getByText("알림이 없습니다. 공고가 바뀌면 여기에 표시됩니다"))
      .toBeVisible();
    expect(host.querySelector("a")).toBeNull();
  });

  it("[더 보기]는 unreadOnly 조건과 커서로 다음 쪽을 읽어 붙인다", async () => {
    fetchMock.mockResolvedValueOnce(okPage([make("n3")], null));
    const host = render({ items: [UNREAD], nextCursor: "c1", unreadOnly: true });
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.poll(() => host.querySelectorAll("li").length).toBe(2);
    expect(String(fetchMock.mock.lastCall?.[0])).toBe(
      "/api/v1/notifications?unreadOnly=true&cursor=c1",
    );
  });

  it("더 보기가 실패하면 알리고 [다시 시도]를 보인다", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    render({ nextCursor: "c1" });
    await page.getByRole("button", { name: "더 보기" }).click();
    await expect.element(page.getByText("더 불러오지 못했습니다")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  });
});
