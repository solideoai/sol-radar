"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DemoBadge, StatusBadge } from "@/components/bids/status-badge";
import { formatKst } from "@/components/bids/format";
import { FACTOR_LABEL, MISSING_REASON_LABEL, REVIEW_FLAG_LABEL } from "@/components/bids/labels";
import type { AnalysisHistoryItem, AnalysisView, FactorKey } from "@/server/bids";
import { BIDS_DESCRIPTION } from "@/app/(app)/(work)/bids/bids-copy";

type Loaded = { view: AnalysisView; title: string; isDemo: boolean };
type ColumnState = { kind: "loaded"; value: Loaded } | { kind: "error"; message: string };
const FACTORS: FactorKey[] = [
  "skillMatch",
  "pastPerformance",
  "staffAvailability",
  "scaleFit",
  "strategicPreference",
];
const textLink =
  "rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

async function readColumn(
  id: string,
  summaries: AnalysisHistoryItem[],
  signal?: AbortSignal,
): Promise<Loaded> {
  const response = await fetch(`/api/v1/analyses/${id}`, { signal, cache: "no-store" });
  if (!response.ok) {
    const body = (await response.json()) as {
      error?: { message?: string; code?: string; requestId?: string };
    };
    throw new Error(
      response.status === 404
        ? "분석을 찾을 수 없거나 접근할 수 없습니다"
        : `${body.error?.message ?? "분석을 읽지 못했습니다"} · ${body.error?.code ?? response.status} · ${body.error?.requestId ?? ""}`,
    );
  }
  const view = (await response.json()) as AnalysisView;
  const summary = summaries.find((item) => item.id === id);
  if (summary) return { view, title: summary.bidTitle, isDemo: summary.isDemo };
  // 공유 URL의 분석이 현재 이력 페이지 밖에 있어도 공고 이름과 DEMO를 확인한다.
  const bidResponse = await fetch(`/api/v1/bids/${view.bidId}`, { signal, cache: "no-store" });
  if (!bidResponse.ok) throw new Error("공고 정보를 읽지 못했습니다. 다시 시도하세요.");
  const bid = (await bidResponse.json()) as { title: string; isDemo: boolean };
  return { view, title: bid.title, isDemo: bid.isDemo };
}

function FactorValue({ view, factor }: { view: AnalysisView; factor: FactorKey }) {
  const value = view.scoreBreakdown.find((item) => item.factor === factor);
  if (!value) return <span>—</span>;
  return (
    <div className="space-y-1">
      <p className="tabular-nums">
        {value.points} / {value.maxPoints}
      </p>
      {value.missing && (
        <p className="type-caption text-warning">
          정보 부족 ·{" "}
          {value.missingReason ? MISSING_REASON_LABEL[value.missingReason] : "근거 확인 필요"}
        </p>
      )}
      {value.note && <p className="type-caption text-muted-foreground">{value.note}</p>}
    </div>
  );
}

