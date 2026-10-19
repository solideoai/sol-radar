import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  refreshTopbarStatus,
  TopbarStatus,
  useTopbarStore,
  type TopbarSummary,
} from "@/components/topbar-status";
import { NOTIFICATIONS } from "@/components/bids/test-data";

// next/link 는 브라우저 시험에서 process 를 찾아 못 불러온다. 목록 시험(bid-list)과 같이 <a> 로 바꾼다. Base UI 가 넘기는 속성·ref 는 그대로 받는다.
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    __esModule: true,
    default: React.forwardRef<HTMLAnchorElement, React.ComponentProps<"a">>(
      function MockLink(props, ref) {
        return <a ref={ref} {...props} />;
      },
    ),
  };
});

// Topbar 지표 묶음을 진짜 브라우저에서 본다. fetch 는 주소별로 바꿔 끼운다.
// 스펙 §4.2·§4.3: 순서 DEMO → 실행 모드 → AI → 수집 → 벨, 30초 polling(시험은 짧은 주기), 알림은 aria-live 없이 숨은 status 한 곳.

const mounted: Root[] = [];
const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const summaryOf = (
  over: Partial<TopbarSummary["dataFreshness"]> = {},
  unread = 2,
): TopbarSummary => ({
  dataFreshness: {
    lastIngestAt: ago(12 * MINUTE),
    lastIngestStatus: "SUCCEEDED",
    isDemo: true,
    lastIngestSummary: {
      created: 15,
      changed: 3,
      cancelled: 0,
      skippedDuplicate: 0,
      quarantined: 2,
      retried: 0,
    },
    ...over,
  },
  unreadNotifications: unread,
});

type Routes = {
  health?: () => Response;
  summary?: () => Response;
  notifications?: () => Response;
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const healthOk = (ai: string) => () =>
  json({ status: ai === "unavailable" ? "degraded" : "ok", checks: { ai } });

const calls: string[] = [];
const stubFetch = (routes: Routes) => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("/health/ready")) return (routes.health ?? healthOk("mock"))();
      if (url.startsWith("/api/v1/dashboard/summary"))
        return (routes.summary ?? (() => json(summaryOf())))();
      if (url.startsWith("/api/v1/notifications"))
        return (
          routes.notifications ??
          (() => json({ items: [], pageInfo: { cursor: null, nextCursor: null, hasNext: false } }))
        )();
      throw new Error(`예상하지 못한 요청 ${url}`);
    }),
  );
};
const callsTo = (prefix: string) => calls.filter((url) => url.startsWith(prefix)).length;

beforeEach(() => {
  useTopbarStore.getState().reset();
});

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

type Props = React.ComponentProps<typeof TopbarStatus>;
const render = (over: Partial<Props> = {}, width = 1024) => {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  // 바로 DOM 을 재야 해서 그리기를 끝까지 동기로 돌린다.
  flushSync(() =>
    root.render(
      <header style={{ width }} className="flex min-h-12 items-center gap-4 border-b px-4">
        <span className="type-label">입찰 공고</span>
        <div className="ml-auto">
          <TopbarStatus
            runMode="mock"
            initialSummary={summaryOf()}
            initialAi="mock"
            pollIntervalMs={60_000}
            {...over}
          />
        </div>
      </header>,
    ),
  );
  mounted.push(root);
  return host;
};
const part = (host: HTMLElement, name: string) =>
  host.querySelector<HTMLElement>(`[data-indicator="${name}"]`);
