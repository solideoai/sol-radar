import { AppPage } from "@/components/app-page";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LOADING_LABEL, ORG_SETTINGS_DESCRIPTION, ORG_SETTINGS_TITLE } from "./org-settings-copy";

// 첫 진입 로딩(디자인 스펙 §4.7). 제목·설명은 진짜 글자(page.tsx 와 같다), 하위 메뉴 4칸과 카드 4장은 뼈대다.
// 카드: 구성원(행 4줄 52px) · 초대(입력칸·선택·단추 한 줄) · 대기 중 초대(행 2줄) · 기록(행 5줄 44px).
// 펼쳐 넘기는 객체라 key 를 두지 않는다(React 는 펼친 props 의 key 를 경고한다).
const MEMBERS_CARD = { rows: 4, rowClass: "h-13" } as const;
const INVITATIONS_CARD = { rows: 2, rowClass: "h-13" } as const;
const AUDIT_CARD = { rows: 5, rowClass: "h-11" } as const;

export default function Loading() {
  const pulse = "motion-reduce:animate-none";
  return (
    <AppPage title={ORG_SETTINGS_TITLE} description={ORG_SETTINGS_DESCRIPTION}>
      {/* 본문 랜드마크(main)는 AppPage 가 그린다. 읽는 중 알림은 안쪽 요소가 맡는다. */}
      <div role="status">
        <span className="sr-only">{LOADING_LABEL}</span>
        <div aria-hidden>
          <div className="flex h-10 items-center gap-6 border-b border-border">
            {Array.from({ length: 4 }, (_, key) => (
              <Skeleton key={key} className={`h-5 w-8 ${pulse}`} />
            ))}
          </div>
          <div className="flex flex-col gap-6 pt-6">
            <TableCardSkeleton {...MEMBERS_CARD} pulse={pulse} />
            <Card>
              <CardHeader>
                <Skeleton className={`h-6 w-16 ${pulse}`} />
              </CardHeader>
              <CardContent className="flex items-center gap-4">
                <Skeleton className={`h-10 w-112 max-w-full ${pulse}`} />
                <Skeleton className={`h-10 w-40 shrink-0 ${pulse}`} />
                <Skeleton className={`h-9 w-15 shrink-0 ${pulse}`} />
              </CardContent>
            </Card>
            <TableCardSkeleton {...INVITATIONS_CARD} pulse={pulse} />
            <TableCardSkeleton {...AUDIT_CARD} pulse={pulse} />
          </div>
        </div>
      </div>
    </AppPage>
  );
}

function TableCardSkeleton({
  rows,
  rowClass,
  pulse,
}: {
  rows: number;
  rowClass: string;
  pulse: string;
}) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className={`h-6 w-28 ${pulse}`} />
        <Skeleton className={`h-5 w-96 max-w-full ${pulse}`} />
      </CardHeader>
      <CardContent className="divide-y divide-border px-0">
        <div className="flex h-10 items-center px-6">
          <Skeleton className={`h-4 w-full ${pulse}`} />
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className={`flex items-center gap-6 px-6 ${rowClass}`}>
            <Skeleton className={`h-5 w-32 shrink-0 ${pulse}`} />
            <Skeleton className={`h-5 min-w-0 flex-1 ${pulse}`} />
            <Skeleton className={`h-5 w-24 shrink-0 ${pulse}`} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
