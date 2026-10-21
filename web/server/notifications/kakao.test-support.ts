// 시험 전용 도우미(카카오톡 추천 공고 알림 소비자). 제품 코드가 import 하지 않는다.
// 1. 시험 id·outbox 이벤트 견본(BID_RECOMMENDED·KAKAO_TEST)과 피드 재료 견본.
// 2. 메모리 저장(KakaoOutboxStore 흉내). notifications.idempotency_key UNIQUE(같은 키는 조용히 무시)와
//    받는 사람을 보낼 때마다 다시 고르는 것(setRecipients 로 회차 사이에 바꾼다)을 흉내 낸다.
// 3. 가짜 발송 수단(KakaoSender 흉내). 정해 둔 결과를 돌려주고 보낸 사람·템플릿을 기록한다. 실제 카카오는 부르지 않는다.
// 근거: docs/plans/2026-10-20-kakao-memo-notify-design.md §5.2·§5.5, 계획 Task 4.
import type { KakaoFeedTemplate, KakaoSender, KakaoSenderResult } from "@/server/kakao-notify";
import type {
  KakaoChannelDeps,
  KakaoFeedSource,
  KakaoNotificationRow,
  KakaoOutboxStore,
  KakaoRowStatus,
  NotificationRow,
  OutboxEventRow,
} from "@/server/notifications";
import { BID_ID, BID_TITLE, EVENT_ID, ORG_ID, RUN_ID } from "./outbox.test-support";

// ── 1. id·견본 ──

export const USER_A = "11111111-1a2b-4c3d-8e4f-5a6b7c8d9e01";
export const USER_B = "22222222-2b3c-4d4e-9f50-6b7c8d9e0f12";
export const USER_C = "33333333-3c4d-4e5f-a061-7c8d9e0f1a23";
export const SITE_URL = "https://sol-radar.example";

/** 만료 인앱 알림 문구(계획 Global Constraints "만료 인앱"). */
export const EXPIRED_IN_APP_MESSAGE =
  "카카오 연결이 만료되어 카카오톡 알림을 보내지 못하고 있습니다. 설정에서 다시 연결해 주세요.";

/** BID_RECOMMENDED outbox(20261021000002 finish_score_run 이 쓰는 payload 모양). */
export function bidRecommendedEvent(
  recommendation: "BID" | "WATCH" = "BID",
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: EVENT_ID,
    org_id: ORG_ID,
    event_type: "BID_RECOMMENDED",
    payload: {
      scoreRunId: RUN_ID,
      bidId: BID_ID,
      orgId: ORG_ID,
      recommendation,
      status: "COMPLETED",
    },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  };
}

/** KAKAO_TEST outbox(20261021000001 request_kakao_notify_test 가 쓰는 모양: org_id null, payload {userId}). */
export function kakaoTestEvent(
  userId: string = USER_A,
  overrides: Partial<OutboxEventRow> = {},
): OutboxEventRow {
  return {
    id: EVENT_ID,
    org_id: null,
    event_type: "KAKAO_TEST",
    payload: { userId },
    status: "PENDING",
    attempts: 0,
    ...overrides,
  };
}

/** 피드 재료(score_runs·bid_notices·qualification_checks 를 읽은 결과). */
export function feedSource(overrides: Partial<KakaoFeedSource> = {}): KakaoFeedSource {
  return {
    orgId: ORG_ID,
    bidId: BID_ID,
    recommendation: "BID",
    status: "COMPLETED",
    score: 78,
    title: BID_TITLE,
    agency: "가상시청",
    deadlineAt: new Date("2026-10-30T09:00:00.000Z"),
    budgetKrw: 1_240_000_000,
    sourceUrl: "https://fixture.invalid/notice/0001",
    checks: [
      { mandatory: true, outcome: "SATISFIED" },
      { mandatory: false, outcome: "NEEDS_REVIEW" },
    ],
    ...overrides,
  };
}

// ── 2. 메모리 저장 ──

/** notifications 한 행(메모리). KAKAO 행과 다른 조직·다른 이벤트의 행을 함께 담는다. */
export type MemoryKakaoRow = {
  id: string;
  org_id: string;
  user_id: string;
  type: string;
  channel: string;
  status: KakaoRowStatus;
  error: string | null;
  sent_at: string | null;
  idempotency_key: string;
  payload: { bidId: string; title: string; message: string; link: string };
};

type KakaoStoreMethod = keyof KakaoOutboxStore;
/** 저장 호출 하나. key 는 무엇에 대한 호출인지(조직·run·"user:bid"·알림 키·행 id). */
export type KakaoStoreCall = { method: KakaoStoreMethod; key: string };

const isOpen = (row: MemoryKakaoRow): boolean =>
  row.status === "PENDING" || row.status === "FAILED";

/**
 * 메모리 저장. fail 이 Error 를 돌려주면 그 호출이 그 오류로 실패한다(실패한 쓰기는 아무것도 바꾸지 않는다).
 * listRecipients 는 부를 때의 recipients 를 돌려준다(보낼 때마다 다시 고른다 — setRecipients 로 회차 사이에 바꾼다).
 * isActive 는 inactive 에 없는 사용자면 true 다(KAKAO_TEST 도 정지 계정에게는 보내지 않는다).
 * hasKakaoSentForBid 는 그 사람의 KAKAO·BID_RECOMMENDED 행 가운데 같은 공고가 SENT 이거나 DEAD(TIMEOUT_UNKNOWN)이면 true 다.
 */
