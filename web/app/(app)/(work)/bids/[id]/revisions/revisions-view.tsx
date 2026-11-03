import { ArrowLeftIcon, CircleDashedIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";
import { DETAIL_CONTENT_CLASS } from "@/app/(app)/(work)/bids/[id]/detail-copy";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { AppPage } from "@/components/app-page";
import { AnalysisBanner } from "@/components/bids/analysis-banner";
import { Added, Removed, ValueMark } from "@/components/bids/diff-marks";
import { formatKrwCompact, formatKst } from "@/components/bids/format";
import { STAGE_LABEL, STATUS_ICON } from "@/components/bids/labels";
import { REVISION_FIELD_LABEL, shownChangeCount } from "@/components/bids/revision-field-labels";
import { TextDiff } from "@/components/bids/text-diff";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { RevisionComparison, RevisionFieldChange, RevisionRef } from "@/server/bids";
import { BID_STATUS_LABEL, REVISIONS_TITLE } from "./revisions-copy";

// 스펙 docs/plans/2026-10-21-s5-revisions-ui-spec.md. 서버 부품이다. 브라우저로 내려가는 상호작용은 본문 펼치기(TextDiff)뿐이다.

const TEXT_LINK = "rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

type ScalarChange = Extract<RevisionFieldChange, { kind: "scalar" }>;
type ListChange = Extract<RevisionFieldChange, { kind: "list" }>;
type TextChange = Extract<RevisionFieldChange, { kind: "text" }>;

function Empty({ label }: { label: string }) {
  return (
    <>
      <span className="text-muted-foreground">—</span>
      <span className="sr-only">{label}</span>
    </>
  );
}

// 한국 시각. 시간대 표기(KST·UTC)는 붙이지 않는다(2026-11-03 사용자 지시).
function Kst({ iso }: { iso: string }) {
  return (
    <time dateTime={iso} className="tabular-nums">
      {formatKst(iso)}
    </time>
  );
}

// 수집 번호(revision)의 화면 이름. "r1" 같은 내부 표기 대신 "1번째 수집"으로 쓴다(2026-11-03 사용자 지시).
const collectedName = (revision: number): string => `${revision}번째 수집`;

// 값 하나. 표시(추가·삭제 모양)를 입힐지는 부른 쪽이 정한다.
function ScalarValue({ field, value }: { field: ScalarChange["field"]; value: string | null }) {
  if (value === null) return <Empty label={field === "budgetKrw" ? "미공개" : "없음"} />;
  switch (field) {
    case "budgetKrw": {
      const money = formatKrwCompact(value);
      return (
        <>
          <span className="tabular-nums">{money.text}</span>
          <span className="block type-caption text-muted-foreground">{money.full}</span>
        </>
      );
    }
    case "deadlineAt":
    case "noticeDate":
      return <Kst iso={value} />;
    case "status": {
      const label = Object.hasOwn(BID_STATUS_LABEL, value)
        ? BID_STATUS_LABEL[value as keyof typeof BID_STATUS_LABEL]
        : null;
      if (label === null) return <span className="font-mono">{value}</span>;
      if (value === "CANCELLED") {
        const { icon: Icon, className } = STATUS_ICON.CANCELLED;
        return (
          <span className="inline-flex items-center gap-1">
            <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />
            {label}
          </span>
        );
      }
      return <>{label}</>;
    }
    case "stage":
      return (
        <>
          {Object.hasOwn(STAGE_LABEL, value)
            ? STAGE_LABEL[value as keyof typeof STAGE_LABEL]
            : value}
        </>
      );
    case "sourceUrl":
      return <span className="font-mono">{value}</span>;
    case "planRef":
    case "preSpecRef":
      return <span className="font-mono">{value}</span>;
    default:
      return <>{value}</>;
  }
}

function ScalarCells({ change }: { change: ScalarChange }) {
  const { before, after, field } = change;
  const money = field === "budgetKrw";
  // 예산은 둘째 줄(전체 금액)에 모양을 입히지 않으려고 첫 줄만 감싼다.
  const wrap = (kind: "added" | "removed", value: string | null) => {
    if (value === null) return <ScalarValue field={field} value={value} />;
    if (!money) {
      return (
        <ValueMark kind={kind}>
          <ScalarValue field={field} value={value} />
        </ValueMark>
      );
    }
    const compact = formatKrwCompact(value);
    return (
      <>
        <ValueMark kind={kind} className="tabular-nums">
          {compact.text}
        </ValueMark>
        <span className="block type-caption text-muted-foreground">{compact.full}</span>
      </>
    );
  };
  return (
    <>
      <TableCell className="align-top whitespace-normal wrap-anywhere">
        {wrap("removed", before)}
      </TableCell>
      <TableCell className="align-top whitespace-normal wrap-anywhere">
        {wrap("added", after)}
      </TableCell>
    </>
  );
}

function ListCell({
  marked,
  kept,
  mark,
}: {
  marked: string[];
  kept: string[];
  mark: "added" | "removed";
}) {
  if (marked.length + kept.length === 0) return <Empty label="없음" />;
  return (
    <ul className="flex flex-col gap-1">
      {marked.map((item, index) => (
        <li key={`m-${index}`} className="wrap-anywhere">
          {mark === "added" ? <Added text={item} /> : <Removed text={item} />}
        </li>
      ))}
      {kept.map((item, index) => (
        <li key={`k-${index}`} className="wrap-anywhere">
          {item}
        </li>
      ))}
    </ul>
  );
}

function ListCells({ change }: { change: ListChange }) {
  return (
    <>
      <TableCell className="align-top whitespace-normal wrap-anywhere">
        <ListCell marked={change.removed} kept={change.kept} mark="removed" />
      </TableCell>
      <TableCell className="align-top whitespace-normal wrap-anywhere">
        <ListCell marked={change.added} kept={change.kept} mark="added" />
      </TableCell>
    </>
  );
}

function ChangesTable({
  rows,
  previous,
  current,
}: {
  rows: (ScalarChange | ListChange)[];
  previous: RevisionRef;
  current: RevisionRef;
}) {
  // 바깥 둥근 1px 테두리는 ui/table 이 그린다(2026-10-28 화면 개편).
  return (
    <Table className="min-w-160 table-fixed">
      <TableCaption className="sr-only">
        바뀐 항목 표: 이전 {collectedName(previous.revision)}, 이후{" "}
        {collectedName(current.revision)}
      </TableCaption>
      <colgroup>
        <col className="w-32" />
        <col />
        <col />
      </colgroup>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">항목</TableHead>
          <TableHead scope="col">이전 ({collectedName(previous.revision)})</TableHead>
          <TableHead scope="col">이후 ({collectedName(current.revision)})</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((change) => (
          <TableRow key={change.field} data-slot="revision-change-row" data-field={change.field}>
            <th
              scope="row"
              className="px-3 py-2.5 text-left align-top type-label font-medium text-muted-foreground"
            >
              {REVISION_FIELD_LABEL[change.field]}
            </th>
            {change.kind === "scalar" ? (
              <ScalarCells change={change} />
            ) : (
              <ListCells change={change} />
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Legend() {
  return (
    <p className="type-caption text-muted-foreground">
      <span className="font-semibold text-success underline decoration-2 underline-offset-4">
        밑줄
      </span>
      은 추가, <span className="text-destructive line-through decoration-2">취소선</span>은 삭제,
      표시 없음은 유지입니다.
    </p>
  );
}

type EmptyReason = "single" | "first" | "gap" | "no-changes";

function EmptyChanges({
  reason,
  comparison,
}: {
  reason: EmptyReason;
  comparison: RevisionComparison;
}) {
  const detailHref = `/bids/${comparison.bidId}`;
  const link = (href: string, label: string) => (
    <Link href={href} className={cn(buttonVariants({ variant: "outline" }))}>
      {label}
    </Link>
  );
  const copy = {
    single: {
      icon: HistoryIcon,
      title: "처음 수집한 공고입니다. 아직 바뀐 내용이 없습니다.",
      description: undefined,
      action: link(detailHref, "공고 상세로"),
    },
    first: {
      icon: HistoryIcon,
      title: "처음 수집한 기록입니다",
      description: "이전 수집 기록이 없어 비교할 내용이 없습니다.",
      action: link(`${detailHref}/revisions`, "최신 변경 보기"),
    },
    gap: {
      icon: HistoryIcon,
      title: "이전 수집 기록을 찾을 수 없습니다",
      description: `${collectedName(comparison.current.revision - 1)} 기록이 없어 비교할 수 없습니다.`,
      action: link(detailHref, "공고 상세로"),
    },
    "no-changes": {
      icon: CircleDashedIcon,
      title: "표시할 바뀐 항목이 없습니다",
      description: "차수 번호만 바뀌었거나 수집 기록에 바뀐 항목이 남아 있지 않습니다.",
      action: link(detailHref, "공고 상세로"),
    },
  }[reason];
  return (
    <div data-slot="revision-empty" data-reason={reason}>
      <EmptyState {...copy} />
    </div>
  );
}

function reasonOf(comparison: RevisionComparison): EmptyReason | null {
  if (comparison.revisions.length === 1) return "single";
  if (comparison.previous === null) return comparison.current.revision === 1 ? "first" : "gap";
  if (comparison.changes.length === 0) return "no-changes";
  return null;
}

function RevisionRail({ comparison }: { comparison: RevisionComparison }) {
  const { bidId, revisions, current } = comparison;
  return (
    <nav
      data-slot="revision-list"
      aria-labelledby="revision-list-title"
      className="min-w-0 xl:sticky xl:top-18 xl:max-h-[calc(100dvh-5.5rem)] xl:overflow-y-auto rounded-lg border border-border"
    >
      <div className="flex items-baseline gap-2 px-4 pt-4 pb-3">
        <h2 id="revision-list-title" className="type-heading text-foreground">
          수집 기록
        </h2>
        <span className="type-caption text-muted-foreground">{revisions.length}개</span>
      </div>
      <ol className="divide-y divide-border border-t border-border">
        {revisions.map((item) => {
          const selected = item.revision === current.revision;
          const shown = shownChangeCount(item.changedFields);
          return (
            <li key={item.revision}>
              <Link
                href={`/bids/${bidId}/revisions?rev=${item.revision}`}
                data-slot="revision-item"
                data-revision={item.revision}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex flex-col gap-0.5 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50",
                  // 고른 수집 기록은 파스텔 선택색이다(2026-10-28 화면 개편). 올려도 바탕이 회색으로 바뀌지 않게 hover 도 덮는다.
                  selected && "bg-selected hover:bg-selected",
                )}
              >
                <span
                  className={cn(
                    "type-label tabular-nums wrap-anywhere",
                    selected ? "font-semibold text-selected-foreground" : "text-foreground",
                  )}
                >
                  {collectedName(item.revision)} · 차수 {item.amendmentNo ?? "—"}
                </span>
                <span className="type-caption text-muted-foreground">
                  <Kst iso={item.fetchedAt} />
                </span>
                <span className="type-caption text-muted-foreground">
                  {item.revision === 1
                    ? "처음 수집"
                    : shown > 0
                      ? `바뀐 항목 ${shown}개`
                      : "바뀐 항목 없음"}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function Description({ comparison }: { comparison: RevisionComparison }) {
  const { previous, current } = comparison;
  const dash = (value: string | null) => value ?? "—";
  const noAmendment = (previous?.amendmentNo ?? null) === null && current.amendmentNo === null;
  const arrow = (
    <>
      <span aria-hidden="true"> → </span>
      <span className="sr-only"> 에서 </span>
    </>
  );
  return (
    <>
      <span className="tabular-nums">
        {collectedName(previous?.revision ?? current.revision)}
        {previous !== null && (
          <>
            {arrow}
            {collectedName(current.revision)}
          </>
        )}
      </span>
      {!noAmendment && (
        <>
          {" · "}
          <span className="tabular-nums">
            차수 {previous !== null ? dash(previous.amendmentNo) : dash(current.amendmentNo)}
            {previous !== null && (
              <>
                {arrow}
                {dash(current.amendmentNo)}
              </>
            )}
          </span>
        </>
      )}
      {" · 수집 "}
      <Kst iso={current.fetchedAt} />
    </>
  );
}

export function RevisionsView({ comparison }: { comparison: RevisionComparison }) {
  const { bidId, title, previous, current, cancelled, changes } = comparison;
  const reason = reasonOf(comparison);
  const tableRows = changes.filter(
    (change): change is ScalarChange | ListChange => change.kind !== "text",
  );
  const text = changes.find((change): change is TextChange => change.kind === "text");
  return (
    <AppPage
      eyebrow={
        <div className="mb-3 flex flex-col items-start gap-2">
          <Link
            href={`/bids/${bidId}`}
            className={cn(
              "inline-flex items-center gap-1 type-label text-muted-foreground hover:text-foreground",
              TEXT_LINK,
            )}
          >
            <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />
            공고 상세
          </Link>
          <p
            data-slot="revision-bid-title"
            className="type-body font-medium text-foreground wrap-anywhere"
          >
            {title}
          </p>
        </div>
      }
      title={REVISIONS_TITLE}
      description={<Description comparison={comparison} />}
      contentClassName={DETAIL_CONTENT_CLASS}
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] items-start gap-6">
        <div className="flex min-w-0 flex-col gap-6">
          {cancelled && (
            <div data-slot="revision-cancelled">
              <AnalysisBanner analysis={null} bidStatus="CANCELLED" />
            </div>
          )}
          <section
            data-slot="revision-changes"
            aria-labelledby="revision-changes-title"
            className="flex min-w-0 flex-col gap-3"
          >
            <div className="flex items-baseline gap-2">
              <h2 id="revision-changes-title" className="type-heading text-foreground">
                바뀐 항목
              </h2>
              {reason === null && (
                <span className="type-caption text-muted-foreground">{changes.length}개</span>
              )}
            </div>
            {reason !== null || previous === null ? (
              <EmptyChanges reason={reason ?? "gap"} comparison={comparison} />
            ) : (
              <>
                <Legend />
                {tableRows.length > 0 && (
                  <ChangesTable rows={tableRows} previous={previous} current={current} />
                )}
                {text !== undefined && <TextDiff segments={text.segments} />}
              </>
            )}
          </section>
        </div>
        <RevisionRail comparison={comparison} />
      </div>
    </AppPage>
  );
}
