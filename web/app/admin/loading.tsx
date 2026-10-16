import { AppPage } from "@/components/app-page";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 관리자 틀(layout) 안에서만 보인다 — 운영자가 아니면 틀이 먼저 404 를 낸다. 제목·설명은 page.tsx 와 같은 글자다.
// 검색 줄 자리는 화면과 같은 높이다(라벨 20 + 간격 8 + 입력칸 32px) — 화면이 그려질 때 표가 튀지 않게.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage
      title="사용자 관리"
      description="가입한 모든 사용자를 보고, 회원의 이용을 정지하거나 해제합니다."
    >
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status">
        <span className="sr-only">사용자 목록을 불러오는 중…</span>
        <Card aria-hidden className="@container gap-0 py-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <Skeleton className={`h-6 w-24 ${pulse}`} />
            <Skeleton className={`h-5 w-8 ${pulse}`} />
          </div>
          <div className="flex flex-wrap items-end gap-3 border-b border-border px-6 py-4">
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-2 @2xl:max-w-sm">
              <Skeleton className={`h-5 w-10 ${pulse}`} />
              <Skeleton className={`h-8 w-full ${pulse}`} />
            </div>
            <Skeleton className={`h-8 w-16 ${pulse}`} />
          </div>
          <div className="divide-y divide-border">
            <div className="h-10" />
            {[0, 1, 2, 3, 4].map((key) => (
              <div key={key} className="flex items-center gap-3 px-6 py-3">
                <Skeleton className={`size-8 shrink-0 rounded-full ${pulse}`} />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Skeleton className={`h-4 w-32 max-w-full ${pulse}`} />
                  <Skeleton className={`h-3 w-48 max-w-full ${pulse}`} />
                </div>
                <Skeleton className={`hidden h-5 w-12 shrink-0 @xl:block ${pulse}`} />
                <Skeleton className={`hidden h-5 w-10 shrink-0 @xl:block ${pulse}`} />
                <Skeleton className={`hidden h-5 w-24 shrink-0 @2xl:block ${pulse}`} />
                <Skeleton className={`h-8 w-12 shrink-0 ${pulse}`} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppPage>
  );
}
