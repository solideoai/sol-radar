import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptKakaoToken, encryptKakaoToken } from "./kakao-token.crypto";

// 카카오 토큰 암호화(설계 §7, 계획 Task 2). 키는 시험마다 새로 만든다 — 저장소에 키 모양의 값을 두지 않는다.
const newKey = (bytes = 32): string => randomBytes(bytes).toString("base64");
const TOKEN = "kakao-access-token-예시-0123456789";
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// 같은 자리의 다른 base64url 글자로 바꾼다.
const swapCharAt = (text: string, index: number): string => {
  const replacement = text[index] === "A" ? "B" : "A";
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
};

describe("encryptKakaoToken·decryptKakaoToken", () => {
  it("암호화한 값을 복호화하면 원문과 같다", () => {
    const key = newKey();
    expect(decryptKakaoToken(encryptKakaoToken(TOKEN, key), key)).toBe(TOKEN);
  });

  it("모양은 v1.<iv>.<tag>.<ciphertext> 이고 각 조각은 base64url, iv 는 12바이트, tag 는 16바이트다", () => {
    const sealed = encryptKakaoToken(TOKEN, newKey());
    const [version, iv, tag, ciphertext, ...rest] = sealed.split(".");

    expect(version).toBe("v1");
    expect(rest).toEqual([]);
    for (const part of [iv, tag, ciphertext]) expect(part).toMatch(BASE64URL);
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
  });

  it("암호문에 원문이 드러나지 않는다", () => {
    expect(encryptKakaoToken(TOKEN, newKey())).not.toContain("kakao-access-token");
  });

  it("같은 원문을 두 번 암호화하면 결과가 다르다", () => {
    const key = newKey();
    expect(encryptKakaoToken(TOKEN, key)).not.toBe(encryptKakaoToken(TOKEN, key));
  });

  it("어느 글자든 한 글자를 바꾸면 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key);
    for (let index = 0; index < sealed.length; index += 1) {
      expect(() => decryptKakaoToken(swapCharAt(sealed, index), key)).toThrow(
        new Error("KAKAO_TOKEN_DECRYPT_FAILED"),
      );
    }
  });

  it("tag 끝 글자의 남는 비트만 바꿔 바이트가 같아도 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다", () => {
    // 16바이트 tag 는 base64url 22자이고 끝 글자의 아래 4비트는 버려진다. 가장 아래 비트만 바꾼다.
    const key = newKey();
    const [version, iv, tag, ciphertext] = encryptKakaoToken(TOKEN, key).split(".");
    const last = BASE64URL_ALPHABET.indexOf(tag[tag.length - 1]);
    const tampered = `${tag.slice(0, -1)}${BASE64URL_ALPHABET[last ^ 1]}`;
    expect(Buffer.from(tampered, "base64url")).toEqual(Buffer.from(tag, "base64url"));
    expect(() => decryptKakaoToken([version, iv, tampered, ciphertext].join("."), key)).toThrow(
      new Error("KAKAO_TOKEN_DECRYPT_FAILED"),
    );
  });

  it("다른 키로 복호화하면 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다", () => {
    const sealed = encryptKakaoToken(TOKEN, newKey());
    expect(() => decryptKakaoToken(sealed, newKey())).toThrow(
      new Error("KAKAO_TOKEN_DECRYPT_FAILED"),
    );
  });

  it("모양이 틀린 값은 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다", () => {
    const key = newKey();
    for (const sealed of ["", "v1", "v1.a.b", "v2.a.b.c", TOKEN]) {
      expect(() => decryptKakaoToken(sealed, key)).toThrow(new Error("KAKAO_TOKEN_DECRYPT_FAILED"));
    }
  });

  it("복호화 실패 오류의 message 에 암호문·원문이 없다", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key);
    const caught = (() => {
      try {
        decryptKakaoToken(sealed, newKey());
        return null;
      } catch (error) {
        return error;
      }
    })();

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("KAKAO_TOKEN_DECRYPT_FAILED");
    expect((caught as Error).cause).toBeUndefined();
  });

  it("16바이트 키는 암호화·복호화 모두 형식 오류로 던진다", () => {
    const shortKey = newKey(16);
    const sealed = encryptKakaoToken(TOKEN, newKey());
    expect(() => encryptKakaoToken(TOKEN, shortKey)).toThrow(
      new Error("KAKAO_TOKEN_ENC_KEY 형식 오류"),
    );
    expect(() => decryptKakaoToken(sealed, shortKey)).toThrow(
      new Error("KAKAO_TOKEN_ENC_KEY 형식 오류"),
    );
  });

  it("빈 키는 형식 오류로 던진다", () => {
    expect(() => encryptKakaoToken(TOKEN, "")).toThrow(new Error("KAKAO_TOKEN_ENC_KEY 형식 오류"));
  });
});
