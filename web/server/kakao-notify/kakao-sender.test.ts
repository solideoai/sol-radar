import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KakaoApi, KakaoSendResult, KakaoTokenSet } from "./kakao-api";
import type { KakaoLinkStore, StoredKakaoLink } from "./kakao-notify.model";
import { createMemoKakaoSender, createMockKakaoSender } from "./kakao-sender";
import {
  KakaoTokenKeyMismatchError,
  decryptKakaoToken,
  encryptKakaoToken,
  type KakaoTokenContext,
} from "./kakao-token.crypto";
import type { KakaoFeedTemplate } from "./feed.model";

// 카카오 발송 port(계획 Task 3 Step 1, 설계 §5.4 1초 1통·§5.5 실패와 만료, Review Focus 3).
// 카카오 API·연결 저장·시계는 가짜다. 실제 네트워크는 부르지 않는다. 키는 시험마다 새로 만든다.
// 보안 검토 보강: 키 불일치는 만료가 아니라 던지고(1), 암호문은 사용자·종류에 묶이며(3), 토큰 저장·만료는 읽은 액세스 암호문이
// 그대로일 때만 바꾼다(5 — 그 사이 다시 연결했으면 RETRYABLE LINK_CHANGED).

const USER_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const OTHER_USER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const START = new Date("2026-10-20T05:14:00.000Z");
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const OLD_ACCESS = "fake-old-access-token";
const OLD_REFRESH = "fake-old-refresh-token";
const NEW_ACCESS = "fake-new-access-token";
const NEW_REFRESH = "fake-new-refresh-token";

const TEMPLATE: KakaoFeedTemplate = {
  object_type: "feed",
  content: {
    title: "2026년 가상시청 통합 민원 플랫폼 고도화 사업",
    description: "BID 권고 · 필수 자격 충족",
    link: {
      web_url: "https://sol-radar.example/bids/1",
      mobile_web_url: "https://sol-radar.example/bids/1",
    },
  },
  item_content: { items: [{ item: "발주처", item_op: "가상시청" }] },
  buttons: [],
};

const newKey = (): string => randomBytes(32).toString("base64");
const at = (ms: number): Date => new Date(START.getTime() + ms);
const accessOf = (userId: string): KakaoTokenContext => ({ userId, kind: "access" });
const refreshOf = (userId: string): KakaoTokenContext => ({ userId, kind: "refresh" });

/** 암호문 본문(ciphertext) 첫 글자를 바꾼다. 모양·kid 는 그대로라 변조(KAKAO_TOKEN_DECRYPT_FAILED)다. */
const tampered = (sealed: string): string => {
  const parts = sealed.split(".");
  const ciphertext = parts[4];
  parts[4] = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  return parts.join(".");
};

const LINK_CHANGED: KakaoSendResult = { kind: "RETRYABLE", code: "LINK_CHANGED" };

// ── 시계: sleep 은 기다리지 않고 시각만 앞으로 민다 ──
// isFrozen 이면 sleep 이 시각을 밀지 않는다. 동시 발송에서 각자가 받은 대기 시간을 그대로 보려고 쓴다.

function fakeClock(options: { isFrozen?: boolean } = {}) {
  let current = START.getTime();
  const sleeps: number[] = [];
  return {
    now: (): Date => new Date(current),
    sleep: async (ms: number): Promise<void> => {
      sleeps.push(ms);
      events.push(`sleep ${ms}`);
      if (!options.isFrozen) current += ms;
    },
    advance: (ms: number): void => {
      current += ms;
    },
    sleeps,
  };
}

/** 시험 하나 안에서 가짜 api·sleep 이 부른 순서. */
let events: string[] = [];

afterEach(() => {
  events = [];
  vi.unstubAllGlobals();
});

// ── 연결 저장(메모리) ──

type StoreCall = { method: keyof KakaoLinkStore; args: unknown[] };

/**
 * 연결 저장(메모리). saveTokens·markExpired 는 repo 처럼 조건부다 — 행의 액세스 암호문이 기대값과 같을 때만(markExpired 는
 * CONNECTED 도) 바꾸고 바꿨는지 돌려준다. afterRead 는 read 가 돌려준 뒤 행을 바꾼다(그 사이 다시 연결·다른 처리자 흉내).
 */
function memoryLinks(
  initial: Record<string, StoredKakaoLink> = {},
  options: {
    fail?: (method: keyof KakaoLinkStore) => Error | undefined;
    afterRead?: (rows: Record<string, StoredKakaoLink>) => void;
  } = {},
) {
  const rows: Record<string, StoredKakaoLink> = structuredClone(initial);
  const calls: StoreCall[] = [];
  const record = (method: keyof KakaoLinkStore, args: unknown[]): void => {
    calls.push({ method, args });
    const error = options.fail?.(method);
    if (error) throw error;
  };
  const store: KakaoLinkStore = {
    async read(userId) {
      record("read", [userId]);
      const row = rows[userId];
      const link = row === undefined ? null : structuredClone(row);
      options.afterRead?.(rows);
      return link;
    },
    async saveTokens(userId, sealed, expected) {
      record("saveTokens", [userId, sealed, expected]);
      const row = rows[userId];
      if (row === undefined || row.accessTokenEnc !== expected.accessTokenEnc) return false;
      Object.assign(row, sealed);
      return true;
    },
    async markExpired(userId, expected) {
      record("markExpired", [userId, expected]);
      const row = rows[userId];
      if (row?.status !== "CONNECTED" || row.accessTokenEnc !== expected.accessTokenEnc) {
        return false;
      }
      row.status = "EXPIRED";
      return true;
    },
    async markResult(userId, result, when) {
      record("markResult", [userId, result, when]);
    },
  };
  return {
    store,
    rows,
    calls,
    callsOf: (method: keyof KakaoLinkStore) => calls.filter((call) => call.method === method),
  };
}

