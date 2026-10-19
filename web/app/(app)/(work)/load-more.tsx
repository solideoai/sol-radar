"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// 커서 목록의 "더 보기"(스펙 §5.3 더 보기·더 보기 실패). 공고 목록과 알림 목록이 같이 쓴다.
// 05 §3 커서 페이지 응답 {items, pageInfo{cursor,nextCursor,hasNext}} 를 읽어 아래에 붙인다.
// 커서가 무효(400 INVALID_CURSOR: 목록 조건이나 정렬 값이 바뀌었다)면 이어 읽을 수 없으니 처음부터 다시 읽게 하고,
// 그 밖의 실패는 같은 커서로 다시 시도하게 한다.

export type LoadMoreStatus = "idle" | "loading" | "failed" | "invalid-cursor";

type Identified = { id: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const errorCodeOf = (body: unknown): string | null =>
  isRecord(body) && isRecord(body.error) && typeof body.error.code === "string"
    ? body.error.code
    : null;

// 화면에서 쓰는 두 칸(items·pageInfo.nextCursor)만 확인한다. 항목 모양은 같은 서버의 05 DTO 를 믿는다.
function pageOf<T>(body: unknown): { items: T[]; nextCursor: string | null } | null {
  if (!isRecord(body) || !Array.isArray(body.items) || !isRecord(body.pageInfo)) return null;
  const { nextCursor } = body.pageInfo;
  if (nextCursor !== null && typeof nextCursor !== "string") return null;
  return { items: body.items as T[], nextCursor };
}

const withCursor = (endpoint: string, cursor: string): string =>
  `${endpoint}${endpoint.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;

// 같은 공고가 두 쪽에 걸쳐 오면(그사이 정렬 값이 바뀐 경우) 처음 것만 남긴다. key 가 겹치지 않게 한다.
function mergeUnique<T extends Identified>(head: readonly T[], tail: readonly T[]): T[] {
  const seen = new Set(head.map((item) => item.id));
  const fresh = tail.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return [...head, ...fresh];
}

type LoadMoreState<T> = {
  items: T[];
  nextCursor: string | null;
  status: LoadMoreStatus;
  /** 마지막으로 붙인 쪽의 첫 항목 위치. 붙인 뒤 초점을 옮길 때 쓴다. */
  appendedFrom: number | null;
  /** 첫 쪽의 세대. 서버가 첫 쪽을 새로 줄 때마다 1 오른다. 지난 세대에 대한 응답은 버린다. */
  generation: number;
};

/**
 * 서버가 그린 첫 쪽(initialItems·initialNextCursor)에 다음 쪽을 이어 붙인다.
 * endpoint 는 cursor 를 뺀 목록 주소다(예: `/api/v1/bids?sort=score%3Adesc`). GET 이라 CSRF 머리글이 필요 없다.
 * 서버가 첫 쪽을 새로 주면(조건 변경·새로고침) 붙인 행과 실패 상태를 버리고 그 쪽부터 다시 시작한다.
 */
export function useLoadMore<T extends Identified>({
  endpoint,
  initialItems,
  initialNextCursor,
}: {
  endpoint: string;
  initialItems: T[];
  initialNextCursor: string | null;
}) {
  const fresh = (generation: number): LoadMoreState<T> => ({
    items: initialItems,
    nextCursor: initialNextCursor,
    status: "idle",
    appendedFrom: null,
    generation,
  });
  const [state, setState] = useState<LoadMoreState<T>>(() => fresh(0));
  const [source, setSource] = useState({ initialItems, initialNextCursor, endpoint });
  if (
    source.initialItems !== initialItems ||
    source.initialNextCursor !== initialNextCursor ||
    source.endpoint !== endpoint
  ) {
    // 렌더 중에 바로 새 세대로 바꾼다. 진행 중 요청의 abort 는 아래 effect 정리에서야 일어나므로,
    // 그 사이에 온 옛 응답은 세대가 달라 붙지 않는다(settle).
    setSource({ initialItems, initialNextCursor, endpoint });
    setState((prev) => fresh(prev.generation + 1));
  }

  // 진행 중 요청. 같은 세대에서 다시 누른 것을 렌더 전에도 막고, 떠나거나 첫 쪽이 바뀌면 abort 한다.
  const inFlight = useRef<{ controller: AbortController; generation: number } | null>(null);
  useEffect(() => () => inFlight.current?.controller.abort(), [source]);

  const loadMore = useCallback(async () => {
    const { nextCursor: cursor, generation } = state;
    if (cursor === null || inFlight.current?.generation === generation) return;
    const request = { controller: new AbortController(), generation };
    inFlight.current = request;
    setState((prev) => (prev.generation === generation ? { ...prev, status: "loading" } : prev));
    const settle = (next: (prev: LoadMoreState<T>) => LoadMoreState<T>) => {
      if (request.controller.signal.aborted) return;
      setState((prev) => (prev.generation === generation ? next(prev) : prev));
    };
    try {
      const response = await fetch(withCursor(endpoint, cursor), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: request.controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      const page = response.ok ? pageOf<T>(body) : null;
      if (page === null) {
        const status = errorCodeOf(body) === "INVALID_CURSOR" ? "invalid-cursor" : "failed";
        settle((prev) => ({ ...prev, status }));
        return;
      }
      settle((prev) => ({
        ...prev,
        items: mergeUnique(prev.items, page.items),
        nextCursor: page.nextCursor,
        status: "idle",
        appendedFrom: prev.items.length,
      }));
    } catch {
      settle((prev) => ({ ...prev, status: "failed" }));
    } finally {
      if (inFlight.current === request) inFlight.current = null;
    }
  }, [endpoint, state]);

  return {
    items: state.items,
    hasNext: state.nextCursor !== null,
    status: state.status,
    appendedFrom: state.appendedFrom,
    loadMore,
  };
}

const ACTION_LABEL = {
  idle: "더 보기",
  loading: "불러오는 중…",
  failed: "다시 시도",
  "invalid-cursor": "처음부터 보기",
} as const satisfies Record<LoadMoreStatus, string>;

const NOTICE = {
  failed: "더 불러오지 못했습니다",
  "invalid-cursor": "목록이 바뀌었습니다",
} as const satisfies Partial<Record<LoadMoreStatus, string>>;

/**
 * 목록 아래 자리: [더 보기] → 읽는 중 → 실패([다시 시도]) 또는 커서 무효([처음부터 보기]). 더 읽을 것이 없으면 그리지 않는다.
 * 단추는 상태가 바뀌어도 같은 자리의 같은 요소이고 알림 글은 그 형제로 붙는다. 그래서 누른 단추의 초점이 사라지지 않는다.
 */
export function LoadMoreFooter({
  status,
  hasNext,
  onLoadMore,
  onRestart,
}: {
  status: LoadMoreStatus;
  hasNext: boolean;
  onLoadMore: () => void;
  onRestart: () => void;
}) {
  const notice = status === "failed" || status === "invalid-cursor" ? NOTICE[status] : null;
  if (!hasNext && notice === null) return null;
  const loading = status === "loading";
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
      {notice === null ? null : (
        <p role="alert" className="type-body text-foreground">
          {notice}
        </p>
      )}
      {/* 읽는 동안에도 초점을 잃지 않게 disabled 대신 aria-disabled 로 막는다. */}
      <Button
        key="action"
        variant="outline"
        disabled={loading}
        focusableWhenDisabled
        onClick={() => {
          if (loading) return;
          if (status === "invalid-cursor") onRestart();
          else onLoadMore();
        }}
      >
        {ACTION_LABEL[status]}
      </Button>
    </div>
  );
}
