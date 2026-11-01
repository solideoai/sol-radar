"use client";

import { cn } from "cn";
import { DemoBadge } from "@/components/bids/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProgramNoticeListItem, ProgramNoticeSort } from "@/server/program-notices";
import { deadlineOf, kstDate } from "./program-format";
import { SourceBadge } from "./program-notice-drawer";
import { noPeriodText, TABLE_CAPTION } from "./programs-copy";

// 부처 공고 표(디자인 스펙 §4.5). 데이터를 가져오지 않고 props 만 그린다. 쪽 나누기 없이 서버가 준 행(최대 300)을 한 표로 그린다.
// 행마다 초점을 받는 것은 공고명 단추 하나다. 행 전체 누르기는 두지 않는다(§12.1 Q6).

type ColumnKey = "source" | "title" | "agency" | "deadline" | "published";

// 열 폭은 칸 안쪽 여백을 포함한 숫자다(80·가변·160·104·112). 공고명만 가변이다.
const COLUMNS: { key: ColumnKey; label: string; width?: string }[] = [
  { key: "source", label: "출처", width: "w-20" },
  { key: "title", label: "공고명" },
  { key: "agency", label: "소관기관", width: "w-40" },
  { key: "deadline", label: "신청 마감", width: "w-26" },
  { key: "published", label: "등록일", width: "w-28" },
];

// 지금 정렬 열에만 aria-sort 를 단다. 머리를 눌러 정렬하지는 않는다(정렬은 필터 막대).
const SORTED_COLUMN: Record<
  ProgramNoticeSort,
  { key: ColumnKey; order: "ascending" | "descending" }
> = {
  deadline: { key: "deadline", order: "ascending" },
  published: { key: "published", order: "descending" },
};

const EMPTY = "—";

export function ProgramTable({
  items,
  sort,
  today,
  openId,
  onOpen,
}: {
  items: ProgramNoticeListItem[];
  sort: ProgramNoticeSort;
  /** 서울 오늘(YYYY-MM-DD). 서버가 목록을 거른 값과 같다. */
  today: string;
  /** 서랍이 열린 행. 그 행의 공고명 단추만 aria-expanded=true 다(행 바탕은 TableRow 기본이 칠한다). */
  openId: string | null;
  onOpen: (item: ProgramNoticeListItem, trigger: HTMLElement) => void;
}) {
  const sorted = SORTED_COLUMN[sort];
  return (
    <Table className="min-w-180 table-fixed">
      <caption className="sr-only">{TABLE_CAPTION}</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {COLUMNS.map((column) => (
            <TableHead
              key={column.key}
              scope="col"
              aria-sort={sorted.key === column.key ? sorted.order : undefined}
              className={column.width}
            >
              {column.label}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id} className="h-11">
            {COLUMNS.map((column) => (
              <TableCell
                key={column.key}
                className={cn(
                  "type-body",
                  column.key === "title" ? "whitespace-normal" : "overflow-hidden",
                  column.key === "source" && "pr-1.5 pl-1.5",
                )}
              >
                <Cell
                  column={column.key}
                  item={item}
                  today={today}
                  isOpen={openId === item.id}
                  onOpen={onOpen}
                />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Cell({
  column,
  item,
  today,
  isOpen,
  onOpen,
}: {
  column: ColumnKey;
  item: ProgramNoticeListItem;
  today: string;
  isOpen: boolean;
  onOpen: (item: ProgramNoticeListItem, trigger: HTMLElement) => void;
}) {
  switch (column) {
    case "source":
      return item.isDemo ? <DemoBadge dense /> : <SourceBadge source={item.source} />;
    case "title":
      return (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          title={item.title}
          onClick={(event) => onOpen(item, event.currentTarget)}
          className="line-clamp-2 min-w-0 rounded-sm text-left break-words whitespace-normal text-foreground outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {item.title}
        </button>
      );
    case "agency":
      return item.agency === null ? (
        <span>{EMPTY}</span>
      ) : (
        <span className="block truncate" title={item.agency}>
          {item.agency}
        </span>
      );
    case "deadline":
      return <DeadlineCell applyEndOn={item.applyEndOn} today={today} source={item.source} />;
    case "published":
      return item.publishedAt === null ? (
        <span className="text-muted-foreground">{EMPTY}</span>
      ) : (
        <time dateTime={item.publishedAt} className="text-muted-foreground tabular-nums">
          {kstDate(item.publishedAt)}
        </time>
      );
  }
}

// 1줄 D-n(보이는 글자는 낭독하지 않고 옆의 sr-only 가 읽는다) · 2줄 짧은 날짜.
// 마감 없음은 한 줄이다: 과기정통부 "공고문 확인", 나머지 "기간 미표기".
function DeadlineCell({
  applyEndOn,
  today,
  source,
}: {
  applyEndOn: string | null;
  today: string;
  source: ProgramNoticeListItem["source"];
}) {
  const deadline = deadlineOf(applyEndOn, today);
  if (applyEndOn === null || deadline === null)
    return <span className="type-label text-muted-foreground">{noPeriodText(source)}</span>;
  return (
    <div className="flex flex-col">
      <span className={cn("type-label tabular-nums", deadline.past && "text-muted-foreground")}>
        <span aria-hidden="true">{deadline.label}</span>
        <span className="sr-only">{deadline.srText}</span>
      </span>
      <time dateTime={applyEndOn} className="type-caption text-muted-foreground tabular-nums">
        {deadline.short}
      </time>
    </div>
  );
}
