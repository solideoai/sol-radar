"use client";

import { BellIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { NOTIFICATION_ICON, NOTIFICATION_TYPE_LABEL } from "@/components/bids/labels";
import { formatKst, formatRelative } from "@/components/bids/format";
import { refreshTopbarStatus } from "@/components/topbar-status";
import type { Notification } from "@/server/bids";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { LoadMoreFooter, useLoadMore } from "@/app/(app)/(work)/load-more";

// /notifications 목록(스펙 §5.5). 서버가 그린 첫 쪽에 GET /api/v1/notifications 결과를 이어 붙인다.
// 행 전체가 링크다. 안 읽은 행을 누르면 읽음 처리(PATCH)를 보내고, 결과와 상관없이 링크로 이동한다.

const READ_FAILED = "읽음으로 표시하지 못했습니다";
const EMPTY_ALL = "알림이 없습니다. 공고가 바뀌면 여기에 표시됩니다";
const EMPTY_UNREAD = "안 읽은 알림이 없습니다";

// 새 탭·새 창으로 여는 클릭(보조 키·가운데 단추)은 브라우저에 맡기고 이동을 가로채지 않는다.
const isPlainClick = (event: React.MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function NotificationList({
  items: initialItems,
  nextCursor: initialNextCursor,
  unreadOnly,
  now,
}: {
  items: Notification[];
  nextCursor: string | null;
  unreadOnly: boolean;
  /** 서버가 요청마다 한 번 만든 시각(ISO). 상대 시각의 기준이다(하이드레이션 차이 없음). */
  now: string;
}) {
  const router = useRouter();
  const at = useMemo(() => new Date(now), [now]);
  const { items, hasNext, status, appendedFrom, loadMore } = useLoadMore({
    endpoint: unreadOnly ? "/api/v1/notifications?unreadOnly=true" : "/api/v1/notifications",
    initialItems,
    initialNextCursor,
  });

  // 이 화면에서 읽음 처리에 성공한 id. 서버가 다시 읽어 주기 전에도 점을 바로 지운다.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());
  // 같은 행을 연달아 눌러도 요청은 한 번이다.
  const inFlight = useRef(new Set<string>());

  const markRead = async (id: string) => {
    if (inFlight.current.has(id)) return;
    inFlight.current.add(id);
    try {
      // 이동하면 이 화면이 사라지므로 keepalive 로 요청이 끝까지 가게 한다.
      const response = await fetch(`/api/v1/notifications/${id}/read`, {
        method: "PATCH",
        keepalive: true,
        headers: { "X-Requested-With": "sol-radar" },
      });
      if (!response.ok) throw new Error(String(response.status));
      setReadIds((prev) => new Set(prev).add(id));
      void refreshTopbarStatus();
    } catch {
      // 이동은 이미 시작했다. 알리기만 한다. 다시 누르면 다시 보낼 수 있다.
      toast.error(READ_FAILED);
    } finally {
      inFlight.current.delete(id);
    }
  };

  const open = (
    event: React.MouseEvent<HTMLAnchorElement>,
    item: Notification,
    unread: boolean,
  ) => {
    if (unread) void markRead(item.id);
    if (!isPlainClick(event)) return;
    event.preventDefault();
    router.push(item.payload.link);
  };

  // 다음 쪽을 붙이면 초점을 새로 붙은 첫 행으로 옮긴다. 단추가 사라져도 초점을 잃지 않는다.
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (appendedFrom === null) return;
    listRef.current?.querySelectorAll<HTMLElement>("li")[appendedFrom]?.querySelector("a")?.focus();
  }, [appendedFrom, items.length]);

  if (items.length === 0) {
    return unreadOnly ? (
      <EmptyState
        icon={BellIcon}
        title={EMPTY_UNREAD}
        action={
          <Link
            href="/notifications"
            className="type-label font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            전체 보기
          </Link>
        }
      />
    ) : (
      <EmptyState icon={BellIcon} title={EMPTY_ALL} />
    );
  }

  return (
    <>
      {/* 표(ui/table)와 같은 둥근 1px 테두리 상자다. 행 hover 바탕이 모서리 밖으로 나가지 않게 넘침을 자른다. */}
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <ul ref={listRef} className="divide-y divide-border">
          {items.map((item) => {
            const unread = item.readAt === null && !readIds.has(item.id);
            // 모르는 type 이면 기본 벨 아이콘과 '알림' 글자를 쓴다.
            const Icon = NOTIFICATION_ICON[item.type] ?? BellIcon;
            return (
              <li key={item.id}>
                <Link
                  href={item.payload.link}
                  onClick={(event) => open(event, item, unread)}
                  className="flex items-start gap-3 px-4 py-3 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
                >
                  {/* 점 자리는 읽은 행에도 남겨 글이 같은 줄에서 시작한다. */}
                  <span className="mt-2 flex size-2 shrink-0 items-center justify-center">
                    {unread ? (
                      <>
                        <span
                          aria-hidden="true"
                          data-part="unread-dot"
                          className="size-2 rounded-full bg-brand"
                        />
                        <span className="sr-only">안 읽음</span>
                      </>
                    ) : null}
                  </span>
                  <Icon
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="type-label text-muted-foreground">
                      {NOTIFICATION_TYPE_LABEL[item.type] ?? "알림"}
                    </span>
                    <span
                      className={`truncate type-body text-foreground ${unread ? "font-semibold" : ""}`}
                    >
                      {item.payload.title}
                    </span>
                    <span className="line-clamp-2 type-label text-muted-foreground">
                      {item.payload.message}
                    </span>
                  </span>
                  <time
                    dateTime={item.createdAt}
                    title={formatKst(item.createdAt)}
                    className="shrink-0 type-label text-muted-foreground tabular-nums"
                  >
                    {formatRelative(item.createdAt, at)}
                  </time>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
      <LoadMoreFooter
        status={status}
        hasNext={hasNext}
        onLoadMore={() => void loadMore()}
        onRestart={() => router.push(unreadOnly ? "/notifications?unread=1" : "/notifications")}
      />
    </>
  );
}
