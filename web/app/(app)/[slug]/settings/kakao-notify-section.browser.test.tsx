import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { KakaoConnectOutcome, KakaoNotifyView } from "@/server/kakao-notify";
import { KakaoNotifySection } from "./kakao-notify-section";
import { SettingsSection } from "./settings-section";

// 개인 설정 "카카오톡 알림" 칸(설계 §9, 계획 Task 7). 상태 넷·연결 결과 안내·켬끔·해제·시험 요청을 진짜 브라우저로 본다.
const { router, toast } = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => router,
  usePathname: () => "/solideo/settings",
}));
vi.mock("sonner", () => ({ toast }));

const fetchMock = vi.fn<typeof fetch>();
const VIEWS: Record<KakaoNotifyView["state"], KakaoNotifyView> = {
  DISCONNECTED: { state: "DISCONNECTED", lastSentAt: null, lastResult: null },
  OFF: { state: "OFF", lastSentAt: null, lastResult: null },
  ON: { state: "ON", lastSentAt: "2026-10-21T02:00:00.000Z", lastResult: "SENT" },
  EXPIRED: { state: "EXPIRED", lastSentAt: "2026-10-20T23:30:00.000Z", lastResult: "EXPIRED" },
};

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
  vi.unstubAllGlobals();
});

const render = (view: KakaoNotifyView, outcome: KakaoConnectOutcome | null = null) =>
  root.render(
    <div className="@container mx-auto max-w-5xl px-8">
      <div className="divide-y divide-border">
        <SettingsSection
          id="settings-kakao-notify"
          title="카카오톡 알림"
          description="추천 공고(BID·WATCH 권고)가 나오면 내 카톡 '나와의 채팅'으로 받습니다."
        >
          <KakaoNotifySection view={view} outcome={outcome} />
        </SettingsSection>
      </div>
    </div>,
  );

const toggle = () => page.getByRole("switch", { name: "카카오톡 알림 받기" });
const requestOf = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return { url, init, headers: new Headers(init?.headers) };
};
const envelope = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { code: "X", message, details: {}, requestId: "r" } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("상태 넷", () => {
  it("연결 전: 스위치는 꺼진 채 비활성, 안내와 카카오 연결 링크", async () => {
    render(VIEWS.DISCONNECTED);
    await expect.element(toggle()).toBeDisabled();
    await expect.element(toggle()).not.toBeChecked();
    await expect
      .element(page.getByText("카카오 계정을 먼저 연결해야 켤 수 있습니다.", { exact: false }))
      .toBeVisible();
    const link = page.getByRole("link", { name: "카카오톡 알림 연결" });
    await expect.element(link).toHaveAttribute("href", "/api/v1/me/kakao-notify/connect");
    await expect.element(link).toHaveClass(/bg-kakao/);
    expect(page.getByRole("button", { name: "시험 메시지 보내기" }).elements()).toHaveLength(0);
  });

  it("연결됨·꺼짐: 스위치 꺼짐(누를 수 있음)과 연결 해제", async () => {
    render(VIEWS.OFF);
    await expect.element(toggle()).toBeEnabled();
    await expect.element(toggle()).not.toBeChecked();
    await expect.element(page.getByRole("button", { name: "연결 해제" })).toBeVisible();
    expect(page.getByRole("link", { name: "카카오톡 알림 연결" }).elements()).toHaveLength(0);
  });

  it("켜짐: 마지막 발송(서울 시각)과 시험 메시지 보내기", async () => {
    render(VIEWS.ON);
    await expect.element(toggle()).toBeChecked();
    await expect.element(page.getByText("마지막 발송: 10-21 11:00 · 보냄")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "시험 메시지 보내기" })).toBeVisible();
  });

  it("켜짐인데 보낸 적이 없으면 '아직 없음'", async () => {
    render({ state: "ON", lastSentAt: null, lastResult: null });
    await expect.element(page.getByText("마지막 발송: 아직 없음")).toBeVisible();
  });

  it("연결 만료: 스위치 켬, 경고, 다시 연결과 연결 해제", async () => {
    render(VIEWS.EXPIRED);
    await expect.element(toggle()).toBeChecked();
    await expect
      .element(page.getByText("카카오 연결이 만료되어 보내지 못하고 있습니다.", { exact: false }))
      .toBeVisible();
    await expect
      .element(page.getByRole("link", { name: "다시 연결" }))
      .toHaveAttribute("href", "/api/v1/me/kakao-notify/connect");
    // 보안 검토(하): 다시 연결하지 않을 사람도 저장된 토큰 암호문을 화면에서 지울 수 있어야 한다.
    await expect.element(page.getByRole("button", { name: "연결 해제" })).toBeVisible();
  });
});

