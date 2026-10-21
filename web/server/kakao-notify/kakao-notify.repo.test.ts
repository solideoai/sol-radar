import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import { KakaoNotifyStoreError, kakaoNotifyRepo } from "./kakao-notify.repo";

// 개인 설정 카카오 저장(계획 Task 6). 진짜 supabase-js 클라이언트에 가짜 fetch 를 물려 PostgREST 요청 모양과 오류 매핑을 본다.
const USER_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";

type Captured = { url: URL; method: string; body: unknown };
const { client, captured, reply } = vi.hoisted(() => ({
  client: vi.fn(),
  captured: [] as { url: URL; method: string; body: unknown }[],
  reply: { status: 200, body: null as unknown },
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: () => client(),
  getAuthClaims: vi.fn(),
  isSupabaseConfigured: () => true,
}));

const respond = (status: number, body: unknown) => {
  reply.status = status;
  reply.body = body;
};

beforeEach(() => {
  captured.length = 0;
  respond(200, null);
  client.mockReturnValue(
    createClient<Database>("https://supabase.example.invalid", "fake-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
          captured.push({ url: new URL(String(input)), method: init?.method ?? "GET", body });
          return reply.body === null && reply.status === 204
            ? new Response(null, { status: 204 })
            : new Response(JSON.stringify(reply.body), {
                status: reply.status,
                headers: { "Content-Type": "application/json" },
              });
        },
      },
    }),
  );
});

const only = (): Captured => {
  expect(captured).toHaveLength(1);
  return captured[0] as Captured;
};
const raised = (message: string) => ({ code: "P0001", message, details: null, hint: null });

describe("readMine", () => {
  it("화면 역할에 열린 열 넷만 고르고 본인 행으로 좁힌다", async () => {
    respond(200, [{ enabled: true, status: "CONNECTED", last_sent_at: null, last_result: "SENT" }]);
    await expect(kakaoNotifyRepo.readMine(USER_ID)).resolves.toEqual({
      enabled: true,
      status: "CONNECTED",
      last_sent_at: null,
      last_result: "SENT",
    });
    const request = only();
    expect(request.url.pathname).toBe("/rest/v1/kakao_notify_links");
    expect(request.url.searchParams.get("select")).toBe("enabled,status,last_sent_at,last_result");
    expect(request.url.searchParams.get("user_id")).toBe(`eq.${USER_ID}`);
  });

  it("행이 없으면 null", async () => {
    respond(200, []);
    await expect(kakaoNotifyRepo.readMine(USER_ID)).resolves.toBeNull();
  });

  it("상태·결과 값이 목록 밖이면 지어내지 않고 INVALID_ROW 로 던진다", async () => {
    respond(200, [{ enabled: true, status: "PAUSED", last_sent_at: null, last_result: null }]);
    await expect(kakaoNotifyRepo.readMine(USER_ID)).rejects.toMatchObject({
      name: "KakaoNotifyStoreError",
      code: "INVALID_ROW",
    });
    respond(200, [
      { enabled: true, status: "CONNECTED", last_sent_at: null, last_result: "QUEUED" },
    ]);
    await expect(kakaoNotifyRepo.readMine(USER_ID)).rejects.toMatchObject({
      code: "INVALID_ROW",
    });
  });

  it("PostgREST 오류는 code 만 실어 던진다", async () => {
    respond(401, { code: "42501", message: "permission denied for column access_token_enc" });
    const error = await kakaoNotifyRepo.readMine(USER_ID).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KakaoNotifyStoreError);
    expect(error).toMatchObject({ code: "42501" });
    expect(String((error as Error).message)).not.toContain("access_token_enc");
  });
});

describe("saveLink", () => {
  it("암호문과 ISO 만료 시각을 저장 RPC 에 넘긴다", async () => {
    respond(204, null);
    await kakaoNotifyRepo.saveLink({
      accessTokenEnc: "v1.kid.iv.tag.access",
      refreshTokenEnc: "v1.kid.iv.tag.refresh",
      accessExpiresAt: new Date("2026-10-21T09:00:00.000Z"),
      refreshExpiresAt: new Date("2026-12-20T03:00:00.000Z"),
    });
    const request = only();
    expect(request.method).toBe("POST");
    expect(request.url.pathname).toBe("/rest/v1/rpc/save_kakao_notify_link");
    expect(request.body).toEqual({
      p_access_token_enc: "v1.kid.iv.tag.access",
      p_refresh_token_enc: "v1.kid.iv.tag.refresh",
      p_access_expires_at: "2026-10-21T09:00:00.000Z",
      p_refresh_expires_at: "2026-12-20T03:00:00.000Z",
    });
  });

  it("RPC 가 거절하면(KAKAO_LINK_INVALID 등) 던진다", async () => {
    respond(400, raised("KAKAO_LINK_INVALID"));
    await expect(
      kakaoNotifyRepo.saveLink({
        accessTokenEnc: "v1.a",
        refreshTokenEnc: "v1.b",
        accessExpiresAt: new Date(0),
        refreshExpiresAt: new Date(0),
      }),
    ).rejects.toMatchObject({ name: "KakaoNotifyStoreError", code: "P0001" });
  });
});

describe("setEnabled", () => {
  it("켬·끔 값을 RPC 에 넘기고 OK", async () => {
    respond(204, null);
    await expect(kakaoNotifyRepo.setEnabled(false)).resolves.toBe("OK");
    const request = only();
    expect(request.url.pathname).toBe("/rest/v1/rpc/set_kakao_notify_enabled");
    expect(request.body).toEqual({ p_enabled: false });
  });

  it("연결 전(KAKAO_NOT_CONNECTED)이면 NOT_CONNECTED", async () => {
    respond(400, raised("KAKAO_NOT_CONNECTED"));
    await expect(kakaoNotifyRepo.setEnabled(true)).resolves.toBe("NOT_CONNECTED");
  });

  it("다른 오류는 던진다", async () => {
    respond(400, raised("UNAUTHENTICATED"));
    await expect(kakaoNotifyRepo.setEnabled(true)).rejects.toBeInstanceOf(KakaoNotifyStoreError);
  });
});

describe("disconnect", () => {
  it("해제 RPC 를 부른다", async () => {
    respond(204, null);
    await kakaoNotifyRepo.disconnect();
    expect(only().url.pathname).toBe("/rest/v1/rpc/disconnect_kakao_notify");
  });

  it("오류는 던진다", async () => {
    respond(503, { code: "PGRST000", message: "down" });
    await expect(kakaoNotifyRepo.disconnect()).rejects.toMatchObject({ code: "PGRST000" });
  });
});

describe("requestTest", () => {
  it("true 면 QUEUED, false 면 THROTTLED", async () => {
    respond(200, true);
    await expect(kakaoNotifyRepo.requestTest()).resolves.toBe("QUEUED");
    expect(captured[0]?.url.pathname).toBe("/rest/v1/rpc/request_kakao_notify_test");
    respond(200, false);
    await expect(kakaoNotifyRepo.requestTest()).resolves.toBe("THROTTLED");
  });

  it("연결·켬이 아니면(KAKAO_NOT_READY) NOT_READY", async () => {
    respond(400, raised("KAKAO_NOT_READY"));
    await expect(kakaoNotifyRepo.requestTest()).resolves.toBe("NOT_READY");
  });

  it("다른 오류는 던진다", async () => {
    respond(400, raised("UNAUTHENTICATED"));
    await expect(kakaoNotifyRepo.requestTest()).rejects.toBeInstanceOf(KakaoNotifyStoreError);
  });
});
