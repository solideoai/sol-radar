import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json, TablesUpdate } from "@/lib/database.types";
import {
  NOTIFY_EVENT_TYPES,
  toProcessedUpdate,
  type NotificationOutboxStore,
  type OutboxEventRow,
} from "./outbox.model";

// ── 저장: 알림 outbox port 의 Supabase 구현. supabase-js 호출만 두고 규칙은 outbox.model 에 둔다 ──
// worker 가 service role 클라이언트(getSupabaseAdmin)를 넘긴다. 클라이언트는 모듈에 담아 두지 않는다.
// service role 은 RLS 를 거치지 않으므로 알림 행의 org_id·user_id 는 모델이 이벤트의 조직·수신자로 정하고,
// 수신자가 그 조직의 멤버인지는 서비스가 isMember 로 먼저 확인한다(docs/13-NOTIFICATIONS.md).
// 오류 message 에는 표·동작·코드만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).
// 던지는 오류는 모두 NotificationStoreError 다. 로그는 오류 이름만 싣으므로(docs/14-OBSERVABILITY.md) 이름으로 저장 오류임을 알린다.

type Client = SupabaseClient<Database>;

const OUTBOX_COLUMNS = "id, org_id, event_type, payload, status, attempts";
const DUE_STATUSES: readonly OutboxEventRow["status"][] = ["PENDING", "FAILED"];

/** 알림 outbox 저장 오류. message 는 "notifications store 오류: <표>.<동작> <code>" 이고 값은 싣지 않는다. */
export class NotificationStoreError extends Error {
  constructor(table: string, action: string, code: string) {
    super(`notifications store 오류: ${table}.${action} ${code}`);
    this.name = "NotificationStoreError";
  }
}

/** PostgREST 오류를 NotificationStoreError 로 바꾼다. code 가 없으면 UNKNOWN 이다. kakao.repo 도 쓴다(배럴에는 내보내지 않는다). */
export function storeError(
  table: string,
  action: string,
  error: { code?: string | null },
): NotificationStoreError {
  const code = typeof error.code === "string" && error.code !== "" ? error.code : "UNKNOWN";
  return new NotificationStoreError(table, action, code);
}

/** Date.toISOString 이 만드는 모양(밀리초·Z)이고 실제 있는 시각인가. 필터 값에 그대로 넣으므로 다른 모양은 받지 않는다. */
function isIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

function toOutboxEventRow(row: {
  id: string;
  org_id: string | null;
  event_type: string;
  payload: Json;
  status: string;
  attempts: number;
}): OutboxEventRow {
  const status = DUE_STATUSES.find((candidate) => candidate === row.status);
  // 필터가 PENDING·FAILED 만 고르므로 다른 값은 질의가 틀렸다는 뜻이다.
  if (status === undefined) {
    throw new NotificationStoreError("outbox_events", "select", "UNEXPECTED_STATUS");
  }
  return {
    id: row.id,
    org_id: row.org_id,
    event_type: row.event_type,
    payload: row.payload,
    status,
    attempts: row.attempts,
  };
}

export function createNotificationOutboxStore(client: Client): NotificationOutboxStore {
  /** 읽은 상태(id·status·attempts)가 그대로인 행만 바꾼다. 0행이어도 오류가 아니다. */
  const compareAndSet = async (
    event: OutboxEventRow,
    patch: TablesUpdate<"outbox_events">,
  ): Promise<void> => {
    const result = await client
      .from("outbox_events")
      .update(patch)
      .eq("id", event.id)
      .eq("status", event.status)
      .eq("attempts", event.attempts);
    if (result.error) throw storeError("outbox_events", "update", result.error);
  };

  return {
    // 조직 조건을 걸지 않는다(모든 조직의 이벤트를 처리한다). 조직은 행마다 org_id 로 돌려주고 모델이 확인한다.
    // NOTIFY_EVENT_TYPES(인앱 두 종·카카오 두 종)만 고른다. 공고 이벤트(BID_CREATED·BID_CHANGED)는 고르지 않는다. 오래된 것부터 limit 건까지.
    async findDue(input) {
      const isValidInput =
        isIsoInstant(input.now) && Number.isInteger(input.limit) && input.limit >= 1;
      if (!isValidInput) {
        throw new NotificationStoreError("outbox_events", "select", "INVALID_INPUT");
      }
      const due = await client
        .from("outbox_events")
        .select(OUTBOX_COLUMNS)
        .in("event_type", NOTIFY_EVENT_TYPES)
        .or(`status.eq.PENDING,and(status.eq.FAILED,next_attempt_at.lte.${input.now})`)
        .order("created_at")
        .order("id")
        .limit(input.limit);
      if (due.error) throw storeError("outbox_events", "select", due.error);
      return due.data.map(toOutboxEventRow);
    },

    async readBidTitle(bidId) {
      const notice = await client.from("bid_notices").select("title").eq("id", bidId).maybeSingle();
      if (notice.error) throw storeError("bid_notices", "select", notice.error);
      return notice.data?.title ?? null;
    },

    async isMember(orgId, userId) {
      const member = await client
        .from("memberships")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();
      if (member.error) throw storeError("memberships", "select", member.error);
      return member.data !== null;
    },

    // 정지 계정에게는 알리지 않는다(docs/09-SECURITY.md "정지" — my_org_ids 처럼 활동 계정만 본다).
    // 'active' 만 true 다. 'suspended' 이거나 행이 없으면(지운 계정) false 다.
    async isActive(userId) {
      const profile = await client.from("profiles").select("status").eq("id", userId).maybeSingle();
      if (profile.error) throw storeError("profiles", "select", profile.error);
      return profile.data?.status === "active";
    },

    // 병합 upsert 가 아니다. 다시 처리해도 처음 넣은 알림(sent_at 등)을 덮지 않는다.
    async insertNotification(row) {
      const result = await client
        .from("notifications")
        .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true });
      if (result.error) throw storeError("notifications", "insert", result.error);
    },

    async markProcessed(event, now) {
      await compareAndSet(event, toProcessedUpdate(now));
    },

    async markRetry(event, update) {
      await compareAndSet(event, update);
    },
  };
}
