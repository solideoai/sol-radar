"use client";

import { cn } from "cn";
import { CalendarXIcon, InboxIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ProgramNoticeListItem, ProgramNoticeListQuery } from "@/server/program-notices";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { ProgramFilters } from "./program-filters";
import { ProgramNoticeDrawer } from "./program-notice-drawer";
import { ProgramTable } from "./program-table";
import {
  CAPPED_NOTE,
  CLOSED_HIDDEN,
  EMPTY_COPY,
  INCLUDE_CLOSED_LABEL,
  PROGRAMS_PATH,
  RESET_FILTERS_LABEL,
} from "./programs-copy";

// /bids/programs 본문: 필터 막대 → 결과 줄 → 표(또는 빈 상태) → 상세 서랍(디자인 스펙 §4.3 정보 위계).
// 필터를 바꾸면 주소만 바꾸고 서버가 다시 읽는다. 그동안 필터 막대는 그대로(초점은 고른 칸에 남는다) 두고 표만 흐린다.
// 서랍은 화면 안의 지역 상태다(주소에 남기지 않는다). 목록 조건이 바뀌면 닫는다(바뀐 목록에 그 행이 없을 수 있다).

type ProgramListViewProps = {
  items: ProgramNoticeListItem[];
  /** 거르기 전에 저장된 공고가 하나라도 있는가. 없으면 조건과 상관없이 "수집 0건"이다(§12.1 Q3). */
  hasAnyNotice: boolean;
  /** 거른 결과가 300건을 넘어 잘렸는가. */
  isCapped: boolean;
  /** 서버가 읽은 목록 조건(정렬 열 표시·빈 상태 문구). */
  query: ProgramNoticeListQuery;
  /** 남은 조건의 쿼리 문자열. 바뀌면 서랍을 닫는다. */
  search: string;
  /** 출처·검색어·마감 지난 공고 포함이 모두 기본인지(정렬은 보지 않는다). */
  isDefault: boolean;
  /** 서울 오늘(YYYY-MM-DD). 서버가 목록을 거른 값과 같다 — 부품이 만들면 서버·브라우저 값이 어긋난다. */
  today: string;
};

type Selection = { search: string; item: ProgramNoticeListItem | null; open: boolean };

export function ProgramListView({
  items,
  hasAnyNotice,
  isCapped,
  query,
  search,
  isDefault,
  today,
}: ProgramListViewProps) {
  const router = useRouter();
  const [isNavigating, startTransition] = useTransition();
  const navigate = (href: string) => startTransition(() => router.push(href, { scroll: false }));

  // 연 공고명 단추를 기억해 닫을 때 초점을 돌려준다(인력 명부 관례).
  const triggerRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<Selection>({ search, item: null, open: false });
  if (selection.search !== search) setSelection({ search, item: null, open: false });
  const openItem = (item: ProgramNoticeListItem, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSelection({ search, item, open: true });
  };
  // 닫는 동안에도 내용이 남게 item 은 두고 open 만 끈다.
  const close = () => setSelection((prev) => ({ ...prev, open: false }));
  const isOpen = selection.search === search && selection.open;

  return (
    <>
      <ProgramFilters startTransition={startTransition} />
      <div className="flex flex-col gap-3">
        {/* 조건이 바뀐 것을 화면 낭독기에 여기 한 곳에서만 알린다. */}
        <p role="status" className="type-label text-muted-foreground">
          공고 {items.length}건 표시{isCapped ? CAPPED_NOTE : ""}
        </p>
        <div
          aria-busy={isNavigating || undefined}
          className={cn("transition-opacity", isNavigating && "opacity-60")}
        >
          {items.length === 0 ? (
            <ProgramsEmpty
              hasAnyNotice={hasAnyNotice}
              isDefault={isDefault}
              includeClosed={query.includeClosed}
              search={search}
              onNavigate={navigate}
            />
          ) : (
            <ProgramTable
              items={items}
              sort={query.sort}
              today={today}
              openId={isOpen ? (selection.item?.id ?? null) : null}
              onOpen={openItem}
            />
          )}
        </div>
      </div>
      <ProgramNoticeDrawer
        item={selection.item}
        open={isOpen}
        today={today}
        onClose={close}
        returnFocus={() =>
          triggerRef.current?.isConnected
            ? triggerRef.current
            : document.getElementById("main-content")
        }
      />
    </>
  );
}

// 0건 빈 상태 셋(디자인 스펙 §4.7, §12.1 Q3). 기본 조건은 마감 지난 공고를 숨기므로 "수집 0건"과 "진행 중 0건"을
// hasAnyNotice 로 가른다. 정렬만 바꾼 조건은 거르지 않으므로 기본 조건으로 본다.
function ProgramsEmpty({
  hasAnyNotice,
  isDefault,
  includeClosed,
  search,
  onNavigate,
}: {
  hasAnyNotice: boolean;
  isDefault: boolean;
  includeClosed: boolean;
  search: string;
  onNavigate: (href: string) => void;
}) {
  if (!hasAnyNotice)
    return (
      <EmptyState
        icon={InboxIcon}
        title={EMPTY_COPY.none.title}
        description={EMPTY_COPY.none.description}
        action={
          <Link href="/bids" className={cn(buttonVariants({ variant: "outline" }))}>
            {EMPTY_COPY.none.action}
          </Link>
        }
      />
    );
  if (isDefault) {
    // 지금 조건(정렬)은 그대로 두고 마감 지난 공고만 더한다.
    const params = new URLSearchParams(search);
    params.set("includeClosed", "true");
    return (
      <EmptyState
        icon={CalendarXIcon}
        title={EMPTY_COPY.open.title}
        description={CLOSED_HIDDEN}
        action={
          <Button
            variant="outline"
            onClick={() => onNavigate(`${PROGRAMS_PATH}?${params.toString()}`)}
          >
            {INCLUDE_CLOSED_LABEL}
          </Button>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={SearchIcon}
      title={EMPTY_COPY.filtered.title}
      description={includeClosed ? undefined : CLOSED_HIDDEN}
      action={
        <Button variant="outline" onClick={() => onNavigate(PROGRAMS_PATH)}>
          {RESET_FILTERS_LABEL}
        </Button>
      }
    />
  );
}
