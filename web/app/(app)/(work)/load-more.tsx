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
  const initial = (): LoadMoreState<T> => ({
    items: initialItems,
    nextCursor: initialNextCursor,
    status: "idle",
    appendedFrom: null,
  });
  const [state, setState] = useState<LoadMoreState<T>>(initial);
  const [source, setSource] = useState({ initialItems, initialNextCursor, endpoint });
  if (
    source.initialItems !== initialItems ||
    source.initialNextCursor !== initialNextCursor ||
    source.endpoint !== endpoint
  ) {
    setSource({ initialItems, initialNextCursor, endpoint });
    setState(initial());
  }

  // 읽는 중 다시 누른 것을 렌더 전에도 막고, 화면을 떠난 뒤 온 응답과 지난 첫 쪽에 대한 응답은 버린다.
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), [source]);

  const loadMore = useCallback(async () => {
    const cursor = state.nextCursor;
    if (cursor === null || inFlight.current !== null) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setState((prev) => ({ ...prev, status: "loading" }));
    const settle = (next: (prev: LoadMoreState<T>) => LoadMoreState<T>) => {
      if (controller.signal.aborted) return;
      setState(next);
    };
    try {
      const response = await fetch(withCursor(endpoint, cursor), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      const page = response.ok ? pageOf<T>(body) : null;
      if (page === null) {
        const status = errorCodeOf(body) === "INVALID_CURSOR" ? "invalid-cursor" : "failed";
        settle((prev) => ({ ...prev, status }));
        return;
      }
      settle((prev) => ({
        items: mergeUnique(prev.items, page.items),
        nextCursor: page.nextCursor,
        status: "idle",
        appendedFrom: prev.items.length,
      }));
    } catch {
      settle((prev) => ({ ...prev, status: "failed" }));
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, [endpoint, state.nextCursor]);

  return {
    items: state.items,
    hasNext: state.nextCursor !== null,
    status: state.status,
    appendedFrom: state.appendedFrom,
    loadMore,
  };
}

/** 목록 아래 자리: [더 보기], 읽는 중, 실패([다시 시도]), 커서 무효([처음부터 보기]). 더 읽을 것이 없으면 그리지 않는다. */
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
  if (status === "invalid-cursor" || status === "failed") {
    const invalid = status === "invalid-cursor";
    return (
      <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
        <p role="alert" className="type-body text-foreground">
          {invalid ? "목록이 바뀌었습니다" : "더 불러오지 못했습니다"}
        </p>
        <Button variant="outline" size="sm" onClick={invalid ? onRestart : onLoadMore}>
          {invalid ? "처음부터 보기" : "다시 시도"}
        </Button>
      </div>
    );
  }
  if (!hasNext) return null;
  const loading = status === "loading";
  return (
    <div className="flex justify-center pt-4">
      {/* 읽는 동안에도 초점을 잃지 않게 disabled 대신 aria-disabled 로 막는다. */}
      <Button
        variant="outline"
        disabled={loading}
        focusableWhenDisabled
        onClick={() => {
          if (!loading) onLoadMore();
        }}
      >
        {loading ? "불러오는 중…" : "더 보기"}
      </Button>
    </div>
  );
}
