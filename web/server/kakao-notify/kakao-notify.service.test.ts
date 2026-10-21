import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KakaoTokenError, type KakaoApi, type KakaoTokenSet } from "./kakao-api";
import type { KakaoConnectConfig } from "./kakao-connect.config";
import type { KakaoNotifyRow } from "./kakao-notify.model";
import type { KakaoNotifyRepo, SealedKakaoLink } from "./kakao-notify.repo";
import {
  completeKakaoConnect,
  disconnectMyKakaoNotify,
  getMyKakaoNotify,
  loadMyKakaoNotify,
  requestMyKakaoNotifyTest,
  setMyKakaoNotifyEnabled,
  startKakaoConnect,
  toKakaoConnectOutcome,
  type KakaoNotifyDeps,
} from "./kakao-notify.service";
import { decryptKakaoToken } from "./kakao-token.crypto";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

// 개인 설정 카카오 연결 흐름(계획 Task 6, Review Focus 5). 저장·카카오 API 는 가짜, 암호화·state 는 진짜다.
const USER_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const OTHER_USER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = new Date("2026-10-21T03:00:00.000Z");
const ACCESS_TOKEN = "kakao-access-평문-토큰";
const REFRESH_TOKEN = "kakao-refresh-평문-토큰";

const newConfig = (redirectUri = "http://localhost:3000/api/v1/me/kakao-notify/callback") => ({
  restApiKey: "rest-key-for-test",
  clientSecret: "client-secret-for-test",
  tokenKey: randomBytes(32).toString("base64"),
  redirectUri,
});

const tokenSet = (overrides: Partial<KakaoTokenSet> = {}): KakaoTokenSet => ({
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  accessExpiresAt: new Date("2026-10-21T09:00:00.000Z"),
  refreshExpiresAt: new Date("2026-12-20T03:00:00.000Z"),
  scopes: ["talk_message"],
  ...overrides,
});

type Harness = {
  deps: KakaoNotifyDeps;
  config: KakaoConnectConfig;
  saved: SealedKakaoLink[];
  exchanges: { code: string; redirectUri: string }[];
  authorizeInputs: { redirectUri: string; state: string }[];
};

function harness(
  options: {
    config?: KakaoConnectConfig | null;
    exchange?: () => Promise<KakaoTokenSet>;
    row?: KakaoNotifyRow | null;
    saveLink?: (sealed: SealedKakaoLink) => Promise<void>;
    signedIn?: boolean;
    isDatabaseConfigured?: boolean;
  } = {},
): Harness {
  const config = options.config === undefined ? newConfig() : options.config;
  const saved: SealedKakaoLink[] = [];
  const exchanges: { code: string; redirectUri: string }[] = [];
  const authorizeInputs: { redirectUri: string; state: string }[] = [];
  const api: KakaoApi = {
    authorizeUrl: (input) => {
      authorizeInputs.push(input);
      return `https://kauth.kakao.com/oauth/authorize?state=${input.state}`;
    },
    exchangeCode: async (input) => {
      exchanges.push(input);
      return (options.exchange ?? (async () => tokenSet()))();
    },
    refresh: async () => {
      throw new Error("웹 서버는 갱신하지 않는다");
    },
    sendMemo: async () => {
      throw new Error("웹 서버는 보내지 않는다");
    },
  };
  const repo: KakaoNotifyRepo = {
    isConfigured: () => options.isDatabaseConfigured ?? true,
    currentUserId: async () => (options.signedIn === false ? null : USER_ID),
    readMine: async (userId) => (userId === USER_ID ? (options.row ?? null) : null),
    saveLink: async (sealed) => {
      saved.push(sealed);
      await options.saveLink?.(sealed);
    },
    setEnabled: async (enabled) => (enabled ? "NOT_CONNECTED" : "OK"),
    disconnect: async () => {},
    requestTest: async () => "THROTTLED",
  };
  return {
    deps: { repo, config: () => config, api: () => api, now: () => NOW },
    config: config ?? newConfig(),
    saved,
    exchanges,
    authorizeInputs,
  };
}

const callbackParams = (entries: Record<string, string>) => new URLSearchParams(entries);
const stateFor = (config: KakaoConnectConfig, userId = USER_ID, now = NOW) =>
  createOAuthState({ userId, now, secret: config.tokenKey });

