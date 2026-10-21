import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { missingKakaoConnectSettings, readKakaoConnectConfig } from "./kakao-connect.config";

// 웹 서버 카카오 연결 설정. 키는 시험마다 새로 만든다 — 저장소에 키 모양의 값을 두지 않는다.
const fullEnv = () => ({
  KAKAO_REST_API_KEY: " rest-key ",
  KAKAO_CLIENT_SECRET: "client-secret",
  KAKAO_TOKEN_ENC_KEY: randomBytes(32).toString("base64"),
  KAKAO_REDIRECT_URI: "http://localhost:3000/api/v1/me/kakao-notify/callback",
});

describe("readKakaoConnectConfig", () => {
  it("넷이 다 있으면 앞뒤 공백을 뗀 설정", () => {
    const env = fullEnv();
    expect(readKakaoConnectConfig(env)).toEqual({
      restApiKey: "rest-key",
      clientSecret: "client-secret",
      tokenKey: env.KAKAO_TOKEN_ENC_KEY,
      redirectUri: "http://localhost:3000/api/v1/me/kakao-notify/callback",
    });
    expect(missingKakaoConnectSettings(env)).toEqual([]);
  });

  it("빠졌거나 틀린 변수는 이름만 돌려주고 설정은 null", () => {
    const env = {
      ...fullEnv(),
      KAKAO_REST_API_KEY: "  ",
      KAKAO_CLIENT_SECRET: undefined,
      KAKAO_TOKEN_ENC_KEY: randomBytes(16).toString("base64"),
      KAKAO_REDIRECT_URI: "javascript:alert(1)",
    };
    expect(missingKakaoConnectSettings(env)).toEqual([
      "KAKAO_REST_API_KEY",
      "KAKAO_CLIENT_SECRET",
      "KAKAO_TOKEN_ENC_KEY",
      "KAKAO_REDIRECT_URI",
    ]);
    expect(readKakaoConnectConfig(env)).toBeNull();
  });

  it("하나만 빠져도 null", () => {
    expect(readKakaoConnectConfig({ ...fullEnv(), KAKAO_REDIRECT_URI: "not a url" })).toBeNull();
    expect(readKakaoConnectConfig({ ...fullEnv(), KAKAO_TOKEN_ENC_KEY: "" })).toBeNull();
  });

  // 보안 검토(하): 운영에서 http 콜백이면 state 쿠키에 Secure 가 빠진다. 로컬 데모(localhost)만 http 를 받는다.
  it.each([
    "http://sol-radar.example/api/v1/me/kakao-notify/callback",
    "http://10.0.0.5:3000/api/v1/me/kakao-notify/callback",
  ])("운영(NODE_ENV=production)에서 loopback 이 아닌 http 콜백 %s 는 틀린 값이다", (uri) => {
    const env = { ...fullEnv(), NODE_ENV: "production", KAKAO_REDIRECT_URI: uri };
    expect(missingKakaoConnectSettings(env)).toEqual(["KAKAO_REDIRECT_URI"]);
    expect(readKakaoConnectConfig(env)).toBeNull();
  });

  it.each([
    "https://sol-radar.example/api/v1/me/kakao-notify/callback",
    "http://localhost:3000/api/v1/me/kakao-notify/callback",
    "http://127.0.0.1:3000/api/v1/me/kakao-notify/callback",
  ])("운영에서도 https 와 loopback http 콜백 %s 은 받는다", (uri) => {
    const env = { ...fullEnv(), NODE_ENV: "production", KAKAO_REDIRECT_URI: uri };
    expect(missingKakaoConnectSettings(env)).toEqual([]);
  });

  it("개발(NODE_ENV 가 production 이 아님)에서는 http 콜백도 받는다", () => {
    const env = {
      ...fullEnv(),
      NODE_ENV: "development",
      KAKAO_REDIRECT_URI: "http://sol-radar.example/api/v1/me/kakao-notify/callback",
    };
    expect(missingKakaoConnectSettings(env)).toEqual([]);
  });

  it("NEXT_PUBLIC_ 이름은 읽지 않는다", () => {
    const env = fullEnv();
    const publicOnly = Object.fromEntries(
      Object.entries(env).map(([name, value]) => [`NEXT_PUBLIC_${name}`, value]),
    );
    expect(readKakaoConnectConfig(publicOnly)).toBeNull();
  });
});
