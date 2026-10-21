import "server-only";

// ── 개인 설정 "카카오톡 알림" 칸의 화면 상태(설계 §9) ──
// 연결 표(kakao_notify_links)에서 화면 역할이 읽을 수 있는 열만 받는다. 토큰 열은 이 모양에 없다.

export type KakaoNotifyRow = {
  enabled: boolean;
  status: "CONNECTED" | "EXPIRED";
  last_sent_at: string | null;
  last_result: "SENT" | "FAILED" | "EXPIRED" | null;
};

export type KakaoNotifyView = {
  state: "DISCONNECTED" | "OFF" | "ON" | "EXPIRED";
  lastSentAt: string | null;
  lastResult: KakaoNotifyRow["last_result"];
};

const stateOf = (row: KakaoNotifyRow): KakaoNotifyView["state"] => {
  if (row.status === "EXPIRED") return "EXPIRED";
  return row.enabled ? "ON" : "OFF";
};

// 행이 없으면 연결 전이다. 만료는 켬·끔보다 먼저 본다 — 켜 둔 채 만료돼도 "다시 연결" 을 보여야 한다.
export function toKakaoNotifyView(row: KakaoNotifyRow | null): KakaoNotifyView {
  if (row === null) return { state: "DISCONNECTED", lastSentAt: null, lastResult: null };
  return { state: stateOf(row), lastSentAt: row.last_sent_at, lastResult: row.last_result };
}

// ── worker 발송 port 가 읽고 쓰는 연결 한 행(설계 §5.5·§7, 계획 Task 3) ──
// 토큰은 암호문(kakao-token.crypto)이다. 구현은 kakao-link.repo(service role 클라이언트)이고 worker 만 쓴다.

/** 설정 칸 "마지막 발송" 줄에 적는 결과. 보내지 못한 실패(UNKNOWN_OUTCOME·RETRYABLE·REJECTED)는 FAILED 다. */
export type KakaoSendRecord = NonNullable<KakaoNotifyRow["last_result"]>;

/**
 * 액세스 암호문·만료가 null 일 수 있다. 표가 null 을 허용한다(20261021000001). RPC 로는 생기지 않지만
 * 생기면 sender 가 암호문 없음은 만료로, 만료 없음은 "곧 만료"로 다룬다.
 */
export type StoredKakaoLink = {
  userId: string;
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  accessExpiresAt: Date | null;
  refreshExpiresAt: Date | null;
  status: "CONNECTED" | "EXPIRED";
};

/** 갱신 뒤 저장할 토큰. 새 refresh 가 오지 않았으면 기존 암호문과 만료를 그대로 넘긴다. */
export type SealedKakaoTokens = {
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date | null;
};

export type KakaoLinkStore = {
  /** 연결이 없으면 null. */
  read(userId: string): Promise<StoredKakaoLink | null>;
  saveTokens(userId: string, sealed: SealedKakaoTokens): Promise<void>;
  /** CONNECTED 인 행만 EXPIRED 로 바꾼다. 바꿨으면 true — 만료 인앱 알림은 바뀐 순간 한 번만 낸다(설계 §5.5). */
  markExpired(userId: string): Promise<boolean>;
  markResult(userId: string, result: KakaoSendRecord, at: Date): Promise<void>;
};