function connectedLink(
  key: string,
  overrides: Partial<StoredKakaoLink> = {},
  userId = USER_ID,
): StoredKakaoLink {
  return {
    userId,
    accessTokenEnc: encryptKakaoToken(OLD_ACCESS, key, accessOf(userId)),
    refreshTokenEnc: encryptKakaoToken(OLD_REFRESH, key, refreshOf(userId)),
    accessExpiresAt: at(6 * HOUR_MS),
    refreshExpiresAt: at(60 * 24 * HOUR_MS),
    status: "CONNECTED",
    ...overrides,
  };
}

// ── 카카오 API(가짜) ──

type RefreshReply = KakaoTokenSet | "INVALID_GRANT" | Error;

const tokenSet = (overrides: Partial<KakaoTokenSet> = {}): KakaoTokenSet => ({
  accessToken: NEW_ACCESS,
  refreshToken: null,
  accessExpiresAt: at(12 * HOUR_MS),
  refreshExpiresAt: null,
  scopes: [],
  ...overrides,
});

/** 준비한 답을 차례로 쓰고, 다 쓰면 마지막 답을 되풀이한다. */
function fakeApi(options: { sends?: KakaoSendResult[]; refreshes?: RefreshReply[] } = {}) {
  const sends = options.sends ?? [{ kind: "SENT" }];
  const refreshes = options.refreshes ?? [tokenSet()];
  const sendCalls: { accessToken: string; template: KakaoFeedTemplate }[] = [];
  const refreshCalls: string[] = [];
  const pick = <T>(list: readonly T[], index: number): T => list[Math.min(index, list.length - 1)];
  const api: KakaoApi = {
    authorizeUrl: () => {
      throw new Error("sender 가 authorizeUrl 을 불렀다");
    },
    exchangeCode: async () => {
      throw new Error("sender 가 exchangeCode 를 불렀다");
    },
    async refresh(refreshToken) {
      refreshCalls.push(refreshToken);
      events.push(`refresh ${refreshToken}`);
      const reply = pick(refreshes, refreshCalls.length - 1);
      if (reply instanceof Error) throw reply;
      return reply;
    },
    async sendMemo(accessToken, template) {
      sendCalls.push({ accessToken, template });
      events.push(`send ${accessToken}`);
      return pick(sends, sendCalls.length - 1);
    },
  };
  return { api, sendCalls, refreshCalls };
}

function memoWith(
  options: {
    key?: string;
    links?: Record<string, StoredKakaoLink>;
    sends?: KakaoSendResult[];
    refreshes?: RefreshReply[];
    storeOptions?: Parameters<typeof memoryLinks>[1];
    isClockFrozen?: boolean;
  } = {},
) {
  const key = options.key ?? newKey();
  const links = memoryLinks(
    options.links ?? { [USER_ID]: connectedLink(key) },
    options.storeOptions,
  );
  const api = fakeApi({ sends: options.sends, refreshes: options.refreshes });
  const clock = fakeClock({ isFrozen: options.isClockFrozen });
  const sender = createMemoKakaoSender({
    api: api.api,
    links: links.store,
    encKey: key,
    now: clock.now,
    sleep: clock.sleep,
  });
  return { sender, links, api, clock, key };
}

const resultsOf = (links: ReturnType<typeof memoryLinks>) =>
  links.callsOf("markResult").map((call) => call.args[1]);

// ── mock ──

