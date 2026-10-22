"use client";
import { SearchIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import { z } from "zod";
import { DemoBadge } from "@/components/bids/status-badge";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkforceResult } from "@/server/workforce";
import { WorkforceResults } from "./workforce-results";
type BidOption = { id: string; title: string; isDemo: boolean };
const optionsPageSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), title: z.string(), isDemo: z.boolean() })),
  pageInfo: z.object({ nextCursor: z.string().nullable() }),
});

export function WorkforceView({
  origin,
  initialOptions,
  initialNextCursor,
  initialResult,
  initialIds,
  initialNotice,
}: {
  origin: "live" | "demo" | "all";
  initialOptions: BidOption[];
  initialNextCursor: string | null;
  initialResult: WorkforceResult | null;
  initialIds: string[];
  initialNotice: string | null;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [optionId, setOptionId] = useState<string | null>(null);
  const [optionsBusy, setOptionsBusy] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BidOption[]>(() =>
    initialIds.map((id) => {
      const loaded = initialResult?.bids.find((bid) => bid.bidId === id);
      return loaded
        ? { id, title: loaded.title, isDemo: loaded.isDemo }
        : (initialOptions.find((bid) => bid.id === id) ?? {
            id,
            title: `공고 ${id.slice(0, 8)}`,
            isDemo: false,
          });
    }),
  );
  const [result, setResult] = useState(initialResult);
  const [notice, setNotice] = useState(initialNotice);
  const [busy, setBusy] = useState(false);
  const picker = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const optionsInFlight = useRef(false);
  const available = options.filter((option) => !selected.some((bid) => bid.id === option.id));
  const matchesResult =
    result?.bids.map((bid) => bid.bidId).join(",") === selected.map((bid) => bid.id).join(",");

  const readOptions = async (more: boolean) => {
    if (optionsInFlight.current) return;
    optionsInFlight.current = true;
    setOptionsBusy(true);
    setOptionsError(null);
    const query = new URLSearchParams({ origin, limit: "20" });
    for (const status of ["OPEN", "AMENDED", "CLOSED", "CANCELLED"]) query.append("status", status);
    const term = more ? appliedSearch : search;
    if (term.trim()) query.set("q", term.trim());
    if (more && nextCursor) query.set("cursor", nextCursor);
    try {
      const response = await fetch(`/api/v1/bids?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("공고 선택 목록을 읽지 못했습니다");
      const page = optionsPageSchema.parse(await response.json());
      setOptions((current) =>
        more
          ? [
              ...current,
              ...page.items.filter((item) => !current.some((known) => known.id === item.id)),
            ]
          : page.items,
      );
      setNextCursor(page.pageInfo.nextCursor);
      setAppliedSearch(term);
      setOptionId(null);
    } catch {
      setOptionsError("공고 선택 목록을 읽지 못했습니다. 검색을 다시 시도해 주세요.");
    } finally {
      optionsInFlight.current = false;
      setOptionsBusy(false);
    }
  };
  const remove = (id: string) => {
    setSelected((current) => current.filter((bid) => bid.id !== id));
    setNotice(null);
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLButtonElement>("[data-workforce-remove]") ?? picker.current
      )?.focus(),
    );
  };
  const simulate = async () => {
    if (inFlight.current || selected.length < 1 || selected.length > 3) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(null);
    setResult(null);
    const query = new URLSearchParams({ bidIds: selected.map((bid) => bid.id).join(",") });
    window.history.replaceState(null, "", `/workforce?${query}`);
    try {
      const response = await fetch(`/api/v1/workforce/simulation?${query}`, { cache: "no-store" });
      if (!response.ok) {
        setNotice(
          response.status === 404
            ? "공고를 찾을 수 없거나 접근할 수 없습니다."
            : `시뮬레이션을 읽지 못했습니다. 다시 조회해 주세요.${response.headers.get("X-Request-Id") ? ` 오류 ID ${response.headers.get("X-Request-Id")}` : ""}`,
        );
        return;
      }
      setResult((await response.json()) as WorkforceResult);
    } catch {
      setNotice("시뮬레이션을 읽지 못했습니다. 연결 상태를 확인하고 다시 조회해 주세요.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <>
      <p className="type-body text-muted-foreground">
        조회 결과는 저장되거나 실제 인력 배정에 반영되지 않습니다.
      </p>
      <section
        aria-label="시뮬레이션 공고 선택"
        className="min-w-0 space-y-4 rounded-lg border border-border p-4"
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void readOptions(false);
          }}
        >
          <Field className="w-72">
            <FieldLabel htmlFor="workforce-search">공고 검색</FieldLabel>
            <Input
              id="workforce-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={100}
              placeholder="공고 제목·기관·공고번호"
            />
          </Field>
          <Button type="submit" variant="outline" disabled={optionsBusy}>
            <SearchIcon aria-hidden className="size-4" />
            검색
          </Button>
        </form>
        <div className="flex flex-wrap items-end gap-3">
          <Field className="min-w-0 w-100">
            <FieldLabel htmlFor="workforce-picker">공고 선택</FieldLabel>
            <Select
              value={optionId}
              disabled={busy || optionsBusy || selected.length === 3}
              items={available.map((item) => ({
                value: item.id,
                label: `${item.isDemo ? "DEMO · " : ""}${item.title}`,
              }))}
              onValueChange={setOptionId}
            >
              <SelectTrigger
                id="workforce-picker"
                ref={picker}
                className="w-full"
                aria-describedby="workforce-selection-help"
              >
                <SelectValue placeholder="공고를 선택하세요" />
              </SelectTrigger>
              <SelectContent className="max-w-120">
                {available.map((option) => (
                  <SelectItem
                    key={option.id}
                    value={option.id}
                    className="whitespace-normal wrap-anywhere"
                  >
                    {option.isDemo ? "DEMO · " : ""}
                    {option.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="outline"
            disabled={!optionId || busy || selected.length === 3}
            onClick={() => {
              const item = available.find((bid) => bid.id === optionId);
              if (item) {
                setSelected((current) => [...current, item]);
                setOptionId(null);
                setNotice(null);
              }
            }}
          >
            추가
          </Button>
          {nextCursor && (
            <Button variant="ghost" disabled={optionsBusy} onClick={() => void readOptions(true)}>
              {optionsBusy ? "불러오는 중…" : "공고 더 보기"}
            </Button>
          )}
        </div>
        {optionsError && (
          <p role="alert" className="type-label text-destructive">
            {optionsError}
          </p>
        )}
        {!optionsBusy && options.length === 0 && (
          <p className="type-body text-muted-foreground">조건에 맞는 공고가 없습니다.</p>
        )}
        <p
          id="workforce-selection-help"
          aria-live="polite"
          className="type-caption text-muted-foreground"
        >
          공고를 1~3건 선택하세요. 현재 {selected.length}건 선택
          {selected.length === 3 ? " · 최대 3건까지 조회할 수 있습니다." : ""}
        </p>
        {selected.length > 0 && (
          <ul className="space-y-2">
            {selected.map((bid) => (
              <li
                key={bid.id}
                className="flex min-w-0 items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="min-w-0 flex-1 type-label wrap-anywhere">{bid.title}</span>
                {bid.isDemo && <DemoBadge dense />}
                <Button
                  data-workforce-remove
                  variant="ghost"
                  size="icon-sm"
                  disabled={busy}
                  aria-label={`${bid.title} 선택 해제`}
                  onClick={() => remove(bid.id)}
                >
                  <XIcon aria-hidden className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button
          disabled={selected.length === 0 || busy}
          aria-describedby="workforce-selection-help"
          onClick={() => void simulate()}
        >
          {busy ? "조회 중…" : "시뮬레이션 조회"}
        </Button>
      </section>
      {notice && (
        <p role="alert" className="type-label text-destructive">
          {notice}
        </p>
      )}
      {busy ? (
        <div role="status" aria-busy="true">
          <span className="sr-only">시뮬레이션을 조회하는 중…</span>
          <Skeleton className="h-64 motion-reduce:animate-none" />
        </div>
      ) : matchesResult && result ? (
        <WorkforceResults result={result} />
      ) : (
        <p className="type-body text-muted-foreground">
          {selected.length
            ? "선택한 공고의 인력 가용성과 기간 충돌을 조회하세요."
            : "공고를 선택하면 인력 가용성과 기간 충돌을 확인할 수 있습니다."}
        </p>
      )}
    </>
  );
}
