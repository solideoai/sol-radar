import "server-only";
import { cursorScope, type PageQuery } from "./bid-query";
import type { Page } from "./bid.model";
import { fail, paginate, type ServiceResult } from "./bids.service";
import type { NotificationRepo } from "./bids.repo";
import { safeNotificationLink, type Notification } from "./notification.model";

// Topbar 는 payload.link 를 그대로 쓴다. 그래서 바깥으로 내보내는 모든 항목의 링크를 여기서 바꾼다.
const withSafeLink = (n: Notification): Notification => ({
  ...n,
  payload: { ...n.payload, link: safeNotificationLink(n) },
});

export function listNotifications(
  orgId: string,
  userId: string,
  query: PageQuery & { unreadOnly: boolean },
  cursorSecret: string | null,
  deps: { repo: NotificationRepo },
): Promise<ServiceResult<Page<Notification>>> {
  // 다른 조직·사람이 받은 커서, 필터(unreadOnly)가 다른 커서는 쓰지 못한다(보안 L3).
  return paginate(
    cursorScope("notifications", [orgId, userId, query.unreadOnly]),
    query,
    cursorSecret,
    async (after) => {
      const rows = await deps.repo.list(
        userId,
        { unreadOnly: query.unreadOnly, limit: query.limit },
        after,
      );
      return { ...rows, items: rows.items.map(withSafeLink) };
    },
  );
}

export async function markNotificationRead(
  userId: string,
  id: string,
  deps: { repo: NotificationRepo },
): Promise<ServiceResult<Notification>> {
  const notification = await deps.repo.markRead(userId, id);
  if (notification === null) {
    return fail(404, "NOT_FOUND", "알림을 찾을 수 없습니다", { resource: "notification" });
  }
  return { ok: true, status: 200, data: withSafeLink(notification) };
}
