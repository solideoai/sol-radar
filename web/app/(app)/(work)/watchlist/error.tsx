"use client";

import { WorkError } from "@/app/(app)/(work)/work-error";
import { WATCHLIST_TITLE } from "./watchlist-copy";

// 관심 공고 목록이나 내 관심 id 를 읽지 못했을 때(N3 디자인 §4.2 오류, D15). 다시 시도는 retry()(Next 16, reset() 은 다시 읽지 않는다).
export default function WatchlistError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <WorkError error={error} retry={retry} title={WATCHLIST_TITLE} contentClassName="max-w-360" />
  );
}
