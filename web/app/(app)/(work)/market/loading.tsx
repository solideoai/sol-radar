import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { MARKET_DESCRIPTION, MARKET_TITLE } from "./market-copy";

export default function Loading() {
  return (
    <AppPage title={MARKET_TITLE} description={MARKET_DESCRIPTION} contentClassName="max-w-360">
      <div role="status" className="space-y-6">
        <span className="sr-only">발주 현황을 불러오는 중…</span>
        <div aria-hidden className="space-y-6">
          <Skeleton className="h-10 w-full motion-reduce:animate-none" />
          <Skeleton className="h-28 w-full motion-reduce:animate-none" />
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-12">
            <Skeleton className="h-96 w-full motion-reduce:animate-none" />
            <Skeleton className="h-96 w-full motion-reduce:animate-none" />
          </div>
          <Skeleton className="h-52 w-full motion-reduce:animate-none" />
        </div>
      </div>
    </AppPage>
  );
}
