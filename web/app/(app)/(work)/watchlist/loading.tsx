import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { WATCHLIST_DESCRIPTION, WATCHLIST_TITLE } from "./watchlist-copy";

// 최초 진입은 필터·11열 표 자리를 유지하고, 조건 변경은 기존 표만 busy 상태로 보인다.
// 필터 칸 자리는 화면과 같은 크기다(라벨 20 + 간격 8 + 칸 40px, 검색 240·선택 144px).
const FILTERS = [
  "source",
  "agency",
  "stage",
  "status",
  "recommendation",
  "category",
  "decision",
  "origin",
  "sort",
];

export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage
      title={WATCHLIST_TITLE}
      description={WATCHLIST_DESCRIPTION}
      contentClassName="max-w-360"
    >
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">관심 공고를 불러오는 중…</span>
        <div aria-hidden className="contents">
          <div className="flex flex-wrap gap-3 rounded-lg border border-border p-4">
            <Skeleton className={`h-9 w-52 ${pulse}`} />
            {[0, 1, 2, 3, 4].map((key) => (
              <Skeleton key={key} className={`h-9 w-20 ${pulse}`} />
            ))}
            <Skeleton className={`h-9 w-56 ${pulse}`} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Skeleton className={`h-10 w-60 ${pulse}`} />
            {FILTERS.map((name) => (
              <div key={name} className="flex flex-col gap-2">
                <Skeleton className={`h-5 w-10 ${pulse}`} />
                <Skeleton className={`h-10 w-36 ${pulse}`} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className={`h-5 w-28 ${pulse}`} />
            <div className="divide-y divide-border border-b border-border">
              <div className="flex h-10 items-center gap-4 px-3">
                <Skeleton className={`h-4 w-full ${pulse}`} />
              </div>
              {Array.from({ length: 10 }, (_, key) => (
                <div key={key} className="flex h-16 items-center gap-4 px-3">
                  <Skeleton className={`h-5 w-14 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-14 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 min-w-0 flex-1 ${pulse}`} />
                  <Skeleton className={`h-5 w-24 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-12 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-12 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-10 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-16 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-16 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-16 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-16 shrink-0 ${pulse}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
