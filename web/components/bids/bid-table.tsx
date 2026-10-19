import { cn } from "cn";
import { FileWarningIcon } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import { EXTRA_STATUS_LABEL, STAGE_LABEL, STATUS_ICON } from "@/components/bids/labels";
import { dDay, formatKrwCompact, formatKstShort } from "@/components/bids/format";
import { DemoBadge, StatusBadge } from "@/components/bids/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BidListItem } from "@/server/bids";

// 스펙 §5.3 (10열 표) · §5.2 (대시보드 compact 표). 데이터를 가져오지 않고 props 만 그린다.
// 서버 모듈은 타입으로만 가져온다.

type ColumnKey =
  | "origin"
  | "stage"
  | "title"
  | "agency"
  | "budget"
  | "deadline"
  | "score"
  | "recommendation"
  | "analysis"
  | "decision";

type Column = {
  key: ColumnKey;
  label: string;
  width?: string;
  numeric?: boolean;
  className?: string;
};

// 열 폭은 셀 안쪽 여백을 포함한 숫자다(64·72·가변·120·80·72·80·88·96·88). 제목만 가변이다.
const FULL_COLUMNS: Column[] = [
  // 스펙은 64px 이지만 DEMO 칩(아이콘+글자, 약 68px)이 들어가지 않아 80px 로 넓힌다. 제목 열이 16px 줄어든다.
  { key: "origin", label: "출처", width: "w-20" },
  { key: "stage", label: "단계", width: "w-[72px]" },
  { key: "title", label: "제목" },
  { key: "agency", label: "발주기관", width: "w-[120px]" },
  { key: "budget", label: "예산", width: "w-20", numeric: true },
  { key: "deadline", label: "마감", width: "w-[72px]" },
  { key: "score", label: "SOL Score", width: "w-20", numeric: true },
  { key: "recommendation", label: "권고", width: "w-[88px]" },
  { key: "analysis", label: "분석 상태", width: "w-24" },
  { key: "decision", label: "최종 결정", width: "w-[88px]" },
];

const byKey = (key: ColumnKey): Column => {
  const found = FULL_COLUMNS.find((column) => column.key === key);
  if (!found) throw new Error(`알 수 없는 열: ${key}`);
  return found;
};

// 대시보드 표 두 개의 열(§5.2). 발주기관은 카드 폭 @lg 이상에서만 보인다.
const COMPACT_COLUMNS = {
  recommended: [
    { ...byKey("origin"), width: "w-20" },
    { ...byKey("title"), width: undefined },
    { ...byKey("agency"), width: "w-[120px]", className: "hidden @lg:table-cell" },
    { ...byKey("score"), width: "w-20" },
    { ...byKey("recommendation"), width: "w-[88px]" },
  ],
  deadline: [
    { ...byKey("origin"), width: "w-20" },
    { ...byKey("title"), width: undefined },
    { ...byKey("deadline"), width: "w-[72px]" },
    { ...byKey("recommendation"), width: "w-[88px]" },
    { ...byKey("decision"), label: "결정", width: "w-[88px]" },
  ],
} as const satisfies Record<string, Column[]>;

const EMPTY = "—";
const DEMO_NOTE = "DEMO 표시는 데모용 가상 공고입니다. 실제 입찰 공고가 아닙니다.";

type BidTableProps = {
  items: BidListItem[];
  /** 표 이름. 화면에는 보이지 않고 스크린리더가 읽는다. */
  caption: string;
  compact?: boolean;
  /** compact 표의 열 묶음: 점수형(기본) 또는 마감형. */
  compactKind?: keyof typeof COMPACT_COLUMNS;
  /** D-n 의 기준 시각. 서버가 넘기면 하이드레이션 차이가 없다. */
  now?: Date;
  /** 필터가 바뀌어 서버가 다시 읽는 중이면 표를 흐리게 하고 aria-busy 를 켠다. */
  busy?: boolean;
  /** 표 아래 자리(더 보기 단추 등). */
  footer?: React.ReactNode;
  className?: string;
};

function hasDocumentIssue({ documentsStatus: d }: BidListItem): boolean {
  return d.downloadFailed + d.failed + d.unsupported + d.partial > 0;
}

