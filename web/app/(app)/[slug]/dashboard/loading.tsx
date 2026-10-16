import { AppPage } from "@/components/app-page";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 앱 틀 안에서만 보이므로 제목은 진짜 글자로 둔다(page.tsx 와 같은 글자다).
// loading 은 주소의 값을 받지 않아 조직을 모른다. 설명은 개인·팀에 같이 맞는 글로 둔다.
// 넓은 폭은 w-full·분수·max-w-full 만 쓴다. 고정 폭이 자리보다 넓으면 320px 에서 가로로 넘친다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title="대시보드" description="작업 진행 상황을 한눈에 봅니다.">
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">대시보드를 불러오는 중…</span>
        <div aria-hidden className="contents">
          <div className="@container">
            <div className="grid grid-cols-2 gap-4 @2xl:grid-cols-4">
              {[0, 1, 2, 3].map((key) => (
                <Card key={key} size="sm">
                  <CardContent className="flex flex-col gap-1">
                    <Skeleton className={`h-5 w-20 max-w-full ${pulse}`} />
                    <Skeleton className={`h-8 w-12 ${pulse}`} />
                    <Skeleton className={`h-4 w-28 max-w-full ${pulse}`} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <Card>
            <CardHeader>
              <Skeleton className={`h-6 w-20 ${pulse}`} />
              <Skeleton className={`h-5.5 w-72 max-w-full ${pulse}`} />
            </CardHeader>
            <CardContent>
              {/* 범례 줄(20px + 아래 16px)만큼 차트보다 높다. */}
              <Skeleton className={`h-52 w-full ${pulse}`} />
            </CardContent>
          </Card>
          <div className="@container">
            <div className="grid items-start gap-6 @4xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              {["due-soon", "activity"].map((name) => (
                <Card key={name}>
                  <CardHeader>
                    <Skeleton className={`h-6 w-32 max-w-full ${pulse}`} />
                    <Skeleton className={`h-5.5 w-48 max-w-full ${pulse}`} />
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    {[0, 1, 2, 3, 4].map((key) => (
                      <Skeleton key={key} className={`h-6 w-full ${pulse}`} />
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
