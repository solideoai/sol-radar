import { AppPage } from "@/components/app-page";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { INGESTION_DESCRIPTION, INGESTION_TITLE } from "./ingestion-copy";

// 첫 진입 로딩(N8 스펙 §4.10): 단추 자리 + 소스별 카드 2장(각 4줄) + 구역 제목·결과 줄 + 표 머리 1줄·행 8줄 뼈대(행 64px).
// 카드 뼈대는 화면(source-cards.tsx)과 같은 틀·칸 수·줄 높이라 그려질 때 자리가 튀지 않는다.
const ROWS = 8;
const CARD_LINES = 4;
const CARDS = 2;

export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage
      title={INGESTION_TITLE}
      description={INGESTION_DESCRIPTION}
      contentClassName="max-w-360"
      actions={<Skeleton aria-hidden className={`h-9 w-30 ${pulse}`} />}
    >
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">수집 이력을 불러오는 중…</span>
        <div aria-hidden className="contents">
          <div className="flex flex-col gap-3">
            <Skeleton className={`h-6 w-32 ${pulse}`} />
            <div className="@container">
              <div className="grid gap-4 @2xl:grid-cols-2">
                {Array.from({ length: CARDS }, (_, card) => (
                  <Card key={card} size="sm">
                    <CardContent className="flex flex-col gap-3">
                      <div className="flex flex-col gap-0.5">
                        <Skeleton className={`h-6 w-40 ${pulse}`} />
                        <Skeleton className={`h-4 w-56 max-w-full ${pulse}`} />
                      </div>
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                        {Array.from({ length: CARD_LINES }, (_, line) => (
                          <div key={line} className="contents">
                            <Skeleton className={`h-[22px] w-16 ${pulse}`} />
                            <Skeleton className={`h-[22px] w-44 max-w-full ${pulse}`} />
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <Skeleton className={`h-6 w-20 ${pulse}`} />
            <Skeleton className={`h-5 w-32 ${pulse}`} />
            <div className="divide-y divide-border border-b border-border">
              <div className="flex h-10 items-center gap-4 px-3">
                <Skeleton className={`h-4 w-full ${pulse}`} />
              </div>
              {Array.from({ length: ROWS }, (_, key) => (
                <div key={key} className="flex h-16 items-center gap-6 px-3">
                  <Skeleton className={`h-5 w-32 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 w-20 shrink-0 ${pulse}`} />
                  <Skeleton className={`h-5 min-w-0 flex-1 ${pulse}`} />
                  {Array.from({ length: 6 }, (_, cell) => (
                    <Skeleton key={cell} className={`h-5 w-10 shrink-0 ${pulse}`} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
