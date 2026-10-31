import "server-only";
import { createOAuthStateSigner } from "@/server/token-seal";
import { assertKakaoTokenKey } from "./kakao-token.crypto";

// ── 카카오 연결 OAuth state(계획 Task 6, Review Focus 5) ──
// 연결 시작(/connect)이 만들어 쿠키와 카카오 인가 주소에 함께 싣고, 콜백이 "이 사용자가 10분 안에 시작한 연결"인지 확인한다.
// 모양·HKDF·MAC 규칙은 token-seal 의 서명기에 있다(구글 캘린더 연동과 같은 방식, ADR-073). info·label 은 카카오 고유 값이라
// 구글 state 와 섞이지 않는다. 키 형식 오류는 카카오 쪽 문구(Error("KAKAO_TOKEN_ENC_KEY 형식 오류"))로 던진다.

const signer = createOAuthStateSigner({
  keyName: "KAKAO_TOKEN_ENC_KEY",
  info: "kakao-oauth-state",
  label: "kakao-notify-state:v1",
});

type StateKeyInput = { userId: string; secret: string };

/** 키 형식이 틀리면 Error("KAKAO_TOKEN_ENC_KEY 형식 오류")를 던진다. */
export function createOAuthState(input: StateKeyInput & { now: Date }): string {
  assertKakaoTokenKey(input.secret);
  return signer.create(input);
}

/**
 * 같은 사용자·같은 키로 만들었고 발급 뒤 600초 안이면 true. 모양이 틀린 state 는 던지지 않고 false 다.
 * 키 형식이 틀리면 만들기와 같이 던진다(설정 오류는 거부와 구분한다).
 */
export function verifyOAuthState(input: StateKeyInput & { state: string; now: Date }): boolean {
  assertKakaoTokenKey(input.secret);
  return signer.verify(input);
}
