import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { QualificationSummaryInput } from "@/server/kakao-notify";
import {
  TIMEOUT_UNKNOWN,
  type KakaoFeedSource,
  type KakaoOutboxStore,
  type KakaoRowStatus,
} from "./kakao.model";
import { NotificationStoreError, createNotificationOutboxStore, storeError } from "./outbox.repo";

// ── 저장: 카카오 소비자 port(KakaoOutboxStore)의 Supabase 구현. supabase-js 호출만 두고 규칙은 kakao.model·service 에 둔다 ──
// worker 가 service role 클라이언트(getSupabaseAdmin)를 넘긴다. 클라이언트는 모듈에 담아 두지 않는다.
// service role 은 RLS 를 거치지 않으므로 받는 사람은 그 조직 멤버로만 고른다(listRecipients). 연결 표에서는 user_id 만 읽고
// 토큰 열은 읽지 않는다(복호화는 발송 수단의 몫). score_runs 에서 AI 서술(explanation)은 읽지 않는다(설계 §5.3).
// 오류 message 에는 표·동작·code 만 싣는다(PostgREST message·details 에 값이 섞일 수 있다). 던지는 오류는 모두 NotificationStoreError 다.

type Client = SupabaseClient<Database>;
type QualificationCheck = QualificationSummaryInput[number];

const NOTIFICATIONS = "notifications";
/** KAKAO 행의 공고. 이벤트는 조직·공고마다 하나라(키 <orgId>:<bidId>:BID_RECOMMENDED) 조직 + 공고로 그 이벤트의 행을 고른다. */
const PAYLOAD_BID_ID = "payload->>bidId";
const ROW_STATUSES: readonly KakaoRowStatus[] = ["PENDING", "SENT", "FAILED", "DEAD"];
const OPEN_ROW_STATUSES: readonly KakaoRowStatus[] = ["PENDING", "FAILED"];
const CHECK_OUTCOMES: readonly QualificationCheck["outcome"][] = [
  "SATISFIED",
  "NOT_SATISFIED",
  "NEEDS_REVIEW",
  "NOT_APPLICABLE",
];
const RECOMMENDATIONS: readonly KakaoFeedSource["recommendation"][] = ["BID", "WATCH"];
const FINISHED_STATUSES: readonly KakaoFeedSource["status"][] = ["COMPLETED", "PARTIAL"];

const pick = <T extends string>(values: readonly T[], value: string | null): T | undefined =>
  values.find((candidate) => candidate === value);

function toCheck(row: { mandatory: boolean; outcome: string }): QualificationCheck {
  const outcome = pick(CHECK_OUTCOMES, row.outcome);
  // 표의 check 가 받는 값만 오므로 다른 값은 표나 질의가 틀렸다는 뜻이다.
  if (outcome === undefined) {
    throw new NotificationStoreError("qualification_checks", "select", "UNEXPECTED_OUTCOME");
  }
  return { mandatory: row.mandatory, outcome };
}

const toNullableUrl = (value: string | null): string | null =>
  value === null || value.trim() === "" ? null : value;

