import { AppPage } from "@/components/app-page";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 제목은 진짜 글자로 둔다(page.tsx 와 같다). loading 은 주소의 값을 받지 않아 조직을 모르므로 하위 메뉴도 뼈대로 둔다.
// 넓은 폭은 w-full·분수·max-w-full 만 쓴다. 고정 폭이 자리보다 넓으면 320px 에서 가로로 넘친다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title="설정">
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status">
        <span className="sr-only">멤버를 불러오는 중…</span>
        <div aria-hidden>
          <div className="flex h-10 items-center gap-6 border-b border-border">
            <Skeleton className={`h-5 w-8 ${pulse}`} />
            <Skeleton className={`h-5 w-8 ${pulse}`} />
          </div>
          <div className="flex flex-col gap-6 pt-6">
            {[3, 2].map((rows, key) => (
              <Card key={key}>
                <CardHeader>
                  <Skeleton className={`h-6 w-24 ${pulse}`} />
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {Array.from({ length: rows }, (_, row) => (
                    <div key={row} className="flex items-center gap-3">
                      <Skeleton className={`size-8 shrink-0 rounded-full ${pulse}`} />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Skeleton className={`h-5 w-32 max-w-full ${pulse}`} />
                        <Skeleton className={`h-4 w-48 max-w-full ${pulse}`} />
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </AppPage>
  );
}