// 초점은 키보드(Tab)로 옮겨야 툴팁이 열린다. 목표 요소에 닿을 때까지 Tab 을 누른다.
const tabTo = async (target: HTMLElement | null | undefined) => {
  for (let i = 0; i < 8 && document.activeElement !== target; i += 1) await userEvent.tab();
  expect(document.activeElement).toBe(target);
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("TopbarStatus - 실행 모드와 DEMO", () => {
  it("mock 이면 DEMO 가 있고 실행 모드 값이 text-warning 이다", async () => {
    stubFetch({});
    const host = render({ runMode: "mock" });
    await expect.element(page.getByText("DEMO")).toBeInTheDocument();
    const mode = part(host, "run-mode");
    expect(mode?.textContent).toBe("실행 모드: mock");
    expect(mode?.querySelector('[data-part="value"]')?.className).toContain("text-warning");
  });

  it("live 이면 DEMO 가 없고 값이 text-foreground 이다", async () => {
    stubFetch({});
    const host = render({ runMode: "live" });
    await expect.element(page.getByText("실행 모드:")).toBeInTheDocument();
    expect(host.textContent).not.toContain("DEMO");
    const value = part(host, "run-mode")?.querySelector('[data-part="value"]');
    expect(value?.textContent).toBe("live");
    expect(value?.className).toContain("text-foreground");
    expect(value?.className).not.toContain("text-warning");
  });

  it("순서는 DEMO, 실행 모드, AI, 수집, 벨이고 사이에 세로 구분선 4개가 있다", async () => {
    stubFetch({});
    const host = render();
    await expect.element(page.getByText("AI: mock")).toBeInTheDocument();
    const order = Array.from(
      host.querySelectorAll<HTMLElement>('[data-slot="topbar-item"], [data-slot="separator"]'),
    ).map((el) => (el.dataset.slot === "separator" ? "|" : el.dataset.indicator));
    expect(order).toEqual(["demo", "|", "run-mode", "|", "ai", "|", "freshness", "|", "bell"]);
    expect(host.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });
});

describe("TopbarStatus - AI", () => {
  it("unavailable 이면 AI: unavailable 이 destructive 이고 숨은 status 가 한 번만 읽는다", async () => {
    stubFetch({ health: healthOk("unavailable") });
    const host = render({ initialAi: "mock" });
    await refreshTopbarStatus();
    await expect.element(page.getByText("AI: unavailable")).toBeInTheDocument();
    expect(part(host, "ai")?.className).toContain("text-destructive");
    const statuses = host.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe("AI 연결이 끊겼습니다");
    expect(statuses[0]?.className).toContain("sr-only");
    expect(host.querySelector("[aria-live]")).toBeNull();
    // 한 번 더 읽어도 status 는 하나이고 문구도 하나다.
    await refreshTopbarStatus();
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(host.textContent?.split("AI 연결이 끊겼습니다").length).toBe(2);
  });

  it("복구되면 status 문구가 비고 AI: local 로 돌아온다", async () => {
    stubFetch({ health: healthOk("unavailable") });
    const host = render({ initialAi: "mock" });
    await refreshTopbarStatus();
    await expect.element(page.getByText("AI: unavailable")).toBeInTheDocument();
    stubFetch({ health: healthOk("local") });
    await refreshTopbarStatus();
    await expect.element(page.getByText("AI: local")).toBeInTheDocument();
    expect(host.querySelector('[role="status"]')?.textContent).toBe("");
  });

  it("첫 응답 전에는 AI: 확인 중 이고, 응답이 오면 값으로 바뀐다", async () => {
    stubFetch({ health: healthOk("hosted") });
    render({ initialAi: null });
    await expect.element(page.getByText("AI: 확인 중")).toBeInTheDocument();
    await expect.element(page.getByText("AI: hosted")).toBeInTheDocument();
  });

  it("health 가 503 이면 마지막 값을 유지하고 툴팁이 상태를 확인하지 못했다고 한다", async () => {
    stubFetch({ health: () => json({ status: "unavailable" }, 503) });
    const host = render({ initialAi: "local" });
    await refreshTopbarStatus();
    expect(part(host, "ai")?.textContent).toBe("AI: local");
    await expect.poll(() => useTopbarStore.getState().healthFailed).toBe(true);
    await tabTo(part(host, "ai"));
    await expect.element(page.getByText("상태를 확인하지 못했습니다")).toBeInTheDocument();
  });

  it("health 에 네트워크 오류가 나도 마지막 값을 유지한다", async () => {
    stubFetch({
      health: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const host = render({ initialAi: "hosted" });
    await refreshTopbarStatus();
    expect(part(host, "ai")?.textContent).toBe("AI: hosted");
    expect(useTopbarStore.getState().healthFailed).toBe(true);
  });
});

describe("TopbarStatus - 수집 신선도", () => {
  it("정상이면 수집 12분 전, 툴팁에 절대 시각과 적재·격리 수가 있다", async () => {
    stubFetch({});
    const host = render();
    const item = part(host, "freshness");
    expect(item?.textContent).toBe("수집 12분 전");
    expect(item?.className).not.toContain("text-warning");
    expect(item?.className).not.toContain("text-destructive");
    await tabTo(item);
    await expect.element(page.getByText(/KST · .* UTC · 적재 15 · 격리 2/)).toBeInTheDocument();
  });

  it("툴팁의 적재는 created 만 센다(changed 를 더하지 않는다)", async () => {
    stubFetch({});
    const host = render({
      initialSummary: summaryOf({
        lastIngestSummary: {
          created: 19,
          changed: 4,
          cancelled: 0,
          skippedDuplicate: 0,
          quarantined: 1,
          retried: 0,
        },
      }),
    });
    await tabTo(part(host, "freshness"));
    await expect.element(page.getByText(/UTC · 적재 19 · 격리 1$/)).toBeInTheDocument();
  });

  it("60분 넘으면 수집 지연 · 2시간 전 이고 warning 이다", async () => {
    stubFetch({});
    const host = render({ initialSummary: summaryOf({ lastIngestAt: ago(125 * MINUTE) }) });
    const item = part(host, "freshness");
    expect(item?.textContent).toBe("수집 지연 · 2시간 전");
    expect(item?.className).toContain("text-warning");
  });

  it("마지막 수집이 FAILED 이면 수집 실패 · 3분 전 이고 destructive 이다", async () => {
    stubFetch({});
    const host = render({
      initialSummary: summaryOf({ lastIngestAt: ago(3 * MINUTE), lastIngestStatus: "FAILED" }),
    });
    const item = part(host, "freshness");
    expect(item?.textContent).toBe("수집 실패 · 3분 전");
    expect(item?.className).toContain("text-destructive");
  });

  it("lastIngestAt 이 null 이면 수집 기록 없음 이고 muted 이다", async () => {
    stubFetch({});
    const host = render({
      initialSummary: summaryOf({
        lastIngestAt: null,
        lastIngestStatus: null,
        lastIngestSummary: null,
      }),
    });
    const item = part(host, "freshness");
    expect(item?.textContent).toBe("수집 기록 없음");
    expect(item?.className).toContain("text-muted-foreground");
  });

  it("initialSummary 가 null 이고 첫 읽기도 실패하면 — 이다", async () => {
    stubFetch({ summary: () => json({ error: { code: "INTERNAL" } }, 500) });
    const host = render({ initialSummary: null });
    await expect.poll(() => useTopbarStore.getState().summaryFailed).toBe(true);
    expect(part(host, "freshness")?.textContent).toBe("—");
  });

  it("summary 가 실패하면 마지막 값을 유지하고 툴팁이 상태를 확인하지 못했다고 한다", async () => {
    stubFetch({ summary: () => json({}, 500) });
    const host = render();
    await refreshTopbarStatus();
    await expect.poll(() => useTopbarStore.getState().summaryFailed).toBe(true);
    const item = part(host, "freshness");
    expect(item?.textContent).toBe("수집 12분 전");
    expect(part(host, "bell")?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "알림, 안 읽음 2건",
    );
    await tabTo(item);
    await expect.element(page.getByText(/KST .*상태를 확인하지 못했습니다/)).toBeInTheDocument();
  });

  it("summary 응답이 오면 수집 지표와 벨 수가 바뀐다", async () => {
    stubFetch({ summary: () => json(summaryOf({ lastIngestAt: ago(5 * MINUTE + 5000) }, 7)) });
    const host = render();
    await refreshTopbarStatus();
    await expect.poll(() => part(host, "freshness")?.textContent).toBe("수집 5분 전");
    expect(part(host, "bell")?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "알림, 안 읽음 7건",
    );
  });
});

describe("TopbarStatus - 알림 벨", () => {
  it("안 읽음 12건이면 9+ 이고 aria-label 에 건수가 있다", async () => {
    stubFetch({});
    const host = render({ initialSummary: summaryOf({}, 12) });
    const button = part(host, "bell")?.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("알림, 안 읽음 12건");
    const badge = part(host, "bell")?.querySelector('[data-part="count"]');
    expect(badge?.textContent).toBe("9+");
    expect(badge?.getAttribute("aria-hidden")).toBe("true");
  });

  it("안 읽음 9건이면 숫자 그대로 9 이다", async () => {
    stubFetch({});
    const host = render({ initialSummary: summaryOf({}, 9) });
    expect(part(host, "bell")?.querySelector('[data-part="count"]')?.textContent).toBe("9");
  });

  it("0건이면 숫자 배지가 없고 aria-label 은 알림 이다", async () => {
    stubFetch({});
    const host = render({ initialSummary: summaryOf({}, 0) });
    expect(part(host, "bell")?.querySelector('[data-part="count"]')).toBeNull();
    expect(part(host, "bell")?.querySelector("button")?.getAttribute("aria-label")).toBe("알림");
  });

  it("누르면 목록을 읽어 최근 5건과 모두 보기 링크를 보인다", async () => {
    stubFetch({
      notifications: () =>
        json({
          items: NOTIFICATIONS.slice(0, 5),
          pageInfo: { cursor: null, nextCursor: null, hasNext: false },
        }),
    });
    const host = render();
    expect(callsTo("/api/v1/notifications")).toBe(0);
    await userEvent.click(part(host, "bell")!.querySelector("button")!);
    await expect.element(page.getByRole("menu")).toBeInTheDocument();
    expect(calls.some((url) => url === "/api/v1/notifications?limit=5")).toBe(true);
    await expect.element(page.getByText("결정 담당 지정")).toBeInTheDocument();
    const items = document.querySelectorAll('[role="menu"] a[href="/bids/bid-fx-01"]');
    expect(items).toHaveLength(5);
    const more = page.getByRole("menuitem", { name: "모두 보기" });
    await expect.element(more).toHaveAttribute("href", "/notifications");
    // 안 읽은 알림(readAt null) 2건에만 점이 있다.
    expect(document.querySelectorAll('[role="menu"] [data-part="unread-dot"]')).toHaveLength(2);
  });

  it("이상 항목(모르는 type·link 없음)이 섞여도 나머지를 그리고 오류가 없다", async () => {
    const [good, other] = NOTIFICATIONS;
    stubFetch({
      notifications: () =>
        json({
          items: [
            { ...good, type: "NEW_UNKNOWN_TYPE" },
            { ...other, id: "broken", payload: { title: "깨진 항목" } },
            other,
          ],
          pageInfo: { cursor: null, nextCursor: null, hasNext: false },
        }),
    });
    const host = render();
    await userEvent.click(part(host, "bell")!.querySelector("button")!);
    await expect.element(page.getByText("분석 완료").first()).toBeInTheDocument();
    expect(document.querySelectorAll('[role="menu"] a[href^="/bids"]')).toHaveLength(2);
    expect(document.body.textContent).not.toContain("깨진 항목");
    expect(document.body.textContent).not.toContain("알림을 불러오지 못했습니다");
  });

  it("0건이면 알림이 없습니다 를 보인다", async () => {
    stubFetch({});
    const host = render();
    await userEvent.click(part(host, "bell")!.querySelector("button")!);
    await expect.element(page.getByText("알림이 없습니다")).toBeInTheDocument();
  });

  it("목록 읽기가 실패하면 오류 문구를 보인다", async () => {
    stubFetch({ notifications: () => json({}, 500) });
    const host = render();
    await userEvent.click(part(host, "bell")!.querySelector("button")!);
    await expect.element(page.getByText("알림을 불러오지 못했습니다")).toBeInTheDocument();
  });
});

describe("TopbarStatus - 갱신", () => {
  it("주기마다 두 주소를 읽고 언마운트하면 멈춘다", async () => {
    stubFetch({});
    const host = render({ pollIntervalMs: 40 });
    await expect.poll(() => callsTo("/health/ready")).toBeGreaterThanOrEqual(2);
    expect(callsTo("/api/v1/dashboard/summary")).toBeGreaterThanOrEqual(2);
    mounted.splice(0).forEach((root) => root.unmount());
    await wait(60); // 이미 날아간 요청이 끝날 때까지
    const settled = calls.length;
    await wait(200);
    expect(calls.length).toBe(settled);
    host.remove();
  });

  it("창이 초점을 얻거나 다시 보이면 바로 한 번 읽고, 언마운트 뒤에는 읽지 않는다", async () => {
    stubFetch({});
    render();
    expect(callsTo("/health/ready")).toBe(0);
    window.dispatchEvent(new Event("focus"));
    await expect.poll(() => callsTo("/health/ready")).toBe(1);
    document.dispatchEvent(new Event("visibilitychange"));
    await expect.poll(() => callsTo("/health/ready")).toBe(2);
    mounted.splice(0).forEach((root) => root.unmount());
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    await wait(100);
    expect(callsTo("/health/ready")).toBe(2);
  });

  it("refreshTopbarStatus 는 두 주소를 바로 한 번 읽는다", async () => {
    stubFetch({});
    render();
    await refreshTopbarStatus();
    expect(callsTo("/health/ready")).toBe(1);
    expect(callsTo("/api/v1/dashboard/summary")).toBe(1);
  });
});

describe("TopbarStatus - 배치", () => {
  it("폭 1024px 안에서 묶음이 한 줄이고 높이가 48px 이하이다", async () => {
    stubFetch({});
    const host = render(
      {
        initialSummary: summaryOf({ lastIngestAt: ago(125 * MINUTE) }, 12),
        initialAi: "unavailable",
      },
      1024,
    );
    await expect.element(page.getByText("AI: unavailable")).toBeInTheDocument();
    const header = host.querySelector("header")!;
    expect(header.getBoundingClientRect().height).toBeLessThanOrEqual(48);
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
    const tops = Array.from(host.querySelectorAll<HTMLElement>('[data-slot="topbar-item"]')).map(
      (el) => Math.round(el.getBoundingClientRect().top),
    );
    expect(new Set(tops).size).toBeLessThanOrEqual(2); // 아이콘 높이 차이 정도만 허용
    const group = host.querySelector<HTMLElement>('[data-slot="topbar-status"]')!;
    expect(group.getBoundingClientRect().height).toBeLessThanOrEqual(48);
  });
});