export function createKakaoOutboxStore(client: Client): KakaoOutboxStore {
  // 활동 계정 확인·인앱 알림 넣기는 인앱 저장과 같다.
  const outbox = createNotificationOutboxStore(client);

  /** 켬·CONNECTED 인 연결의 사용자. 연결한 사람이 조직 멤버보다 훨씬 적으므로 여기서 먼저 좁힌다. */
  async function enabledLinkUsers(): Promise<string[]> {
    const links = await client
      .from("kakao_notify_links")
      .select("user_id")
      .eq("enabled", true)
      .eq("status", "CONNECTED");
    if (links.error) throw storeError("kakao_notify_links", "select", links.error);
    return links.data.map((row) => row.user_id);
  }

  async function membersAmong(orgId: string, userIds: readonly string[]): Promise<string[]> {
    const members = await client
      .from("memberships")
      .select("user_id")
      .eq("org_id", orgId)
      .in("user_id", userIds);
    if (members.error) throw storeError("memberships", "select", members.error);
    return members.data.map((row) => row.user_id);
  }

  async function activeAmong(userIds: readonly string[]): Promise<string[]> {
    const profiles = await client
      .from("profiles")
      .select("id")
      .in("id", userIds)
      .eq("status", "active");
    if (profiles.error) throw storeError("profiles", "select", profiles.error);
    return profiles.data.map((row) => row.id);
  }

  return {
    async claimNotification(notificationId) {
      const { data, error } = await client.rpc("claim_kakao_notification", {
        p_notification_id: notificationId,
      });
      if (error) throw storeError("kakao_send_claims", "claim", error);
      return data === true;
    },
    async claimTest(outboxEventId) {
      const { data, error } = await client.rpc("claim_kakao_test", {
        p_outbox_event_id: outboxEventId,
      });
      if (error) throw storeError("kakao_send_claims", "claim", error);
      return data === true;
    },
    async listRecipients(orgId) {
      const linked = await enabledLinkUsers();
      if (linked.length === 0) return [];
      const members = await membersAmong(orgId, linked);
      if (members.length === 0) return [];
      return (await activeAmong(members)).toSorted();
    },

    isActive: (userId) => outbox.isActive(userId),

    async readFeedSource(scoreRunId) {
      const run = await client
        .from("score_runs")
        .select("org_id, bid_id, score, recommendation, status")
        .eq("id", scoreRunId)
        .maybeSingle();
      if (run.error) throw storeError("score_runs", "select", run.error);
      if (run.data === null) return null;
      const recommendation = pick(RECOMMENDATIONS, run.data.recommendation);
      const status = pick(FINISHED_STATUSES, run.data.status);
      // 이벤트는 BID·WATCH 로 마감한 run 에서만 생긴다. 다르면 보낼 공고가 없는 것과 같다.
      if (recommendation === undefined || status === undefined) return null;

      const notice = await client
        .from("bid_notices")
        .select("title, agency, deadline_at, budget_krw, source_url")
        .eq("id", run.data.bid_id)
        .maybeSingle();
      if (notice.error) throw storeError("bid_notices", "select", notice.error);
      if (notice.data === null) return null;

      const checks = await client
        .from("qualification_checks")
        .select("mandatory, outcome")
        .eq("score_run_id", scoreRunId);
      if (checks.error) throw storeError("qualification_checks", "select", checks.error);

      return {
        orgId: run.data.org_id,
        bidId: run.data.bid_id,
        recommendation,
        status,
        score: run.data.score,
        title: notice.data.title,
        agency: notice.data.agency,
        deadlineAt: notice.data.deadline_at === null ? null : new Date(notice.data.deadline_at),
        budgetKrw: notice.data.budget_krw,
        sourceUrl: toNullableUrl(notice.data.source_url),
        checks: checks.data.map(toCheck),
      };
    },

    // 어느 조직의 영속 전송 의도든 재전송을 막는다. 이전 버전의 SENT/DEAD UNKNOWN 기록도 포함한다.
    async hasKakaoSentForBid(userId, bidId) {
      const claimed = await client
        .from("kakao_send_claims")
        .select("claim_key")
        .eq("claim_key", `BID:${userId}:${bidId}`)
        .limit(1);
      if (claimed.error) throw storeError("kakao_send_claims", "select", claimed.error);
      if (claimed.data.length > 0) return true;
      const sent = await client
        .from(NOTIFICATIONS)
        .select("id")
        .eq("user_id", userId)
        .eq("channel", "KAKAO")
        .eq("type", "BID_RECOMMENDED")
        .eq(PAYLOAD_BID_ID, bidId)
        .or(`status.eq.SENT,and(status.eq.DEAD,error.eq.${TIMEOUT_UNKNOWN})`)
        .limit(1);
      if (sent.error) throw storeError(NOTIFICATIONS, "select", sent.error);
      return sent.data.length > 0;
    },

    // 두 단계 멱등: 같은 키면 넣지 않고(병합 upsert 가 아니다 — 처음 행의 상태를 덮지 않는다) 다시 읽어 그 행을 돌려준다.
    async ensureKakaoRow(row) {
      const inserted = await client
        .from(NOTIFICATIONS)
        .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (inserted.error) throw storeError(NOTIFICATIONS, "insert", inserted.error);
      const read = await client
        .from(NOTIFICATIONS)
        .select("id, status")
        .eq("idempotency_key", row.idempotency_key)
        .maybeSingle();
      if (read.error) throw storeError(NOTIFICATIONS, "select", read.error);
      if (read.data === null)
        throw new NotificationStoreError(NOTIFICATIONS, "select", "NOT_FOUND");
      const status = pick(ROW_STATUSES, read.data.status);
      if (status === undefined) {
        throw new NotificationStoreError(NOTIFICATIONS, "select", "UNEXPECTED_STATUS");
      }
      return { id: read.data.id, status };
    },

    // KAKAO 행만 바꾼다(인앱 행을 건드리지 않게). sent_at 은 SENT 일 때만 적는다.
    async setKakaoRowStatus(id, status, error, at) {
      const patch =
        status === "SENT" ? { status, error, sent_at: at.toISOString() } : { status, error };
      const result = await client
        .from(NOTIFICATIONS)
        .update(patch)
        .eq("id", id)
        .eq("channel", "KAKAO");
      if (result.error) throw storeError(NOTIFICATIONS, "update", result.error);
    },

    // error 는 그대로 둔다(마지막 실패 까닭이 남는다).
    async closeOpenKakaoRows(orgId, bidId) {
      const result = await client
        .from(NOTIFICATIONS)
        .update({ status: "DEAD" })
        .eq("org_id", orgId)
        .eq("channel", "KAKAO")
        .eq("type", "BID_RECOMMENDED")
        .eq(PAYLOAD_BID_ID, bidId)
        .in("status", OPEN_ROW_STATUSES);
      if (result.error) throw storeError(NOTIFICATIONS, "update", result.error);
    },

    insertNotification: (row) => outbox.insertNotification(row),
  };
}