function MutedLabel({ statusKey }: { statusKey: "NOT_ANALYZED" }) {
  const { icon: Icon, className } = STATUS_ICON[statusKey];
  return (
    <span
      className={cn("inline-flex items-center gap-1 whitespace-nowrap type-caption", className)}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{EXTRA_STATUS_LABEL[statusKey]}</span>
    </span>
  );
}

function Cell({
  column,
  item,
  now,
  compact,
}: {
  column: Column;
  item: BidListItem;
  now: Date;
  compact: boolean;
}) {
  const analysis = item.latestAnalysis;
  switch (column.key) {
    case "origin":
      return item.isDemo ? (
        <DemoBadge dense />
      ) : (
        <span className="type-caption text-muted-foreground">나라장터</span>
      );
    case "stage":
      return (
        <div className="flex flex-col gap-0.5">
          <span className="type-label">{STAGE_LABEL[item.stage]}</span>
          <StatusBadge kind="bidStatus" value={item.status} variant="inline" />
        </div>
      );
    case "title":
      return (
        <Link
          href={`/bids/${item.id}`}
          title={item.title}
          className={cn(
            compact ? "line-clamp-1" : "line-clamp-2",
            "rounded-sm break-words whitespace-normal outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          {item.title}
          {hasDocumentIssue(item) && (
            <>
              <FileWarningIcon
                aria-hidden="true"
                className="ml-1 inline size-3.5 align-text-bottom text-warning"
              />
              <span className="sr-only">첨부 원문 확인 필요</span>
            </>
          )}
        </Link>
      );
    case "agency":
      return item.agency === null ? (
        <span>{EMPTY}</span>
      ) : (
        <span className="block truncate" title={item.agency}>
          {item.agency}
        </span>
      );
    case "budget": {
      const { text, full } = formatKrwCompact(item.budgetKrw);
      return (
        <span title={full}>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{full}</span>
        </span>
      );
    }
    case "deadline": {
      const d = item.deadlineAt === null ? null : dDay(item.deadlineAt, now);
      if (item.deadlineAt === null || d === null) return <span>{EMPTY}</span>;
      return (
        <div className="flex flex-col">
          <span className={cn("type-label tabular-nums", d.past && "text-muted-foreground")}>
            {d.label}
          </span>
          <time
            dateTime={item.deadlineAt}
            className="type-caption text-muted-foreground tabular-nums"
          >
            {formatKstShort(item.deadlineAt)}
          </time>
        </div>
      );
    }
    case "score":
      return <span>{analysis?.solScore == null ? EMPTY : Math.round(analysis.solScore)}</span>;
    case "recommendation":
      if (analysis === null) return <MutedLabel statusKey="NOT_ANALYZED" />;
      return analysis.recommendation === null ? (
        <span>{EMPTY}</span>
      ) : (
        <StatusBadge kind="recommendation" value={analysis.recommendation} variant="inline" />
      );
    case "analysis":
      return analysis === null ? (
        <MutedLabel statusKey="NOT_ANALYZED" />
      ) : (
        <StatusBadge kind="analysis" value={analysis.status} short variant="inline" />
      );
    case "decision":
      return (
        <StatusBadge kind="decision" value={item.latestReview?.decision ?? null} variant="inline" />
      );
  }
}

function BidTable({
  items,
  caption,
  compact = false,
  compactKind = "recommended",
  now,
  busy = false,
  footer,
  className,
}: BidTableProps) {
  const columns: readonly Column[] = compact ? COMPACT_COLUMNS[compactKind] : FULL_COLUMNS;
  const rowNow = now ?? new Date();
  const noteId = useId();
  return (
    <div aria-busy={busy || undefined} className={className}>
      <p id={noteId} className="sr-only">
        {DEMO_NOTE}
      </p>
      <div className={cn("transition-opacity", busy && "opacity-60")}>
        <Table className="table-fixed" aria-describedby={noteId}>
          <caption className="sr-only">{caption}</caption>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cn(column.width, column.numeric && "text-right", column.className)}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id} className="h-11">
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      "type-body",
                      column.key === "title" ? "whitespace-normal" : "overflow-hidden",
                      column.key === "origin" && "px-1.5",
                      column.numeric && "text-right tabular-nums",
                      column.className,
                    )}
                  >
                    <Cell column={column} item={item} now={rowNow} compact={compact} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {footer}
    </div>
  );
}

export { BidTable };
export type { BidTableProps };
