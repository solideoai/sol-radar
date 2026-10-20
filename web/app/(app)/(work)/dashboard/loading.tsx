import { AppPage } from "@/components/app-page";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DASHBOARD_DESCRIPTION, DASHBOARD_TITLE } from "./dashboard-view";

// 스펙 §5.2 로딩: 카드 5개 + 표 2개 뼈대. 화면과 같은 틀·폭·글자 범위(+3px)라 그려질 때 자리가 튀지 않는다.
// 사이드바·상단바는 layout 이 그대로 그려 계속 쓸 수 있다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
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
          <div className="@container">
            <div className="grid grid-cols-3 gap-4 @4xl:grid-cols-5">
              {[0, 1, 2, 3, 4].map((key) => (
                <Card key={key} size="sm">
                  <CardContent className="flex flex-col gap-1">
                    <Skeleton className={`h-[23px] w-20 max-w-full ${pulse}`} />
                    <Skeleton className={`h-[39px] w-14 ${pulse}`} />
                    <Skeleton className={`h-[19px] w-24 max-w-full ${pulse}`} />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-6">
            {["recommended", "deadline"].map((name) => (
              <Card key={name}>
                <CardHeader className="grid-cols-[1fr_auto]">
                  <Skeleton className={`h-[27px] w-48 max-w-full ${pulse}`} />
                  <Skeleton className={`h-8 w-20 ${pulse}`} />
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className={`h-6 w-full ${pulse}`} />
                  {[0, 1, 2, 3, 4].map((key) => (
                    <Skeleton key={key} className={`h-9 w-full ${pulse}`} />
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
