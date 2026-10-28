import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { loadNotificationPage } from "@/app/_lib/work-data";
import { requireWork } from "@/app/(app)/(work)/work";
import { NotificationList } from "./notification-list";
import { NOTIFICATIONS_DESCRIPTION, NOTIFICATIONS_TITLE } from "./notifications-copy";

export const metadata: Metadata = { title: NOTIFICATIONS_TITLE };

// 연한 파랑 알약이다(2026-10-28 화면 개편: 설정 메뉴와 같은 클래스). 화면 머리 아래 구분선이 있어 밑줄 선은 두지 않는다.
const LINK_CLASS =
  "inline-flex items-center rounded-md px-3 py-1.5 type-label text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-selected-foreground";

// 스펙 §5.5. ?unread=1 이면 안 읽은 알림만 읽는다. 내 알림만 보인다(RLS, user_id).
export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  await connection();
  const raw = await searchParams;
  const unreadOnly = raw.unread === "1";
  const { orgId, userId } = await requireWork(
    unreadOnly ? "/notifications?unread=1" : "/notifications",
  );
  // 상대 시각의 기준. 요청마다 한 번 만들어 내린다(하이드레이션 차이 없음).
  const now = new Date();
  const first = await loadNotificationPage(orgId, userId, unreadOnly);
  return (
    <AppPage title={NOTIFICATIONS_TITLE} description={NOTIFICATIONS_DESCRIPTION}>
      <nav aria-label="알림 보기">
        <ul className="flex gap-1">
          <li>
            <Link
              href="/notifications"
              aria-current={unreadOnly ? undefined : "page"}
              className={LINK_CLASS}
            >
              전체
            </Link>
          </li>
          <li>
            <Link
              href="/notifications?unread=1"
              aria-current={unreadOnly ? "page" : undefined}
              className={LINK_CLASS}
            >
              안 읽음
            </Link>
          </li>
        </ul>
      </nav>
      <NotificationList
        items={first.items}
        nextCursor={first.pageInfo.nextCursor}
        unreadOnly={unreadOnly}
        now={now.toISOString()}
      />
    </AppPage>
  );
}
