import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GoogleCalendarView } from "@/server/google-calendar";
import { GOOGLE_CONNECT_NOTICES } from "@/app/(app)/(work)/calendar/calendar-copy";
import { GoogleCalendarSection } from "./google-calendar-section";

// 설정 "구글 캘린더" 칸(ADR-073)의 상태 셋(연결 전·연결됨·만료)과 돌아온 결과 안내를 진짜 브라우저에 그린다.
// 요청(DELETE)은 가짜 fetch 고 토스트·라우터는 감시한다.

const spies = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: spies.toastSuccess, error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: spies.refresh, replace: spies.replace }),
  usePathname: () => "/solideo/settings",
}));

const mounted: Root[] = [];
beforeEach(() => {
  spies.toastSuccess.mockReset();
  spies.refresh.mockReset();
  spies.replace.mockReset();
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

const render = (node: React.ReactNode) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "448px";
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const viewOf = (extra: Partial<GoogleCalendarView> = {}): GoogleCalendarView => ({
  state: "CONNECTED",
  googleEmail: "me@gmail.invalid",
  hasCalendar: true,
  lastSyncedAt: "2026-10-30T06:05:00.000Z",
  lastResult: "SYNCED",
  ...extra,
});

it("연결 전에는 안내와 [구글 캘린더 연동] 링크만 있고 돌아갈 곳은 설정 경로다", () => {
  const host = render(
    <GoogleCalendarSection
      view={viewOf({
        state: "DISCONNECTED",
        googleEmail: null,
        hasCalendar: false,
        lastSyncedAt: null,
        lastResult: null,
      })}
      outcome={null}
      settingsPath="/solideo/settings"
    />,
  );
  const link = host.querySelector<HTMLAnchorElement>(
    'a[href^="/api/v1/me/google-calendar/connect"]',
  );
  expect(link?.textContent).toContain("구글 캘린더 연동");
  expect(link?.getAttribute("href")).toBe(
    "/api/v1/me/google-calendar/connect?next=%2Fsolideo%2Fsettings",
  );
  expect(host.textContent).toContain("보조 캘린더 'SOL RADAR 입찰 일정'");
  expect(host.querySelector("button")).toBeNull();
});

it("연결됨은 구글 계정·마지막 반영(서울 시각)·[구글 캘린더 열기]·[연결 해제]를 보이고, 해제는 확인 헤더로 DELETE 한다", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  });
  const host = render(
    <GoogleCalendarSection view={viewOf()} outcome={null} settingsPath="/solideo/settings" />,
  );
  expect(host.textContent).toContain("me@gmail.invalid");
  expect(host.textContent).toContain("연결됨");
  expect(host.textContent).toContain("마지막 반영: 10-30 15:05 · 넣음");
  const open = host.querySelector<HTMLAnchorElement>(
    'a[href="https://calendar.google.com/calendar/"]',
  );
  expect(open?.getAttribute("target")).toBe("_blank");
  expect(open?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(host.querySelector('a[href^="/api/v1/me/google-calendar/connect"]')).toBeNull();
  const disconnect = Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("연결 해제"),
  );
  disconnect?.click();
  await vi.waitFor(() => expect(spies.refresh).toHaveBeenCalled());
  expect(calls).toEqual([
    {
      url: "/api/v1/me/google-calendar",
      init: { method: "DELETE", headers: { "X-Requested-With": "sol-radar" } },
    },
  ]);
  expect(spies.toastSuccess).toHaveBeenCalledWith(
    "구글 캘린더 연결을 해제했습니다. 구글 캘린더에 넣은 일정은 남습니다.",
  );
});

it("만료는 경고와 [다시 연결]을 보이고, 돌아온 실패 결과는 안내에 초점을 두고 주소에서 지운다", async () => {
  const host = render(
    <GoogleCalendarSection
      view={viewOf({ state: "EXPIRED", lastResult: "EXPIRED" })}
      outcome="no_refresh_token"
      settingsPath="/solideo/settings"
    />,
  );
  expect(host.querySelector('[role="status"]')?.textContent).toContain("연결이 만료");
  const reconnect = host.querySelector<HTMLAnchorElement>(
    'a[href^="/api/v1/me/google-calendar/connect"]',
  );
  expect(reconnect?.textContent).toContain("다시 연결");
  const notice = Array.from(host.querySelectorAll("p")).find((p) =>
    p.textContent?.includes(GOOGLE_CONNECT_NOTICES.no_refresh_token),
  );
  expect(notice).toBeDefined();
  await vi.waitFor(() => expect(document.activeElement).toBe(notice));
  expect(spies.replace).toHaveBeenCalledWith("/solideo/settings", { scroll: false });
});
