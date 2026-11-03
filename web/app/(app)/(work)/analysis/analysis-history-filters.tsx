"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ANALYSIS_STATUS_LABEL, RECOMMENDATION_LABEL } from "@/components/bids/labels";
import type { AnalysisHistoryQuery, BidListItem, Page } from "@/server/bids";

export type BidOption = { id: string; title: string };
function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { value: string; label: string }[];
  onChange(value: string | null): void;
}) {
  const labelId = useId();
  return (
    <div className="min-w-0 space-y-2">
      <span id={labelId} className="block type-label">
        {label}
      </span>
      <Select
        value={value ?? "all"}
        onValueChange={(next) => onChange(next === "all" ? null : next)}
      >
        <SelectTrigger aria-labelledby={labelId} className="w-full">
          <SelectValue>
            {options.find((option) => option.value === value)?.label ?? "전체"}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">전체</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function AnalysisHistoryFilters({
  query,
  bidOptions,
  onChange,
}: {
  query: AnalysisHistoryQuery;
  bidOptions: BidOption[];
  onChange(changes: Record<string, string | null>): void;
}) {
  const [options, setOptions] = useState(bidOptions);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchBids = async () => {
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ origin: "all", limit: "100" });
    for (const status of ["OPEN", "AMENDED", "CLOSED", "CANCELLED"])
      params.append("status", status);
    if (search.trim()) params.set("q", search.trim());
    try {
      const response = await fetch(`/api/v1/bids?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("공고를 검색하지 못했습니다. 다시 시도하세요.");
      const result = (await response.json()) as Page<BidListItem>;
      setOptions((previous) => [
        ...previous.filter((option) => option.id === query.bidId),
        ...result.items
          .filter((item) => item.id !== query.bidId)
          .map(({ id, title }) => ({ id, title })),
      ]);
    } catch {
      setError("공고를 검색하지 못했습니다. 다시 시도하세요.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="분석 이력 필터" className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 md:w-70">
          <FilterSelect
            label="공고"
            value={query.bidId}
            options={options.map(({ id, title }) => ({ value: id, label: title }))}
            onChange={(bidId) => onChange({ bidId })}
          />
        </div>
        <div className="w-44">
          <FilterSelect
            label="분석 상태"
            value={query.status}
            options={Object.entries(ANALYSIS_STATUS_LABEL).map(([value, label]) => ({
              value,
              label: label.long,
            }))}
            onChange={(status) => onChange({ status })}
          />
        </div>
        <div className="w-36">
          <FilterSelect
            label="권고"
            value={query.recommendation}
            options={[
              { value: "BID", label: RECOMMENDATION_LABEL.BID },
              { value: "WATCH", label: RECOMMENDATION_LABEL.WATCH },
              { value: "NO_BID", label: RECOMMENDATION_LABEL.NO_BID },
            ]}
            onChange={(recommendation) => onChange({ recommendation })}
          />
        </div>
        <Button
          variant="outline"
          onClick={() =>
            onChange({ bidId: null, status: null, recommendation: null, runMode: null })
          }
        >
          필터 초기화
        </Button>
      </div>
      {query.runMode && (
        <p className="type-caption text-muted-foreground">
          적용 중:{" "}
          {query.runMode === "live"
            ? "실제 공고·AI"
            : query.runMode === "mock"
              ? "모의 응답 분석"
              : "저장 공고 분석"}
        </p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void searchBids();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="w-70 space-y-1">
          <label htmlFor="analysis-bid-search" className="type-caption text-muted-foreground">
            공고 선택지 검색 (최대 100건)
          </label>
          <Input
            id="analysis-bid-search"
            value={search}
            maxLength={100}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="공고명 검색"
          />
        </div>
        <Button variant="outline" disabled={busy} type="submit">
          {busy ? "검색 중…" : "공고 검색"}
        </Button>
        {error && (
          <p role="alert" className="type-label text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
