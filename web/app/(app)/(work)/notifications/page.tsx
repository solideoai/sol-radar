import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { loadNotificationPage } from "@/app/_lib/work-data";
import { requireWork } from "@/app/(app)/(work)/work";
import { NotificationList } from "./notification-list";
import { NOTIFICATIONS_DESCRIPTION, NOTIFICATIONS_TITLE } from "./notifications-copy";

export const metadata: Metadata = { title: NOTIFICATIONS_TITLE };

const LINK_CLASS =
  "relative inline-flex h-10 items-center rounded-md type-label font-medium text-muted-foreground outline-none after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:text-foreground aria-[current=page]:after:bg-foreground";

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
      <nav aria-label="알림 보기" className="border-b border-border">
        {/* 막대가 아래 선 위에 겹치도록 한 픽셀 내린다. */}
        <ul className="-mb-px flex gap-6">
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
