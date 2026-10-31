import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KakaoTokenKeyMismatchError,
  assertKakaoTokenKey,
  decryptKakaoToken,
  encryptKakaoToken,
} from "./kakao-token.crypto";

// token-seal 로 옮긴 뒤에도 카카오 쪽 오류가 그대로인지 본다(ADR-073). 발송 수단(kakao-sender)은 message
// "KAKAO_TOKEN_DECRYPT_FAILED" 만 연결 만료로 보고, 키 불일치·키 형식 오류는 설정 오류로 던진다.
const KEY = randomBytes(32).toString("base64");
const CONTEXT = { userId: "00000000-0000-0000-0000-000000000001", kind: "refresh" } as const;

const errorOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
};

describe("kakao-token.crypto", () => {
  it("변조는 KAKAO_TOKEN_DECRYPT_FAILED, 다른 키는 KakaoTokenKeyMismatchError, 틀린 키 형식은 형식 오류다", () => {
    const sealed = encryptKakaoToken("kakao-refresh", KEY, CONTEXT);
    expect(decryptKakaoToken(sealed, KEY, CONTEXT)).toBe("kakao-refresh");

    const tampered = errorOf(() => decryptKakaoToken(sealed, KEY, { ...CONTEXT, kind: "access" }));
    expect(tampered).toBeInstanceOf(Error);
    expect((tampered as Error).message).toBe("KAKAO_TOKEN_DECRYPT_FAILED");

    const otherKey = randomBytes(32).toString("base64");
    expect(errorOf(() => decryptKakaoToken(sealed, otherKey, CONTEXT))).toBeInstanceOf(
      KakaoTokenKeyMismatchError,
    );

    const badKey = errorOf(() => assertKakaoTokenKey("short"));
    expect((badKey as Error).message).toBe("KAKAO_TOKEN_ENC_KEY 형식 오류");
    expect((badKey as Error).message).not.toContain("short");
  });

  it("token-seal 로 옮기기 전 코드(7a772753)가 만든 암호문을 그대로 푼다", () => {
    // 옛 kakao-token.crypto.ts 의 encryptKakaoToken 으로 한 번 만든 고정 값이다. 운영에 저장된 카카오 행이 계속 풀리는지 지킨다.
    // 키는 시험용 가짜 값(바이트 0x01..0x20)이다. 실제 키가 아니다.
    const fixtureKey = Buffer.from(Array.from({ length: 32 }, (_, index) => index + 1)).toString(
      "base64",
    );
    const legacy =
      "v1.riFsLvUkejc.677pxQGx81R74Vt0.huR2R3X5DFdjzas9_g8BKw.QY-Yv42fxouqwESfLtzsIVurVoDa";
    expect(decryptKakaoToken(legacy, fixtureKey, CONTEXT)).toBe("kakao-refresh-fixture");
  });
});