export function createMemoryKakaoStore(
  options: {
    /** orgId → 켬·CONNECTED·active 인 그 조직 멤버 */
    recipients?: Readonly<Record<string, readonly string[]>>;
    /** scoreRunId → 피드 재료. 없으면 null(공고·run 없음) */
    feeds?: Readonly<Record<string, KakaoFeedSource>>;
    /** 이미 있는 notifications 행(다른 조직에서 이미 보낸 것 등) */
    rows?: readonly MemoryKakaoRow[];
    /** 정지(profiles.status = 'suspended') 계정의 userId. KAKAO_TEST 가 본다. 없으면 모두 활동 계정이다. */
    inactive?: readonly string[];
    fail?: (call: KakaoStoreCall) => Error | undefined;
  } = {},
) {
  const recipients = new Map<string, readonly string[]>(
    Object.entries(options.recipients ?? { [ORG_ID]: [USER_A] }),
  );
  const feeds = options.feeds ?? { [RUN_ID]: feedSource() };
  const rows: MemoryKakaoRow[] = (options.rows ?? []).map((row) => structuredClone(row));
  const inactive = options.inactive ?? [];
  const inApp: NotificationRow[] = [];
  const calls: KakaoStoreCall[] = [];
  let nextId = rows.length + 1;

  const record = (method: KakaoStoreMethod, key: string): void => {
    const call = { method, key };
    calls.push(call);
    const error = options.fail?.(call);
    if (error) throw error;
  };

  const store: KakaoOutboxStore = {
    async listRecipients(orgId) {
      record("listRecipients", orgId);
      return [...(recipients.get(orgId) ?? [])];
    },
    async isActive(userId) {
      record("isActive", userId);
      return !inactive.includes(userId);
    },
    async readFeedSource(scoreRunId) {
      record("readFeedSource", scoreRunId);
      const source = feeds[scoreRunId];
      return source === undefined ? null : structuredClone(source);
    },
    async hasKakaoSentForBid(userId, bidId) {
      record("hasKakaoSentForBid", `${userId}:${bidId}`);
      return rows.some(
        (row) =>
          row.user_id === userId &&
          row.channel === "KAKAO" &&
          row.type === "BID_RECOMMENDED" &&
          row.payload.bidId === bidId &&
          (row.status === "SENT" || (row.status === "DEAD" && row.error === "TIMEOUT_UNKNOWN")),
      );
    },
    async ensureKakaoRow(row: KakaoNotificationRow) {
      record("ensureKakaoRow", row.idempotency_key);
      const existing = rows.find((candidate) => candidate.idempotency_key === row.idempotency_key);
      if (existing !== undefined) return { id: existing.id, status: existing.status };
      const inserted: MemoryKakaoRow = {
        id: `row-${nextId}`,
        ...structuredClone(row),
        error: null,
        sent_at: null,
      };
      nextId += 1;
      rows.push(inserted);
      return { id: inserted.id, status: inserted.status };
    },
    async setKakaoRowStatus(id, status, error, at) {
      record("setKakaoRowStatus", id);
      const row = rows.find((candidate) => candidate.id === id);
      if (row === undefined) return;
      Object.assign(row, {
        status,
        error,
        sent_at: status === "SENT" ? at.toISOString() : row.sent_at,
      });
    },
    async closeOpenKakaoRows(orgId, bidId) {
      record("closeOpenKakaoRows", `${orgId}:${bidId}`);
      for (const row of rows) {
        const isTarget =
          row.org_id === orgId &&
          row.channel === "KAKAO" &&
          row.type === "BID_RECOMMENDED" &&
          row.payload.bidId === bidId;
        if (isTarget && isOpen(row)) row.status = "DEAD";
      }
    },
    async insertNotification(row) {
      record("insertNotification", row.idempotency_key);
      if (inApp.some((existing) => existing.idempotency_key === row.idempotency_key)) return;
      inApp.push(structuredClone(row));
    },
  };

  return {
    store,
    rows,
    inApp,
    calls,
    /** 그 조직의 받는 사람을 바꾼다(끄기·연결 해제·정지 흉내). */
    setRecipients(orgId: string, users: readonly string[]): void {
      recipients.set(orgId, users);
    },
    /** 그 사람의 KAKAO 행. 없으면 시험이 실패한다. */
    rowOf(userId: string, outboxEventId: string = EVENT_ID): MemoryKakaoRow {
      const row = rows.find(
        (candidate) => candidate.idempotency_key === `${outboxEventId}:${userId}:KAKAO`,
      );
      if (row === undefined) throw new Error(`KAKAO 행이 없다: ${userId}`);
      return row;
    },
  };
}

// ── 3. 가짜 발송 수단 ──

/** 정해 둔 결과(사람·그 사람에게 보낸 몇 번째인지)를 돌려준다. 기본은 늘 SENT. */
export function fakeSender(
  reply: (userId: string, nth: number) => KakaoSenderResult | Promise<KakaoSenderResult> = () => ({
    kind: "SENT",
  }),
) {
  const sends: { userId: string; template: KakaoFeedTemplate }[] = [];
  const sender: KakaoSender = {
    async send(userId, template) {
      const nth = sends.filter((sent) => sent.userId === userId).length;
      sends.push({ userId, template: structuredClone(template) });
      return reply(userId, nth);
    },
  };
  return {
    sender,
    sends,
    /** 보낸 사람 순서. */
    recipientsSent: (): string[] => sends.map((sent) => sent.userId),
  };
}

/**
 * 카카오 이벤트가 없는 시험(인앱 두 종)에 넘기는 기본 카카오 의존성. 받는 사람이 없는 메모리 저장과 늘 SENT 인 가짜 발송 수단이다.
 * OutboxBatchDeps.kakao 가 필수라서 둔다 — 빠지면 새 이벤트가 조용히 버려지므로 타입이 강제한다.
 */
export function idleKakao(): KakaoChannelDeps {
  return {
    store: createMemoryKakaoStore({ recipients: {} }).store,
    sender: fakeSender().sender,
    siteUrl: SITE_URL,
  };
}
