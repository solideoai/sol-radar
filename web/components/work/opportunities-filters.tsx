"use client";

import { cn } from "cn";
import { ChevronDownIcon, FilterXIcon, SearchIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useOptimistic, useState, type TransitionStartFunction } from "react";
import { SOURCE_LABELS } from "@/components/bids/source-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ALL_STATUSES,
  EARLY_STAGES,
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STAGES,
} from "@/components/work/opportunities-copy";

type Option = { id: string; name: string };
type Changes = Record<string, string | string[] | null>;

function MultipleFilter({
  id,
  label,
  options,
  values,
  onChange,
  searchable = false,
}: {
  id: string;
  label: string;
  options: Option[];
  values: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const visible = options.filter((option) =>
    option.name.toLowerCase().includes(search.toLowerCase()),
  );
  const selected =
    values.length === 1 ? options.find((option) => option.id === values[0])?.name : null;
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DropdownMenu>
        <DropdownMenuTrigger
          id={id}
          render={<Button variant="outline" className="h-10 w-full justify-between font-normal" />}
        >
          <span className="truncate">
            {values.length === 0 ? "전체" : (selected ?? `${values.length}개 선택`)}
          </span>
          <ChevronDownIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-72">
          {searchable && (
            <div className="p-2">
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label={`${label} 검색`}
                placeholder={`${label} 검색`}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </div>
          )}
          <DropdownMenuCheckboxItem
            checked={values.length === 0}
            onCheckedChange={() => onChange([])}
          >
            전체
          </DropdownMenuCheckboxItem>
          {visible.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={values.includes(option.id)}
              onCheckedChange={() =>
                onChange(
                  values.includes(option.id)
                    ? values.filter((value) => value !== option.id)
                    : [...values, option.id],
                )
              }
            >
              <span className="truncate" title={option.name}>
                {option.name}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {visible.length === 0 && (
            <p className="px-3 py-2 type-label text-muted-foreground">검색 결과가 없습니다</p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </Field>
  );
}

function SingleFilter({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field className="min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items.map((item) => ({ value: item.id, label: item.name }))}
        value={value}
        onValueChange={(next) => {
          if (next !== null) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>
            {(selected: string) => (
              <span className="truncate">{items.find((item) => item.id === selected)?.name}</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

const optionsOf = (record: Record<string, string>): Option[] =>
  Object.entries(record).map(([id, name]) => ({ id, name }));
const RECOMMENDATIONS = [
  { id: "BID", name: "BID" },
  { id: "WATCH", name: "WATCH" },
  { id: "NO_BID", name: "NO-BID" },
];
// 켜진 빠른 선택 버튼(aria-pressed)은 파스텔 선택색이다(2026-10-28 화면 개편). 올려도 바탕이 회색으로 바뀌지 않게 hover 도 덮는다.
// 여러 개 켜는 거르기 칩이라 꺼진 칩은 1px 테두리, 켜진 칩은 테두리를 투명하게 둔다.
const PRESSED =
  "border-transparent bg-selected font-semibold text-selected-foreground hover:bg-selected hover:text-selected-foreground";

export function OpportunityFilters({
  query,
  defaultOrigin,
  agencies,
  companies,
  startTransition,
}: {
  query: string;
  defaultOrigin: "live" | "demo" | "all";
  agencies: Option[];
  companies: Option[];
  startTransition: TransitionStartFunction;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useOptimistic(query);
  const params = new URLSearchParams(search);
  const sourceFamilies = params.getAll("sourceFamily");
  const selectedStages = params.getAll("stage");
  const siAiFirst = params.get("siAiFirst") !== "false";
  const includeEarly = params.get("includeEarly") === "true";
  const statuses = params.getAll("status");
  const status =
    statuses.length === 4
      ? "all"
      : statuses.length === 1 && statuses[0] === "CLOSED"
        ? "closed"
        : statuses.length === 1 && statuses[0] === "CANCELLED"
          ? "cancelled"
          : statuses.includes("CANCELLED")
            ? "withCancelled"
            : "active";
  const go = (changes: Changes) => {
    const next = new URLSearchParams(search);
    for (const key of ["cursor", "limit", "asOf"]) next.delete(key);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value === null) continue;
      for (const item of typeof value === "string" ? [value] : value) next.append(key, item);
    }
    if (pathname === "/watchlist") next.delete("watched");
    const nextQuery = next.toString();
    startTransition(() => {
      setSearch(nextQuery);
      router.push(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    });
  };
  const multiple = (key: string, values: string[]) =>
    go({ [key]: values.length === 0 ? null : values });
  const isDefault =
    !params.get("q") &&
    sourceFamilies.length === 0 &&
    params.getAll("agencyId").length === 0 &&
    params.getAll("companyId").length === 0 &&
    selectedStages.length === 0 &&
    status === "active" &&
    params.getAll("recommendation").length === 0 &&
    params.getAll("decision").length === 0 &&
    params.getAll("category").length === 0 &&
    siAiFirst &&
    !includeEarly &&
    (params.get("origin") ?? defaultOrigin) === defaultOrigin &&
    !params.get("sort");
  return (
    <section
      aria-label="입찰 공고 검색 조건"
      className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="opportunity-si-ai"
          className="flex min-h-9 min-w-52 cursor-pointer items-center gap-3 type-label font-medium"
        >
          <Switch
            id="opportunity-si-ai"
            checked={siAiFirst}
            onCheckedChange={(checked) => go({ siAiFirst: checked ? null : "false" })}
          />
          공공 SI·AI 우선
        </label>
        <div role="group" aria-label="수집 출처 빠른 선택" className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-pressed={sourceFamilies.length === 0}
            className={cn("min-w-20", sourceFamilies.length === 0 && PRESSED)}
            onClick={() => multiple("sourceFamily", [])}
          >
            전체
          </Button>
          {Object.entries(SOURCE_LABELS).map(([family, label]) => (
            <Button
              key={family}
              variant="outline"
              size="sm"
              aria-pressed={sourceFamilies.includes(family)}
              className={cn("min-w-20", sourceFamilies.includes(family) && PRESSED)}
              onClick={() =>
                multiple(
                  "sourceFamily",
                  sourceFamilies.includes(family)
                    ? sourceFamilies.filter((value) => value !== family)
                    : [...sourceFamilies, family],
                )
              }
            >
              {label}
            </Button>
          ))}
        </div>
        <div className="w-40">
          <MultipleFilter
            id="opportunity-agency-quick"
            label="기관 선택"
            options={agencies}
            values={params.getAll("agencyId")}
            onChange={(values) => multiple("agencyId", values)}
            searchable
          />
        </div>
        <label
          htmlFor="opportunity-early"
          className="flex min-h-9 min-w-56 cursor-pointer items-center gap-3 type-label"
        >
          <Switch
            id="opportunity-early"
            checked={includeEarly}
            onCheckedChange={(checked) =>
              go({
                includeEarly: checked ? "true" : null,
                stage: checked
                  ? selectedStages
                  : selectedStages.filter((value) => !EARLY_STAGES.includes(value)),
              })
            }
          />
          Early Opportunity 포함
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <form
          role="search"
          className="min-w-60 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            const value = new FormData(event.currentTarget).get("q");
            const text = typeof value === "string" ? value.trim() : "";
            go({ q: text || null });
          }}
        >
          <Field>
            <FieldLabel htmlFor="opportunity-search">검색</FieldLabel>
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
              />
              <Input
                id="opportunity-search"
                key={params.get("q") ?? ""}
                name="q"
                type="search"
                maxLength={100}
                defaultValue={params.get("q") ?? ""}
                placeholder="제목·기관·공고번호"
                className="pl-9"
              />
            </div>
          </Field>
        </form>
        <div className="w-32">
          <MultipleFilter
            id="opportunity-source"
            label="출처"
            options={optionsOf(SOURCE_LABELS)}
            values={sourceFamilies}
            onChange={(values) => multiple("sourceFamily", values)}
          />
        </div>
        <div className="w-40">
          <MultipleFilter
            id="opportunity-agency"
            label="기관"
            options={agencies}
            values={params.getAll("agencyId")}
            onChange={(values) => multiple("agencyId", values)}
            searchable
          />
        </div>
        <div className="w-32">
          <MultipleFilter
            id="opportunity-stage"
            label="단계"
            options={optionsOf(OPPORTUNITY_STAGES)}
            values={selectedStages}
            onChange={(values) =>
              go({
                stage: values,
                ...(values.some((value) => EARLY_STAGES.includes(value))
                  ? { includeEarly: "true" }
                  : {}),
              })
            }
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <SingleFilter
            id="opportunity-status"
            label="상태"
            value={status}
            items={[
              { id: "active", name: "진행 중 (기본)" },
              { id: "all", name: "전체" },
              { id: "closed", name: "마감" },
              { id: "withCancelled", name: "취소 포함" },
              { id: "cancelled", name: "취소됨" },
            ]}
            onChange={(value) =>
              go({
                status:
                  value === "all"
                    ? ALL_STATUSES
                    : value === "closed"
                      ? ["CLOSED"]
                      : value === "cancelled"
                        ? ["CANCELLED"]
                        : value === "withCancelled"
                          ? ["OPEN", "AMENDED", "CANCELLED"]
                          : null,
              })
            }
          />
        </div>
        <div className="w-32">
          <MultipleFilter
            id="opportunity-recommendation"
            label="권고"
            options={RECOMMENDATIONS}
            values={params.getAll("recommendation")}
            onChange={(values) => multiple("recommendation", values)}
          />
        </div>
        <div className="w-36">
          <MultipleFilter
            id="opportunity-category"
            label="분야"
            options={optionsOf(OPPORTUNITY_CATEGORIES)}
            values={params.getAll("category")}
            onChange={(values) => multiple("category", values)}
          />
        </div>
        <div className="w-32">
          <MultipleFilter
            id="opportunity-decision"
            label="최종 결정"
            options={[...RECOMMENDATIONS, { id: "NONE", name: "미결정" }]}
            values={params.getAll("decision")}
            onChange={(values) => multiple("decision", values)}
          />
        </div>
        {companies.length > 0 && (
          <div className="w-40">
            <MultipleFilter
              id="opportunity-company"
              label="KEPCO 회사 구분"
              options={companies}
              values={params.getAll("companyId")}
              onChange={(values) => multiple("companyId", values)}
              searchable
            />
          </div>
        )}
        <div className="w-36">
          <SingleFilter
            id="opportunity-origin"
            label="데이터 구분"
            value={params.get("origin") ?? defaultOrigin}
            items={[
              { id: "live", name: "실제 공고" },
              { id: "demo", name: "데모 공고" },
              { id: "all", name: "전체" },
            ]}
            onChange={(value) => go({ origin: value === defaultOrigin ? null : value })}
          />
        </div>
        <div className="w-40">
          <SingleFilter
            id="opportunity-sort"
            label="정렬"
            value={params.get("sort") ?? "publishedAt:desc"}
            items={[
              { id: "publishedAt:desc", name: "최근 공고 순" },
              { id: "deadlineAt:asc", name: "마감 빠른 순" },
              { id: "score:desc", name: "점수 높은 순" },
              { id: "budgetKrw:desc", name: "예산 높은 순" },
            ]}
            onChange={(value) => go({ sort: value === "publishedAt:desc" ? null : value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="type-caption text-muted-foreground">
          공공 SI·AI 우선은 표시 순서만 바꾸며 공고를 숨기지 않습니다.
        </p>
        {!isDefault && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => startTransition(() => router.push(pathname, { scroll: false }))}
          >
            <FilterXIcon aria-hidden className="size-4" />
            필터 초기화
          </Button>
        )}
      </div>
    </section>
  );
}
