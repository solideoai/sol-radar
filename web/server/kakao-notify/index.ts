import "server-only";

// ── kakao-notify 도메인 배럴. 바깥(app·worker)은 이 파일만 부른다 ──
// 카카오톡 "나에게 보내기" 추천 공고 알림(설계 docs/plans/2026-10-20-kakao-memo-notify-design.md).

// 토큰 암호화. 웹 서버가 암호화해 저장하고 worker 만 복호화한다(설계 §7).
// 암호문은 v1.<kid>.<iv>.<tag>.<ciphertext> 이고 사용자·토큰 종류(KakaoTokenContext)에 묶인다. kid 가 지금 키와 다르면
// KakaoTokenKeyMismatchError(설정 오류)다. assertKakaoTokenKey 는 KAKAO_TOKEN_ENC_KEY 형식 검사다(worker 기동 때).
export {
  KakaoTokenKeyMismatchError,
  assertKakaoTokenKey,
  decryptKakaoToken,
  encryptKakaoToken,
} from "./kakao-token.crypto";
export type { KakaoTokenContext } from "./kakao-token.crypto";

// 피드 한 통과 사유 줄(설계 §5.3). AI 서술은 싣지 않는다.
export { toBidFeedTemplate, toReasonLine, toTestFeedTemplate } from "./feed.model";
export type {
  BidFeedInput,
  KakaoFeedTemplate,
  KakaoLink,
  QualificationSummaryInput,
} from "./feed.model";

// 설정 칸의 화면 상태 4개(설계 §9)와 worker 발송 port 가 읽고 쓰는 연결 행(설계 §5.5).
export { toKakaoNotifyView } from "./kakao-notify.model";
export type {
  KakaoLinkExpectation,
  KakaoLinkStore,
  KakaoNotifyRow,
  KakaoNotifyView,
  KakaoSendRecord,
  SealedKakaoTokens,
  StoredKakaoLink,
} from "./kakao-notify.model";

// 카카오 REST API 클라이언트(인가 주소·토큰 받기·갱신·나에게 보내기, 설계 §4.2). 실제 호출은 memo 발송과 연결 Route Handler 만 한다.
// 발송 실패는 결과 값으로, 토큰 실패는 KakaoTokenError 로 던진다(갱신의 invalid_grant 만 "INVALID_GRANT" 값).
export { KakaoTokenError, createKakaoApi } from "./kakao-api";
export type { KakaoApi, KakaoApiDeps, KakaoSendResult, KakaoTokenSet } from "./kakao-api";

// 발송 port. worker 가 NOTIFY_KAKAO_PROVIDER(mock | memo)로 고른다(설계 §8). 비면 live 밖은 mock, live 는 발송 꺼짐(worker/notify-outbox.ts).
export { createMemoKakaoSender, createMockKakaoSender } from "./kakao-sender";
export type {
  KakaoExpiredResult,
  KakaoSender,
  KakaoSenderResult,
  MemoKakaoSenderDeps,
  MockKakaoSenderDeps,
} from "./kakao-sender";

// 연결 저장 port 의 Supabase 구현. worker 가 service role 클라이언트를 넘긴다. 던지는 오류는 모두 KakaoLinkStoreError 다.
export { KakaoLinkStoreError, createKakaoLinkStore } from "./kakao-link.repo";

// 개인 설정 "카카오톡 알림"의 웹 서버 쪽(계획 Task 6). Route Handler·설정 화면이 부른다. 사용자 세션(anon 키 + RLS)으로만 읽고 쓴다.
// 연결은 OAuth state(HMAC, 10분)를 쿠키와 대조한 뒤 받은 토큰을 사용자에 묶어 암호화해 저장한다.
export {
  KAKAO_CONNECT_OUTCOMES,
  KAKAO_STATE_COOKIE,
  completeKakaoConnect,
  disconnectMyKakaoNotify,
  getMyKakaoNotify,
  isKakaoStateCookieSecure,
  loadMyKakaoNotify,
  requestMyKakaoNotifyTest,
  setMyKakaoNotifyEnabled,
  startKakaoConnect,
  toKakaoConnectOutcome,
} from "./kakao-notify.service";
export type { KakaoConnectOutcome, KakaoConnectResult } from "./kakao-notify.service";
