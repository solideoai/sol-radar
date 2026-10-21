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
// 관심 열(N3 디자인 §4.1)은 watch 슬롯을 준 전체 표에만 맨 앞에 붙는다. ★ 토글(요청·토스트)은 화면 층(app)에 있어
// 이 부품은 칸 자리만 내준다(components 는 app 을 부르지 않는다).

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
// compact 표는 대시보드(글자 +3px, ADR-030 B25) 카드 안에만 놓인다. 폭은 그 글자 크기에서 가장 긴 값
// (DEMO 칩·"SOL Score"·"NO-BID"·"WATCH"·D-n)이 Pretendard·시스템 글꼴 모두 8px 이상 남게 잡았다.
// 첫·끝 칸은 카드 여백(24px)만큼 안쪽 여백을 주어 카드 제목과 글자 줄을 맞춘다.
const COMPACT_COLUMNS = {
  recommended: [
    { ...byKey("origin"), width: "w-[100px]" },
    { ...byKey("title"), width: undefined },
    { ...byKey("agency"), width: "w-[140px]", className: "hidden @lg:table-cell" },
    { ...byKey("score"), width: "w-28" },
    { ...byKey("recommendation"), width: "w-[116px]" },
  ],
  deadline: [
    { ...byKey("origin"), width: "w-[100px]" },
    { ...byKey("title"), width: undefined },
    { ...byKey("deadline"), width: "w-22" },
    { ...byKey("recommendation"), width: "w-26" },
    { ...byKey("decision"), label: "결정", width: "w-[116px]" },
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
  /** D-n 의 기준 시각. 서버가 요청마다 한 번 만들어 내린다 — 부품이 만들면 서버·브라우저 값이 달라 하이드레이션이 어긋난다. */
  now: Date;
  /** 목록 조건(쿼리 문자열, cursor 없음). 있으면 상세 링크에 ?list= 로 붙여 상세의 "목록으로"가 같은 조건으로 돌아오게 한다. */
  listQuery?: string;
  /** 필터가 바뀌어 서버가 다시 읽는 중이면 표를 흐리게 하고 aria-busy 를 켠다. */
  busy?: boolean;
  /** 표 아래 자리(더 보기 단추 등). */
  footer?: React.ReactNode;
  /**
   * 관심 열(맨 앞) 칸에 그릴 것. titleId 는 같은 행 제목 링크의 id 다(★ 의 aria-describedby).
   * 없거나 compact 표면 관심 열을 그리지 않는다.
   */
  watch?: (item: BidListItem, titleId: string) => React.ReactNode;
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

const detailHref = (id: string, listQuery: string | undefined): string =>
  listQuery ? `/bids/${id}?list=${encodeURIComponent(listQuery)}` : `/bids/${id}`;

function Cell({
  column,
  item,
  now,
  compact,
  listQuery,
  titleId,
}: {
  column: Column;
  item: BidListItem;
  now: Date;
  compact: boolean;
  listQuery: string | undefined;
  titleId: string;
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
      // 경고 아이콘은 말줄임 상자 밖 형제다. 안에 두면 긴 제목에서 말줄임과 함께 잘려 보이지 않는다(P3).
      return (
        <div className="flex min-w-0 items-start gap-1">
          <Link
            id={titleId}
            href={detailHref(item.id, listQuery)}
            title={item.title}
            className={cn(
              compact ? "line-clamp-1" : "line-clamp-2",
              "min-w-0 rounded-sm break-words whitespace-normal outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
            )}
          >
            {item.title}
          </Link>
          {hasDocumentIssue(item) && (
            <span className="flex h-[1lh] shrink-0 items-center">
              <FileWarningIcon aria-hidden="true" className="size-3.5 text-warning" />
              <span className="sr-only">첨부 원문 확인 필요</span>
            </span>
          )}
        </div>
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

// 숫자 열(예산·SOL Score)은 오른쪽 정렬이고 좌우 여백을 8px 로 줄인다. 80px 칸에서 Pretendard 13px "SOL Score"
// 머리 글자(약 62px)가 기본 여백(12px)으로는 내용 폭(56px)을 넘는다. 머리와 몸통 여백이 같아야 오른쪽 끝이 맞는다.
const NUMERIC_CELL = "px-2 text-right";

// 관심 열: 40px 안에 32px 버튼. 좌우 4px 여백이 3px 초점 고리를 담아 overflow-hidden 칸에서도 잘리지 않는다(§9 M3).
const WATCH_CELL = "w-10 px-1 text-center";

// compact 표의 첫·끝 칸: 기본 여백(12px, origin 은 6px) 대신 카드 여백 24px.
const edgeClass = (compact: boolean, index: number, count: number): string | false =>
  compact && (index === 0 ? "pl-6" : index === count - 1 && "pr-6");

function BidTable({
  items,
  caption,
  compact = false,
  compactKind = "recommended",
  now,
  listQuery,
  busy = false,
  footer,
  watch,
  className,
}: BidTableProps) {
  const columns: readonly Column[] = compact ? COMPACT_COLUMNS[compactKind] : FULL_COLUMNS;
  const watchCell = compact ? undefined : watch;
  const noteId = useId();
  // 행마다 고유한 제목 링크 id. 더 보기로 붙은 행도 같은 규칙이라 겹치지 않는다.
  const rowsId = useId();
  const titleIdOf = (index: number): string => `${rowsId}-title-${index}`;
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
              {watchCell && (
                <TableHead scope="col" className={WATCH_CELL}>
                  관심
                </TableHead>
              )}
              {columns.map((column, index) => (
                <TableHead
                  key={column.key}
                  scope="col"
                  className={cn(
                    column.width,
                    column.numeric && NUMERIC_CELL,
                    column.className,
                    edgeClass(compact, index, columns.length),
                  )}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item, row) => (
              <TableRow key={item.id} className="h-11">
                {watchCell && (
                  // 위아래 6px: 행 h-11(44px) = 32px 버튼 + 12px. 기본 py-2.5 면 52px 라 한 줄 행이 커진다(§9 M4).
                  <TableCell className={cn(WATCH_CELL, "overflow-hidden py-1.5")}>
                    {/* 글줄 안 inline 버튼은 글자 기준선 아래 여백만큼 위로 떠 칸 가운데에서 벗어난다. 상자로 감싸 가운데에 둔다. */}
                    <div className="flex items-center justify-center">
                      {watchCell(item, titleIdOf(row))}
                    </div>
                  </TableCell>
                )}
                {columns.map((column, index) => (
                  <TableCell
                    key={column.key}
                    className={cn(
                      "type-body",
                      column.key === "title" ? "whitespace-normal" : "overflow-hidden",
                      column.key === "origin" && "pr-1.5 pl-1.5",
                      column.numeric && `${NUMERIC_CELL} tabular-nums`,
                      column.className,
                      edgeClass(compact, index, columns.length),
                    )}
                  >
                    <Cell
                      column={column}
                      item={item}
                      now={now}
                      compact={compact}
                      listQuery={listQuery}
                      titleId={titleIdOf(row)}
                    />
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