describe("createMockKakaoSender", () => {
  const mockWith = (rows: Record<string, StoredKakaoLink>) => {
    const links = memoryLinks(rows);
    const clock = fakeClock();
    return { sender: createMockKakaoSender({ links: links.store, now: clock.now }), links, clock };
  };

  it("연결이 있으면 외부 호출 없이 SENT 를 돌려주고 markResult(SENT, now) 를 부른다", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { sender, links } = mockWith({ [USER_ID]: connectedLink(newKey()) });

    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
    expect(links.callsOf("markResult").map((call) => call.args)).toEqual([
      [USER_ID, "SENT", START],
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("연결이 없으면 EXPIRED(changed false) 이고 markResult 를 부르지 않는다", async () => {
    const { sender, links } = mockWith({});
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: false });
    expect(links.callsOf("markResult")).toEqual([]);
  });

  it("연결이 EXPIRED 면 EXPIRED(changed false) 이고 markResult(EXPIRED) 를 부른다", async () => {
    const { sender, links } = mockWith({
      [USER_ID]: connectedLink(newKey(), { status: "EXPIRED" }),
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: false });
    expect(resultsOf(links)).toEqual(["EXPIRED"]);
    expect(links.callsOf("markExpired")).toEqual([]);
  });
});

// ── memo: 연결 없음·만료 ──

describe("createMemoKakaoSender · 연결 없음", () => {
  it("연결이 없으면 EXPIRED(changed false) 이고 카카오를 부르지 않는다", async () => {
    const { sender, api, links } = memoWith({ links: {} });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: false });
    expect(api.sendCalls).toEqual([]);
    expect(api.refreshCalls).toEqual([]);
    expect(links.callsOf("markResult")).toEqual([]);
  });

  it("연결이 EXPIRED 면 EXPIRED(changed false) 이고 카카오를 부르지 않는다", async () => {
    const key = newKey();
    const { sender, api, links } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { status: "EXPIRED" }) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: false });
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toEqual([]);
    expect(resultsOf(links)).toEqual(["EXPIRED"]);
  });
});

// ── memo: 보통 발송 ──

