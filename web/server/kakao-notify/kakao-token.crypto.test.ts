import { createHash, randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  KakaoTokenKeyMismatchError,
  assertKakaoTokenKey,
  decryptKakaoToken,
  encryptKakaoToken,
  type KakaoTokenContext,
} from "./kakao-token.crypto";

// 카카오 토큰 암호화(설계 §7, 계획 Task 2, 보안 검토 보강 1~3). 키는 시험마다 새로 만든다 — 저장소에 키 모양의 값을 두지 않는다.
// 모양 v1.<kid>.<iv>.<tag>.<ciphertext>. kid 는 키 지문이라 다른 키면 "변조"(DECRYPT_FAILED)가 아니라 키 불일치(설정 오류)다.
// AAD 는 "<userId>:<kind>" 라 다른 사용자·다른 토큰 자리로 옮긴 암호문은 풀리지 않는다.
const newKey = (bytes = 32): string => randomBytes(bytes).toString("base64");
const TOKEN = "kakao-access-token-예시-0123456789";
const USER_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";
const OTHER_USER_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const ACCESS: KakaoTokenContext = { userId: USER_ID, kind: "access" };
const REFRESH: KakaoTokenContext = { userId: USER_ID, kind: "refresh" };
const BASE64URL = /^[A-Za-z0-9_-]*$/;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const KEY_FORMAT_ERROR = new Error("KAKAO_TOKEN_ENC_KEY 형식 오류");
const DECRYPT_FAILED = new Error("KAKAO_TOKEN_DECRYPT_FAILED");

/** 키 지문: sha256(키 바이트) 앞 8바이트의 base64url. */
const kidOf = (keyBase64: string): string =>
  createHash("sha256")
    .update(Buffer.from(keyBase64, "base64"))
    .digest()
    .subarray(0, 8)
    .toString("base64url");

// 같은 자리의 다른 base64url 글자로 바꾼다.
const swapCharAt = (text: string, index: number): string => {
  const replacement = text[index] === "A" ? "B" : "A";
  return `${text.slice(0, index)}${replacement}${text.slice(index + 1)}`;
};

/** 던진 오류. 던지지 않으면 시험을 실패시킨다. */
function caughtOf(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

describe("encryptKakaoToken·decryptKakaoToken", () => {
  it("암호화한 값을 같은 키·사용자·종류로 복호화하면 원문과 같다(access·refresh 둘 다)", () => {
    const key = newKey();
    expect(decryptKakaoToken(encryptKakaoToken(TOKEN, key, ACCESS), key, ACCESS)).toBe(TOKEN);
    expect(decryptKakaoToken(encryptKakaoToken(TOKEN, key, REFRESH), key, REFRESH)).toBe(TOKEN);
  });

  it("모양은 v1.<kid>.<iv>.<tag>.<ciphertext> 이고 각 조각은 base64url, kid 는 sha256(키) 앞 8바이트, iv 는 12바이트, tag 는 16바이트다", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key, ACCESS);
    const [version, kid, iv, tag, ciphertext, ...rest] = sealed.split(".");

    expect(version).toBe("v1");
    expect(rest).toEqual([]);
    for (const part of [kid, iv, tag, ciphertext]) expect(part).toMatch(BASE64URL);
    expect(kid).toBe(kidOf(key));
    expect(Buffer.from(kid, "base64url")).toHaveLength(8);
    expect(Buffer.from(iv, "base64url")).toHaveLength(12);
    expect(Buffer.from(tag, "base64url")).toHaveLength(16);
  });

  it("앞뒤 공백을 뗀 같은 키는 같은 kid 다", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, ` ${key}\n`, ACCESS);
    expect(sealed.split(".")[1]).toBe(kidOf(key));
    expect(decryptKakaoToken(sealed, key, ACCESS)).toBe(TOKEN);
  });

  it("암호문에 원문이 드러나지 않는다", () => {
    expect(encryptKakaoToken(TOKEN, newKey(), ACCESS)).not.toContain("kakao-access-token");
  });

  it("같은 원문을 두 번 암호화하면 결과가 다르다", () => {
    const key = newKey();
    expect(encryptKakaoToken(TOKEN, key, ACCESS)).not.toBe(encryptKakaoToken(TOKEN, key, ACCESS));
  });

  it("kid 밖의 어느 글자든 한 글자를 바꾸면 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key, ACCESS);
    const kidStart = "v1.".length;
    const kidEnd = kidStart + kidOf(key).length;
    for (let index = 0; index < sealed.length; index += 1) {
      if (index >= kidStart && index < kidEnd) continue;
      expect(() => decryptKakaoToken(swapCharAt(sealed, index), key, ACCESS)).toThrow(
        DECRYPT_FAILED,
      );
    }
  });

  it("kid 자리 글자를 바꾸면 키 불일치나 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다(원문을 돌려주지 않는다)", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key, ACCESS);
    const kidStart = "v1.".length;
    for (let index = kidStart; index < kidStart + kidOf(key).length; index += 1) {
      const error = caughtOf(() => decryptKakaoToken(swapCharAt(sealed, index), key, ACCESS));
      expect(["KAKAO_TOKEN_KEY_MISMATCH", "KAKAO_TOKEN_DECRYPT_FAILED"]).toContain(error.message);
    }
  });

  it("tag 끝 글자의 남는 비트만 바꿔 바이트가 같아도 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다", () => {
    // 16바이트 tag 는 base64url 22자이고 끝 글자의 아래 4비트는 버려진다. 가장 아래 비트만 바꾼다.
    const key = newKey();
    const [version, kid, iv, tag, ciphertext] = encryptKakaoToken(TOKEN, key, ACCESS).split(".");
    const last = BASE64URL_ALPHABET.indexOf(tag[tag.length - 1]);
    const tampered = `${tag.slice(0, -1)}${BASE64URL_ALPHABET[last ^ 1]}`;
    expect(Buffer.from(tampered, "base64url")).toEqual(Buffer.from(tag, "base64url"));
    expect(() =>
      decryptKakaoToken([version, kid, iv, tampered, ciphertext].join("."), key, ACCESS),
    ).toThrow(DECRYPT_FAILED);
  });

  it("모양이 틀린 값은 KAKAO_TOKEN_DECRYPT_FAILED 로 던진다(예전 네 조각 모양 포함)", () => {
    const key = newKey();
    const [version, , iv, tag, ciphertext] = encryptKakaoToken(TOKEN, key, ACCESS).split(".");
    const fourParts = [version, iv, tag, ciphertext].join(".");
    for (const sealed of ["", "v1", "v1.a.b", "v1.a.b.c", "v2.a.b.c.d", TOKEN, fourParts]) {
      expect(() => decryptKakaoToken(sealed, key, ACCESS)).toThrow(DECRYPT_FAILED);
    }
  });

  it("v2 로 시작하면 kid 가 맞아도 KAKAO_TOKEN_DECRYPT_FAILED 다", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key, ACCESS).replace(/^v1\./, "v2.");
    expect(() => decryptKakaoToken(sealed, key, ACCESS)).toThrow(DECRYPT_FAILED);
  });
});

