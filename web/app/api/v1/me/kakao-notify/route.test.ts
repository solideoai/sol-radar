import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FAKE_SUPABASE_URL,
  FAKE_USERS,
  fakeRequest,
  fakeSession,
  resetFakeSession,
} from "@/app/api/v1/_lib/fake-session";
import { GET as callback } from "./callback/route";
import { GET as connect } from "./connect/route";
import { DELETE, GET, PATCH } from "./route";
import { POST as requestTest } from "./test/route";

// 카카오 연결 Route Handler 계약(계획 Task 6). 인증(로그인·정지·CSRF 헤더)은 진짜 경로를 돌리고 SDK 전송만 바꾼다.
// 카카오 서비스 함수는 가짜다 — 흐름(state·토큰·암호화)은 kakao-notify.service.test 가 본다. 여기서는 상태 코드·본문·쿠키·이동을 본다.
vi.mock(
  "next/headers",
  async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders,
);
vi.mock("@supabase/ssr", async () => ({
  createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
}));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...(await original<typeof import("@supabase/supabase-js")>()),
  createClient: (await import("@/app/api/v1/_lib/fake-session")).fakeBearerClient,
}));
const service = vi.hoisted(() => ({
  getMyKakaoNotify: vi.fn(),
  setMyKakaoNotifyEnabled: vi.fn(),
  disconnectMyKakaoNotify: vi.fn(),
  requestMyKakaoNotifyTest: vi.fn(),
  startKakaoConnect: vi.fn(),
  completeKakaoConnect: vi.fn(),
  isKakaoStateCookieSecure: vi.fn(),
}));
vi.mock("@/server/kakao-notify", async (original) => ({
  ...(await original<typeof import("@/server/kakao-notify")>()),
  ...service,
}));

const USER = FAKE_USERS.sales;
const CSRF = { "X-Requested-With": "sol-radar" };
const STATE = "1792540800.bm9uY2Utbm9uY2Utbm9uY2U.mac";
const KAKAO_AUTHORIZE = "https://kauth.kakao.com/oauth/authorize?client_id=x&state=s";

const signIn = () => {
  fakeSession.cookie = USER.token;
};

async function errorOf(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json();
  expect(body.error).toMatchObject({ code, message: expect.any(String) });
  return body.error;
}

// 브라우저 이동. 설정 화면의 링크에서 오면 Sec-Fetch-Site 가 same-origin 이다(null 이면 머리를 싣지 않는다).
function navigation(
  path: string,
  cookie?: string,
  fetchSite: string | null = "same-origin",
): NextRequest {
  const request = new NextRequest(`https://app.example${path}`, {
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(fetchSite === null ? {} : { "Sec-Fetch-Site": fetchSite }),
    },
  });
  fakeSession.headers = request.headers;
  return request;
}

const setCookieOf = (response: Response): string => response.headers.get("set-cookie") ?? "";

beforeEach(() => {
  resetFakeSession();
  for (const mock of Object.values(service)) mock.mockReset();
  service.isKakaoStateCookieSecure.mockReturnValue(false);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /me/kakao-notify", () => {
  it("로그인 전이면 401, 서비스를 부르지 않는다", async () => {
    await errorOf(await GET(fakeRequest("/api/v1/me/kakao-notify")), 401, "UNAUTHENTICATED");
    expect(service.getMyKakaoNotify).not.toHaveBeenCalled();
  });

  it("정지된 계정이면 403 ACCOUNT_DISABLED", async () => {
    signIn();
    fakeSession.profileStatus = "suspended";
    await errorOf(await GET(fakeRequest("/api/v1/me/kakao-notify")), 403, "ACCOUNT_DISABLED");
  });

  it("로그인한 본인의 화면 상태를 돌려준다", async () => {
    signIn();
    service.getMyKakaoNotify.mockResolvedValue({
      state: "ON",
      lastSentAt: "2026-10-21T02:00:00.000Z",
      lastResult: "SENT",
    });
    const response = await GET(fakeRequest("/api/v1/me/kakao-notify"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      state: "ON",
      lastSentAt: "2026-10-21T02:00:00.000Z",
      lastResult: "SENT",
    });
    expect(service.getMyKakaoNotify).toHaveBeenCalledWith(USER.id);
  });
});

