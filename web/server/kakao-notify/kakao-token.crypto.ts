import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// ── 카카오 토큰 암호화(설계 §7): AES-256-GCM, 모양 v1.<kid>.<iv>.<tag>.<ciphertext>(각 base64url) ──
// 평문 토큰을 DB 에 두지 않으려고 웹 서버가 암호화해 저장하고 worker 만 복호화한다.
// 오류 message 는 고정 문구만 싣는다. 키·암호문·원문은 로그로 새지 않게 message 에도 cause 에도 넣지 않는다.
//
// 보안 검토 보강(2026-10-21):
//   - kid 는 키 지문(sha256(키 바이트) 앞 8바이트)이다. 웹과 worker 의 KAKAO_TOKEN_ENC_KEY 가 다르면 복호화 실패가
//     "변조"(KAKAO_TOKEN_DECRYPT_FAILED)가 아니라 설정 오류(KakaoTokenKeyMismatchError)로 나뉜다. 발송 수단은 변조만 연결 만료로
//     보므로, 키를 잘못 넣어도 연결된 전원이 만료되지 않는다. kid 는 해시 조각이라 키를 되살릴 수 없다.
//     kid 가 같아도 키가 다르면 GCM 이 실패한다 — kid 는 오류를 나누는 데만 쓰고 믿지 않는다.
//   - AAD 는 "<userId>:<kind>" 다. 암호문을 다른 사용자 행이나 다른 토큰 자리(access↔refresh)로 옮기면 풀리지 않는다.
//   - 키는 정규 base64(패딩 포함) 32바이트만 받고 전부 0 인 키는 거절한다. Buffer.from 은 틀린 글자를 조용히 버리므로
//     다시 인코딩해 같은지 본다.
//   - 운영 데이터가 아직 없어(ADR-038 구현 중) v1 모양을 그대로 바꿨다. 예전 네 조각 모양은 형식 오류다.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const KID_BYTES = 8;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PART_COUNT = 5;

/** 암호문이 묶이는 자리. 같은 사용자·같은 종류로만 풀린다. */
export type KakaoTokenContext = { userId: string; kind: "access" | "refresh" };

/**
 * 암호문의 kid 가 지금 키의 kid 와 다르다 — 웹과 worker 의 KAKAO_TOKEN_ENC_KEY 가 다르거나 키를 바꿨다는 설정 오류다.
 * 변조(KAKAO_TOKEN_DECRYPT_FAILED)가 아니므로 부르는 쪽은 연결을 만료로 바꾸지 말고 그대로 던진다. message 에 값은 없다.
 */
export class KakaoTokenKeyMismatchError extends Error {
  constructor() {
    super("KAKAO_TOKEN_KEY_MISMATCH");
    this.name = "KakaoTokenKeyMismatchError";
  }
}

const keyFormatError = (): Error => new Error("KAKAO_TOKEN_ENC_KEY 형식 오류");
const decryptFailed = (): Error => new Error("KAKAO_TOKEN_DECRYPT_FAILED");

function readKey(keyBase64: string): Buffer {
  const trimmed = keyBase64.trim();
  const key = Buffer.from(trimmed, "base64");
  if (key.toString("base64") !== trimmed) throw keyFormatError();
  if (key.length !== KEY_BYTES) throw keyFormatError();
  if (key.every((byte) => byte === 0)) throw keyFormatError();
  return key;
}

/**
 * KAKAO_TOKEN_ENC_KEY 형식 검사. 앞뒤 공백을 뗀 값이 정규 base64(패딩 포함)이고 32바이트이며 전부 0 이 아니어야 한다.
 * 아니면 Error("KAKAO_TOKEN_ENC_KEY 형식 오류")(값 없음). worker 는 기동 때 이것으로 막는다.
 */
export function assertKakaoTokenKey(keyBase64: string): void {
  readKey(keyBase64);
}

const kidOf = (key: Buffer): Buffer =>
  createHash("sha256").update(key).digest().subarray(0, KID_BYTES);

const aadOf = (context: KakaoTokenContext): Buffer =>
  Buffer.from(`${context.userId}:${context.kind}`, "utf8");

// Buffer.from 은 base64url 이 아닌 글자를 조용히 버리고 끝자리의 남는 비트도 무시한다.
// 다시 인코딩한 글자가 같을 때만 받아, 어느 글자를 바꾸든 복호화가 실패하게 한다.
function decodePart(part: string, expectedBytes?: number): Buffer {
  const bytes = Buffer.from(part, "base64url");
  if (bytes.toString("base64url") !== part) throw decryptFailed();
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) throw decryptFailed();
  return bytes;
}

export function encryptKakaoToken(
  plain: string,
  keyBase64: string,
  context: KakaoTokenContext,
): string {
  const key = readKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aadOf(context));
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const parts = [kidOf(key), iv, tag, ciphertext].map((bytes) => bytes.toString("base64url"));
  return [VERSION, ...parts].join(".");
}

/**
 * 모양이 틀리거나 변조됐거나 다른 사용자·종류로 풀면 Error("KAKAO_TOKEN_DECRYPT_FAILED").
 * 모양은 맞는데 kid 가 지금 키와 다르면 KakaoTokenKeyMismatchError. 키 형식이 틀리면 Error("KAKAO_TOKEN_ENC_KEY 형식 오류").
 */
export function decryptKakaoToken(
  sealed: string,
  keyBase64: string,
  context: KakaoTokenContext,
): string {
  const key = readKey(keyBase64);
  const parts = sealed.split(".");
  if (parts.length !== PART_COUNT || parts[0] !== VERSION) throw decryptFailed();
  const [, kidPart, ivPart, tagPart, ciphertextPart] = parts;
  // 모양부터 모두 본다. 모양이 틀린 값은 kid 와 상관없이 변조다.
  const kid = decodePart(kidPart, KID_BYTES);
  const iv = decodePart(ivPart, IV_BYTES);
  const tag = decodePart(tagPart, TAG_BYTES);
  const ciphertext = decodePart(ciphertextPart);
  if (!kid.equals(kidOf(key))) throw new KakaoTokenKeyMismatchError();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aadOf(context));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw decryptFailed();
  }
}
