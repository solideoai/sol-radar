import { AppPage } from "@/components/app-page";
import { COMPANY_DESCRIPTION, COMPANY_TITLE } from "@/components/company/company-tabs";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 화면과 같은 틀·폭(요약 줄 + 탭 줄 + 본문 칸)이라 그려질 때 자리가 튀지 않는다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title={COMPANY_TITLE} description={COMPANY_DESCRIPTION}>
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">회사 프로필을 불러오는 중…</span>
        <div aria-hidden className="contents">
          <Skeleton className={`h-5 w-80 ${pulse}`} />
          {/* 탭 줄은 바깥 선 없는 알약 줄이다(2026-10-28 화면 개편). 알약 높이 32px 와 같다. */}
          <div className="flex gap-1">
            {Array.from({ length: 7 }, (_, key) => (
              <Skeleton key={key} className={`h-8 w-20 ${pulse}`} />
            ))}
          </div>
          <Skeleton className={`h-6 w-40 ${pulse}`} />
          <Card className="gap-0 py-0">
            <div className="grid grid-cols-4">
              {Array.from({ length: 8 }, (_, key) => (
                <div key={key} className="px-4 py-3">
                  <Skeleton className={`h-5 w-24 ${pulse}`} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppPage>
  );
}
