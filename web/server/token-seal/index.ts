import "server-only";

// ── token-seal 배럴: 외부 서비스 토큰(카카오·구글 refresh token)의 AES-256-GCM 암호화와 연결 OAuth state 서명 ──
// 도메인(kakao-notify·google-calendar)이 각자의 env 키 이름으로 createTokenSealer·createOAuthStateSigner 를 만들어 쓴다.
export { TokenSealError, createTokenSealer } from "./token-seal";
export type { TokenSealContext, TokenSealFailure, TokenSealer } from "./token-seal";
export { createOAuthStateSigner } from "./oauth-state";
export type { OAuthStateSigner } from "./oauth-state";
