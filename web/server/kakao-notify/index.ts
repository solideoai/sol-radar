import "server-only";

// ── kakao-notify 도메인 배럴. 바깥(app·worker)은 이 파일만 부른다 ──
// 카카오톡 "나에게 보내기" 추천 공고 알림(설계 docs/plans/2026-10-20-kakao-memo-notify-design.md).

// 토큰 암호화. 웹 서버가 암호화해 저장하고 worker 만 복호화한다(설계 §7).
export { decryptKakaoToken, encryptKakaoToken } from "./kakao-token.crypto";

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

// 발송 port. worker 가 NOTIFY_KAKAO_PROVIDER(mock 기본 | memo)로 고른다(설계 §8).
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
