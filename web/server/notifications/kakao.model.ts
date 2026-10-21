import "server-only";
import { z } from "zod";
import {
  toReasonLine,
  type BidFeedInput,
  type KakaoSender,
  type KakaoSenderResult,
  type QualificationSummaryInput,
} from "@/server/kakao-notify";
import type { NotificationPayload, NotificationRow, OutboxEventRow } from "./outbox.model";

// ── 카카오톡 추천 공고 알림 소비자의 순수 규칙(설계 docs/plans/2026-10-20-kakao-memo-notify-design.md §5.2·§5.5, 계획 Task 4) ──
// outbox 이벤트 → 카카오 이벤트, 받는 사람 하나 → KAKAO 알림 행, 연결 만료 → 인앱 알림 행, 발송 결과 → 행 갱신.
// 인앱 두 종(REVIEW_ASSIGNED·ANALYSIS_COMPLETE)의 규칙은 outbox.model 에 그대로 있다. 이 파일은 두 새 종만 다룬다.
// 저장·시계·발송·로그는 모른다. 시각은 Date 로 받고 ISO 문자열로 돌려준다.

/** 카카오 소비자가 받는 이벤트 종류. outbox 의 한 회차(processOutboxBatch)가 인앱 규칙보다 먼저 이쪽으로 넘긴다. */
export const KAKAO_EVENT_TYPES = ["BID_RECOMMENDED", "KAKAO_TEST"] as const;
export type KakaoEventType = (typeof KAKAO_EVENT_TYPES)[number];

export const isKakaoEventType = (eventType: string): eventType is KakaoEventType =>
  KAKAO_EVENT_TYPES.some((candidate) => candidate === eventType);

// 근거: 마이그레이션 20261021000002(finish_score_run 의 BID_RECOMMENDED)·20261021000001(request_kakao_notify_test 의 KAKAO_TEST).
const bidRecommendedPayloadSchema = z.looseObject({
  scoreRunId: z.uuid(),
  bidId: z.uuid(),
  orgId: z.uuid(),
  recommendation: z.enum(["BID", "WATCH"]),
  status: z.enum(["COMPLETED", "PARTIAL"]),
});

const kakaoTestPayloadSchema = z.looseObject({ userId: z.uuid() });

export type KakaoEvent =
  | {
      kind: "RECOMMENDED";
      orgId: string;
      bidId: string;
      scoreRunId: string;
      recommendation: "BID" | "WATCH";
      status: "COMPLETED" | "PARTIAL";
    }
  | { kind: "TEST"; userId: string }
  | { kind: "INVALID" };

/**
 * outbox 이벤트를 카카오 이벤트로 읽는다. 다시 해도 같은 결과인 것은 INVALID 다:
 * 두 종이 아니다 · payload 가 틀렸다 · BID_RECOMMENDED 인데 조직이 없거나(org_id null) payload 의 조직과 다르다(다른 조직 혼입).
 * KAKAO_TEST 는 사용자 단위라 조직이 없다(org_id null) — payload 의 userId 만 본다.
 */
export function toKakaoEvent(event: OutboxEventRow): KakaoEvent {
  if (event.event_type === "KAKAO_TEST") {
    const parsed = kakaoTestPayloadSchema.safeParse(event.payload);
    return parsed.success ? { kind: "TEST", userId: parsed.data.userId } : { kind: "INVALID" };
  }
  if (event.event_type !== "BID_RECOMMENDED" || event.org_id === null) return { kind: "INVALID" };
  const parsed = bidRecommendedPayloadSchema.safeParse(event.payload);
  if (!parsed.success || parsed.data.orgId !== event.org_id) return { kind: "INVALID" };
  const { orgId, bidId, scoreRunId, recommendation, status } = parsed.data;
  return { kind: "RECOMMENDED", orgId, bidId, scoreRunId, recommendation, status };
}

// ── 알림 행 ──

/** 만료 인앱 알림 문구(계획 Global Constraints, 설계 §5.5). 고정 문구다. */
const MESSAGE_KAKAO_EXPIRED =
  "카카오 연결이 만료되어 카카오톡 알림을 보내지 못하고 있습니다. 설정에서 다시 연결해 주세요.";
/** 만료 인앱 알림의 링크. 개인 설정으로 넘겨 주는 기존 경로다. */
const SETTINGS_LINK = "/settings";

export type KakaoRowStatus = "PENDING" | "SENT" | "FAILED" | "DEAD";

/**
 * notifications 의 KAKAO 행(받는 사람 하나). 처음에는 PENDING 이고 발송 결과로 SENT·FAILED·DEAD 가 된다.
 * 인앱 행(NotificationRow)과 달리 행을 만드는 것이 곧 발송이 아니다.
 */
