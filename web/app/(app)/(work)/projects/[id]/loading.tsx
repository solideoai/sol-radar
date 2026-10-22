import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <AppPage title="입찰 프로젝트">
      <div role="status">
        <span className="sr-only">프로젝트 상세를 불러오는 중…</span>
        <Skeleton className="h-96 w-full motion-reduce:animate-none" />
      </div>
    </AppPage>
  );
}
