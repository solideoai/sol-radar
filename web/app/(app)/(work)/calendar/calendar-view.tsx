import { cn } from "cn";
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  FolderKanbanIcon,
  LayersIcon,
  StarIcon,
} from "lucide-react";
import Link from "next/link";
import { AppPage } from "@/components/app-page";
import { dDay, formatKst } from "@/components/bids/format";
import { DemoBadge } from "@/components/bids/status-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type {
  CalendarDay,
  CalendarEvent,
  CalendarEventKind,
  CalendarView,
} from "@/server/calendar";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import {
  CALENDAR_CAPTION,
  CALENDAR_DESCRIPTION,
  CALENDAR_TITLE,
  KIND_LABELS,
  MONTH_EMPTY,
  NO_EVENTS_HINT,
  UPCOMING_EMPTY,
  UPCOMING_TITLE,
  VIEW_HINTS,
  VIEW_LABELS,
  VIEW_ORDER,
  WEEKDAYS,
} from "./calendar-copy";

// 서버 모듈을 값으로 부르지 않는다(브라우저 시험이 그대로 그린다). 날짜 계산은 page 가 끝내서 넘긴다.
// 일정 종류는 색이 아니라 아이콘과 글자로 구분한다. 칩의 접근 이름(aria-label)에 종류·시각·관심·DEMO 를 모두 글자로 싣는다.

// 칩은 두 줄(종류·시각·표시 줄 + 제목 줄)이라 칸에 두 개까지 그리고 나머지는 "+n건" 메뉴로 연다(칸 높이를 주마다 같게).
const MAX_CHIPS = 2;

const KIND_ICON: Record<CalendarEventKind, typeof FileTextIcon> = {
  SUBMISSION_DUE: FolderKanbanIcon,
  BID_DEADLINE: FileTextIcon,
};

export type CalendarLinks = {
  prev: string;
  next: string;
  today: string;
  views: Record<CalendarView, string>;
};

const timeOf = (at: string) => formatKst(at).slice(11);

const kindText = (event: CalendarEvent) =>
  `${KIND_LABELS[event.kind]}${event.dueOverridden ? "(변경)" : ""}`;

const markersOf = (event: CalendarEvent) =>
  [
    event.bid.cancelled ? "공고 취소" : null,
    event.watched ? "내 관심" : null,
    event.bid.isDemo ? "DEMO" : null,
  ].filter((marker) => marker !== null);

// 칩은 좁아 제목이 잘린다. 마우스를 올리면 날짜까지 다 보이고(title), 접근 이름은 같은 내용을 시각만으로 읽는다.
const chipTitle = (event: CalendarEvent) =>
  [`${kindText(event)} ${formatKst(event.at)}`, event.bid.title, ...markersOf(event)].join(" · ");

const chipName = (event: CalendarEvent) =>
  [`${kindText(event)} ${timeOf(event.at)}`, event.bid.title, ...markersOf(event)].join(" ");

