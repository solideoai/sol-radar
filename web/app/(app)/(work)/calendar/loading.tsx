import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { CALENDAR_DESCRIPTION, CALENDAR_LOADING, CALENDAR_TITLE } from "./calendar-copy";

// 달력 자리(머리 줄·7칸 × 5주)와 다가오는 14일 자리를 화면과 같은 크기로 잡는다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title={CALENDAR_TITLE} description={CALENDAR_DESCRIPTION} contentClassName="max-w-360">
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">{CALENDAR_LOADING}</span>
        <div aria-hidden className="contents">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Skeleton className={`h-8 w-64 ${pulse}`} />
            <Skeleton className={`h-8 w-44 ${pulse}`} />
          </div>
          <Skeleton className={`h-5 w-96 max-w-full ${pulse}`} />
          <div className="@container">
            <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-7 md:gap-px">
                {Array.from({ length: 35 }, (_, key) => (
                  <Skeleton key={key} className={`h-32 rounded-none ${pulse}`} />
                ))}
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className={`h-6 w-32 ${pulse}`} />
                {[0, 1, 2, 3].map((key) => (
                  <Skeleton key={key} className={`h-16 w-full ${pulse}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
