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
    // 카카오 알림(20261023000701). 만료 안내는 인앱 행이고, 추천 공고는 KAKAO 행이라 목록에는 오지 않는다.
    "BID_RECOMMENDED",
    "KAKAO_EXPIRED",
  ]),
  channel: z.enum(["IN_APP", "KAKAO"]),
  status: z.enum(["PENDING", "SENT", "FAILED", "DEAD"]),
  // 생산자(C7)가 05 에 없는 키를 더해도 알림 전체가 사라지지 않게 모르는 키는 버린다(M5). 필수 키는 그대로 검사한다.
  payload: z.object({
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

const LINK_ORIGIN = "http://internal.invalid";

// 알림 링크는 이 앱 안의 경로만 쓴다(열린 리다이렉트 방지). 바깥이거나 모호하면 공고 상세로 바꾼다.
// 제어 문자·역슬래시는 브라우저가 "/" 로 해석해 바깥 주소가 되므로 막는다.
// safeNextPath 처럼 URL 로 풀어 본다. `/.//evil.example`·`/%2F/evil.example` 은 풀면 `//evil.example` 이다(보안 L6).
export function safeNotificationLink(n: Notification): string {
  const fallback = `/bids/${n.payload.bidId}`;
  const link = n.payload.link;
  if (!link.startsWith("/") || link.startsWith("//")) return fallback;
  // 제어 문자 범위는 코드 값으로 검사한다
  for (const ch of link) {
    const code = ch.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || ch === "\\") return fallback;
  }
  const url = URL.parse(link, LINK_ORIGIN);
  if (url === null || url.origin !== LINK_ORIGIN) return fallback;
  try {
    const decoded = decodeURIComponent(url.pathname).replaceAll("\\", "/");
    if (decoded.startsWith("//")) return fallback;
  } catch {
    // 풀 수 없는 % 이스케이프는 모호한 경로다.
    return fallback;
  }
  // 점 경로(./ ../)를 푼 값을 낸다. 화면이 받은 그대로 다시 풀지 않게 한다.
  return url.pathname + url.search + url.hash;
}