describe("getMyKakaoNotify", () => {
  it("행이 없으면 DISCONNECTED, 켜 둔 연결이면 ON", async () => {
    await expect(getMyKakaoNotify(USER_ID, harness().deps)).resolves.toEqual({
      state: "DISCONNECTED",
      lastSentAt: null,
      lastResult: null,
    });
    const row: KakaoNotifyRow = {
      enabled: true,
      status: "CONNECTED",
      last_sent_at: "2026-10-21T02:00:00.000Z",
      last_result: "SENT",
    };
    await expect(getMyKakaoNotify(USER_ID, harness({ row }).deps)).resolves.toEqual({
      state: "ON",
      lastSentAt: "2026-10-21T02:00:00.000Z",
      lastResult: "SENT",
    });
  });
});

describe("toKakaoConnectOutcome", () => {
  it("넷만 받고 나머지(배열·모르는 값·빈 값)는 null", () => {
    for (const outcome of ["connected", "consent_denied", "state_mismatch", "failed"] as const) {
      expect(toKakaoConnectOutcome(outcome)).toBe(outcome);
    }
    for (const value of [undefined, "", "CONNECTED", "linked", ["connected"], 1]) {
      expect(toKakaoConnectOutcome(value)).toBeNull();
    }
  });
});

describe("loadMyKakaoNotify", () => {
  const row: KakaoNotifyRow = {
    enabled: false,
    status: "CONNECTED",
    last_sent_at: null,
    last_result: null,
  };

  it("로그인한 사람의 행으로 화면 상태를 만든다", async () => {
    await expect(loadMyKakaoNotify(harness({ row }).deps)).resolves.toEqual({
      state: "OFF",
      lastSentAt: null,
      lastResult: null,
    });
  });

  it("로그인 전이거나 DB 설정이 없으면 null", async () => {
    await expect(loadMyKakaoNotify(harness({ row, signedIn: false }).deps)).resolves.toBeNull();
    await expect(
      loadMyKakaoNotify(harness({ row, isDatabaseConfigured: false }).deps),
    ).resolves.toBeNull();
  });
});

describe("startKakaoConnect", () => {
  it("설정이 빠졌으면 NOT_CONFIGURED", async () => {
    await expect(startKakaoConnect(USER_ID, harness({ config: null }).deps)).resolves.toEqual({
      kind: "NOT_CONFIGURED",
    });
  });

  it("이 사용자의 state 를 만들어 설정의 콜백 주소로 인가 주소를 만든다", async () => {
    const run = harness();
    const start = await startKakaoConnect(USER_ID, run.deps);
    if (start.kind !== "REDIRECT") throw new Error("REDIRECT 여야 한다");
    expect(run.authorizeInputs).toEqual([
      { redirectUri: run.config.redirectUri, state: start.state },
    ]);
    expect(start.redirectTo).toBe(`https://kauth.kakao.com/oauth/authorize?state=${start.state}`);
    expect(
      verifyOAuthState({
        state: start.state,
        userId: USER_ID,
        now: NOW,
        secret: run.config.tokenKey,
      }),
    ).toBe(true);
    expect(start.isSecureCookie).toBe(false);
  });

  it("콜백 주소가 https 면 Secure 쿠키", async () => {
    const config = newConfig("https://radar.example.com/api/v1/me/kakao-notify/callback");
    const start = await startKakaoConnect(USER_ID, harness({ config }).deps);
    expect(start).toMatchObject({ kind: "REDIRECT", isSecureCookie: true });
  });
});

