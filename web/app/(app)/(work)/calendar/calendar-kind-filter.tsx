import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import Link from "next/link";
import type { CalendarEventKind } from "@/server/calendar";
import {
  KIND_FILTER_ALL,
  KIND_FILTER_LABEL,
  KIND_HIDDEN,
  KIND_LABELS,
  KIND_ORDER,
  KIND_SHORT_LABELS,
  KIND_SHOWN,
} from "./calendar-copy";
import { KIND_ICON } from "./calendar-kinds";

// 일정 종류 거르기. 칩마다 그 종류를 켜고 끈 주소로 가는 링크다(주소만 바꾸므로 버튼이 아니라 링크).
// 칩 글자는 짧은 이름, 정식 이름은 title 로 보인다. 모양은 보기 전환(조직 전체·내 일정)과 같고, 켜진 칩은 체크 아이콘·굵은 글자·바탕으로, 화면 읽기는 "보는 중"·"숨김" 글자로 구분한다.
// 서버 모듈을 값으로 부르지 않는다(브라우저 시험이 그대로 그린다). 주소는 page 가 만들어 넘긴다.

export function CalendarKindFilter({
  kinds,
  hrefs,
  allHref,
}: {
  /** 지금 보이는 종류 */
  kinds: readonly CalendarEventKind[];
  /** 종류마다 그 칩을 눌렀을 때(켜고 끈) 주소 */
  hrefs: Record<CalendarEventKind, string>;
  /** 거르는 중일 때만 전부 켠 주소. 전부 보이면 null */
  allHref: string | null;
}) {
  return (
    <nav aria-label={KIND_FILTER_LABEL} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span aria-hidden className="type-label text-muted-foreground">
        {KIND_FILTER_LABEL}
      </span>
      {/* 여러 개 켜는 거르기 칩이라 칩마다 1px 테두리를 두고 바깥 상자는 두지 않는다(2026-10-28 화면 개편). */}
      <ul className="flex flex-wrap gap-1.5">
        {KIND_ORDER.map((kind) => {
          const on = kinds.includes(kind);
          const Icon = KIND_ICON[kind];
          return (
            <li key={kind}>
              <Link
                href={hrefs[kind]}
                title={KIND_LABELS[kind]}
                data-kind={kind}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 type-label whitespace-nowrap outline-hidden focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11",
                  on
                    ? "border-transparent bg-selected font-semibold text-selected-foreground"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {on ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
                <Icon aria-hidden className="size-3.5 shrink-0" />
                {KIND_SHORT_LABELS[kind]}
                <span className="sr-only">{on ? KIND_SHOWN : KIND_HIDDEN}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      {allHref === null ? null : (
        <Link
          href={allHref}
          className="rounded-sm type-label text-foreground underline underline-offset-4 outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          {KIND_FILTER_ALL}
        </Link>
      )}
    </nav>
  );
}
