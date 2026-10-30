import { cn } from "cn";
import {
  CalendarDaysIcon,
  CalendarPlusIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  LayersIcon,
  StarIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { AppPage } from "@/components/app-page";
import { dDay, formatKst } from "@/components/bids/format";
import { DemoBadge } from "@/components/bids/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
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
  GOOGLE_ADD,
  ICS_DOWNLOAD,
  ICS_HINT,
  ICS_UNAVAILABLE,
  KIND_FILTER_ALL,
  KIND_FILTER_EMPTY,
  KIND_LABELS,
  KIND_SHORT_LABELS,
  LEGEND_LABEL,
  MONTH_EMPTY,
  MORE_MENU_MAX,
  moreMenuOverflow,
  NO_EVENTS_HINT,
  RELEVANT_LOAD_FAILED,
  SOURCE_NOTES,
  UPCOMING_EMPTY,
  UPCOMING_MAX,
  UPCOMING_TITLE,
  UPCOMING_VISIBLE,
  upcomingMore,
  upcomingOverflow,
  VIEW_HINTS,
  VIEW_LABELS,
  VIEW_ORDER,
  WEEKDAYS,
} from "./calendar-copy";
import { googleCalendarUrl } from "./calendar-export";
import { CalendarKindFilter } from "./calendar-kind-filter";
import { KIND_ICON } from "./calendar-kinds";

// 서버 모듈을 값으로 부르지 않는다(브라우저 시험이 그대로 그린다). 날짜 계산은 page 가 끝내서 넘긴다.
// 일정 종류는 색이 아니라 아이콘과 글자로 구분한다. 칩의 접근 이름(aria-label)에 종류·시각·관심·DEMO 를 모두 글자로 싣는다.

// 칩은 두 줄(종류·시각·표시 줄 + 제목 줄)이라 칸에 두 개까지 그리고 나머지는 "+n건" 메뉴로 연다(칸 높이를 주마다 같게).
export const MAX_CHIPS = 2;

// 다가오는 목록은 UPCOMING_MAX 건까지만 그린다. page 는 이 함수로 상한 너머의 일정을 넘기지 않고 건수만 넘긴다.
export const capUpcoming = (events: readonly CalendarEvent[]) => ({
  upcoming: events.slice(0, UPCOMING_MAX),
  upcomingHidden: Math.max(events.length - UPCOMING_MAX, 0),
});

export type CalendarLinks = {
  prev: string;
  next: string;
  today: string;
  views: Record<CalendarView, string>;
  // 종류마다 그 칩을 켜고 끈 주소, 거르는 중일 때만 전부 켠 주소(전부 보이면 null)
  kinds: Record<CalendarEventKind, string>;
  allKinds: string | null;
  // 지금 보는 달·보기·종류 그대로의 .ics 내려받기 주소(GET /api/v1/calendar/ics)
  ics: string;
};

const timeOf = (at: string) => formatKst(at).slice(11);

// 칩 글자는 짧은 이름, 접근 이름·title·메뉴·다가오는 목록은 정식 이름이다.
const kindText = (event: CalendarEvent) =>
  `${KIND_SHORT_LABELS[event.kind]}${event.dueOverridden ? "(변경)" : ""}`;

const fullKindText = (event: CalendarEvent) =>
  `${KIND_LABELS[event.kind]}${event.dueOverridden ? "(변경)" : ""}`;

// 현장설명회는 장소를 함께 싣는다(원본에 있을 때만).
const placeText = (event: CalendarEvent) => (event.place === null ? null : `장소 ${event.place}`);

const markersOf = (event: CalendarEvent) =>
  [
    event.bid.cancelled ? "공고 취소" : null,
    event.watched ? "내 관심" : null,
    event.bid.isDemo ? "DEMO" : null,
  ].filter((marker) => marker !== null);

