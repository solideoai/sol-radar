import { AppPage } from "@/components/app-page";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 스펙 §5.5 로딩: 링크 줄 + 행 6개 뼈대. 화면과 같은 틀·폭이라 그려질 때 자리가 튀지 않는다.
// 제목·설명 글자는 page.tsx 와 같은 값이어야 하나, 페이지 모듈을 끌어오지 않으려고 같은 문장을 둔다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title="알림" description="결정 담당으로 지정되거나 분석이 끝나면 여기에 표시됩니다.">
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">알림을 불러오는 중…</span>
        <div aria-hidden className="contents">
          <div className="flex h-10 items-center gap-6 border-b border-border">
            <Skeleton className={`h-5 w-8 ${pulse}`} />
            <Skeleton className={`h-5 w-14 ${pulse}`} />
          </div>
          <Card className="gap-0 py-0">
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
          </Card>
        </div>
      </div>
    </AppPage>
  );
}