function KindIcon({ kind, className }: { kind: CalendarEventKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

// 칸이 좁아(1440px 에서 안쪽 약 100px) 아이콘·표시를 제목 옆에 두면 제목이 서너 글자만 남는다.
// 윗줄에 종류 아이콘·시각·관심·DEMO 글자를 모으고, 아랫줄은 제목만 칩 폭을 다 쓴다.
function EventChip({ event }: { event: CalendarEvent }) {
  return (
    <li>
      <Link
        href={event.href}
        title={chipTitle(event)}
        aria-label={chipName(event)}
        className="block min-w-0 rounded-md border border-border bg-background px-1 py-px type-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex items-center gap-1 text-muted-foreground">
          <KindIcon kind={event.kind} className="size-3" />
          <span className="tabular-nums">{timeOf(event.at)}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {event.watched ? <StarIcon aria-hidden className="size-3" /> : null}
            {event.bid.isDemo ? <span className="font-semibold text-demo">DEMO</span> : null}
          </span>
        </span>
        <span
          className={cn(
            "block truncate font-medium text-foreground",
            event.bid.cancelled && "text-muted-foreground line-through",
          )}
        >
          {event.bid.title}
        </span>
      </Link>
    </li>
  );
}

function MoreEvents({ dateLabel, events }: { dateLabel: string; events: CalendarEvent[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mt-0.5 w-full rounded-md px-1.5 text-left type-caption text-muted-foreground outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        +{events.length}건 더<span className="sr-only"> ({dateLabel})</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{dateLabel}</DropdownMenuLabel>
          {/* 날짜는 메뉴 머리에만 둔다. 항목은 종류·시각·제목(2줄까지)과 칩과 같은 관심·DEMO 표시다. */}
          {events.map((event) => (
            <DropdownMenuLinkItem
              key={event.key}
              render={<Link href={event.href} />}
              title={chipTitle(event)}
              aria-label={chipName(event)}
              className="items-start"
            >
              <KindIcon kind={event.kind} className="mt-0.5" />
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {timeOf(event.at)}
              </span>
              <span
                className={cn(
                  "min-w-0 flex-1 line-clamp-2 wrap-anywhere",
                  event.bid.cancelled && "text-muted-foreground line-through",
                )}
              >
                {event.bid.title}
              </span>
              {event.watched ? (
                <StarIcon aria-hidden className="mt-1 size-3 text-muted-foreground" />
              ) : null}
              {event.bid.isDemo ? (
                <span className="mt-0.5 shrink-0 type-caption font-semibold text-demo">DEMO</span>
              ) : null}
            </DropdownMenuLinkItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const dateLabelOf = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
};

function DayCell({
  day,
  events,
  isToday,
}: {
  day: CalendarDay;
  events: CalendarEvent[];
  isToday: boolean;
}) {
  const dateLabel = dateLabelOf(day.date);
  return (
    <td
      aria-current={isToday ? "date" : undefined}
      className={cn("h-32 border border-border p-1 align-top", !day.inMonth && "bg-muted/40")}
    >
      <div className="flex h-6 items-center justify-between gap-1 px-1">
        <span
          className={cn(
            "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 type-caption tabular-nums",
            isToday && "bg-foreground font-semibold text-background",
            !isToday && !day.inMonth && "text-muted-foreground",
          )}
        >
          <span aria-hidden>{day.day}</span>
          <span className="sr-only">
            {dateLabel}
            {isToday ? " 오늘" : ""}
          </span>
        </span>
        {/* 같은 날 마감이 겹치면 칸 머리에 아이콘과 건수를 함께 둔다(색만으로 알리지 않는다). */}
        {events.length >= 2 ? (
          <span className="inline-flex items-center gap-0.5 type-caption text-muted-foreground">
            <LayersIcon aria-hidden className="size-3" />
            {events.length}건<span className="sr-only"> 겹침</span>
          </span>
        ) : null}
      </div>
      {events.length > 0 ? (
        <ul className="mt-1 flex flex-col gap-0.5">
          {events.slice(0, MAX_CHIPS).map((event) => (
            <EventChip key={event.key} event={event} />
          ))}
        </ul>
      ) : null}
      {events.length > MAX_CHIPS ? (
        <MoreEvents dateLabel={dateLabel} events={events.slice(MAX_CHIPS)} />
      ) : null}
    </td>
  );
}

function UpcomingItem({ event, now }: { event: CalendarEvent; now: Date }) {
  const due = dDay(event.at, now);
  return (
    <li className="flex gap-3 py-3">
      <span className="w-14 shrink-0 type-label font-semibold tabular-nums">
        {due?.label ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 type-caption text-muted-foreground">
          <KindIcon kind={event.kind} />
          {kindText(event)} · {formatKst(event.at)}
        </p>
        <Link
          href={event.href}
          className="mt-0.5 line-clamp-2 type-label font-medium wrap-anywhere hover:underline focus-visible:outline-2 focus-visible:outline-ring"
        >
          {event.bid.title}
        </Link>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 type-caption text-muted-foreground">
          <span className="wrap-anywhere">{event.bid.agency ?? "기관 미정"}</span>
          {event.project ? <span>담당 {event.project.ownerName ?? "없음"}</span> : null}
          {event.watched ? (
            <span className="inline-flex items-center gap-0.5">
              <StarIcon aria-hidden className="size-3" />내 관심
            </span>
          ) : null}
          {event.bid.cancelled ? <span className="text-destructive">공고 취소</span> : null}
          {event.bid.isDemo ? <DemoBadge dense /> : null}
        </p>
      </div>
    </li>
  );
}

function Legend() {
  const item = "inline-flex items-center gap-1";
  return (
    <ul
      aria-label="표시 설명"
      className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-muted-foreground"
    >
      <li className={item}>
        <FolderKanbanIcon aria-hidden className="size-3.5" />
        제출 마감(입찰 프로젝트)
      </li>
      <li className={item}>
        <FileTextIcon aria-hidden className="size-3.5" />
        공고 마감
      </li>
      <li className={item}>
        <StarIcon aria-hidden className="size-3.5" />내 관심
      </li>
      <li className={item}>
        <span className="font-semibold text-demo">DEMO</span>
        데모용 가상 공고
      </li>
      <li className={item}>
        <LayersIcon aria-hidden className="size-3.5" />
        같은 날 마감 2건 이상
      </li>
    </ul>
  );
}

export function BidCalendar({
  monthLabel,
  weeks,
  eventsByDate,
  upcoming,
  today,
  now,
  view,
  links,
  hasAnyEvents,
}: {
  monthLabel: string;
  weeks: CalendarDay[][];
  // 달력 칸 날짜(KST "YYYY-MM-DD")별 일정, 시각 순
  eventsByDate: Record<string, CalendarEvent[]>;
  upcoming: CalendarEvent[];
  today: string;
  now: string;
  view: CalendarView;
  links: CalendarLinks;
  // 보기(조직 전체·내 일정) 안에 일정이 한 건이라도 있는지(달과 상관없이)
  hasAnyEvents: boolean;
}) {
  const monthHasEvents = weeks.some((week) =>
    week.some((day) => day.inMonth && (eventsByDate[day.date]?.length ?? 0) > 0),
  );
  const nowDate = new Date(now);
  return (
    <AppPage title={CALENDAR_TITLE} description={CALENDAR_DESCRIPTION} contentClassName="max-w-360">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="type-heading tabular-nums">{monthLabel}</h2>
          <nav aria-label="달 이동" className="flex items-center gap-1">
            <Link
              href={links.prev}
              aria-label="이전 달"
              className={buttonVariants({ variant: "outline", size: "icon-sm" })}
            >
              <ChevronLeftIcon aria-hidden />
            </Link>
            <Link href={links.today} className={buttonVariants({ variant: "outline", size: "sm" })}>
              오늘
            </Link>
            <Link
              href={links.next}
              aria-label="다음 달"
              className={buttonVariants({ variant: "outline", size: "icon-sm" })}
            >
              <ChevronRightIcon aria-hidden />
            </Link>
          </nav>
        </div>
        <nav aria-label="보기" className="inline-flex rounded-lg border border-border p-0.5">
          {VIEW_ORDER.map((option) => (
            <Link
              key={option}
              href={links.views[option]}
              aria-current={option === view ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 type-label outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                option === view
                  ? "bg-secondary font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {VIEW_LABELS[option]}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex flex-col gap-2">
        <p className="type-label text-muted-foreground">{VIEW_HINTS[view]}의 마감입니다.</p>
        <Legend />
      </div>
      {hasAnyEvents ? null : (
        <EmptyState
          icon={CalendarDaysIcon}
          title="아직 일정이 없습니다"
          description={NO_EVENTS_HINT}
          action={
            <Link href="/bids" className={buttonVariants({ variant: "outline" })}>
              입찰 공고 보기
            </Link>
          }
        />
      )}
      {/* 단이 넓으면(사이드바를 편 1440px 이상) 다가오는 14일을 오른쪽에, 좁으면 아래에 둔다. */}
      <div className="@container">
        <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_18rem]">
          <section aria-label={`${monthLabel} 달력`} className="min-w-0">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                {CALENDAR_CAPTION} {monthLabel}
              </caption>
              <thead>
                <tr>
                  {WEEKDAYS.map((weekday) => (
                    <th
                      key={weekday}
                      scope="col"
                      className="h-8 type-caption font-medium text-muted-foreground"
                    >
                      {weekday}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week[0]?.date}>
                    {week.map((day) => (
                      <DayCell
                        key={day.date}
                        day={day}
                        events={eventsByDate[day.date] ?? []}
                        isToday={day.date === today}
                      />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {hasAnyEvents && !monthHasEvents ? (
              <p className="mt-2 type-label text-muted-foreground">{MONTH_EMPTY}</p>
            ) : null}
          </section>
          <section aria-labelledby="calendar-upcoming-title" className="min-w-0">
            <h2 id="calendar-upcoming-title" className="type-heading">
              {UPCOMING_TITLE}
            </h2>
            {upcoming.length === 0 ? (
              <p className="mt-3 type-label text-muted-foreground">{UPCOMING_EMPTY}</p>
            ) : (
              <ol className="mt-2 divide-y divide-border border-y border-border">
                {upcoming.map((event) => (
                  <UpcomingItem key={event.key} event={event} now={nowDate} />
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </AppPage>
  );
}