describe("completeKakaoConnect — 거부·state (Review Focus 5)", () => {
  const rejected = [
    {
      name: "state 가 주소에 없다",
      build: (config: KakaoConnectConfig) => ({
        params: callbackParams({ code: "c" }),
        stateCookie: stateFor(config),
      }),
      reason: "STATE_MISSING",
    },
    {
      name: "state 쿠키가 없다",
      build: (config: KakaoConnectConfig) => ({
        params: callbackParams({ code: "c", state: stateFor(config) }),
        stateCookie: undefined,
      }),
      reason: "STATE_MISSING",
    },
    {
      name: "주소의 state 와 쿠키가 다르다",
      build: (config: KakaoConnectConfig) => ({
        params: callbackParams({ code: "c", state: stateFor(config) }),
        stateCookie: stateFor(config),
      }),
      reason: "STATE_INVALID",
    },
    {
      name: "다른 사용자의 state 다",
      build: (config: KakaoConnectConfig) => {
        const state = stateFor(config, OTHER_USER_ID);
        return { params: callbackParams({ code: "c", state }), stateCookie: state };
      },
      reason: "STATE_INVALID",
    },
    {
      name: "10분이 지난 state 다",
      build: (config: KakaoConnectConfig) => {
        const state = stateFor(config, USER_ID, new Date(NOW.getTime() - 601_000));
        return { params: callbackParams({ code: "c", state }), stateCookie: state };
      },
      reason: "STATE_INVALID",
    },
    {
      name: "state 가 틀린 채 거부(access_denied)로 돌아왔다",
      build: (config: KakaoConnectConfig) => ({
        params: callbackParams({ error: "access_denied", state: "1.a.b" }),
        stateCookie: stateFor(config),
      }),
      reason: "STATE_INVALID",
    },
  ] as const;

  for (const testCase of rejected) {
    it(`${testCase.name} → state_mismatch, 토큰 요청·저장 0`, async () => {
      const run = harness();
      const { params, stateCookie } = testCase.build(run.config);
      await expect(
        completeKakaoConnect({ userId: USER_ID, params, stateCookie }, run.deps),
      ).resolves.toEqual({ outcome: "state_mismatch", reason: testCase.reason });
      expect(run.exchanges).toHaveLength(0);
      expect(run.saved).toHaveLength(0);
    });
  }

  it("state 가 맞고 동의를 거부했으면(access_denied) consent_denied, 토큰 요청·저장 0", async () => {
    const run = harness();
    const state = stateFor(run.config);
    const params = callbackParams({ error: "access_denied", state });
    await expect(
      completeKakaoConnect({ userId: USER_ID, params, stateCookie: state }, run.deps),
    ).resolves.toEqual({ outcome: "consent_denied", reason: "ACCESS_DENIED" });
    expect(run.exchanges).toHaveLength(0);
    expect(run.saved).toHaveLength(0);
  });

  it("다른 카카오 오류·code 없음은 failed, 저장 0", async () => {
    const run = harness();
    const state = stateFor(run.config);
    await expect(
      completeKakaoConnect(
        {
          userId: USER_ID,
          params: callbackParams({ error: "server_error", state }),
          stateCookie: state,
        },
        run.deps,
      ),
    ).resolves.toEqual({ outcome: "failed", reason: "KAKAO_ERROR" });
    await expect(
      completeKakaoConnect(
        { userId: USER_ID, params: callbackParams({ state }), stateCookie: state },
        run.deps,
      ),
    ).resolves.toEqual({ outcome: "failed", reason: "CODE_MISSING" });
    expect(run.exchanges).toHaveLength(0);
    expect(run.saved).toHaveLength(0);
  });

  it("설정이 빠졌으면 failed", async () => {
    const run = harness({ config: null });
    await expect(
      completeKakaoConnect(
        { userId: USER_ID, params: callbackParams({ code: "c", state: "x" }), stateCookie: "x" },
        run.deps,
      ),
    ).resolves.toEqual({ outcome: "failed", reason: "NOT_CONFIGURED" });
  });
});

