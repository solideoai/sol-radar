import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// ── 외부 서비스 토큰 암호화: AES-256-GCM, 모양 v1.<kid>.<iv>.<tag>.<ciphertext>(각 base64url) ──
// 카카오 "나에게 보내기"(kakao-notify)와 구글 캘린더 연동(google-calendar)이 같은 방식으로 refresh token 을 DB 에 둔다.
// 평문 토큰을 DB 에 두지 않으려고 서버가 암호화해 저장하고, 키를 가진 서버만 복호화한다.
// 오류 message 는 고정 문구만 싣는다. 키·암호문·원문은 로그로 새지 않게 message 에도 cause 에도 넣지 않는다.
//
//   - kid 는 키 지문(sha256(키 바이트) 앞 8바이트)이다. 두 런타임의 키가 다르면 복호화 실패가 "변조"(DECRYPT_FAILED)가 아니라
//     설정 오류(KEY_MISMATCH)로 나뉜다. 부르는 쪽은 변조만 연결 만료로 보므로, 키를 잘못 넣어도 연결된 전원이 만료되지 않는다.
//     kid 는 해시 조각이라 키를 되살릴 수 없다. kid 가 같아도 키가 다르면 GCM 이 실패한다 — kid 는 오류를 나누는 데만 쓴다.
//   - AAD 는 "<aadPrefix><userId>:<kind>" 다. 암호문을 다른 사용자 행이나 다른 토큰 자리(access↔refresh)로 옮기면 풀리지 않는다.
//     서비스마다 키가 다르다(KAKAO_TOKEN_ENC_KEY·GOOGLE_TOKEN_ENC_KEY). 같은 값을 넣는 실수에 대비해 구글은 aadPrefix "google:" 를
//     붙여 카카오 암호문을 구글 자리에 옮겨도 풀리지 않게 한다. 카카오는 접두가 없다(운영에 저장된 암호문의 형식을 지킨다).
//   - 키는 정규 base64(패딩 포함) 32바이트만 받고 전부 0 인 키는 거절한다. Buffer.from 은 틀린 글자를 조용히 버리므로
//     다시 인코딩해 같은지 본다.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const KID_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PART_COUNT = 5;

/** 암호문이 묶이는 자리. 같은 사용자·같은 종류로만 풀린다. */
export type TokenSealContext = { userId: string; kind: "access" | "refresh" };

export type TokenSealFailure = "KEY_FORMAT" | "DECRYPT_FAILED" | "KEY_MISMATCH";

/**
 * 암호화·복호화 오류. code 로 나눈다.
 *   KEY_FORMAT     — env 키가 정규 base64 32바이트가 아니다(설정 오류, 기동 때 막는다)
 *   DECRYPT_FAILED — 모양이 틀리거나 변조됐거나 다른 사용자·종류로 풀었다
 *   KEY_MISMATCH   — 암호문의 kid 가 지금 키와 다르다(두 런타임의 키가 다르거나 키를 바꿨다). 변조가 아니다
 * message 는 "<키 이름> <code>" 이고 값은 없다.
 */
export class TokenSealError extends Error {
  readonly code: TokenSealFailure;
  constructor(keyName: string, code: TokenSealFailure) {
    super(`${keyName} ${code}`);
    this.name = "TokenSealError";
    this.code = code;
  }
}

export type TokenSealer = {
  /** 키 형식 검사. 틀리면 TokenSealError(KEY_FORMAT). */
  assertKey(keyBase64: string): void;
  encrypt(plain: string, keyBase64: string, context: TokenSealContext): string;
  decrypt(sealed: string, keyBase64: string, context: TokenSealContext): string;
};

const kidOf = (key: Buffer): Buffer =>
  createHash("sha256").update(key).digest().subarray(0, KID_BYTES);

const aadOf = (prefix: string, context: TokenSealContext): Buffer =>
  Buffer.from(`${prefix}${context.userId}:${context.kind}`, "utf8");

/** keyName 은 오류 문구에 들어가는 env 변수 이름이다(값이 아니다). */
export function createTokenSealer(
  keyName: string,
  options: {
    /** AAD 앞에 붙는 서비스 구분(예: "google:"). 기본은 없음(카카오의 기존 암호문 형식). */
    aadPrefix?: string;
  } = {},
): TokenSealer {
  const aadPrefix = options.aadPrefix ?? "";
  const keyFormatError = () => new TokenSealError(keyName, "KEY_FORMAT");
  const decryptFailed = () => new TokenSealError(keyName, "DECRYPT_FAILED");

  function readKey(keyBase64: string): Buffer {
    const trimmed = keyBase64.trim();
    const key = Buffer.from(trimmed, "base64");
    if (key.toString("base64") !== trimmed) throw keyFormatError();
    if (key.length !== KEY_BYTES) throw keyFormatError();
    if (key.every((byte) => byte === 0)) throw keyFormatError();
    return key;
  }

  // Buffer.from 은 base64url 이 아닌 글자를 조용히 버리고 끝자리의 남는 비트도 무시한다.
  // 다시 인코딩한 글자가 같을 때만 받아, 어느 글자를 바꾸든 복호화가 실패하게 한다.
  function decodePart(part: string, expectedBytes?: number): Buffer {
    const bytes = Buffer.from(part, "base64url");
    if (bytes.toString("base64url") !== part) throw decryptFailed();
    if (expectedBytes !== undefined && bytes.length !== expectedBytes) throw decryptFailed();
    return bytes;
  }

  return {
    assertKey(keyBase64) {
      readKey(keyBase64);
    },

    encrypt(plain, keyBase64, context) {
      const key = readKey(keyBase64);
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(aadOf(aadPrefix, context));
      const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      const parts = [kidOf(key), iv, tag, ciphertext].map((bytes) => bytes.toString("base64url"));
      return [VERSION, ...parts].join(".");
    },

    decrypt(sealed, keyBase64, context) {
      const key = readKey(keyBase64);
      const parts = sealed.split(".");
      if (parts.length !== PART_COUNT || parts[0] !== VERSION) throw decryptFailed();
      const [, kidPart, ivPart, tagPart, ciphertextPart] = parts;
      // 모양부터 모두 본다. 모양이 틀린 값은 kid 와 상관없이 변조다.
      const kid = decodePart(kidPart, KID_BYTES);
      const iv = decodePart(ivPart, IV_BYTES);
      const tag = decodePart(tagPart, TAG_BYTES);
      const ciphertext = decodePart(ciphertextPart);
      if (!kid.equals(kidOf(key))) throw new TokenSealError(keyName, "KEY_MISMATCH");
      try {
        const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(aadOf(aadPrefix, context));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch {
        throw decryptFailed();
      }
    },
  };
}