describe("PATCH /me/kakao-notify", () => {
  const patch = (body: unknown, headers: Record<string, string> = CSRF) =>
    PATCH(
      fakeRequest("/api/v1/me/kakao-notify", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    );

  it("요청 확인 헤더가 없으면 403 CSRF_REJECTED, 저장하지 않는다", async () => {
    signIn();
    await errorOf(await patch({ enabled: true }, {}), 403, "CSRF_REJECTED");
    expect(service.setMyKakaoNotifyEnabled).not.toHaveBeenCalled();
  });

  it("로그인 전이면 401", async () => {
    await errorOf(await patch({ enabled: true }), 401, "UNAUTHENTICATED");
  });

  it("본문을 서비스에 넘기고 204", async () => {
    signIn();
    service.setMyKakaoNotifyEnabled.mockResolvedValue("OK");
    const response = await patch({ enabled: false });
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(service.setMyKakaoNotifyEnabled).toHaveBeenCalledWith({ enabled: false });
  });

  it("본문이 틀리면 400 VALIDATION_ERROR", async () => {
    signIn();
    service.setMyKakaoNotifyEnabled.mockResolvedValue("INVALID");
    const error = await errorOf(await patch({ enabled: "yes" }), 400, "VALIDATION_ERROR");
    expect(error.details.issues).toEqual([
      { path: "enabled", message: "true 또는 false 여야 합니다." },
    ]);
  });

  it("연결 전이면 409 KAKAO_NOT_CONNECTED", async () => {
    signIn();
    service.setMyKakaoNotifyEnabled.mockResolvedValue("NOT_CONNECTED");
    await errorOf(await patch({ enabled: true }), 409, "KAKAO_NOT_CONNECTED");
  });

  it("저장이 던지면 500 INTERNAL_ERROR(봉투)", async () => {
    signIn();
    service.setMyKakaoNotifyEnabled.mockRejectedValue(new Error("kakao notify 저장 오류"));
    await errorOf(await patch({ enabled: true }), 500, "INTERNAL_ERROR");
  });
});

describe("DELETE /me/kakao-notify", () => {
  it("요청 확인 헤더가 없으면 403, 해제하지 않는다", async () => {
    signIn();
    await errorOf(
      await DELETE(fakeRequest("/api/v1/me/kakao-notify", { method: "DELETE" })),
      403,
      "CSRF_REJECTED",
    );
    expect(service.disconnectMyKakaoNotify).not.toHaveBeenCalled();
  });

  it("해제하고 204", async () => {
    signIn();
    service.disconnectMyKakaoNotify.mockResolvedValue(undefined);
    const response = await DELETE(
      fakeRequest("/api/v1/me/kakao-notify", { method: "DELETE", headers: CSRF }),
    );
    expect(response.status).toBe(204);
    expect(service.disconnectMyKakaoNotify).toHaveBeenCalledTimes(1);
  });
});

describe("POST /me/kakao-notify/test", () => {
  const post = (headers: Record<string, string> = CSRF) =>
    requestTest(fakeRequest("/api/v1/me/kakao-notify/test", { method: "POST", headers }));

  it("요청 확인 헤더가 없으면 403, 요청하지 않는다", async () => {
    signIn();
    await errorOf(await post({}), 403, "CSRF_REJECTED");
    expect(service.requestMyKakaoNotifyTest).not.toHaveBeenCalled();
  });

  it("맡기면 202 { queued: true }", async () => {
    signIn();
    service.requestMyKakaoNotifyTest.mockResolvedValue("QUEUED");
    const response = await post();
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: true });
  });

  it("같은 분 다시·하루 상한이면 429 KAKAO_TEST_THROTTLED 와 Retry-After", async () => {
    signIn();
    service.requestMyKakaoNotifyTest.mockResolvedValue("THROTTLED");
    const response = await post();
    expect(response.headers.get("Retry-After")).toBe("60");
    await errorOf(response, 429, "KAKAO_TEST_THROTTLED");
  });

  it("연결·켬이 아니면 409 KAKAO_NOT_READY", async () => {
    signIn();
    service.requestMyKakaoNotifyTest.mockResolvedValue("NOT_READY");
    await errorOf(await post(), 409, "KAKAO_NOT_READY");
  });
});

