import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { Skeleton } from "@/components/ui/skeleton";
import { DETAIL_CONTENT_CLASS, DETAIL_TITLE } from "./detail-copy";

// 스펙 §5.4.11 로딩: 상단 요약·레일·구역 skeleton. 화면(bid-detail-view)과 같은 틀(주 영역 + 320px 레일)이라 읽은 뒤 덜 튄다.
// 제목은 아직 모르므로 skeleton 이고, 화면 낭독기에는 화면 이름과 읽는 중임을 알린다.
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
          <div className="flex gap-2">
            <Block className="h-5 w-14" />
            <Block className="h-5 w-16" />
            <Block className="h-5 w-24" />
          </div>
        </div>
      }
      title={
        <>
          <span className="sr-only">{DETAIL_TITLE}</span>
          <InlineBlock className="h-9 w-[min(36rem,100%)]" />
        </>
      }
      description={
        <span aria-hidden="true" className="mt-2 flex flex-col gap-2">
          <InlineBlock className="h-5 w-96 max-w-full" />
          <InlineBlock className="h-5 w-80 max-w-full" />
        </span>
      }
      actions={
        <div aria-hidden="true" className="flex gap-2">
          <Block className="h-9 w-28" />
          <Block className="h-9 w-24" />
        </div>
      }
      contentClassName={DETAIL_CONTENT_CLASS}
    >
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div
        role="status"
        className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] items-start gap-6"
      >
        <span className="sr-only">공고를 불러오는 중…</span>
        <div aria-hidden="true" className="flex min-w-0 flex-col gap-6">
          <Block className="h-24 w-full rounded-lg" />
          <Block className="h-6 w-2/3" />
          {[3, 5, 4].map((rows, section) => (
            <div key={section} className="flex flex-col gap-3 border-t border-border pt-6">
              <Block className="h-6 w-40" />
              {Array.from({ length: rows }, (_, row) => (
                <Block key={row} className="h-5 w-full" />
              ))}
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="flex flex-col gap-4 rounded-lg border border-border p-6">
          <Block className="h-6 w-24" />
          <Block className="h-6 w-32" />
          <Block className="h-9 w-full" />
          <Block className="h-20 w-full" />
          <Block className="h-10 w-full" />
          <Block className="h-9 w-full" />
        </div>
      </div>
    </AppPage>
  );
}
