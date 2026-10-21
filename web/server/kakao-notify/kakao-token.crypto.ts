import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// ── 카카오 토큰 암호화(설계 §7): AES-256-GCM, 모양 v1.<iv>.<tag>.<ciphertext>(각 base64url) ──
// 평문 토큰을 DB 에 두지 않으려고 웹 서버가 암호화해 저장하고 worker 만 복호화한다.
// 오류 message 는 고정 문구만 싣는다. 키·암호문·원문은 로그로 새지 않게 message 에도 cause 에도 넣지 않는다.

const ALGORITHM = "aes-256-gcm";
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

const keyFormatError = (): Error => new Error("KAKAO_TOKEN_ENC_KEY 형식 오류");
const decryptFailed = (): Error => new Error("KAKAO_TOKEN_DECRYPT_FAILED");

function readKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== KEY_BYTES) throw keyFormatError();
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

export function encryptKakaoToken(plain: string, keyBase64: string): string {
  const key = readKey(keyBase64);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, ...[iv, tag, ciphertext].map((bytes) => bytes.toString("base64url"))].join(".");
}

export function decryptKakaoToken(sealed: string, keyBase64: string): string {
  const key = readKey(keyBase64);
  const parts = sealed.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw decryptFailed();
  const [, ivPart, tagPart, ciphertextPart] = parts;
  const iv = decodePart(ivPart, IV_BYTES);
  const tag = decodePart(tagPart, TAG_BYTES);
  const ciphertext = decodePart(ciphertextPart);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw decryptFailed();
  }
}
