import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <AppPage title="입찰 프로젝트">
      <div role="status">
        <span className="sr-only">프로젝트를 불러오는 중…</span>
        <div aria-hidden className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((key) => (
            <Skeleton key={key} className="h-80 w-full motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </AppPage>
  );
}