describe("키 불일치 — KakaoTokenKeyMismatchError", () => {
  it("다른 키로 잠근 암호문은 KakaoTokenKeyMismatchError(KAKAO_TOKEN_KEY_MISMATCH)로 던진다 — 변조(DECRYPT_FAILED)와 구분한다", () => {
    const sealed = encryptKakaoToken(TOKEN, newKey(), ACCESS);
    const error = caughtOf(() => decryptKakaoToken(sealed, newKey(), ACCESS));
    expect(error).toBeInstanceOf(KakaoTokenKeyMismatchError);
    expect(error.name).toBe("KakaoTokenKeyMismatchError");
    expect(error.message).toBe("KAKAO_TOKEN_KEY_MISMATCH");
  });

  it("키 불일치 오류에는 키·암호문·원문·kid 가 없고 cause 도 없다", () => {
    const sealingKey = newKey();
    const currentKey = newKey();
    const sealed = encryptKakaoToken(TOKEN, sealingKey, ACCESS);
    const error = caughtOf(() => decryptKakaoToken(sealed, currentKey, ACCESS));
    expect(error.cause).toBeUndefined();
    for (const text of [String(error), inspect(error), error.stack ?? ""]) {
      for (const value of [sealingKey, currentKey, sealed, TOKEN, kidOf(sealingKey)]) {
        expect(text).not.toContain(value);
      }
    }
  });

  it("kid 만 지금 키의 kid 로 바꿔 끼운 암호문(다른 키로 잠금)은 KAKAO_TOKEN_DECRYPT_FAILED 다 — kid 를 믿고 풀지 않는다", () => {
    const currentKey = newKey();
    const [version, , iv, tag, ciphertext] = encryptKakaoToken(TOKEN, newKey(), ACCESS).split(".");
    const forged = [version, kidOf(currentKey), iv, tag, ciphertext].join(".");
    expect(() => decryptKakaoToken(forged, currentKey, ACCESS)).toThrow(DECRYPT_FAILED);
  });

  it("변조 오류의 message 에 암호문·원문이 없고 cause 도 없다", () => {
    const key = newKey();
    const original = encryptKakaoToken(TOKEN, key, ACCESS);
    const sealed = swapCharAt(original, original.length - 1);
    const error = caughtOf(() => decryptKakaoToken(sealed, key, ACCESS));
    expect(error.message).toBe("KAKAO_TOKEN_DECRYPT_FAILED");
    expect(error).not.toBeInstanceOf(KakaoTokenKeyMismatchError);
    expect(error.cause).toBeUndefined();
  });
});

