"use client";

import { FilterXIcon, SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  startTransition as defaultStartTransition,
  useOptimistic,
  type TransitionStartFunction,
} from "react";
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

// 스펙 §5.3 필터 막대. 값은 URL 쿼리가 정본이고 기본값은 주소에 적지 않는다.
// 쿼리 키(q·stage·status·recommendation·decision·origin·sort)는 /bids 서버 화면과 같아야 한다.
// 필터를 바꾸면 cursor 를 지운다(05 §3).

const ALL = "all";
const DEFAULT_SORT = "publishedAt:desc";
const FILTER_KEYS = [
  "q",
  "stage",
  "status",
  "recommendation",
  "decision",
  "origin",
  "sort",
] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

// ADR-029 A7: 기본은 진행 중(OPEN·AMENDED)이라 키를 적지 않는다. "취소 포함"은 세 값을 모두 적는다.
const ACTIVE = "active";
const WITH_CANCELLED = "withCancelled";
const WITH_CANCELLED_STATUS = ["OPEN", "AMENDED", "CANCELLED"] as const;

type Origin = "demo" | "live";
type Item = { value: string; label: string };

const STAGE_ITEMS: Item[] = [
  { value: ALL, label: "전체" },
  { value: "PLAN", label: "발주계획" },
  { value: "PRE_SPEC", label: "사전규격" },
  { value: "NOTICE", label: "입찰공고" },
];
const RECOMMENDATION_ITEMS: Item[] = [
  { value: ALL, label: "전체" },
  { value: "BID", label: "BID" },
  { value: "WATCH", label: "WATCH" },
  { value: "NO_BID", label: "NO-BID" },
];
const DECISION_ITEMS: Item[] = [...RECOMMENDATION_ITEMS, { value: "NONE", label: "미결정" }];
const STATUS_ITEMS: Item[] = [
  { value: ACTIVE, label: "진행 중 (기본)" },
  { value: WITH_CANCELLED, label: "취소 포함" },
];
const SORT_ITEMS: Item[] = [
  { value: DEFAULT_SORT, label: "최근 공고 순" },
  { value: "score:desc", label: "점수 높은 순" },
  { value: "deadlineAt:asc", label: "마감 빠른 순" },
];
const originItems = (defaultOrigin: Origin): Item[] =>
  [
    { value: "demo", label: "데모 공고" },
    { value: "live", label: "실제 공고" },
    { value: "all", label: "전체" },
  ].map((item) =>
    item.value === defaultOrigin ? { ...item, label: `${item.label} (기본)` } : item,
  );

// 알 수 없는 값은 기본으로 본다(서버도 같은 값만 받는다).
const known = (items: Item[], value: string | null, fallback: string): string =>
  items.some((item) => item.value === value) && value !== null ? value : fallback;

type BidFiltersProps = {
  defaultOrigin: Origin;
  /**
   * 주소 이동을 감쌀 전환. 목록 화면이 넘기면 서버가 다시 읽는 동안 그 전환의 대기 상태로 표를 흐리게 한다.
   * 없으면 React 의 startTransition 을 쓴다.
   */
  startTransition?: TransitionStartFunction;
};

function BidFilters({ defaultOrigin, startTransition = defaultStartTransition }: BidFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // 이동이 끝나 주소가 바뀌기 전까지도 고른 값을 바로 보인다(서버가 다시 읽는 동안 이전 값으로 튀지 않게).
  const [search, setSearch] = useOptimistic(searchParams.toString());
  const params = new URLSearchParams(search);

  const origins = originItems(defaultOrigin);
  const q = params.get("q") ?? "";
  const current = {
    stage: known(STAGE_ITEMS, params.get("stage"), ALL),
    status: params.getAll("status").includes("CANCELLED") ? WITH_CANCELLED : ACTIVE,
    recommendation: known(RECOMMENDATION_ITEMS, params.get("recommendation"), ALL),
    decision: known(DECISION_ITEMS, params.get("decision"), ALL),
    origin: known(origins, params.get("origin"), defaultOrigin),
    sort: known(SORT_ITEMS, params.get("sort"), DEFAULT_SORT),
  };
  const isDefault =
    q === "" &&
    current.stage === ALL &&
    current.status === ACTIVE &&
    current.recommendation === ALL &&
    current.decision === ALL &&
    current.origin === defaultOrigin &&
    current.sort === DEFAULT_SORT;

  // 기본값은 키를 지운다. cursor 는 늘 지운다. 필터 밖의 다른 쿼리는 그대로 둔다.
  const go = (changes: Partial<Record<FilterKey, string | readonly string[] | null>>) => {
    const next = new URLSearchParams(search);
    next.delete("cursor");
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value === null || value === undefined) continue;
      for (const item of typeof value === "string" ? [value] : value) next.append(key, item);
    }
    const query = next.toString();
    startTransition(() => {
      setSearch(query);
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };
  const pick = (key: "stage" | "recommendation" | "decision", value: string) =>
    go({ [key]: value === ALL ? null : value });

  const reset = () => go(Object.fromEntries(FILTER_KEYS.map((key) => [key, null])));

  return (
    <div className="flex flex-wrap items-end gap-3">
      <form
        role="search"
        className="relative w-60"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          const text = typeof value === "string" ? value.trim() : "";
          go({ q: text === "" ? null : text });
        }}
      >
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        {/* 주소의 q 가 바뀌면(초기화·뒤로 가기) 입력칸도 새로 그린다. */}
        <Input
          key={q}
          type="search"
          name="q"
          defaultValue={q}
          maxLength={100}
          placeholder="제목·기관·공고번호"
          aria-label="공고 검색"
          className="pl-9"
        />
      </form>
      <FilterSelect
        id="bid-filter-stage"
        label="단계"
        items={STAGE_ITEMS}
        value={current.stage}
        onChange={(value) => pick("stage", value)}
      />
      <FilterSelect
        id="bid-filter-status"
        label="상태"
        items={STATUS_ITEMS}
        value={current.status}
        onChange={(value) =>
          go({ status: value === WITH_CANCELLED ? WITH_CANCELLED_STATUS : null })
        }
      />
      <FilterSelect
        id="bid-filter-recommendation"
        label="권고"
        items={RECOMMENDATION_ITEMS}
        value={current.recommendation}
        onChange={(value) => pick("recommendation", value)}
      />
      <FilterSelect
        id="bid-filter-decision"
        label="결정"
        items={DECISION_ITEMS}
        value={current.decision}
        onChange={(value) => pick("decision", value)}
      />
      <FilterSelect
        id="bid-filter-origin"
        label="출처"
        items={origins}
        value={current.origin}
        onChange={(value) => go({ origin: value === defaultOrigin ? null : value })}
      />
      <FilterSelect
        id="bid-filter-sort"
        label="정렬"
        items={SORT_ITEMS}
        value={current.sort}
        onChange={(value) => go({ sort: value === DEFAULT_SORT ? null : value })}
      />
      {!isDefault && (
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          <FilterXIcon data-icon="inline-start" />
          필터 초기화
        </Button>
      )}
    </div>
  );
}

function FilterSelect({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: Item[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field className="w-auto min-w-0">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => {
          if (next !== null && next !== value) onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-36">
          <SelectValue>
            {(selected: string) => (
              <span className="truncate">
                {items.find((item) => item.value === selected)?.label}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              <span className="truncate">{item.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export { BidFilters };
