import { cn } from "cn";
import { DETAIL_CONTENT_CLASS } from "@/app/(app)/(work)/bids/[id]/detail-copy";
import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { REVISIONS_TITLE } from "./revisions-copy";

// 스펙 §5.3 S9. 화면(revisions-view)과 같은 틀(주 영역 + 280px 레일)이라 읽은 뒤 덜 튄다.
const PULSE = "motion-reduce:animate-none";

function Block({ className }: { className: string }) {
  return <Skeleton className={cn(PULSE, className)} />;
}

// 제목(h1)·설명(p) 안은 글줄 내용만 둘 수 있어 div 인 Skeleton 대신 같은 모양의 span 을 쓴다.
function InlineBlock({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block animate-pulse rounded-md bg-muted", PULSE, className)}
    />
  );
}

export default function Loading() {
  return (
    <AppPage
      eyebrow={
        <div aria-hidden="true" className="mb-3 flex flex-col gap-2">
          <Block className="h-5 w-20" />
          <Block className="h-5 w-80 max-w-full" />
        </div>
      }
      title={REVISIONS_TITLE}
      description={<InlineBlock className="h-5 w-96 max-w-full" />}
      contentClassName={DETAIL_CONTENT_CLASS}
    >
      <div
        role="status"
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] items-start gap-6"
      >
        <span className="sr-only">변경 이력을 불러오는 중…</span>
        <div aria-hidden="true" className="flex min-w-0 flex-col gap-3">
          <Block className="h-6 w-28" />
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <Block className="h-10 w-full" />
            <Block className="h-14 w-full" />
            <Block className="h-11 w-full" />
          </div>
          <Block className="h-5 w-12" />
          <Block className="h-32 w-full rounded-lg" />
        </div>
        <div aria-hidden="true" className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <Block className="h-6 w-32" />
          <Block className="h-14 w-full" />
          <Block className="h-14 w-full" />
        </div>
      </div>
    </AppPage>
  );
}
