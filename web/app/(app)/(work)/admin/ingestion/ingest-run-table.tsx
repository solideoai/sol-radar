"use client";

import { cn } from "cn";
import { formatKst } from "@/components/bids/format";
import { StatusBadge } from "@/components/bids/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCount, formatDuration, shortRunId } from "./ingest-format";
import type { AcceptedRun } from "./ingest-runs";
import { runModeLabel, sourceWithBatch, triggerLabel, type IngestRun } from "./ingestion-copy";

// 실행 이력 표(N8 스펙 §4.5). 최근 실행이 위다(정렬을 바꾸는 단추 없음). 행마다 초점을 받는 것은 시작 시각 단추 하나다.
// 행 전체 클릭은 두지 않는다(/bids 제목 링크와 같다). 접수 행(화면 전용)은 숫자를 비운다.

const EMPTY = "—";

type SummaryKey = keyof IngestRun["summary"];

const COUNT_COLUMNS = [
  { key: "created", label: "신규" },
  { key: "changed", label: "변경" },
  { key: "cancelled", label: "취소" },
  { key: "skippedDuplicate", label: "중복" },
  { key: "quarantined", label: "격리" },
  { key: "retried", label: "재시도" },
] as const satisfies readonly { key: SummaryKey; label: string }[];

// 숫자 칸 72px(여백 포함). 6칸 합 432px, 시작 152·상태 112, 나머지는 소스·방식(1280·펼침 264px).
const COUNT_CELL = "w-[72px] text-right tabular-nums";

export type TableRowItem = { run: IngestRun; pending: boolean };

export const toTableRows = (
  pending: readonly AcceptedRun[],
  rows: readonly IngestRun[],
): TableRowItem[] => [
  ...pending.map((entry) => ({ run: entry.run, pending: true })),
  ...rows.map((run) => ({ run, pending: false })),
];

function Count({ value }: { value: number }) {
  const { text, full } = formatCount(value);
  const isCompact = text !== full;
  return (
    <span
      className={cn(value === 0 && "text-muted-foreground")}
      title={isCompact ? full : undefined}
    >
      {isCompact ? (
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{full}</span>
        </>
      ) : (
        text
      )}
    </span>
  );
}

function StartCell({ item, onOpen }: { item: TableRowItem; onOpen: (id: string) => void }) {
  const { run, pending } = item;
  const startedText = formatKst(run.startedAt);
  const id8 = shortRunId(run.id);
  const duration = pending
    ? EMPTY
    : run.status === "RUNNING"
      ? "실행 중"
      : (formatDuration(run.startedAt, run.finishedAt) ?? EMPTY);
  return (
    <div className="flex flex-col items-start gap-0.5">
      {/* 보이는 글자(시작 시각)로 이름을 시작한다(WCAG 2.5.3). */}
      <Button
        type="button"
        variant="link"
        className="h-auto p-0 tabular-nums"
        aria-label={`${startedText} 시작 수집 실행 ${id8} 자세히 보기`}
        aria-haspopup="dialog"
        onClick={() => onOpen(run.id)}
      >
        <time dateTime={run.startedAt} title={run.startedAt}>
          {startedText}
        </time>
      </Button>
      <span className="type-caption text-muted-foreground">{duration}</span>
    </div>
  );
}

export function IngestRunTable({
  items,
  onOpen,
  footer,
}: {
  items: TableRowItem[];
  onOpen: (id: string) => void;
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <Table className="table-fixed">
        <caption className="sr-only">수집 실행 이력. 최근 실행이 위에 있습니다.</caption>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="w-[152px]">
              시작
            </TableHead>
            <TableHead scope="col" className="w-[112px]">
              상태
            </TableHead>
            <TableHead scope="col">소스·방식</TableHead>
            {COUNT_COLUMNS.map((column) => (
              <TableHead key={column.key} scope="col" className={COUNT_CELL}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const { run, pending } = item;
            const method = `${runModeLabel(run.runMode)} · ${triggerLabel(run)}`;
            return (
              <TableRow key={run.id} className="h-11 align-top">
                <TableCell className="align-top">
                  <StartCell item={item} onOpen={onOpen} />
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-col items-start gap-0.5">
                    <StatusBadge
                      kind="ingestRun"
                      value={pending ? "PENDING" : run.status}
                      short
                      variant="inline"
                    />
                    <span className="font-mono type-caption text-muted-foreground">
                      {shortRunId(run.id)}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="overflow-hidden align-top">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate type-body">{sourceWithBatch(run, true)}</span>
                    <span className="truncate type-caption text-muted-foreground" title={method}>
                      {method}
                    </span>
                  </div>
                </TableCell>
                {COUNT_COLUMNS.map((column) => (
                  <TableCell key={column.key} className={cn(COUNT_CELL, "align-top type-body")}>
                    {pending ? (
                      <span className="text-muted-foreground">{EMPTY}</span>
                    ) : (
                      <Count value={run.summary[column.key]} />
                    )}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {footer}
    </div>
  );
}
