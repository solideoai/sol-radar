"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
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
import { REVIEW_FLAG_LABEL } from "@/components/bids/labels";
import type { AnalysisHistoryItem, AnalysisHistoryQuery, Page } from "@/server/bids";
import { AnalysisHistoryFilters, type BidOption } from "./analysis-history-filters";
import { AnalysisComparison } from "./analysis-comparison";
import { comparisonSelection } from "./analysis-query";

export function AnalysisHistoryView({
  initial,
  query,
  querySearch,
  bidOptions,
  notice,
}: {
  initial: Page<AnalysisHistoryItem>;
  query: AnalysisHistoryQuery;
  querySearch: string;
  bidOptions: BidOption[];
  notice: string | null;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const selected = comparisonSelection(params.get("compare"));
  const [comparisonVisible, setComparisonVisible] = useState(selected.ids.length >= 2);
  const [pending, startTransition] = useTransition();
  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.pageInfo.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const select = (ids: string[], restoreFocus = false) => {
    const next = new URLSearchParams(params);
    if (ids.length) next.set("compare", ids.join(","));
    else next.delete("compare");
    window.history.replaceState(null, "", `/analysis${next.size ? `?${next}` : ""}`);
    if (restoreFocus) requestAnimationFrame(() => selectionRef.current?.focus());
  };
  const changeFilters = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(querySearch);
    next.delete("cursor");
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    if (selected.ids.length) next.set("compare", selected.ids.join(","));
    startTransition(() =>
      router.push(`/analysis${next.size ? `?${next}` : ""}`, { scroll: false }),
    );
  };
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setMoreError(null);
    const next = new URLSearchParams(querySearch);
    next.set("cursor", nextCursor);
    try {
      const response = await fetch(`/api/v1/analyses?${next}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          `${body.error?.message ?? "이력을 읽지 못했습니다"} · ${body.error?.code ?? response.status} · ${body.error?.requestId ?? ""}`,
        );
      const page = body as Page<AnalysisHistoryItem>;
      setItems((previous) => [
        ...previous,
        ...page.items.filter((item) => !previous.some((existing) => existing.id === item.id)),
      ]);
      setNextCursor(page.pageInfo.nextCursor);
    } catch (error) {
      setMoreError(error instanceof Error ? error.message : "이력을 읽지 못했습니다");
    } finally {
      setLoadingMore(false);
    }
  };
  const hasFilters = Boolean(query.bidId || query.status || query.recommendation || query.runMode);
  return (
    <>
      <AnalysisHistoryFilters query={query} bidOptions={bidOptions} onChange={changeFilters} />
      {notice && (
        <p role="status" className="type-label text-warning">
          {notice}
        </p>
      )}
      <section
        aria-labelledby="analysis-history-title"
        aria-busy={pending || undefined}
        className="min-w-0 space-y-4"
      >
        <div
          ref={selectionRef}
          tabIndex={-1}
          className="flex flex-wrap items-center justify-between gap-3 outline-none"
        >
          <div>
            <h2 id="analysis-history-title" className="type-heading">
              분석 이력
            </h2>
            <p
              id="analysis-selection-hint"
              aria-live="polite"
              className="type-label text-muted-foreground"
            >
              {selected.ids.length}건 선택 · 최대 4건
              {selected.ids.length < 2 ? " · 2건 이상 선택하세요" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={selected.ids.length === 0 && !selected.notice}
              onClick={() => select([], true)}
            >
              선택 초기화
            </Button>
            <Button
              disabled={selected.ids.length < 2}
              aria-describedby="analysis-selection-hint"
              onClick={() => {
                setComparisonVisible(true);
                requestAnimationFrame(() =>
                  document.getElementById("analysis-comparison-title")?.focus(),
                );
              }}
            >
              선택한 분석 비교
            </Button>
          </div>
        </div>
        {selected.notice && (
          <p role="alert" className="type-label text-warning">
            {selected.notice}
          </p>
        )}
        {selected.ids.length === 4 && (
          <p id="analysis-selection-max" className="type-caption text-muted-foreground">
            최대 4건까지 비교할 수 있습니다. 다른 분석을 고르려면 기존 선택을 해제하세요.
          </p>
        )}
        {selected.ids.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-2 type-caption">
            {selected.ids.map((id) => {
              const item = items.find((value) => value.id === id);
              return (
                <li key={id} className="min-w-0 max-w-80 wrap-anywhere">
                  {item ? `${item.bidTitle} · revision ${item.revision}` : "선택한 분석"}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      select(
                        selected.ids.filter((value) => value !== id),
                        true,
                      )
                    }
                  >
                    선택 해제
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {items.length === 0 ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border p-6">
            <p className="type-body">
              {hasFilters ? "조건에 맞는 분석이 없습니다" : "아직 분석 이력이 없습니다"}
            </p>
            {hasFilters ? (
              <Button
                variant="outline"
                onClick={() =>
                  changeFilters({ bidId: null, status: null, recommendation: null, runMode: null })
                }
              >
                필터 초기화
              </Button>
            ) : (
              <Link
                href="/bids"
                className="type-body underline outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                공고 목록 보기
              </Link>
            )}
          </div>
        ) : (
          <Table className="min-w-200 table-fixed [&_td]:whitespace-normal [&_td]:wrap-anywhere">
            <caption className="sr-only">
              조직 분석 이력. 생성 시각 최신순. DEMO는 데모용 가상 공고입니다.
            </caption>
            <colgroup>
              <col className="w-10" />
              <col />
              <col className="w-28" />
              <col className="w-22" />
              <col className="w-22" />
              <col className="w-36" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {["선택", "공고명", "분석 상태", "SOL Score", "권고", "분석 시각 (KST)"].map(
                  (label) => (
                    <TableHead key={label} scope="col" className="h-auto px-2 py-3">
                      {label}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const checked = selected.ids.includes(item.id);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="p-2 align-top">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!checked && selected.ids.length === 4}
                        aria-describedby={
                          !checked && selected.ids.length === 4
                            ? "analysis-selection-max"
                            : undefined
                        }
                        aria-label={`${item.bidTitle} revision ${item.revision} 비교 선택`}
                        className="size-4 accent-primary focus-visible:ring-3 focus-visible:ring-ring/50"
                        onChange={() =>
                          select(
                            checked
                              ? selected.ids.filter((id) => id !== item.id)
                              : [...selected.ids, item.id],
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="p-2 align-top">
                      <div className="space-y-1">
                        {item.isDemo && <DemoBadge dense />}
                        <Link
                          href={`/bids/${item.bidId}`}
                          className="line-clamp-2 rounded-sm outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {item.bidTitle}
                        </Link>
                        {(item.runMode === "mock" ||
                          item.reviewFlags.includes("MOCK_FALLBACK")) && (
                          <p className="type-caption text-warning">Mock 응답(데모 데이터)</p>
                        )}
                        {item.runMode === "fixture" && (
                          <p className="type-caption text-warning">저장 공고 기반 분석</p>
                        )}
                        {item.errorCode && (
                          <p className="type-caption text-destructive">{item.errorCode}</p>
                        )}
                        {item.reviewFlags.map((flag) => (
                          <p key={flag} className="type-caption text-warning">
                            {REVIEW_FLAG_LABEL[flag]}
                          </p>
                        ))}
                        <details>
                          <summary className="min-h-8 cursor-pointer rounded-sm py-1.5 type-caption text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                            분석 상세 정보
                          </summary>
                          <p className="type-caption">실행 모드 {item.runMode}</p>
                          <p className="type-caption">공고 revision {item.revision}</p>
                          <p className="type-caption">프로필 revision {item.profileRevision}</p>
                          <p className="type-caption">알고리즘 {item.model.algorithmVersion}</p>
                        </details>
                      </div>
                    </TableCell>
                    <TableCell className="p-2 align-top">
                      <StatusBadge kind="analysis" value={item.status} short variant="inline" />
                    </TableCell>
                    <TableCell className="p-2 align-top tabular-nums">
                      {item.solScore ?? "—"}
                    </TableCell>
                    <TableCell className="p-2 align-top">
                      {item.recommendation ? (
                        <StatusBadge
                          kind="recommendation"
                          value={item.recommendation}
                          variant="inline"
                        />
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="p-2 align-top type-caption tabular-nums">
                      {formatKst(item.finishedAt ?? item.queuedAt)}
                      {!item.finishedAt && <p>접수</p>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        {moreError && (
          <p role="alert" className="type-label text-destructive">
            {moreError}
          </p>
        )}
        {nextCursor && (
          <Button
            variant="outline"
            disabled={loadingMore || pending}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "불러오는 중…" : "더 보기"}
          </Button>
        )}
      </section>
      {comparisonVisible && selected.ids.length > 0 && (
        <AnalysisComparison
          key={selected.ids.join(",")}
          ids={selected.ids}
          summaries={items}
          onRemove={(id) =>
            select(
              selected.ids.filter((value) => value !== id),
              true,
            )
          }
        />
      )}
    </>
  );
}