export type KakaoNotificationRow = {
  org_id: string;
  user_id: string;
  type: "BID_RECOMMENDED";
  channel: "KAKAO";
  status: "PENDING";
  idempotency_key: string;
  payload: NotificationPayload;
};

/**
 * 받는 사람 하나의 KAKAO 행. idempotency_key 는 <outboxEventId>:<userId>:KAKAO 다(두 단계 멱등 — 같은 이벤트를 다시·동시에
 * 처리해도 한 사람에게 한 행). link 는 앱 안 경로만 쓴다(열린 리다이렉트 방지, docs/13). title 은 공고명이다.
 */
export function toKakaoNotificationRow(input: {
  outboxEventId: string;
  orgId: string;
  userId: string;
  bidId: string;
  title: string;
  recommendation: "BID" | "WATCH";
}): KakaoNotificationRow {
  return {
    org_id: input.orgId,
    user_id: input.userId,
    type: "BID_RECOMMENDED",
    channel: "KAKAO",
    status: "PENDING",
    idempotency_key: `${input.outboxEventId}:${input.userId}:KAKAO`,
    payload: {
      bidId: input.bidId,
      title: input.title,
      message: `${input.recommendation} 권고`,
      link: `/bids/${input.bidId}`,
    },
  };
}

/**
 * 연결이 만료로 바뀐 순간 한 번 남기는 인앱 알림(설계 §5.5). 만료를 알게 한 이벤트의 조직·공고에 붙인다 —
 * notifications 의 (org_id, user_id) FK 와 목록 화면의 payload.bidId 계약을 그대로 만족한다. 키는 <outboxEventId>:<userId>:KAKAO_EXPIRED:IN_APP.
 */
export function toKakaoExpiredRow(input: {
  outboxEventId: string;
  orgId: string;
  userId: string;
  bidId: string;
  title: string;
  now: Date;
}): NotificationRow {
  return {
    org_id: input.orgId,
    user_id: input.userId,
    type: "KAKAO_EXPIRED",
    channel: "IN_APP",
    status: "SENT",
    sent_at: input.now.toISOString(),
    idempotency_key: `${input.outboxEventId}:${input.userId}:KAKAO_EXPIRED:IN_APP`,
    payload: {
      bidId: input.bidId,
      title: input.title,
      message: MESSAGE_KAKAO_EXPIRED,
      link: SETTINGS_LINK,
    },
  };
}

// ── 발송 결과 → 행 갱신 ──

/** 결과가 불분명한 실패(요청을 보낸 뒤 시간 초과). 카카오가 이미 보냈을 수 있어 다시 보내지 않는다(설계 §5.5). */
export const TIMEOUT_UNKNOWN = "TIMEOUT_UNKNOWN";
const KAKAO_EXPIRED = "KAKAO_EXPIRED";
const TOKEN_INVALID = "TOKEN_INVALID";

export type KakaoRowUpdate = {
  status: "SENT" | "FAILED" | "DEAD";
  /** notifications.error. 카카오 결과 code·고정 이름만 싣는다(값·본문 없음). */
  error: string | null;
  /** 연결이 이번 발송에서 만료로 바뀌었다 — 만료 인앱 알림 1건을 남긴다. */
  notifyExpired: boolean;
};

/**
 * 발송 결과를 행 갱신으로 바꾼다. 재시도 단위는 받는 사람 하나(행 하나)다.
 *   SENT → SENT · RETRYABLE(보내기 전 실패가 분명) → FAILED(이벤트 재시도) · UNKNOWN_OUTCOME → DEAD(TIMEOUT_UNKNOWN)
 *   REJECTED → DEAD(code) · EXPIRED → DEAD(KAKAO_EXPIRED), 바뀐 순간이면 만료 인앱 알림.
 *   TOKEN_INVALID 는 발송 수단이 갱신·재발송·만료로 먼저 처리하므로 오지 않는다. 오면 다시 해도 같으니 DEAD 다.
 */
export function toKakaoRowUpdate(result: KakaoSenderResult): KakaoRowUpdate {
  switch (result.kind) {
    case "SENT":
      return { status: "SENT", error: null, notifyExpired: false };
    case "RETRYABLE":
      return { status: "FAILED", error: result.code, notifyExpired: false };
    case "UNKNOWN_OUTCOME":
      return { status: "DEAD", error: TIMEOUT_UNKNOWN, notifyExpired: false };
    case "REJECTED":
      return { status: "DEAD", error: result.code, notifyExpired: false };
    case "TOKEN_INVALID":
      return { status: "DEAD", error: TOKEN_INVALID, notifyExpired: false };
    case "EXPIRED":
      return { status: "DEAD", error: KAKAO_EXPIRED, notifyExpired: result.changed };
  }
}

// ── 피드 재료 ──

