import "server-only";
import { z } from "zod";

// 05 §4.6 Notification
export const notificationSchema = z.strictObject({
  id: z.string().min(1),
  type: z.enum([
    "BID_CREATED",
    "BID_CHANGED",
    "DEADLINE_APPROACHING",
    "ANALYSIS_COMPLETE",
    "REVIEW_ASSIGNED",
  ]),
  channel: z.enum(["IN_APP", "KAKAO"]),
  status: z.enum(["PENDING", "SENT", "FAILED", "DEAD"]),
  payload: z.strictObject({
    bidId: z.string().min(1),
    title: z.string(),
    message: z.string(),
    link: z.string(),
    changedFields: z.array(z.string()).optional(),
  }),
  readAt: z.string().nullable(),
  createdAt: z.string().min(1),
});
export type Notification = z.infer<typeof notificationSchema>;

// 알림 링크는 이 앱 안의 경로만 쓴다(열린 리다이렉트 방지). 바깥이거나 모호하면 공고 상세로 바꾼다.
// 제어 문자·역슬래시는 브라우저가 "/" 로 해석해 바깥 주소가 되므로 막는다.
export function safeNotificationLink(n: Notification): string {
  const fallback = `/bids/${n.payload.bidId}`;
  const link = n.payload.link;
  if (!link.startsWith("/") || link.startsWith("//")) return fallback;
  // 제어 문자 범위는 코드 값으로 검사한다
  for (const ch of link) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || ch === "\\") return fallback;
  }
  return link;
}
