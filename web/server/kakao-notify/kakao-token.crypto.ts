import "server-only";
import { TokenSealError, createTokenSealer, type TokenSealContext } from "@/server/token-seal";

// ── 카카오 토큰 암호화(설계 §7): token-seal 도메인의 AES-256-GCM 봉인을 KAKAO_TOKEN_ENC_KEY 로 쓴다 ──
// 암호문 모양·AAD·kid 규칙은 token-seal 에 있다(구글 캘린더 연동과 같은 방식, ADR-073). 이 파일은 카카오 쪽 이름과
// 오류 문구를 그대로 지킨다 — sender·worker 가 message "KAKAO_TOKEN_DECRYPT_FAILED" 와 KakaoTokenKeyMismatchError 로 나눈다.
//   - 키 형식 오류 → Error("KAKAO_TOKEN_ENC_KEY 형식 오류")
//   - 변조·다른 사용자·다른 종류 → Error("KAKAO_TOKEN_DECRYPT_FAILED")
//   - kid 불일치(웹과 worker 의 키가 다름) → KakaoTokenKeyMismatchError
// 키·암호문·원문은 어느 오류에도 싣지 않는다.

const KEY_NAME = "KAKAO_TOKEN_ENC_KEY";
const sealer = createTokenSealer(KEY_NAME);

/** 암호문이 묶이는 자리. 같은 사용자·같은 종류로만 풀린다. */
export type KakaoTokenContext = TokenSealContext;

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

const keyFormatError = (): Error => new Error(`${KEY_NAME} 형식 오류`);
const decryptFailed = (): Error => new Error("KAKAO_TOKEN_DECRYPT_FAILED");

/** token-seal 의 오류를 카카오 쪽 오류로 옮긴다. 다른 오류는 그대로 던진다. */
function rethrow(error: unknown): never {
  if (error instanceof TokenSealError) {
    switch (error.code) {
      case "KEY_FORMAT":
        throw keyFormatError();
      case "DECRYPT_FAILED":
        throw decryptFailed();
      case "KEY_MISMATCH":
        throw new KakaoTokenKeyMismatchError();
    }
  }
  throw error;
}

/**
 * KAKAO_TOKEN_ENC_KEY 형식 검사. 앞뒤 공백을 뗀 값이 정규 base64(패딩 포함)이고 32바이트이며 전부 0 이 아니어야 한다.
 * 아니면 Error("KAKAO_TOKEN_ENC_KEY 형식 오류")(값 없음). worker 는 기동 때 이것으로 막는다.
 */
export function assertKakaoTokenKey(keyBase64: string): void {
  try {
    sealer.assertKey(keyBase64);
  } catch (error) {
    rethrow(error);
  }
}

export function encryptKakaoToken(
  plain: string,
  keyBase64: string,
  context: KakaoTokenContext,
): string {
  try {
    return sealer.encrypt(plain, keyBase64, context);
  } catch (error) {
    rethrow(error);
  }
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
  try {
    return sealer.decrypt(sealed, keyBase64, context);
  } catch (error) {
    rethrow(error);
  }
}
