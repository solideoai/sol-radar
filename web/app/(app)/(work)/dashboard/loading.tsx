import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { DASHBOARD_DESCRIPTION, DASHBOARD_TITLE } from "./dashboard-view";

const pulse = "motion-reduce:animate-none";

// 제목 줄 + 구분선 행 구역(dashboard-view 의 OpportunityPanel·오른쪽 칸 구역과 같은 모양).
function SectionSkeleton({ rows, rowHeight }: { rows: number; rowHeight: string }) {
  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Skeleton className={`h-[27px] w-40 max-w-full ${pulse}`} />
          <Skeleton className={`h-[19px] w-56 max-w-full ${pulse}`} />
        </div>
        <Skeleton className={`h-[23px] w-20 ${pulse}`} />
      </div>
      <div className="mt-3 divide-y divide-border border-y border-border">
        {Array.from({ length: rows }, (_, key) => (
          <div key={key} className="py-3">
            <Skeleton className={`w-full ${rowHeight} ${pulse}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// 본문 폭과 +3px 글자 범위를 최종 화면과 맞춰 로딩 뒤 배치가 뛰지 않게 한다.
// 사이드바·상단바는 layout 이 그대로 그려 계속 쓸 수 있다.
export default function Loading() {
  return (
    <AppPage
      title={DASHBOARD_TITLE}
      description={DASHBOARD_DESCRIPTION}
      typeScale="dashboard"
      contentClassName="max-w-360"
    >
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">대시보드를 불러오는 중…</span>
        <div aria-hidden className="contents">
          <div className="grid grid-cols-2 border-y border-border md:grid-cols-3 xl:grid-cols-5">
            {[0, 1, 2, 3, 4].map((key) => (
              <div
                key={key}
                className="flex min-w-0 flex-col gap-1 border-l border-border px-3 py-4 odd:border-l-0 md:odd:border-l xl:px-5 xl:first:border-l-0 xl:first:pl-0 xl:last:pr-0"
              >
                <Skeleton className={`h-[23px] w-20 max-w-full ${pulse}`} />
                <Skeleton className={`h-[39px] w-14 ${pulse}`} />
                <Skeleton className={`h-[19px] w-28 max-w-full ${pulse}`} />
              </div>
            ))}
          </div>
          <div className="mt-4 flex min-w-0 flex-col gap-10">
            <SectionSkeleton rows={5} rowHeight="h-20" />
            <SectionSkeleton rows={4} rowHeight="h-16" />
            <Skeleton className={`h-6 w-48 ${pulse}`} />
          </div>
        </div>
      </div>
    </AppPage>
  );
}
