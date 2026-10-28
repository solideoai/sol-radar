import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { NOTIFICATIONS_DESCRIPTION, NOTIFICATIONS_TITLE } from "./notifications-copy";

// 스펙 §5.5 로딩: 링크 줄 + 행 6개 뼈대. 화면과 같은 틀·폭이라 그려질 때 자리가 튀지 않는다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title={NOTIFICATIONS_TITLE} description={NOTIFICATIONS_DESCRIPTION}>
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">알림을 불러오는 중…</span>
        <div aria-hidden className="contents">
          {/* 전체·안 읽음 전환 상자 자리다. */}
          <div className="flex self-start rounded-lg border border-border p-0.5">
            <Skeleton className={`h-7 w-14 rounded-md ${pulse}`} />
            <Skeleton className={`h-7 w-18 rounded-md ${pulse}`} />
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="divide-y divide-border">
              {Array.from({ length: 6 }, (_, key) => (
                <div key={key} className="flex items-start gap-3 px-4 py-3">
                  <Skeleton className={`mt-2 size-2 shrink-0 rounded-full ${pulse}`} />
                  <Skeleton className={`mt-0.5 size-4 shrink-0 ${pulse}`} />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Skeleton className={`h-4 w-20 ${pulse}`} />
                    <Skeleton className={`h-5 w-2/3 ${pulse}`} />
                    <Skeleton className={`h-4 w-1/2 ${pulse}`} />
                  </div>
                  <Skeleton className={`h-4 w-14 shrink-0 ${pulse}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