describe("AAD — 암호문을 사용자·토큰 종류에 묶는다", () => {
  it("다른 사용자로 풀면 KAKAO_TOKEN_DECRYPT_FAILED 다(남의 행으로 옮긴 암호문)", () => {
    const key = newKey();
    const sealed = encryptKakaoToken(TOKEN, key, ACCESS);
    expect(() => decryptKakaoToken(sealed, key, { userId: OTHER_USER_ID, kind: "access" })).toThrow(
      DECRYPT_FAILED,
    );
  });

  it("access 로 잠근 것을 refresh 로, refresh 로 잠근 것을 access 로 풀면 KAKAO_TOKEN_DECRYPT_FAILED 다", () => {
    const key = newKey();
    expect(() => decryptKakaoToken(encryptKakaoToken(TOKEN, key, ACCESS), key, REFRESH)).toThrow(
      DECRYPT_FAILED,
    );
    expect(() => decryptKakaoToken(encryptKakaoToken(TOKEN, key, REFRESH), key, ACCESS)).toThrow(
      DECRYPT_FAILED,
    );
  });
});

describe("assertKakaoTokenKey — 키 형식", () => {
  it("정규 base64(패딩 포함) 32바이트 키는 받는다", () => {
    expect(() => assertKakaoTokenKey(newKey())).not.toThrow();
  });

  it("앞뒤 공백·개행은 떼고 본다", () => {
    expect(() => assertKakaoTokenKey(`  ${newKey()}\n`)).not.toThrow();
  });

  /** 첫 두 바이트가 0xff·0xef 라 base64 가 "/+" 로 시작한다. base64url 로 쓰면 "_-" 다. */
  const keyWithSlashPlus = (): Buffer => {
    const bytes = randomBytes(32);
    bytes[0] = 0xff;
    bytes[1] = 0xef;
    return bytes;
  };

  const middleNewline = (): string => {
    const key = newKey();
    return `${key.slice(0, 20)}\n${key.slice(20)}`;
  };

  const rejected: [string, () => string][] = [
    ["끝에 !!! 가 붙은 값", () => `${newKey()}!!!`],
    ["큰따옴표로 감싼 값", () => `"${newKey()}"`],
    ["작은따옴표로 감싼 값", () => `'${newKey()}'`],
    ["가운데에 개행이 든 값", middleNewline],
    ["base64url 글자(-·_)로 쓴 값", () => keyWithSlashPlus().toString("base64url")],
    ["패딩(=)을 뺀 값", () => newKey().replace(/=+$/, "")],
    ["전부 0 인 32바이트", () => Buffer.alloc(32).toString("base64")],
    ["31바이트", () => newKey(31)],
    ["33바이트", () => newKey(33)],
    ["16바이트", () => newKey(16)],
    ["빈 값", () => ""],
    ["공백만", () => "   "],
  ];

  it("base64url 시험 입력은 정말 -·_ 를 담고, base64 로는 /·+ 다", () => {
    const bytes = keyWithSlashPlus();
    expect(bytes.toString("base64").slice(0, 2)).toBe("/+");
    expect(bytes.toString("base64url").slice(0, 2)).toBe("_-");
    // Buffer.from 은 base64url 글자도 조용히 받아 같은 32바이트를 만든다. 다시 인코딩해 비교해야 걸러진다.
    expect(Buffer.from(bytes.toString("base64url"), "base64")).toEqual(bytes);
  });

  it.each(rejected)(
    "%s 는 'KAKAO_TOKEN_ENC_KEY 형식 오류' 로 던지고 값은 싣지 않는다",
    (_label, make) => {
      const key = make();
      const error = caughtOf(() => assertKakaoTokenKey(key));
      expect(error).toEqual(KEY_FORMAT_ERROR);
      if (key.trim() !== "") expect(String(error)).not.toContain(key.trim());
    },
  );

  it.each(rejected)("%s 는 암호화·복호화 모두 형식 오류로 던진다", (_label, make) => {
    const key = make();
    const sealed = encryptKakaoToken(TOKEN, newKey(), ACCESS);
    expect(() => encryptKakaoToken(TOKEN, key, ACCESS)).toThrow(KEY_FORMAT_ERROR);
    expect(() => decryptKakaoToken(sealed, key, ACCESS)).toThrow(KEY_FORMAT_ERROR);
  });
});
