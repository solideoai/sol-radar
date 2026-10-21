"use client";

import { FilterXIcon, SearchIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useOptimistic, type TransitionStartFunction } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { INCLUDE_CLOSED_LABEL, PROGRAMS_PATH, RESET_FILTERS_LABEL } from "./programs-copy";

// 부처 공고 필터 막대(디자인 스펙 §4.4). BidFilters 와 같은 부품·크기·동작이다.
// 값은 URL 쿼리가 정본이고 기본값은 주소에 적지 않는다. 필터 밖의 다른 쿼리 키는 그대로 둔다.
// 쿼리 키·값은 서버 parseProgramNoticeListQuery 와 같아야 한다: source=bizinfo|mss · q(1~50자) · sort=deadline|published · includeClosed=true.
// 서버가 버리는 값(반복 키·모르는 값·50자 넘는 검색어)은 여기서도 기본으로 보인다(화면 목록과 필터 칸이 어긋나지 않게).

const ALL = "all";
const DEFAULT_SORT = "deadline";
const Q_MAX_LENGTH = 50;
const FILTER_KEYS = ["q", "source", "sort", "includeClosed"] as const;
type FilterKey = (typeof FILTER_KEYS)[number];

type Item = { value: string; label: string };

const SOURCE_ITEMS: Item[] = [
  { value: ALL, label: "전체 (기본)" },
  { value: "bizinfo", label: "기업마당" },
  { value: "mss", label: "중기부" },
];
const SORT_ITEMS: Item[] = [
  { value: DEFAULT_SORT, label: "마감 빠른 순 (기본)" },
  { value: "published", label: "최근 등록 순" },
];

/** 한 번만 온 키의 값. 없거나 반복되면 null(서버도 반복 키를 버린다). */
const single = (params: URLSearchParams, key: FilterKey): string | null => {
  const values = params.getAll(key);
  return values.length === 1 ? values[0] : null;
};

// 알 수 없는 값은 기본으로 본다(서버도 같은 값만 받는다).
const known = (items: Item[], value: string | null, fallback: string): string =>
  value !== null && items.some((item) => item.value === value) ? value : fallback;

const searchTextOf = (params: URLSearchParams): string => {
  const text = single(params, "q")?.trim() ?? "";
  return [...text].length > Q_MAX_LENGTH ? "" : text;
};

export function ProgramFilters({ startTransition }: { startTransition: TransitionStartFunction }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // 이동이 끝나 주소가 바뀌기 전까지도 고른 값을 바로 보인다(서버가 다시 읽는 동안 이전 값으로 튀지 않게).
  const [search, setSearch] = useOptimistic(searchParams.toString());
  const params = new URLSearchParams(search);
  const switchId = useId();
  const labelId = useId();

  const current = {
    q: searchTextOf(params),
    source: known(SOURCE_ITEMS, single(params, "source"), ALL),
    sort: known(SORT_ITEMS, single(params, "sort"), DEFAULT_SORT),
    includeClosed: single(params, "includeClosed") === "true",
  };
  const isDefault =
    current.q === "" &&
    current.source === ALL &&
    current.sort === DEFAULT_SORT &&
    !current.includeClosed;

  // 기본값은 키를 지운다. 필터 밖의 다른 쿼리는 그대로 둔다.
  const go = (changes: Partial<Record<FilterKey, string | null>>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      next.delete(key);
      if (value !== null && value !== undefined) next.append(key, value);
    }
    const query = next.toString();
    startTransition(() => {
      setSearch(query);
      router.push(query ? `${PROGRAMS_PATH}?${query}` : PROGRAMS_PATH, { scroll: false });
    });
  };
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
          key={current.q}
          type="search"
          name="q"
          defaultValue={current.q}
          maxLength={Q_MAX_LENGTH}
          placeholder="소관기관 이름으로 찾기"
          aria-label="소관기관 검색"
          className="pl-9"
        />
      </form>
      <FilterSelect
        id="program-filter-source"
        label="출처"
        items={SOURCE_ITEMS}
        value={current.source}
        onChange={(value) => go({ source: value === ALL ? null : value })}
      />
      <FilterSelect
        id="program-filter-sort"
        label="정렬"
        items={SORT_ITEMS}
        value={current.sort}
        onChange={(value) => go({ sort: value === DEFAULT_SORT ? null : value })}
      />
      {/* 즉시 적용 토글. 높이 40px 이라 items-end 에서 입력칸·선택 칸 아래 선과 맞는다. */}
      <div className="flex h-10 items-center gap-2">
        <Switch
          id={switchId}
          checked={current.includeClosed}
          onCheckedChange={(checked) => go({ includeClosed: checked ? "true" : null })}
          aria-labelledby={labelId}
        />
        <Label id={labelId} htmlFor={switchId} className="text-foreground">
          {INCLUDE_CLOSED_LABEL}
        </Label>
      </div>
      {!isDefault && (
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          <FilterXIcon data-icon="inline-start" />
          {RESET_FILTERS_LABEL}
        </Button>
      )}
    </div>
  );
}

// BidFilters 의 FilterSelect 와 같은 모양이다. 그 파일은 고치지 않으므로 여기 따로 둔다(디자인 스펙 §12.1 Q8, freeze 뒤 공용으로).
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