function QualificationValue({ view }: { view: AnalysisView }) {
  if (view.status !== "COMPLETED" && view.status !== "PARTIAL") return <span>—</span>;
  return (
    <div className="space-y-2">
      <StatusBadge kind="qualification" value={view.qualification.status} variant="inline" />
      {view.qualification.checks.length > 0 && (
        <details>
          <summary className="cursor-pointer type-caption">
            검사 항목 {view.qualification.checks.length}건
          </summary>
          <ul className="mt-2 space-y-3">
            {view.qualification.checks.map((check) => (
              <li key={check.id} className="space-y-1">
                <p>
                  {check.requirementName}
                  {check.mandatory ? " · 필수" : ""}
                </p>
                <StatusBadge kind="qualification" value={check.outcome} variant="inline" />
                <p className="type-caption text-muted-foreground">{check.reason}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function AttentionValue({ view }: { view: AnalysisView }) {
  return (
    <div className="space-y-1">
      {view.errorCode && <p className="type-caption text-destructive">{view.errorCode}</p>}
      {view.fallbackReason && (
        <p className="type-caption text-warning">
          {view.fallbackReason === "QWEN_UNAVAILABLE"
            ? "추출 모델 사용 불가"
            : "결정 모델 사용 불가"}
        </p>
      )}
      {view.reviewFlags.map((flag) => (
        <p key={flag} className="type-caption">
          {REVIEW_FLAG_LABEL[flag]}
        </p>
      ))}
      {!view.errorCode && !view.fallbackReason && view.reviewFlags.length === 0 && "없음"}
    </div>
  );
}

type CompareRow = { label: string; content(view: AnalysisView): React.ReactNode };
const rows: CompareRow[] = [
  {
    label: "분석 상태",
    content: (view) => <StatusBadge kind="analysis" value={view.status} variant="inline" />,
  },
  {
    label: "SOL Score",
    content: (view) => (view.solScore === null ? "—" : `${view.solScore} / 100`),
  },
  {
    label: "권고",
    content: (view) =>
      view.recommendation ? (
        <StatusBadge kind="recommendation" value={view.recommendation} variant="inline" />
      ) : (
        "—"
      ),
  },
  ...FACTORS.map((factor) => ({
    label: FACTOR_LABEL[factor],
    content: (view: AnalysisView) => <FactorValue view={view} factor={factor} />,
  })),
  { label: "자격 판정", content: (view) => <QualificationValue view={view} /> },
  {
    label: "분석 시각 (KST)",
    content: (view) =>
      `${formatKst(view.finishedAt ?? view.queuedAt)}${view.finishedAt ? "" : " · 접수"}`,
  },
  { label: "주의 사항·실패 사유", content: (view) => <AttentionValue view={view} /> },
];

const technicalRows: CompareRow[] = [
  { label: "공고 revision", content: (view) => view.revision },
  { label: "회사 프로필 revision", content: (view) => view.profileRevision },
  { label: "알고리즘 버전", content: (view) => view.model.algorithmVersion },
  { label: "실행 모드", content: (view) => view.runMode },
];

export function AnalysisComparison({
  ids,
  summaries,
  onRemove,
}: {
  ids: string[];
  summaries: AnalysisHistoryItem[];
  onRemove(id: string): void;
}) {
  const [columns, setColumns] = useState<Record<string, ColumnState>>({});
  const selectionKey = ids.join(",");
  useEffect(() => {
    const controller = new AbortController();
    for (const id of selectionKey.split(",").filter(Boolean)) {
      void readColumn(id, summaries, controller.signal).then(
        (value) => {
          if (!controller.signal.aborted)
            setColumns((previous) => ({ ...previous, [id]: { kind: "loaded", value } }));
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setColumns((previous) => ({
              ...previous,
              [id]: {
                kind: "error",
                message: error instanceof Error ? error.message : "분석을 읽지 못했습니다",
              },
            }));
        },
      );
    }
    return () => controller.abort();
  }, [selectionKey, summaries]);
  const retry = async (id: string) => {
    setColumns((previous) =>
      Object.fromEntries(Object.entries(previous).filter(([key]) => key !== id)),
    );
    try {
      const value = await readColumn(id, summaries);
      setColumns((previous) => ({ ...previous, [id]: { kind: "loaded", value } }));
    } catch (error) {
      setColumns((previous) => ({
        ...previous,
        [id]: {
          kind: "error",
          message: error instanceof Error ? error.message : "분석을 읽지 못했습니다",
        },
      }));
    }
  };
  const loaded = ids.flatMap((id) =>
    columns[id]?.kind === "loaded" ? [columns[id].value.view] : [],
  );
  const differs =
    ["revision", "profileRevision", "runMode"].some(
      (key) =>
        new Set(loaded.map((view) => view[key as "revision" | "profileRevision" | "runMode"]))
          .size > 1,
    ) || new Set(loaded.map((view) => view.model.algorithmVersion)).size > 1;
  return (
    <section aria-labelledby="analysis-comparison-title" className="min-w-0 space-y-4">
      <h2 id="analysis-comparison-title" tabIndex={-1} className="type-heading outline-none">
        선택한 분석 비교
      </h2>
      {ids.length === 1 && (
        <p className="type-label text-muted-foreground">비교하려면 한 건을 더 선택하세요.</p>
      )}
      {differs && (
        <p className="rounded-lg border border-warning p-3 type-label text-warning">
          비교 기준이 다릅니다. 각 분석의 입력과 실행 모드를 확인하세요.
        </p>
      )}
      <Table className="table-fixed [&_td]:wrap-anywhere [&_td]:whitespace-normal [&_th]:wrap-anywhere [&_th]:whitespace-normal">
        <caption className="sr-only">저장된 분석 결과 비교</caption>
        <colgroup>
          <col className="w-40" />
          {ids.map((id) => (
            <col key={id} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead scope="col" className="h-auto p-3 align-top">
              비교 항목
            </TableHead>
            {ids.map((id) => {
              const state = columns[id];
              return (
                <TableHead
                  scope="col"
                  key={id}
                  className="h-auto p-3 align-top font-normal text-foreground"
                >
                  <div className="space-y-2">
                    {state?.kind === "loaded" ? (
                      <>
                        {state.value.isDemo && <DemoBadge dense />}
                        {(state.value.view.runMode === "mock" ||
                          state.value.view.model.provider === "mock") && (
                          <p className="type-caption text-warning">Mock 응답(데모 데이터)</p>
                        )}
                        {state.value.view.runMode === "fixture" && (
                          <p className="type-caption text-warning">저장 공고 기반 분석</p>
                        )}
                        <Link className={textLink} href={`/bids/${state.value.view.bidId}`}>
                          {state.value.title}
                        </Link>
                      </>
                    ) : state?.kind === "error" ? (
                      <div role="alert" className="space-y-2">
                        <p className="type-label text-destructive">{state.message}</p>
                        <Button variant="outline" size="sm" onClick={() => void retry(id)}>
                          다시 시도
                        </Button>
                      </div>
                    ) : (
                      <div role="status">
                        <Skeleton className="h-5 w-full motion-reduce:animate-none" />
                        <span className="sr-only">분석 불러오는 중</span>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${state?.kind === "loaded" ? state.value.title : "분석"} 비교 선택 해제`}
                      onClick={() => onRemove(id)}
                    >
                      선택 해제
                    </Button>
                  </div>
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.label} className="hover:bg-transparent">
              <th scope="row" className="p-3 text-left align-top type-label font-medium">
                {row.label}
              </th>
              {ids.map((id) => (
                <TableCell key={id} className="p-3 align-top tabular-nums">
                  {columns[id]?.kind === "loaded" ? row.content(columns[id].value.view) : "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <details>
        <summary className="min-h-8 cursor-pointer rounded-sm py-1.5 type-label outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          비교 기준
        </summary>
        <Table className="table-fixed [&_td]:wrap-anywhere [&_td]:whitespace-normal [&_th]:wrap-anywhere [&_th]:whitespace-normal">
          <caption className="sr-only">선택한 분석의 비교 기준</caption>
          <colgroup>
            <col className="w-40" />
            {ids.map((id) => (
              <col key={id} />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">비교 항목</TableHead>
              {ids.map((id) => (
                <TableHead key={id} scope="col" className="h-auto p-3">
                  {columns[id]?.kind === "loaded" ? columns[id].value.title : "분석"}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {technicalRows.map((row) => (
              <TableRow key={row.label}>
                <th scope="row" className="p-3 text-left align-top type-label font-medium">
                  {row.label}
                </th>
                {ids.map((id) => (
                  <TableCell key={id} className="p-3 align-top tabular-nums">
                    {columns[id]?.kind === "loaded" ? row.content(columns[id].value.view) : "—"}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
      <p className="type-caption text-muted-foreground">
        {loaded[0]?.disclaimer ?? BIDS_DESCRIPTION}
      </p>
    </section>
  );
}