describe("completeKakaoConnect — 토큰", () => {
  const connect = async (run: Harness) => {
    const state = stateFor(run.config);
    return completeKakaoConnect(
      {
        userId: USER_ID,
        params: callbackParams({ code: "auth-code", state, redirect_uri: "https://evil.example" }),
        stateCookie: state,
      },
      run.deps,
    );
  };

  it("정상이면 connected. 토큰은 사용자·종류에 묶인 암호문으로만 저장한다", async () => {
    const run = harness();
    await expect(connect(run)).resolves.toEqual({ outcome: "connected", reason: null });
    // 콜백 주소는 요청이 아니라 설정에서 온다.
    expect(run.exchanges).toEqual([{ code: "auth-code", redirectUri: run.config.redirectUri }]);
    expect(run.saved).toHaveLength(1);
    const [sealed] = run.saved as [SealedKakaoLink];
    expect(sealed.accessTokenEnc.startsWith("v1.")).toBe(true);
    expect(sealed.refreshTokenEnc.startsWith("v1.")).toBe(true);
    expect(JSON.stringify(sealed)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(sealed)).not.toContain(REFRESH_TOKEN);
    const key = run.config.tokenKey;
    expect(decryptKakaoToken(sealed.accessTokenEnc, key, { userId: USER_ID, kind: "access" })).toBe(
      ACCESS_TOKEN,
    );
    expect(
      decryptKakaoToken(sealed.refreshTokenEnc, key, { userId: USER_ID, kind: "refresh" }),
    ).toBe(REFRESH_TOKEN);
    expect(() =>
      decryptKakaoToken(sealed.accessTokenEnc, key, { userId: OTHER_USER_ID, kind: "access" }),
    ).toThrow("KAKAO_TOKEN_DECRYPT_FAILED");
    expect(sealed.accessExpiresAt).toEqual(new Date("2026-10-21T09:00:00.000Z"));
    expect(sealed.refreshExpiresAt).toEqual(new Date("2026-12-20T03:00:00.000Z"));
  });

  it("scope 에 talk_message 가 없으면 consent_denied, 저장 0", async () => {
    const run = harness({ exchange: async () => tokenSet({ scopes: ["profile_nickname"] }) });
    await expect(connect(run)).resolves.toEqual({
      outcome: "consent_denied",
      reason: "SCOPE_MISSING",
    });
    expect(run.saved).toHaveLength(0);
  });

  it("refresh 토큰이 없으면 failed, 저장 0", async () => {
    const run = harness({
      exchange: async () => tokenSet({ refreshToken: null, refreshExpiresAt: null }),
    });
    await expect(connect(run)).resolves.toEqual({ outcome: "failed", reason: "REFRESH_MISSING" });
    expect(run.saved).toHaveLength(0);
  });

  it("카카오 토큰 오류는 failed 와 코드, 저장 0", async () => {
    const run = harness({
      exchange: async () => {
        throw new KakaoTokenError("TIMEOUT");
      },
    });
    await expect(connect(run)).resolves.toEqual({ outcome: "failed", reason: "TOKEN_TIMEOUT" });
    expect(run.saved).toHaveLength(0);
  });

  it("카카오 토큰 오류가 아닌 예외와 저장 실패는 던진다", async () => {
    const broken = harness({
      exchange: async () => {
        throw new TypeError("버그");
      },
    });
    await expect(connect(broken)).rejects.toThrow("버그");
    const storeDown = harness({
      saveLink: async () => {
        throw new Error("저장 실패");
      },
    });
    await expect(connect(storeDown)).rejects.toThrow("저장 실패");
  });
});

describe("켬·해제·시험 요청", () => {
  it("켬·끔 본문이 { enabled: boolean } 이 아니면 INVALID 이고 저장하지 않는다", async () => {
    const calls: boolean[] = [];
    const run = harness();
    const deps: KakaoNotifyDeps = {
      ...run.deps,
      repo: {
        ...run.deps.repo,
        setEnabled: async (enabled) => {
          calls.push(enabled);
          return "OK";
        },
      },
    };
    const invalid: unknown[] = [
      null,
      true,
      {},
      { enabled: "true" },
      { enabled: 1 },
      { enabled: true, userId: OTHER_USER_ID },
    ];
    for (const input of invalid) {
      await expect(setMyKakaoNotifyEnabled(input, deps)).resolves.toBe("INVALID");
    }
    expect(calls).toEqual([]);
  });

  it("저장 결과를 그대로 돌려준다", async () => {
    const run = harness();
    await expect(setMyKakaoNotifyEnabled({ enabled: true }, run.deps)).resolves.toBe(
      "NOT_CONNECTED",
    );
    await expect(setMyKakaoNotifyEnabled({ enabled: false }, run.deps)).resolves.toBe("OK");
    await expect(disconnectMyKakaoNotify(run.deps)).resolves.toBeUndefined();
    await expect(requestMyKakaoNotifyTest(run.deps)).resolves.toBe("THROTTLED");
  });
});