// 칩은 좁아 제목이 잘린다. 마우스를 올리면 날짜까지 다 보이고(title), 접근 이름은 같은 내용을 시각만으로 읽는다.
const chipTitle = (event: CalendarEvent) =>
  [
    `${fullKindText(event)} ${formatKst(event.at)}`,
    placeText(event),
    event.bid.title,
    ...markersOf(event),
  ]
    .filter((part) => part !== null)
    .join(" · ");

const chipName = (event: CalendarEvent) =>
  [
    `${fullKindText(event)} ${timeOf(event.at)}`,
    placeText(event),
    event.bid.title,
    ...markersOf(event),
  ]
    .filter((part) => part !== null)
    .join(" ");

function KindIcon({ kind, className }: { kind: CalendarEventKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon aria-hidden className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
}

// 칸이 좁아(1440px 에서 안쪽 약 100px) 아이콘·표시를 제목 옆에 두면 제목이 서너 글자만 남는다.
// 윗줄에 종류 아이콘·시각·짧은 종류 이름·관심·DEMO 글자를 모으고, 아랫줄은 제목만 칩 폭을 다 쓴다.
// 종류 이름은 칩이 넓을 때(사이드바를 편 1280px·접은 1440px)만 보인다. 1440px 에서 사이드바를 펴면 칩이 약 100px 라
// 한두 글자로 잘려 뜻이 없어 아이콘만 남긴다(정식 이름은 title·접근 이름에 있고, 아이콘 뜻은 거르기 칩이 보인다).
function EventChip({ event }: { event: CalendarEvent }) {
  return (
    <li>
      <Link
        href={event.href}
        title={chipTitle(event)}
        aria-label={chipName(event)}
        className="@container block min-w-0 rounded-md border border-border bg-background px-1 py-px type-caption hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="flex items-center gap-1 text-muted-foreground">
          <KindIcon kind={event.kind} className="size-3" />
          <span className="shrink-0 tabular-nums">{timeOf(event.at)}</span>
          <span className="hidden min-w-0 truncate @min-[7rem]:block">{kindText(event)}</span>
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

// 메뉴 항목은 MORE_MENU_MAX 건까지만 그리고 나머지는 건수만 글자로 알린다(항목은 열기 전부터 RSC 에 실린다).
function MoreEvents({ dateLabel, events }: { dateLabel: string; events: CalendarEvent[] }) {
  const listed = events.slice(0, MORE_MENU_MAX);
  const hidden = events.length - listed.length;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="mt-0.5 w-full rounded-md px-1.5 text-left type-caption text-muted-foreground outline-hidden hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        +{events.length}건 더<span className="sr-only"> ({dateLabel})</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{dateLabel}</DropdownMenuLabel>
          {/* 날짜는 메뉴 머리에만 둔다. 항목은 윗줄 시각·정식 종류 이름(현장설명회는 장소), 아랫줄 제목(2줄까지)과
              칩과 같은 관심·DEMO 표시다. */}
          {listed.map((event) => (
            <DropdownMenuLinkItem
              key={event.key}
              render={<Link href={event.href} />}
              title={chipTitle(event)}
              aria-label={chipName(event)}
              className="items-start"
            >
              <KindIcon kind={event.kind} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="block type-caption text-muted-foreground wrap-anywhere">
                  <span className="tabular-nums">{timeOf(event.at)}</span> {fullKindText(event)}
                  {event.place === null ? null : ` · ${placeText(event)}`}
                </span>
                <span
                  className={cn(
                    "line-clamp-2 wrap-anywhere",
                    event.bid.cancelled && "text-muted-foreground line-through",
                  )}
                >
                  {event.bid.title}
                </span>
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
        {hidden > 0 ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-1.5 py-1 type-caption text-muted-foreground">
              {moreMenuOverflow(hidden)}
            </p>
          </>
        ) : null}
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
        {/* 같은 날 일정이 겹치면 칸 머리에 아이콘과 건수를 함께 둔다(색만으로 알리지 않는다). */}
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

function UpcomingItem({
  event,
  now,
  siteOrigin,
}: {
  event: CalendarEvent;
  now: Date;
  siteOrigin: string | null;
}) {
  const due = dDay(event.at, now);
  return (
    <li className="flex gap-3 py-3">
      <span className="w-14 shrink-0 type-label font-semibold tabular-nums">
        {due?.label ?? "—"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 type-caption text-muted-foreground">
          <KindIcon kind={event.kind} />
          <span className="wrap-anywhere">
            {fullKindText(event)} · <span className="whitespace-nowrap">{formatKst(event.at)}</span>
            {event.place === null ? null : ` · ${placeText(event)}`}
          </span>
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
          {/* 구글 캘린더 일정 만들기 화면을 새 창으로 연다(OAuth 없음, 사용자가 직접 저장한다). */}
          <a
            href={googleCalendarUrl(event, siteOrigin)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${event.bid.title} ${KIND_LABELS[event.kind]} ${GOOGLE_ADD}(새 창)`}
            className="inline-flex items-center gap-0.5 rounded-sm text-foreground underline underline-offset-4 outline-hidden hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <CalendarPlusIcon aria-hidden className="size-3" />
            {GOOGLE_ADD}
          </a>
        </p>
      </div>
    </li>
  );
}

// 종류 아이콘·이름은 거르기 칩(CalendarKindFilter)이 보인다. 여기는 종류가 아닌 표시만 둔다.
function Legend() {
  const item = "inline-flex items-center gap-1";
  return (
    <ul
      aria-label={LEGEND_LABEL}
      className="flex flex-wrap gap-x-4 gap-y-1 type-caption text-muted-foreground"
    >
      <li className={item}>
        <StarIcon aria-hidden className="size-3.5" />내 관심
      </li>
      <li className={item}>
        <span className="font-semibold text-demo">DEMO</span>
        데모용 가상 공고
      </li>
      <li className={item}>
        <LayersIcon aria-hidden className="size-3.5" />
        같은 날 일정 2건 이상
      </li>
    </ul>
  );
}

export function BidCalendar({
  monthLabel,
  weeks,
  eventsByDate,
  upcoming,
  upcomingHidden,
  today,
  now,
  view,
  links,
  kinds,
  kindsFiltered,
  hasAnyEvents,
  relevantFailed,
  siteOrigin,
}: {
  monthLabel: string;
  weeks: CalendarDay[][];
  // 달력 칸 날짜(KST "YYYY-MM-DD")별 일정, 시각 순. 종류 거르기를 마친 값이다(upcoming 도 같다).
  eventsByDate: Record<string, CalendarEvent[]>;
  // 다가오는 14일 가운데 앞 UPCOMING_MAX 건과, 그 너머라 넘기지 않은 건수(capUpcoming)
  upcoming: CalendarEvent[];
  upcomingHidden: number;
  today: string;
  now: string;
  view: CalendarView;
  links: CalendarLinks;
  // 지금 보이는 종류(?kinds=)와, 일부만 보이는지
  kinds: readonly CalendarEventKind[];
  kindsFiltered: boolean;
  // 보기(조직 전체·내 일정) 안에 일정이 한 건이라도 있는지(달과 상관없이, 종류를 거르기 전)
  hasAnyEvents: boolean;
  // IT 공고를 읽지 못해 관심·프로젝트 일정만 실었는지(조직 전체 보기만 읽는다)
  relevantFailed: boolean;
  // 이 사이트 주소(구글 일정 설명에 SOL RADAR 링크를 싣는다). 모르면 null 이고 링크 줄을 뺀다.
  siteOrigin: string | null;
}) {
  const monthHasEvents = weeks.some((week) =>
    week.some((day) => day.inMonth && (eventsByDate[day.date]?.length ?? 0) > 0),
  );
  const nowDate = new Date(now);
  // 다가오는 일정이 많으면(IT 실공고) 앞 몇 건만 보이고 나머지는 JS 없이 펼친다.
  const upcomingShown = upcoming.slice(0, UPCOMING_VISIBLE);
  const upcomingRest = upcoming.slice(UPCOMING_VISIBLE);
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
        <div className="flex flex-wrap items-center gap-2">
          {/* 같은 일정을 다른 범위로 보는 하나 고르기 전환이라 테두리 상자 안의 알약이다(2026-10-28 화면 개편). */}
          <nav aria-label="보기" className="inline-flex rounded-lg border border-border p-0.5">
            {VIEW_ORDER.map((option) => (
              <Link
                key={option}
                href={links.views[option]}
                aria-current={option === view ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 type-label outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                  option === view
                    ? "bg-selected font-semibold text-selected-foreground"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                {VIEW_LABELS[option]}
              </Link>
            ))}
          </nav>
          {/* 파일 내려받기라 Link(화면 이동·미리 읽기)가 아니라 a 다. IT 공고를 못 읽었으면 내려받기도 503 이라
              누르면 브라우저가 이유 없이 실패만 보이므로 끄고, 이유는 아래 실패 안내에 싣는다. */}
          {relevantFailed ? (
            <Button variant="outline" size="sm" disabled>
              <DownloadIcon aria-hidden />
              {ICS_DOWNLOAD}
            </Button>
          ) : (
            <a
              href={links.ics}
              download
              title={ICS_HINT}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <DownloadIcon aria-hidden />
              {ICS_DOWNLOAD}
            </a>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <div>
          <p className="type-label text-muted-foreground">{VIEW_HINTS[view]}의 일정입니다.</p>
          <p className="mt-0.5 type-caption text-muted-foreground">{SOURCE_NOTES[view]}</p>
          {relevantFailed ? (
            <p
              role="status"
              className="mt-1 flex items-start gap-1.5 type-caption wrap-anywhere text-muted-foreground"
            >
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
              {RELEVANT_LOAD_FAILED} {ICS_UNAVAILABLE}
            </p>
          ) : null}
        </div>
        <CalendarKindFilter kinds={kinds} hrefs={links.kinds} allHref={links.allKinds} />
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
              {/* 요일 줄은 표(ui/table) 머리 줄과 같은 연한 바탕이다. 칸 선을 겹쳐 그리는 표라 바깥 둥근 테두리는 두지 않는다. */}
              <thead>
                <tr className="bg-muted/50">
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
              kindsFiltered ? (
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 type-label text-muted-foreground">
                  {KIND_FILTER_EMPTY}
                  {links.allKinds === null ? null : (
                    <Link
                      href={links.allKinds}
                      className="rounded-sm text-foreground underline underline-offset-4 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {KIND_FILTER_ALL}
                    </Link>
                  )}
                </p>
              ) : (
                <p className="mt-2 type-label text-muted-foreground">{MONTH_EMPTY}</p>
              )
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
                {upcomingShown.map((event) => (
                  <UpcomingItem
                    key={event.key}
                    event={event}
                    now={nowDate}
                    siteOrigin={siteOrigin}
                  />
                ))}
              </ol>
            )}
            {upcomingRest.length > 0 ? (
              <details>
                <summary className="cursor-pointer rounded-sm py-2 type-label text-muted-foreground outline-hidden hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  {upcomingMore(upcomingRest.length)}
                </summary>
                <ol
                  start={UPCOMING_VISIBLE + 1}
                  className="divide-y divide-border border-b border-border"
                >
                  {upcomingRest.map((event) => (
                    <UpcomingItem
                      key={event.key}
                      event={event}
                      now={nowDate}
                      siteOrigin={siteOrigin}
                    />
                  ))}
                </ol>
              </details>
            ) : null}
            {upcomingHidden > 0 ? (
              <p className="mt-2 type-caption text-muted-foreground">
                {upcomingOverflow(upcomingHidden)}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </AppPage>
  );
}
