import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { WORKFORCE_DESCRIPTION, WORKFORCE_TITLE } from "./workforce-query";
export default function WorkforceLoading() {
  return (
    <AppPage
      title={WORKFORCE_TITLE}
      description={WORKFORCE_DESCRIPTION}
      contentClassName="max-w-360"
    >
      <div role="status" className="flex flex-col gap-6">
        <span className="sr-only">인력 시뮬레이션을 불러오는 중…</span>
        <Skeleton className="h-36 motion-reduce:animate-none" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-64 motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </AppPage>
  );
}
