import "server-only";
import { getSupabase } from "@/server/supabase";
import { toNotification } from "./bid-row.mapper";
import type { NotificationRow } from "./bid-row.mapper";
import type { NotificationRepo } from "./bids.repo";
import type { Notification } from "./notification.model";
import { keysetFilter, pageOf } from "./postgrest";

// 내 알림 저장소. 사용자 세션 + RLS("본인 알림 읽기·읽음 처리")로만 읽고 read_at 만 고친다(열 권한).
// 인앱 행만 다룬다. 카카오 발송 기록(channel KAKAO)은 같은 표에 있지만 벨·목록에 보이지 않고 읽음 처리도 404 다.
const IN_APP = "IN_APP";

// 알려진 모양이 아닌 행은 목록에서 빼고 id 만 남긴다(O11). 한 행 때문에 목록·벨이 실패하지 않는다.
function validOrLogged(row: NotificationRow): Notification | null {
  const notification = toNotification(row);
  if (notification === null) console.error({ event: "notification_row_invalid", id: row.id });
  return notification;
}

export const notificationRepo: NotificationRepo = {
  // created_at 내림차순(nulls last), 같은 시각은 id 오름차순 키셋. 다음 쪽 키는 걸러 내기 전 마지막 행에서 만든다.
  async list(userId, { unreadOnly, limit }, after) {
    const db = await getSupabase();
    const base = db.from("notifications").select("*").eq("user_id", userId).eq("channel", IN_APP);
    const unread = unreadOnly ? base.is("read_at", null) : base;
    const paged = after === null ? unread : unread.or(keysetFilter("created_at", "desc", after));
    const { data, error } = await paged
      .order("created_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .limit(limit + 1);
    if (error) throw error;
    const page = pageOf(data, limit, validOrLogged, (row) => ({
      sortValue: row.created_at,
      id: row.id,
    }));
    return {
      ...page,
      items: page.items.filter((item): item is Notification => item !== null),
    };
  },

  // 안 읽은 행만 고친다. 이미 읽은 알림을 다시 고치지 않아 감사 기록(20261019000007)이 겹치지 않는다.
  // 0행이면 이미 읽었거나 없는 알림이다. 다시 읽어 있으면 그대로 돌려준다.
  async markRead(userId, id) {
    const db = await getSupabase();
    const updated = await db
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("channel", IN_APP)
      .is("read_at", null)
      .select("*");
    if (updated.error) throw updated.error;
    const changed = updated.data[0];
    if (changed !== undefined) return validOrLogged(changed);
    const existing = await db
      .from("notifications")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .eq("channel", IN_APP)
      .maybeSingle();
    if (existing.error) throw existing.error;
    return existing.data === null ? null : validOrLogged(existing.data);
  },
};