/**
 * 피드 한 통의 재료. score_runs(조직·공고·점수·권고·상태)·bid_notices(공고명·수요기관·마감·추정금액·원문 주소)·
 * qualification_checks(필수 여부·판정)에서만 읽는다. AI 서술(score_runs.explanation)은 이 모양에 없다(설계 §5.3, U4).
 */
export type KakaoFeedSource = {
  orgId: string;
  bidId: string;
  recommendation: "BID" | "WATCH";
  status: "COMPLETED" | "PARTIAL";
  score: number | null;
  title: string;
  agency: string | null;
  deadlineAt: Date | null;
  budgetKrw: number | null;
  sourceUrl: string | null;
  checks: QualificationSummaryInput;
};

/** 피드 재료를 피드 입력으로 옮긴다. 사유 줄은 필수 자격 판정 요약(toReasonLine)으로만 만든다. */
export function toBidFeedInput(source: KakaoFeedSource, siteUrl: string, now: Date): BidFeedInput {
  return {
    bidId: source.bidId,
    title: source.title,
    agency: source.agency,
    deadlineAt: source.deadlineAt,
    budgetKrw: source.budgetKrw,
    score: source.score,
    recommendation: source.recommendation,
    status: source.status,
    reason: toReasonLine(source.checks),
    sourceUrl: source.sourceUrl,
    siteUrl,
    now,
  };
}

// ── 저장 port·결과 ──

/**
 * 카카오 소비자 저장 port. worker 가 service role 클라이언트로 만든 구현(kakao.repo)을 넘긴다.
 * service role 은 RLS 를 거치지 않으므로 받는 사람은 그 조직 멤버로만 고르고(listRecipients), 행의 org_id 는 이벤트의 조직이다.
 */
export type KakaoOutboxStore = {
  /** 그 조직 멤버 ⋈ 카카오 연결(enabled·CONNECTED) ⋈ 활동 계정(profiles.status = 'active'). user_id 순서. */
  listRecipients(orgId: string): Promise<string[]>;
  /** 활동 계정(profiles.status = 'active')인가. KAKAO_TEST 가 정지 계정에게 보내지 않으려고 묻는다. */
  isActive(userId: string): Promise<boolean>;
  /** run 이 없거나 BID·WATCH 로 마감하지 않았거나 공고가 없으면 null. */
  readFeedSource(scoreRunId: string): Promise<KakaoFeedSource | null>;
  /** 그 사람이 그 공고를 카카오로 이미 받았나(어느 조직에서든 SENT, 또는 결과 불분명 DEAD·TIMEOUT_UNKNOWN). */
  hasKakaoSentForBid(userId: string, bidId: string): Promise<boolean>;
  /** 같은 키의 행이 없으면 넣고(있으면 그대로) 그 행의 id·status 를 돌려준다. */
  ensureKakaoRow(row: KakaoNotificationRow): Promise<{ id: string; status: KakaoRowStatus }>;
  setKakaoRowStatus(
    id: string,
    status: KakaoRowUpdate["status"],
    error: string | null,
    at: Date,
  ): Promise<void>;
  /** 그 조직·공고의 KAKAO 행 가운데 아직 열린 것(PENDING·FAILED)을 DEAD 로 닫는다. 이벤트를 닫을 때 부른다. */
  closeOpenKakaoRows(orgId: string, bidId: string): Promise<void>;
  /** 만료 인앱 알림. 같은 idempotency_key 가 이미 있으면 아무것도 하지 않는다. */
  insertNotification(row: NotificationRow): Promise<void>;
};

/** 알림 outbox 한 회차(OutboxBatchDeps.kakao)가 받는 카카오 의존성. 빠지면 새 이벤트가 조용히 버려지므로 필수다. */
export type KakaoChannelDeps = {
  store: KakaoOutboxStore;
  sender: KakaoSender;
  /** 피드 링크의 앞부분(SITE_URL). */
  siteUrl: string;
};

/**
 * 이벤트 하나의 결과. outcome 은 이벤트를 어떻게 닫는지다:
 *   SENT → PROCESSED(발송 단계를 마쳤다. 실제로 간 통 수는 sent, 못 간 수는 failed) · SKIPPED_* → PROCESSED(보낼 것이 없다)
 *   RETRY → 재시도(FAILED) · DEAD → DEAD(INVALID 이거나 재시도를 다 썼다).
 * sent·failed 는 이번 회차에 보낸 수와 못 보낸 수(FAILED·DEAD)다. 이미 받은 사람·닫힌 행은 세지 않는다.
 */
export type KakaoEventOutcome =
  "SENT" | "SKIPPED_NO_RECIPIENT" | "SKIPPED_NO_BID" | "SKIPPED_INACTIVE" | "RETRY" | "DEAD";
export type KakaoEventResult = { outcome: KakaoEventOutcome; sent: number; failed: number };
