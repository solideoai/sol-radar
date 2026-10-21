import { cn } from "cn";
import Link from "next/link";
import { BidTable } from "@/components/bids/bid-table";
import { formatRelative } from "@/components/bids/format";
import { StatCard } from "@/components/stat-card";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BidListItem, DashboardSummary } from "@/server/bids";
import { NoBidsEmptyState } from "@/app/(app)/(work)/empty-state";
import { DashboardAiBanner } from "./dashboard-ai-banner";

// /dashboard 본문(스펙 §5.2). 데이터를 읽지 않고 page.tsx 가 서버에서 읽은 값만 그린다.
// 글자는 AppPage typeScale="dashboard"(+3px, ADR-030 B25) 안에서 커진다. 그래서 표 두 개는 위아래로 쌓는다.
// 스펙 §5.2 는 @4xl 부터 3fr:2fr 로 나란히였지만, +3px 글자에서 마감 표의 고정 열(출처·마감·권고·결정)만 408px 라
// 나란히 두면 제목 칸이 1280(본문 960)에서 거의 0, 1440·접힘(본문 1376)에서도 130px 남짓이라 공고 이름을 읽을 수 없다.

// page·loading·error 가 같은 제목과 설명을 쓴다(읽는 동안과 읽은 뒤 제목 줄이 튀지 않게).
export const DASHBOARD_TITLE = "대시보드";
export const DASHBOARD_DESCRIPTION = "실행 모드와 수집 현황, 검토가 필요한 공고를 봅니다.";

type DashboardViewProps = {
  summary: DashboardSummary;
  recommended: BidListItem[];
  /** BID 표와 같은 조건(진행 중 공고의 최신 점수 권고 BID)의 전체 건수. "BID 권고" 카드 값이다(M4). */
  recommendedTotal: number;
  deadline: BidListItem[];
  /** 서버가 요청마다 한 번 만든 시각. 상대 시각·D-n 의 기준이다. */
  now: Date;
  /** 공고 0건 빈 상태에 [수집 실행] 단추를 둘지(ADMIN). 아니면 "관리자에게 수집을 요청하세요"를 보인다. */
  canRunIngestion: boolean;
};

const EMPTY = "—";

type IngestCard = { value: string; hint?: string; tone: "default" | "destructive" };

function ingestCard(freshness: DashboardSummary["dataFreshness"], now: Date): IngestCard {
  const { lastIngestAt, lastIngestStatus, lastIngestSummary } = freshness;
  if (lastIngestAt === null) return { value: EMPTY, hint: "수집 기록 없음", tone: "default" };
  const counts =
    lastIngestSummary === null
      ? undefined
      : `적재 ${lastIngestSummary.created} · 격리 ${lastIngestSummary.quarantined}`;
  const failed = lastIngestStatus === "FAILED";
  return {
    value: failed ? "실패" : formatRelative(lastIngestAt, now),
    hint: counts,
    tone: failed ? "destructive" : "default",
  };
}

function SummaryCards({
  summary,
  recommendedTotal,
  now,
}: {
  summary: DashboardSummary;
  recommendedTotal: number;
  now: Date;
}) {
  const { analyses, reviews, bids, dataFreshness } = summary;
  const { completed, partial, failed } = analyses.latestByStatus;
  const ingest = ingestCard(dataFreshness, now);
  return (
    <section aria-labelledby="dashboard-summary-title">
      <h2 id="dashboard-summary-title" className="sr-only">
        요약
      </h2>
      {/* 본문 960(1280·펼침)·1120(1440·펼침) 모두 @4xl 이상이라 다섯 칸 한 줄이다. 카드는 링크가 아니다. */}
      <div className="@container">
        <div className="grid grid-cols-3 gap-4 @4xl:grid-cols-5">
          {/* 아래 BID 표·전체 보기와 같은 정의다. 요약의 byRecommendation(모든 상태·최신 끝난 분석)과 다를 수 있다. */}
          <StatCard label="BID 권고" value={String(recommendedTotal)} />
          <StatCard label="검토 대기" value={String(reviews.pending)} />
          <StatCard label="마감 임박 (7일)" value={String(bids.deadlineWithin7Days)} />
          <StatCard label="수집" value={ingest.value} tone={ingest.tone} hint={ingest.hint} />
          <StatCard
            label="분석 현황"
            value={String(completed)}
            hint={
              completed + partial + failed === 0
                ? "아직 분석한 공고가 없습니다"
                : `부분 ${partial} · 실패 ${failed}`
            }
          />
        </div>
      </div>
    </section>
  );
}

function BidTableCard({
  name,
  title,
  href,
  items,
  now,
  kind,
  emptyText,
}: {
  /** "전체 보기" 링크 이름에 붙이는 짧은 표 이름 */
  name: string;
  title: string;
  href: string;
  items: BidListItem[];
  now: Date;
  kind: "recommended" | "deadline";
  emptyText: string;
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardAction>
          {/* 같은 화면에 "전체 보기"가 둘이라 어느 표의 것인지 이름에 넣는다. */}
          <Link
            href={href}
            aria-label={`${name} 전체 보기`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
          >
            전체 보기
          </Link>
        </CardAction>
      </CardHeader>
      {items.length === 0 ? (
        <CardContent>
          <p className="type-label text-muted-foreground">{emptyText}</p>
        </CardContent>
      ) : (
        // 표는 카드 끝까지 닿고 첫·끝 칸 글자를 카드 여백(24px)에 맞춘다(BidTable compact).
        <CardContent className="@container -mb-4 px-0">
          <BidTable items={items} caption={title} now={now} compact compactKind={kind} />
        </CardContent>
      )}
    </Card>
  );
}

const listHref = (params: Record<string, string>): string =>
  `/bids?${new URLSearchParams(params).toString()}`;

export function DashboardView({
  summary,
  recommended,
  recommendedTotal,
  deadline,
  now,
  canRunIngestion,
}: DashboardViewProps) {
  return (
    <>
      <DashboardAiBanner />
      <SummaryCards summary={summary} recommendedTotal={recommendedTotal} now={now} />
      {summary.bids.total === 0 ? (
        <NoBidsEmptyState canRun={canRunIngestion} />
      ) : (
        <div className="flex flex-col gap-6">
          <BidTableCard
            name="BID 권고"
            title="BID 권고 (점수 높은 순)"
            href={listHref({ recommendation: "BID", sort: "score:desc" })}
            items={recommended}
            now={now}
            kind="recommended"
            emptyText="BID 권고 공고가 없습니다"
          />
          <BidTableCard
            name="마감 임박"
            title="마감 임박 (7일)"
            href={listHref({ sort: "deadlineAt:asc" })}
            items={deadline}
            now={now}
            kind="deadline"
            emptyText="7일 안에 마감되는 공고가 없습니다"
          />
        </div>
      )}
    </>
  );
}
