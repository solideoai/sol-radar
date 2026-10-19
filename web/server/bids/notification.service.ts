import "server-only";
import { cursorScope, signCursor, verifyCursor, type PageQuery } from "./bid-query";
import type { Page } from "./bid.model";
import { cursorUnavailable, fail, type ServiceResult } from "./bids.service";
import type { ListAfter, NotificationRepo } from "./bids.repo";
import { safeNotificationLink, type Notification } from "./notification.model";

// Topbar 는 payload.link 를 그대로 쓴다. 그래서 바깥으로 내보내는 모든 항목의 링크를 여기서 바꾼다.
const withSafeLink = (n: Notification): Notification => ({
  ...n,
  payload: { ...n.payload, link: safeNotificationLink(n) },
});

export async function listNotifications(
  userId: string,
  query: PageQuery & { unreadOnly: boolean },
  cursorSecret: string | null,
  deps: { repo: NotificationRepo },
): Promise<ServiceResult<Page<Notification>>> {
  if (cursorSecret === null) return cursorUnavailable();
  // 필터(unreadOnly)가 다른 커서는 쓰지 못한다.
  const scope = cursorScope("notifications", [query.unreadOnly]);
  let after: ListAfter = null;
  if (query.cursor !== null) {
    const verified = verifyCursor(query.cursor, scope, cursorSecret);
    if (!verified.ok) return fail(400, "INVALID_CURSOR", "커서가 올바르지 않습니다");
    after = verified.payload;
  }
  const rows = await deps.repo.list(
    userId,
    { unreadOnly: query.unreadOnly, limit: query.limit },
    after,
  );
  const nextCursor =
    rows.hasNext && rows.last !== null
      ? signCursor({ ...rows.last, queryFingerprint: scope }, cursorSecret)
      : null;
  return {
    ok: true,
    status: 200,
    data: {
      items: rows.items.map(withSafeLink),
      pageInfo: { cursor: query.cursor, nextCursor, hasNext: nextCursor !== null },
    },
  };
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