describe("createMemoKakaoSender · 발송", () => {
  it("복호화한 액세스 토큰과 받은 템플릿 그대로 보내고 SENT 를 돌려준다", async () => {
    const { sender, api, links } = memoWith();
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
    expect(api.sendCalls).toEqual([{ accessToken: OLD_ACCESS, template: TEMPLATE }]);
    expect(api.refreshCalls).toEqual([]);
    expect(links.callsOf("saveTokens")).toEqual([]);
  });

  it("끝에 markResult(userId, SENT, now) 를 부른다", async () => {
    const { sender, links } = memoWith();
    await sender.send(USER_ID, TEMPLATE);
    expect(links.callsOf("markResult").map((call) => call.args)).toEqual([
      [USER_ID, "SENT", START],
    ]);
  });

  it.each<[string, KakaoSendResult]>([
    ["RETRYABLE", { kind: "RETRYABLE", code: "HTTP_503" }],
    ["UNKNOWN_OUTCOME", { kind: "UNKNOWN_OUTCOME" }],
    ["REJECTED", { kind: "REJECTED", code: "KAKAO_-2" }],
  ])("%s 는 그대로 돌려주고 markResult 는 FAILED 다", async (_label, result) => {
    const { sender, api, links } = memoWith({ sends: [result] });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(result);
    expect(api.sendCalls).toHaveLength(1);
    expect(api.refreshCalls).toEqual([]);
    expect(resultsOf(links)).toEqual(["FAILED"]);
  });

  it("markResult 가 실패해도 이미 간 발송은 SENT 로 돌려준다(다시 보내게 하지 않는다)", async () => {
    const { sender } = memoWith({
      storeOptions: {
        fail: (method) => (method === "markResult" ? new Error("store 오류") : undefined),
      },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
  });

  it("연결 읽기가 실패하면 보내지 않고 그 오류를 던진다", async () => {
    const { sender, api } = memoWith({
      storeOptions: { fail: (method) => (method === "read" ? new Error("read 실패") : undefined) },
    });
    await expect(sender.send(USER_ID, TEMPLATE)).rejects.toThrow("read 실패");
    expect(api.sendCalls).toEqual([]);
  });
});

// ── memo: 만료 5분 전 갱신 ──

describe("createMemoKakaoSender · 만료 전 갱신", () => {
  const expiringIn = (ms: number) => {
    const key = newKey();
    return { key, links: { [USER_ID]: connectedLink(key, { accessExpiresAt: at(ms) }) } };
  };

  it("액세스 만료가 5분 넘게 남았으면 갱신하지 않는다", async () => {
    const { sender, api } = memoWith(expiringIn(5 * MINUTE_MS + 1));
    await sender.send(USER_ID, TEMPLATE);
    expect(api.refreshCalls).toEqual([]);
    expect(api.sendCalls.map((call) => call.accessToken)).toEqual([OLD_ACCESS]);
  });

  it.each([
    ["딱 5분", 5 * MINUTE_MS],
    ["1분", MINUTE_MS],
    ["이미 지남", -HOUR_MS],
  ])("액세스 만료가 %s 남았으면 먼저 갱신하고 새 토큰으로 보낸다", async (_label, ms) => {
    const { sender, api } = memoWith(expiringIn(ms));
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
    expect(api.refreshCalls).toEqual([OLD_REFRESH]);
    expect(events).toEqual([`refresh ${OLD_REFRESH}`, `send ${NEW_ACCESS}`]);
  });

  it("액세스 만료 시각이 없으면(DB 의 null) 먼저 갱신한다", async () => {
    const key = newKey();
    const { sender, api } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { accessExpiresAt: null }) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
    expect(events).toEqual([`refresh ${OLD_REFRESH}`, `send ${NEW_ACCESS}`]);
    expect(api.refreshCalls).toHaveLength(1);
  });

  it("새 액세스 토큰을 암호화해 saveTokens 하고, 새 refresh 가 없으면 기존 암호문과 만료를 그대로 둔다", async () => {
    const setup = expiringIn(MINUTE_MS);
    const before = setup.links[USER_ID];
    const { sender, links, key } = memoWith(setup);
    await sender.send(USER_ID, TEMPLATE);

    const saves = links.callsOf("saveTokens");
    expect(saves).toHaveLength(1);
    const [userId, sealed, expected] = saves[0].args as [string, Record<string, unknown>, unknown];
    expect(userId).toBe(USER_ID);
    expect(expected).toEqual({ accessTokenEnc: before.accessTokenEnc });
    expect(Object.keys(sealed).toSorted()).toEqual(
      ["accessExpiresAt", "accessTokenEnc", "refreshExpiresAt", "refreshTokenEnc"].toSorted(),
    );
    expect(decryptKakaoToken(String(sealed.accessTokenEnc), key, accessOf(USER_ID))).toBe(
      NEW_ACCESS,
    );
    expect(sealed.accessTokenEnc).not.toContain(NEW_ACCESS);
    expect(sealed.accessExpiresAt).toEqual(at(12 * HOUR_MS));
    expect(sealed.refreshTokenEnc).toBe(before.refreshTokenEnc);
    expect(sealed.refreshExpiresAt).toEqual(before.refreshExpiresAt);
  });

  it("갱신 응답에 새 refresh 가 있으면 그것을 암호화하고 새 만료로 바꾼다", async () => {
    const { sender, links, key } = memoWith({
      ...expiringIn(MINUTE_MS),
      refreshes: [tokenSet({ refreshToken: NEW_REFRESH, refreshExpiresAt: at(59 * 24 * HOUR_MS) })],
    });
    await sender.send(USER_ID, TEMPLATE);
    const [, sealed] = links.callsOf("saveTokens")[0].args as [string, Record<string, unknown>];
    expect(decryptKakaoToken(String(sealed.refreshTokenEnc), key, refreshOf(USER_ID))).toBe(
      NEW_REFRESH,
    );
    expect(sealed.refreshExpiresAt).toEqual(at(59 * 24 * HOUR_MS));
  });

  it("saveTokens 가 실패하면 보내지 않고 그 오류를 던진다(아직 아무것도 가지 않았다)", async () => {
    const { sender, api } = memoWith({
      ...expiringIn(MINUTE_MS),
      storeOptions: {
        fail: (method) => (method === "saveTokens" ? new Error("save 실패") : undefined),
      },
    });
    await expect(sender.send(USER_ID, TEMPLATE)).rejects.toThrow("save 실패");
    expect(api.sendCalls).toEqual([]);
  });

  it("미리 갱신한 새 토큰도 TOKEN_INVALID 면 다시 갱신하지 않고 markExpired 한다", async () => {
    const { sender, api, links } = memoWith({
      ...expiringIn(MINUTE_MS),
      sends: [{ kind: "TOKEN_INVALID" }],
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.refreshCalls).toHaveLength(1);
    expect(api.sendCalls).toHaveLength(1);
    expect(links.callsOf("markExpired")).toHaveLength(1);
  });

  it("그때 markExpired 의 기대값은 방금 저장한 새 액세스 암호문이다(읽은 옛 값이 아니다)", async () => {
    const { sender, links } = memoWith({
      ...expiringIn(MINUTE_MS),
      sends: [{ kind: "TOKEN_INVALID" }],
    });
    await sender.send(USER_ID, TEMPLATE);
    const [, sealed] = links.callsOf("saveTokens")[0].args as [string, { accessTokenEnc: string }];
    expect(links.callsOf("markExpired").map((call) => call.args)).toEqual([
      [USER_ID, { accessTokenEnc: sealed.accessTokenEnc }],
    ]);
    expect(links.rows[USER_ID].status).toBe("EXPIRED");
  });
});

// ── memo: 토큰 무효 → 한 번 갱신 뒤 한 번 재발송 ──

describe("createMemoKakaoSender · TOKEN_INVALID", () => {
  it("한 번 갱신하고 새 토큰으로 한 번 다시 보낸다", async () => {
    const { sender, api, links } = memoWith({
      sends: [{ kind: "TOKEN_INVALID" }, { kind: "SENT" }],
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
    expect(api.refreshCalls).toEqual([OLD_REFRESH]);
    expect(api.sendCalls.map((call) => call.accessToken)).toEqual([OLD_ACCESS, NEW_ACCESS]);
    expect(links.callsOf("saveTokens")).toHaveLength(1);
    expect(resultsOf(links)).toEqual(["SENT"]);
  });

  it("다시 보내도 TOKEN_INVALID 면 markExpired 하고 EXPIRED(changed true) 이다", async () => {
    const { sender, api, links } = memoWith({ sends: [{ kind: "TOKEN_INVALID" }] });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.refreshCalls).toHaveLength(1);
    expect(api.sendCalls).toHaveLength(2);
    const [, sealed] = links.callsOf("saveTokens")[0].args as [string, { accessTokenEnc: string }];
    expect(links.callsOf("markExpired").map((call) => call.args)).toEqual([
      [USER_ID, { accessTokenEnc: sealed.accessTokenEnc }],
    ]);
    expect(links.rows[USER_ID].status).toBe("EXPIRED");
    expect(resultsOf(links)).toEqual(["EXPIRED"]);
  });

  it("다른 처리자가 먼저 만료로 바꿨으면(markExpired 0행) RETRYABLE LINK_CHANGED 이고, 다음 발송은 EXPIRED(changed false)다", async () => {
    let isFirstRead = true;
    const { sender, links } = memoWith({
      sends: [{ kind: "TOKEN_INVALID" }],
      refreshes: ["INVALID_GRANT"],
      storeOptions: {
        afterRead: (rows) => {
          if (!isFirstRead) return;
          isFirstRead = false;
          rows[USER_ID].status = "EXPIRED";
        },
      },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(LINK_CHANGED);
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: false });
    expect(resultsOf(links)).toEqual(["FAILED", "EXPIRED"]);
  });

  it("다시 보낸 결과가 RETRYABLE 이면 그대로 돌려준다", async () => {
    const { sender, links } = memoWith({
      sends: [{ kind: "TOKEN_INVALID" }, { kind: "RETRYABLE", code: "HTTP_500" }],
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "RETRYABLE", code: "HTTP_500" });
    expect(links.callsOf("markExpired")).toEqual([]);
    expect(resultsOf(links)).toEqual(["FAILED"]);
  });
});

// ── memo: 갱신 실패 ──

describe("createMemoKakaoSender · 갱신 실패", () => {
  const expiring = () => {
    const key = newKey();
    return { key, links: { [USER_ID]: connectedLink(key, { accessExpiresAt: at(MINUTE_MS) }) } };
  };

  it("미리 갱신이 INVALID_GRANT 면 보내지 않고 markExpired 하고 EXPIRED(changed true)", async () => {
    const { sender, api, links } = memoWith({ ...expiring(), refreshes: ["INVALID_GRANT"] });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toHaveLength(1);
    expect(links.callsOf("saveTokens")).toEqual([]);
    expect(resultsOf(links)).toEqual(["EXPIRED"]);
  });

  it("TOKEN_INVALID 뒤 갱신이 INVALID_GRANT 면 다시 보내지 않고 EXPIRED", async () => {
    const { sender, api, links } = memoWith({
      sends: [{ kind: "TOKEN_INVALID" }],
      refreshes: ["INVALID_GRANT"],
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.sendCalls).toHaveLength(1);
    expect(links.callsOf("markExpired")).toHaveLength(1);
  });

  it("갱신이 던지면(네트워크 등) RETRYABLE REFRESH_FAILED 이고 만료로 바꾸지 않는다", async () => {
    const { sender, api, links } = memoWith({
      ...expiring(),
      refreshes: [new Error("kakao token 오류: NETWORK")],
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: "REFRESH_FAILED",
    });
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toEqual([]);
    expect(resultsOf(links)).toEqual(["FAILED"]);
  });

  it("TOKEN_INVALID 뒤 갱신이 던져도 RETRYABLE REFRESH_FAILED", async () => {
    const { sender, api } = memoWith({
      sends: [{ kind: "TOKEN_INVALID" }],
      refreshes: [new Error("kakao token 오류: HTTP_500")],
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({
      kind: "RETRYABLE",
      code: "REFRESH_FAILED",
    });
    expect(api.sendCalls).toHaveLength(1);
  });

  it("갱신해야 하는데 refresh 암호문이 없으면 markExpired 하고 EXPIRED", async () => {
    const key = newKey();
    const { sender, api, links } = memoWith({
      key,
      links: {
        [USER_ID]: connectedLink(key, {
          accessExpiresAt: at(MINUTE_MS),
          refreshTokenEnc: null,
          refreshExpiresAt: null,
        }),
      },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.refreshCalls).toEqual([]);
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toHaveLength(1);
  });
});

// ── memo: 복호화 실패 ──

describe("createMemoKakaoSender · 복호화 실패", () => {
  it("액세스 암호문을 풀 수 없으면(변조) 카카오를 부르지 않고 markExpired 하고 EXPIRED", async () => {
    const key = newKey();
    const link = connectedLink(key);
    const accessTokenEnc = tampered(link.accessTokenEnc ?? "");
    const { sender, api, links } = memoWith({
      key,
      links: { [USER_ID]: { ...link, accessTokenEnc } },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.sendCalls).toEqual([]);
    expect(api.refreshCalls).toEqual([]);
    expect(links.callsOf("markExpired").map((call) => call.args)).toEqual([
      [USER_ID, { accessTokenEnc }],
    ]);
    expect(resultsOf(links)).toEqual(["EXPIRED"]);
  });

  it("refresh 암호문을 풀 수 없으면(변조) 갱신하지 않고 markExpired 하고 EXPIRED", async () => {
    const key = newKey();
    const link = connectedLink(key, { accessExpiresAt: at(MINUTE_MS) });
    const { sender, api, links } = memoWith({
      key,
      links: { [USER_ID]: { ...link, refreshTokenEnc: tampered(link.refreshTokenEnc ?? "") } },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.refreshCalls).toEqual([]);
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toHaveLength(1);
  });

  it("액세스 암호문이 없으면(DB 의 null) 카카오를 부르지 않고 기대값 null 로 markExpired 하고 EXPIRED", async () => {
    const key = newKey();
    const { sender, api, links } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { accessTokenEnc: null }) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.sendCalls).toEqual([]);
    expect(api.refreshCalls).toEqual([]);
    expect(links.callsOf("markExpired").map((call) => call.args)).toEqual([
      [USER_ID, { accessTokenEnc: null }],
    ]);
  });

  it("암호화 키 형식이 틀리면 설정 오류로 던지고 연결을 만료로 바꾸지 않는다", async () => {
    const goodKey = newKey();
    const links = memoryLinks({ [USER_ID]: connectedLink(goodKey) });
    const api = fakeApi();
    const clock = fakeClock();
    const sender = createMemoKakaoSender({
      api: api.api,
      links: links.store,
      encKey: randomBytes(16).toString("base64"),
      now: clock.now,
      sleep: clock.sleep,
    });
    await expect(sender.send(USER_ID, TEMPLATE)).rejects.toThrow("KAKAO_TOKEN_ENC_KEY 형식 오류");
    expect(links.callsOf("markExpired")).toEqual([]);
    expect(api.sendCalls).toEqual([]);
  });
});

// ── memo: 키 불일치(보안 검토 1) — 설정 오류라 만료로 바꾸지 않고 던진다 ──

describe("createMemoKakaoSender · 키 불일치", () => {
  /** 웹이 다른 키로 잠근 연결. worker(sender)는 memoWith 의 키를 쓴다. */
  const sealedByOtherKey = (overrides: Partial<StoredKakaoLink> = {}, userId = USER_ID) =>
    connectedLink(newKey(), overrides, userId);

  it("액세스 암호문이 다른 키면 KakaoTokenKeyMismatchError 로 던지고, 만료로 바꾸지도 카카오를 부르지도 마지막 발송 줄을 적지도 않는다", async () => {
    const { sender, api, links } = memoWith({ links: { [USER_ID]: sealedByOtherKey() } });
    const error = await sender.send(USER_ID, TEMPLATE).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(KakaoTokenKeyMismatchError);
    expect(api.sendCalls).toEqual([]);
    expect(api.refreshCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toEqual([]);
    expect(links.callsOf("saveTokens")).toEqual([]);
    expect(links.callsOf("markResult")).toEqual([]);
    expect(links.rows[USER_ID].status).toBe("CONNECTED");
  });

  it("갱신해야 할 때 refresh 암호문이 다른 키여도 던지고 만료로 바꾸지 않는다", async () => {
    const key = newKey();
    const link = connectedLink(key, {
      accessExpiresAt: at(MINUTE_MS),
      refreshTokenEnc: encryptKakaoToken(OLD_REFRESH, newKey(), refreshOf(USER_ID)),
    });
    const { sender, api, links } = memoWith({ key, links: { [USER_ID]: link } });
    await expect(sender.send(USER_ID, TEMPLATE)).rejects.toThrow(KakaoTokenKeyMismatchError);
    expect(api.refreshCalls).toEqual([]);
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("markExpired")).toEqual([]);
    expect(links.rows[USER_ID].status).toBe("CONNECTED");
  });

  it("연결된 두 사람 모두 다른 키면 둘 다 던지고 아무도 만료로 바뀌지 않는다", async () => {
    const { sender, links } = memoWith({
      links: {
        [USER_ID]: sealedByOtherKey(),
        [OTHER_USER_ID]: sealedByOtherKey({}, OTHER_USER_ID),
      },
    });
    for (const userId of [USER_ID, OTHER_USER_ID]) {
      await expect(sender.send(userId, TEMPLATE)).rejects.toThrow("KAKAO_TOKEN_KEY_MISMATCH");
    }
    expect(links.callsOf("markExpired")).toEqual([]);
    expect([links.rows[USER_ID].status, links.rows[OTHER_USER_ID].status]).toEqual([
      "CONNECTED",
      "CONNECTED",
    ]);
  });
});

// ── memo: 암호문은 사용자·토큰 종류에 묶인다(보안 검토 3) ──

describe("createMemoKakaoSender · 사용자·종류에 묶인 암호문", () => {
  it("남의 행의 액세스 암호문을 옮겨 넣으면 풀지 못해(변조) 카카오를 부르지 않고 EXPIRED", async () => {
    const key = newKey();
    const { sender, api } = memoWith({
      key,
      links: {
        [USER_ID]: connectedLink(key, {
          accessTokenEnc: encryptKakaoToken(OLD_ACCESS, key, accessOf(OTHER_USER_ID)),
        }),
      },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.sendCalls).toEqual([]);
  });

  it("refresh 자리에 액세스 암호문을 넣으면 풀지 못해 갱신하지 않고 EXPIRED", async () => {
    const key = newKey();
    const link = connectedLink(key, { accessExpiresAt: at(MINUTE_MS) });
    const { sender, api } = memoWith({
      key,
      links: { [USER_ID]: { ...link, refreshTokenEnc: link.accessTokenEnc } },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: true });
    expect(api.refreshCalls).toEqual([]);
  });

  it("갱신한 새 토큰은 그 사용자·종류로 잠근다 — 다른 사용자나 다른 종류로는 풀리지 않는다", async () => {
    const key = newKey();
    const { sender, links } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { accessExpiresAt: at(MINUTE_MS) }) },
      refreshes: [tokenSet({ refreshToken: NEW_REFRESH, refreshExpiresAt: at(59 * 24 * HOUR_MS) })],
    });
    await sender.send(USER_ID, TEMPLATE);
    const [, sealed] = links.callsOf("saveTokens")[0].args as [
      string,
      { accessTokenEnc: string; refreshTokenEnc: string },
    ];
    expect(decryptKakaoToken(sealed.accessTokenEnc, key, accessOf(USER_ID))).toBe(NEW_ACCESS);
    expect(decryptKakaoToken(sealed.refreshTokenEnc, key, refreshOf(USER_ID))).toBe(NEW_REFRESH);
    for (const [value, context] of [
      [sealed.accessTokenEnc, refreshOf(USER_ID)],
      [sealed.accessTokenEnc, accessOf(OTHER_USER_ID)],
      [sealed.refreshTokenEnc, accessOf(USER_ID)],
      [sealed.refreshTokenEnc, refreshOf(OTHER_USER_ID)],
    ] as const) {
      expect(() => decryptKakaoToken(value, key, context)).toThrow("KAKAO_TOKEN_DECRYPT_FAILED");
    }
  });
});

// ── memo: 갱신 경합(보안 검토 5) — 읽은 뒤 사용자가 다시 연결했으면 옛 토큰으로 덮어쓰거나 새 연결을 만료로 바꾸지 않는다 ──

describe("createMemoKakaoSender · 갱신 경합", () => {
  const NEWER_ACCESS = "fake-reconnected-access-token";

  /** read 가 돌려준 뒤 사용자가 다시 연결한 것처럼, 같은 키로 잠근 새 토큰의 CONNECTED 행으로 바꾼다. */
  const reconnectAfterRead = (key: string) => {
    let isDone = false;
    return (rows: Record<string, StoredKakaoLink>) => {
      if (isDone) return;
      isDone = true;
      rows[USER_ID] = connectedLink(key, {
        accessTokenEnc: encryptKakaoToken(NEWER_ACCESS, key, accessOf(USER_ID)),
      });
    };
  };

  it("미리 갱신했는데 저장이 0행이면(그 사이 다시 연결) 보내지 않고 RETRYABLE LINK_CHANGED, 새 연결은 그대로다", async () => {
    const key = newKey();
    const { sender, api, links } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { accessExpiresAt: at(MINUTE_MS) }) },
      storeOptions: { afterRead: reconnectAfterRead(key) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(LINK_CHANGED);
    expect(api.refreshCalls).toEqual([OLD_REFRESH]);
    expect(api.sendCalls).toEqual([]);
    expect(links.callsOf("saveTokens")).toHaveLength(1);
    const row = links.rows[USER_ID];
    expect(row.status).toBe("CONNECTED");
    expect(decryptKakaoToken(row.accessTokenEnc ?? "", key, accessOf(USER_ID))).toBe(NEWER_ACCESS);
    expect(resultsOf(links)).toEqual(["FAILED"]);
  });

  it("다음 발송은 새 연결의 토큰으로 보낸다", async () => {
    const key = newKey();
    const { sender, api } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { accessExpiresAt: at(MINUTE_MS) }) },
      storeOptions: { afterRead: reconnectAfterRead(key) },
    });
    await sender.send(USER_ID, TEMPLATE);
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "SENT" });
    expect(api.sendCalls.map((call) => call.accessToken)).toEqual([NEWER_ACCESS]);
  });

  it("TOKEN_INVALID 뒤 갱신해 저장이 0행이어도 다시 보내지 않고 RETRYABLE LINK_CHANGED", async () => {
    const key = newKey();
    const { sender, api } = memoWith({
      key,
      sends: [{ kind: "TOKEN_INVALID" }],
      storeOptions: { afterRead: reconnectAfterRead(key) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(LINK_CHANGED);
    expect(api.sendCalls.map((call) => call.accessToken)).toEqual([OLD_ACCESS]);
  });

  it("갱신이 INVALID_GRANT 인데 만료가 0행이면(그 사이 다시 연결) 새 연결을 만료로 바꾸지 않고 RETRYABLE LINK_CHANGED", async () => {
    const key = newKey();
    const { sender, links } = memoWith({
      key,
      sends: [{ kind: "TOKEN_INVALID" }],
      refreshes: ["INVALID_GRANT"],
      storeOptions: { afterRead: reconnectAfterRead(key) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(LINK_CHANGED);
    expect(links.callsOf("markExpired")).toHaveLength(1);
    expect(links.rows[USER_ID].status).toBe("CONNECTED");
    expect(resultsOf(links)).toEqual(["FAILED"]);
  });

  it("변조된 암호문이어도 만료가 0행이면(그 사이 다시 연결) RETRYABLE LINK_CHANGED", async () => {
    const key = newKey();
    const link = connectedLink(key);
    const { sender, api, links } = memoWith({
      key,
      links: { [USER_ID]: { ...link, accessTokenEnc: tampered(link.accessTokenEnc ?? "") } },
      storeOptions: { afterRead: reconnectAfterRead(key) },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(LINK_CHANGED);
    expect(api.sendCalls).toEqual([]);
    expect(links.rows[USER_ID].status).toBe("CONNECTED");
  });

  it("연결 해제로 행이 사라졌으면 저장이 0행이라 RETRYABLE LINK_CHANGED 이고, 다음 발송은 EXPIRED(changed false)다", async () => {
    const key = newKey();
    let isDone = false;
    const { sender, api } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { accessExpiresAt: at(MINUTE_MS) }) },
      storeOptions: {
        afterRead: (rows) => {
          if (isDone) return;
          isDone = true;
          delete rows[USER_ID];
        },
      },
    });
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual(LINK_CHANGED);
    expect(await sender.send(USER_ID, TEMPLATE)).toEqual({ kind: "EXPIRED", changed: false });
    expect(api.sendCalls).toEqual([]);
  });
});

// ── memo: 한 사용자 1초 1통 ──

describe("createMemoKakaoSender · 1초 1통", () => {
  const twoUsers = () => {
    const key = newKey();
    return {
      key,
      links: {
        [USER_ID]: connectedLink(key),
        [OTHER_USER_ID]: connectedLink(key, {}, OTHER_USER_ID),
      },
    };
  };

  it("첫 발송은 기다리지 않는다", async () => {
    const { sender, clock } = memoWith();
    await sender.send(USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([]);
  });

  it("같은 사용자에게 곧바로 두 번째를 보내면 그 전에 1000ms 기다린다", async () => {
    const { sender, clock } = memoWith();
    await sender.send(USER_ID, TEMPLATE);
    await sender.send(USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([1000]);
    expect(events).toEqual([`send ${OLD_ACCESS}`, "sleep 1000", `send ${OLD_ACCESS}`]);
  });

  it("앞 발송에서 300ms 지났으면 남은 700ms 만 기다린다", async () => {
    const { sender, clock } = memoWith();
    await sender.send(USER_ID, TEMPLATE);
    clock.advance(300);
    await sender.send(USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([700]);
  });

  it("앞 발송에서 1000ms 이상 지났으면 기다리지 않는다", async () => {
    const { sender, clock } = memoWith();
    await sender.send(USER_ID, TEMPLATE);
    clock.advance(1000);
    await sender.send(USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([]);
  });

  it("다른 사용자에게는 기다리지 않는다", async () => {
    const { sender, clock } = memoWith(twoUsers());
    await sender.send(USER_ID, TEMPLATE);
    await sender.send(OTHER_USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([]);
  });

  it("같은 사용자에게 동시에 세 통을 보내면 자리를 1000ms 씩 미리 잡아 둘째는 1000ms, 셋째는 2000ms 기다린다", async () => {
    const { sender, clock } = memoWith({ isClockFrozen: true });
    await Promise.all([
      sender.send(USER_ID, TEMPLATE),
      sender.send(USER_ID, TEMPLATE),
      sender.send(USER_ID, TEMPLATE),
    ]);
    expect(clock.sleeps.toSorted((a, b) => a - b)).toEqual([1000, 2000]);
  });

  it("TOKEN_INVALID 뒤 다시 보낼 때도 1000ms 간격을 둔다", async () => {
    const { sender, clock } = memoWith({ sends: [{ kind: "TOKEN_INVALID" }, { kind: "SENT" }] });
    await sender.send(USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([1000]);
    expect(events).toEqual([
      `send ${OLD_ACCESS}`,
      `refresh ${OLD_REFRESH}`,
      "sleep 1000",
      `send ${NEW_ACCESS}`,
    ]);
  });

  it("보내지 않고 끝난 발송(연결 만료)은 간격 기준이 되지 않는다", async () => {
    const key = newKey();
    const { sender, clock, links } = memoWith({
      key,
      links: { [USER_ID]: connectedLink(key, { status: "EXPIRED" }) },
    });
    await sender.send(USER_ID, TEMPLATE);
    links.rows[USER_ID].status = "CONNECTED";
    await sender.send(USER_ID, TEMPLATE);
    expect(clock.sleeps).toEqual([]);
  });

  it("markResult 의 시각은 기다린 뒤의 now 다", async () => {
    const { sender, links } = memoWith();
    await sender.send(USER_ID, TEMPLATE);
    await sender.send(USER_ID, TEMPLATE);
    expect(links.callsOf("markResult").map((call) => call.args[2])).toEqual([START, at(1000)]);
  });
});
