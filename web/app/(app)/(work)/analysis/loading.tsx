import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { ANALYSIS_DESCRIPTION, ANALYSIS_TITLE } from "./analysis-query";

export default function Loading() {
  return (
    <AppPage title={ANALYSIS_TITLE} description={ANALYSIS_DESCRIPTION} contentClassName="max-w-360">
      <div role="status" className="space-y-6">
        <span className="sr-only">분석 이력을 불러오는 중…</span>
        <div aria-hidden className="space-y-4">
          <Skeleton className="h-40 w-full motion-reduce:animate-none" />
          <Skeleton className="h-10 w-full motion-reduce:animate-none" />
          {[1, 2, 3, 4, 5].map((id) => (
            <Skeleton key={id} className="h-16 w-full motion-reduce:animate-none" />
          ))}
        </div>
      </div>
    </AppPage>
  );
}