describe("GET /me/kakao-notify/connect", () => {
  it("로그인 전이면 설정 화면으로(failed), 쿠키·카카오 이동 없음", async () => {
    const response = await connect(navigation("/api/v1/me/kakao-notify/connect"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/settings?kakao=failed");
    expect(setCookieOf(response)).toBe("");
    expect(service.startKakaoConnect).not.toHaveBeenCalled();
  });

  it("서버 설정이 빠졌으면 설정 화면으로(failed)", async () => {
    signIn();
    service.startKakaoConnect.mockResolvedValue({ kind: "NOT_CONFIGURED" });
    const response = await connect(navigation("/api/v1/me/kakao-notify/connect"));
    expect(response.headers.get("location")).toBe("https://app.example/settings?kakao=failed");
    expect(setCookieOf(response)).toBe("");
  });

  it("카카오 동의 화면으로 보내고 state 쿠키를 콜백 경로에만 10분 굽는다", async () => {
    signIn();
    service.startKakaoConnect.mockResolvedValue({
      kind: "REDIRECT",
      redirectTo: KAKAO_AUTHORIZE,
      state: STATE,
      isSecureCookie: false,
    });
    const response = await connect(navigation("/api/v1/me/kakao-notify/connect"));
    expect(service.startKakaoConnect).toHaveBeenCalledWith(USER.id);
    expect(response.headers.get("location")).toBe(KAKAO_AUTHORIZE);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const cookie = setCookieOf(response);
    expect(cookie).toContain(`kakao_notify_state=${STATE}`);
    expect(cookie).toContain("Path=/api/v1/me/kakao-notify");
    expect(cookie).toContain("Max-Age=600");
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).not.toMatch(/Secure/i);
  });

  // 보안 검토(중): 다른 사이트가 이 주소로 최상위 이동시켜 끈 연결을 몰래 다시 켜지 못하게 한다.
  it.each([
    ["cross-site", "cross-site"],
    ["same-site(다른 하위 도메인)", "same-site"],
    ["머리 없음", null],
  ] as const)(
    "%s 에서 온 이동은 설정 화면으로(failed), 쿠키·카카오 이동 없음",
    async (_label, fetchSite) => {
      signIn();
      service.startKakaoConnect.mockResolvedValue({
        kind: "REDIRECT",
        redirectTo: KAKAO_AUTHORIZE,
        state: STATE,
        isSecureCookie: false,
      });
      const response = await connect(
        navigation("/api/v1/me/kakao-notify/connect", undefined, fetchSite),
      );
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("https://app.example/settings?kakao=failed");
      expect(setCookieOf(response)).toBe("");
      expect(service.startKakaoConnect).not.toHaveBeenCalled();
    },
  );

  it("주소창·북마크로 직접 연 이동(none)은 카카오로 보낸다", async () => {
    signIn();
    service.startKakaoConnect.mockResolvedValue({
      kind: "REDIRECT",
      redirectTo: KAKAO_AUTHORIZE,
      state: STATE,
      isSecureCookie: false,
    });
    const response = await connect(
      navigation("/api/v1/me/kakao-notify/connect", undefined, "none"),
    );
    expect(response.headers.get("location")).toBe(KAKAO_AUTHORIZE);
    expect(setCookieOf(response)).toContain(`kakao_notify_state=${STATE}`);
  });

  it("콜백 주소가 https 면 Secure 쿠키", async () => {
    signIn();
    service.startKakaoConnect.mockResolvedValue({
      kind: "REDIRECT",
      redirectTo: KAKAO_AUTHORIZE,
      state: STATE,
      isSecureCookie: true,
    });
    const response = await connect(navigation("/api/v1/me/kakao-notify/connect"));
    expect(setCookieOf(response)).toMatch(/Secure/i);
  });
});

describe("GET /me/kakao-notify/callback", () => {
  const callbackPath = `/api/v1/me/kakao-notify/callback?code=auth-code&state=${STATE}`;

  it("로그인한 본인·주소 검색값·state 쿠키를 서비스에 넘기고 결과로 설정 화면에 보낸다", async () => {
    signIn();
    service.completeKakaoConnect.mockResolvedValue({ outcome: "connected", reason: null });
    const response = await callback(navigation(callbackPath, `kakao_notify_state=${STATE}`));
    const [input] = service.completeKakaoConnect.mock.calls[0] as [
      { userId: string; params: URLSearchParams; stateCookie: string | undefined },
    ];
    expect(input.userId).toBe(USER.id);
    expect(input.params.get("code")).toBe("auth-code");
    expect(input.params.get("state")).toBe(STATE);
    expect(input.stateCookie).toBe(STATE);
    expect(response.headers.get("location")).toBe("https://app.example/settings?kakao=connected");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("state 쿠키는 결과와 상관없이 같은 경로로 지운다", async () => {
    signIn();
    service.completeKakaoConnect.mockResolvedValue({
      outcome: "state_mismatch",
      reason: "STATE_INVALID",
    });
    const response = await callback(navigation(callbackPath));
    expect(service.completeKakaoConnect.mock.calls[0]?.[0]).toMatchObject({
      stateCookie: undefined,
    });
    expect(response.headers.get("location")).toBe(
      "https://app.example/settings?kakao=state_mismatch",
    );
    const cookie = setCookieOf(response);
    expect(cookie).toContain("kakao_notify_state=;");
    expect(cookie).toContain("Path=/api/v1/me/kakao-notify");
    expect(cookie).toContain("Max-Age=0");
  });

  it("연결 실패는 결과·이유 코드만 한 줄 남긴다(code·state 는 싣지 않는다)", async () => {
    signIn();
    service.completeKakaoConnect.mockResolvedValue({
      outcome: "consent_denied",
      reason: "ACCESS_DENIED",
    });
    await callback(navigation(callbackPath, `kakao_notify_state=${STATE}`));
    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = String(vi.mocked(console.warn).mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: "kakao_notify.connect",
      outcome: "consent_denied",
      reason: "ACCESS_DENIED",
    });
    expect(line).not.toContain("auth-code");
    expect(line).not.toContain(STATE);
    expect(line).not.toContain(USER.id);
  });

  it("로그인 전이면 서비스를 부르지 않고 failed", async () => {
    const response = await callback(navigation(callbackPath, `kakao_notify_state=${STATE}`));
    expect(service.completeKakaoConnect).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example/settings?kakao=failed");
  });

  it("서비스가 던지면 failed 로 보내고 오류를 기록한다", async () => {
    signIn();
    service.completeKakaoConnect.mockRejectedValue(new Error("kakao notify 저장 오류"));
    const response = await callback(navigation(callbackPath, `kakao_notify_state=${STATE}`));
    expect(response.headers.get("location")).toBe("https://app.example/settings?kakao=failed");
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).not.toContain("auth-code");
  });
});
