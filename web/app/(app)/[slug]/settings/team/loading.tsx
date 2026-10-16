import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";

// 이 파일이 없으면 위 settings/loading.tsx(계정 화면 뼈대, 구역 다섯)가 대신 보인다.
// 제목은 진짜 글자로 둔다(page.tsx 와 같다). 설명은 팀 이름이 들어가서 비워 둔다.
// 이 주소는 팀에만 있으므로 하위 메뉴 뼈대는 셋(계정·멤버·팀), 구역은 owner 의 둘(팀 이름·팀 삭제)이다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title="설정">
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status">
        <span className="sr-only">팀 설정을 불러오는 중…</span>
        <div aria-hidden>
          <div className="flex h-10 items-center gap-6 border-b border-border">
            <Skeleton className={`h-5 w-8 ${pulse}`} />
            <Skeleton className={`h-5 w-8 ${pulse}`} />
            <Skeleton className={`h-5 w-8 ${pulse}`} />
          </div>
          <div className="@container">
            <div className="divide-y divide-border">
              {[0, 1].map((key) => (
                <div
                  key={key}
                  className="grid gap-x-10 gap-y-5 py-8 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
                >
                  <div className="flex flex-col gap-2">
                    <Skeleton className={`h-6 w-24 ${pulse}`} />
                    <Skeleton className={`h-4 w-48 max-w-full ${pulse}`} />
                  </div>
                  <Skeleton className={`h-10 w-full max-w-md ${pulse}`} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AppPage>
  );
}
