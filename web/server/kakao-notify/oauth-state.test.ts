import { createHmac, hkdfSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createOAuthState, verifyOAuthState } from "./oauth-state";

// 카카오 연결 OAuth state(계획 Task 6, Review Focus 5). 콜백이 "이 사용자가 10분 안에 시작한 연결"인지 확인한다.
// 키는 시험마다 새로 만든다 — 저장소에 키 모양의 값을 두지 않는다.
const newKey = (): string => randomBytes(32).toString("base64");
const USER_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const OTHER_USER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const NOW = new Date("2026-10-21T03:00:00.000Z");
const seconds = (count: number): Date => new Date(NOW.getTime() + count * 1000);
const KEY_FORMAT_ERROR = new Error("KAKAO_TOKEN_ENC_KEY 형식 오류");

/** 계획이 정한 값으로 MAC 을 다시 계산한다: HKDF(info "kakao-oauth-state") 로 뽑은 키의 HMAC-SHA256. */
const expectedMac = (secret: string, userId: string, issuedAt: string, nonce: string): string => {
  const derived = Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "base64"), Buffer.alloc(0), "kakao-oauth-state", 32),
  );
  return createHmac("sha256", derived)
    .update(`kakao-notify-state:v1:${userId}:${issuedAt}:${nonce}`)
    .digest("base64url");
};

describe("createOAuthState·verifyOAuthState", () => {
  it("같은 사용자·같은 키·10분 안이면 통과한다", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret });
    expect(verifyOAuthState({ state, userId: USER_ID, now: NOW, secret })).toBe(true);
    expect(verifyOAuthState({ state, userId: USER_ID, now: seconds(600), secret })).toBe(true);
  });

  it("모양은 <발급 초>.<nonce>.<mac> 이고 MAC 은 HKDF 로 뽑은 키로 만든다", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret });
    const [issuedAt, nonce, mac] = state.split(".");
    expect(state.split(".")).toHaveLength(3);
    expect(issuedAt).toBe(String(NOW.getTime() / 1000));
    expect(Buffer.from(nonce ?? "", "base64url")).toHaveLength(16);
    expect(mac).toBe(expectedMac(secret, USER_ID, issuedAt ?? "", nonce ?? ""));
    // 토큰 키를 그대로 HMAC 키로 쓰지 않는다(용도 분리).
    const rawKeyMac = createHmac("sha256", Buffer.from(secret, "base64"))
      .update(`kakao-notify-state:v1:${USER_ID}:${issuedAt}:${nonce}`)
      .digest("base64url");
    expect(mac).not.toBe(rawKeyMac);
  });

  it("state 에 사용자 ID 를 평문으로 싣지 않는다", () => {
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret: newKey() });
    expect(state).not.toContain(USER_ID);
  });

  it("부를 때마다 nonce 가 달라 state 가 다르다", () => {
    const secret = newKey();
    const first = createOAuthState({ userId: USER_ID, now: NOW, secret });
    const second = createOAuthState({ userId: USER_ID, now: NOW, secret });
    expect(first).not.toBe(second);
  });

  it("다른 사용자의 state 는 거부한다", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: OTHER_USER_ID, now: NOW, secret });
    expect(verifyOAuthState({ state, userId: USER_ID, now: NOW, secret })).toBe(false);
  });

  it("10분(600초)이 지나면 거부한다", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret });
    expect(verifyOAuthState({ state, userId: USER_ID, now: seconds(601), secret })).toBe(false);
  });

  it("발급 시각이 60초 넘게 미래면 거부한다(시계 차이는 60초까지 허용)", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: USER_ID, now: seconds(61), secret });
    expect(verifyOAuthState({ state, userId: USER_ID, now: NOW, secret })).toBe(false);
    const nearFuture = createOAuthState({ userId: USER_ID, now: seconds(60), secret });
    expect(verifyOAuthState({ state: nearFuture, userId: USER_ID, now: NOW, secret })).toBe(true);
  });

  it("다른 키로 만든 state 는 거부한다", () => {
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret: newKey() });
    expect(verifyOAuthState({ state, userId: USER_ID, now: NOW, secret: newKey() })).toBe(false);
  });

  it("발급 시각·nonce·mac 을 바꾸면 거부한다", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret });
    const [issuedAt, nonce, mac] = state.split(".") as [string, string, string];
    const otherNonce = randomBytes(16).toString("base64url");
    const flipped = `${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`;
    const tampered = [
      `${Number(issuedAt) - 1}.${nonce}.${mac}`,
      `${issuedAt}.${otherNonce}.${mac}`,
      `${issuedAt}.${nonce}.${flipped}`,
    ];
    for (const candidate of tampered) {
      expect(verifyOAuthState({ state: candidate, userId: USER_ID, now: NOW, secret })).toBe(false);
    }
  });

  it("모양이 틀린 state 는 던지지 않고 거부한다", () => {
    const secret = newKey();
    const state = createOAuthState({ userId: USER_ID, now: NOW, secret });
    const [issuedAt, nonce, mac] = state.split(".") as [string, string, string];
    const malformed = [
      "",
      "abc",
      `${issuedAt}.${nonce}`,
      `${state}.extra`,
      `x${issuedAt}.${nonce}.${mac}`,
      `${issuedAt}.0.${nonce}.${mac}`,
      ` ${state}`,
      `${issuedAt}.${nonce}.${mac}=`,
      `${issuedAt}.${nonce}+.${mac}`,
      `${issuedAt}.${nonce}.${mac.slice(0, 20)}`,
      "9".repeat(400) + `.${nonce}.${mac}`,
    ];
    for (const candidate of malformed) {
      expect(verifyOAuthState({ state: candidate, userId: USER_ID, now: NOW, secret })).toBe(false);
    }
  });

  // MAC 이 맞아도 발급 시각 모양 검사가 따로 막는다. 같은 시각의 다른 표기(+·16진·지수·13자리)는 받지 않는다.
  it("MAC 이 맞아도 발급 시각이 10진 정수 1~12자리가 아니면 거부한다", () => {
    const secret = newKey();
    const issuedSeconds = NOW.getTime() / 1000;
    const nonce = randomBytes(16).toString("base64url");
    const stateWith = (issuedAt: string) =>
      `${issuedAt}.${nonce}.${expectedMac(secret, USER_ID, issuedAt, nonce)}`;
    expect(
      verifyOAuthState({
        state: stateWith(String(issuedSeconds)),
        userId: USER_ID,
        now: NOW,
        secret,
      }),
    ).toBe(true);
    for (const issuedAt of [
      `+${issuedSeconds}`,
      `0x${issuedSeconds.toString(16)}`,
      `${issuedSeconds}e0`,
      `000${issuedSeconds}`,
    ]) {
      expect(Number(issuedAt)).toBe(issuedSeconds);
      expect(
        verifyOAuthState({ state: stateWith(issuedAt), userId: USER_ID, now: NOW, secret }),
        issuedAt,
      ).toBe(false);
    }
  });

  it("키 형식이 틀리면 만들기·확인 모두 형식 오류를 던진다(값은 싣지 않는다)", () => {
    const shortKey = randomBytes(16).toString("base64");
    expect(() => createOAuthState({ userId: USER_ID, now: NOW, secret: shortKey })).toThrow(
      KEY_FORMAT_ERROR,
    );
    expect(() =>
      verifyOAuthState({ state: "1.a.b", userId: USER_ID, now: NOW, secret: shortKey }),
    ).toThrow(KEY_FORMAT_ERROR);
  });
});