describe("동작", () => {
  it("스위치를 켜면 PATCH { enabled: true } 를 요청 확인 헤더와 보내고 다시 읽는다", async () => {
    render(VIEWS.OFF);
    await toggle().click();
    await expect.poll(() => router.refresh.mock.calls.length).toBe(1);
    const { url, init, headers } = requestOf();
    expect(url).toBe("/api/v1/me/kakao-notify");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ enabled: true }));
    expect(headers.get("X-Requested-With")).toBe("sol-radar");
    expect(toast.success).toHaveBeenCalledWith("카카오톡 알림을 켰습니다");
  });

  it("켬이 거절되면(409) 서버 문구를 알리고 서버 값으로 다시 읽는다", async () => {
    fetchMock.mockResolvedValue(envelope(409, "카카오 계정을 먼저 연결해야 켤 수 있습니다."));
    render(VIEWS.OFF);
    await toggle().click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("카카오 계정을 먼저 연결해야 켤 수 있습니다.");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("연결 해제는 DELETE", async () => {
    render(VIEWS.OFF);
    await page.getByRole("button", { name: "연결 해제" }).click();
    await expect.poll(() => router.refresh.mock.calls.length).toBe(1);
    expect(requestOf().init?.method).toBe("DELETE");
    expect(requestOf().headers.get("X-Requested-With")).toBe("sol-radar");
    expect(toast.success).toHaveBeenCalledWith("카카오톡 알림 연결을 해제했습니다");
  });

  it("연결 만료에서도 연결 해제는 DELETE", async () => {
    render(VIEWS.EXPIRED);
    await page.getByRole("button", { name: "연결 해제" }).click();
    await expect.poll(() => router.refresh.mock.calls.length).toBe(1);
    expect(requestOf().init?.method).toBe("DELETE");
    expect(toast.success).toHaveBeenCalledWith("카카오톡 알림 연결을 해제했습니다");
  });

  it("시험 메시지는 POST /test, 202 면 안내", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ queued: true }), { status: 202 }));
    render(VIEWS.ON);
    await page.getByRole("button", { name: "시험 메시지 보내기" }).click();
    await expect.poll(() => toast.success.mock.calls.length).toBe(1);
    expect(requestOf().url).toBe("/api/v1/me/kakao-notify/test");
    expect(requestOf().init?.method).toBe("POST");
    expect(requestOf().headers.get("X-Requested-With")).toBe("sol-radar");
  });

  it("시험 메시지가 막히면(429) 서버 문구를 알린다", async () => {
    fetchMock.mockResolvedValue(
      envelope(429, "시험 메시지를 방금 보냈습니다. 잠시 뒤 다시 시도하세요."),
    );
    render(VIEWS.ON);
    await page.getByRole("button", { name: "시험 메시지 보내기" }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("시험 메시지를 방금 보냈습니다.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("네트워크가 끊기면 기본 문구", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(VIEWS.ON);
    await page.getByRole("button", { name: "시험 메시지 보내기" }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent("처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
  });
});

describe("연결하고 돌아온 결과(?kakao=…)", () => {
  it("connected 는 알림을 띄우고 주소에서 지운다", async () => {
    render(VIEWS.ON, "connected");
    await expect
      .poll(() => router.replace.mock.calls)
      .toEqual([["/solideo/settings", { scroll: false }]]);
    expect(toast.success).toHaveBeenCalledWith(
      "카카오톡 알림을 연결했습니다. 시험 메시지로 받아 보세요.",
    );
  });

  it.each([
    ["consent_denied", "메시지 전송에 동의해야 켤 수 있습니다."],
    ["state_mismatch", "연결 요청이 만료되었거나 올바르지 않습니다. 다시 연결해 주세요."],
    ["failed", "카카오톡 알림을 연결하지 못했습니다. 잠시 뒤 다시 시도해 주세요."],
  ] as const)("%s 는 안내 문구에 초점을 주고 주소에서 지운다", async (outcome, message) => {
    render(VIEWS.DISCONNECTED, outcome);
    const notice = page.getByText(message);
    await expect.element(notice).toBeVisible();
    await expect.element(notice).toHaveFocus();
    await expect.poll(() => router.replace.mock.calls.length).toBe(1);
  });
});

describe("화면 폭", () => {
  it.each([1440, 1280])("%s 폭에서 네 상태가 넘치지 않는다", async (width) => {
    await page.viewport(width, 720);
    for (const state of ["DISCONNECTED", "OFF", "ON", "EXPIRED"] as const) {
      render(VIEWS[state]);
      await expect.element(page.getByRole("heading", { name: "카카오톡 알림" })).toBeVisible();
      await expect.element(toggle()).toBeVisible();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    }
  });
});
