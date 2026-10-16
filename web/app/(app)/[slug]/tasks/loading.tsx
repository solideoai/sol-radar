import { AppPage } from "@/components/app-page";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 앱 틀 안에서만 보이므로 제목은 진짜 글자로 둔다(page.tsx 와 같은 글자다).
// loading 은 주소의 값을 받지 않아 조직을 모른다. 개인·팀마다 다른 설명은 뼈대로 둔다.
// 도구 줄 자리는 화면과 같은 높이다(라벨 20 + 간격 8 + 트리거 32px) — 화면이 그려질 때 표가 튀지 않게.
// 넓은 폭은 w-full·분수·max-w-full 만 쓴다. 320px 에서 자리는 본문 288px, 카드 안 240px 이다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage
      title="작업"
      description={
        // 설명 줄(<p>) 안에 들어가므로 div 인 Skeleton 대신 같은 모양의 span 을 둔다.
        <span
          aria-hidden
          className={`block h-5.5 w-72 max-w-full animate-pulse rounded-md bg-muted ${pulse}`}
        />
      }
    >
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status">
        <span className="sr-only">작업을 불러오는 중…</span>
        <Card aria-hidden className="@container gap-0 py-0">
          <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <Skeleton className={`h-6 w-20 ${pulse}`} />
            <Skeleton className={`h-5 w-8 ${pulse}`} />
          </div>
          <div className="grid grid-cols-2 gap-3 border-b border-border px-6 py-4 @2xl:flex @2xl:flex-wrap @2xl:items-end">
            {[
              { name: "status", width: "@2xl:w-36" },
              { name: "assignee", width: "@2xl:w-44" },
              { name: "sort", width: "@2xl:w-44" },
            ].map(({ name, width }) => (
              <div key={name} className={`flex flex-col gap-2 ${width}`}>
                <Skeleton className={`h-5 w-10 ${pulse}`} />
                <Skeleton className={`h-8 w-full ${pulse}`} />
              </div>
            ))}
          </div>
          <div className="divide-y divide-border">
            <div className="h-10" />
            {[0, 1, 2, 3, 4].map((key) => (
              <div key={key} className="flex items-center gap-4 px-6 py-3">
                <Skeleton className={`h-5 min-w-0 flex-1 ${pulse}`} />
                <Skeleton className={`h-5 w-8 shrink-0 @xl:w-20 ${pulse}`} />
                <Skeleton className={`size-8 shrink-0 ${pulse}`} />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppPage>
  );
}
