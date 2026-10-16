import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";

// 로그인 수단 목록은 Auth 서버를 한 번 더 부르므로 뼈대를 둔다. 구역 다섯(프로필·로그인 수단·비밀번호·세션·탈퇴)의 자리와 같다.
// 제목·설명은 진짜 글자로 둔다(page.tsx 와 같다). loading 은 주소의 값을 받지 않아 조직을 모르므로 하위 메뉴도 뼈대로 둔다.
export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title="설정" description="프로필과 로그인 정보를 관리합니다.">
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status">
        <span className="sr-only">설정을 불러오는 중…</span>
        <div aria-hidden>
          <div className="flex h-10 items-center gap-6 border-b border-border">
            <Skeleton className={`h-5 w-8 ${pulse}`} />
            <Skeleton className={`h-5 w-8 ${pulse}`} />
          </div>
          <div className="@container">
            <div className="divide-y divide-border">
              {[0, 1, 2, 3, 4].map((key) => (
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
