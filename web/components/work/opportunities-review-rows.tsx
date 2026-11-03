import { cn } from "cn";
import Link from "next/link";
import { formatKrwCompact, formatKstShort } from "@/components/bids/format";
import { StatusBadge } from "@/components/bids/status-badge";
import { OpportunityRecommendation } from "@/components/work/opportunity-recommendation";
import { isUnverifiedOrigin } from "@/components/bids/notice-origin";
import { OPPORTUNITY_STAGES, opportunityHref } from "@/components/work/opportunities-copy";
import { OpportunitySourcesDialog } from "@/components/work/opportunities-sources-dialog";
import { OpportunityConflictNotice } from "@/components/work/opportunities-conflict-notice";
import { OpportunitySourceCell, TitleDemoBadge } from "@/components/work/opportunity-source-cell";
import type { OpportunityItem } from "@/server/opportunities";

export function OpportunityReviewRows({
  items,
  query,
  early = false,
  className,
}: {
  items: OpportunityItem[];
  query: string;
  early?: boolean;
  className?: string;
}) {
  // 상자 없이 구분선 행으로 쓴다(대시보드). 바깥 선은 쓰는 쪽이 className 으로 정한다.
  return (
    <ul className={cn("divide-y divide-border", className)}>
      {items.map((item) => (
        // 좁은 폭(640px 미만)에서는 출처를 제목 위 한 줄로 올려 제목 칸 폭을 넓힌다.
        <li
          key={item.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 py-4 sm:grid-cols-[92px_minmax(0,1fr)_112px] sm:gap-3"
        >
          <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-1 sm:flex-col sm:items-start sm:gap-1">
            <OpportunitySourceCell item={item} />
            <OpportunitySourcesDialog item={item} listQuery={query} />
          </div>
          <div className="flex min-w-0 flex-col items-start gap-1">
            <TitleDemoBadge item={item} />
            {isUnverifiedOrigin(item) && (
              <span data-part="unverified-origin" className="type-caption text-warning">
                출처 미확인
              </span>
            )}
            {item.sourceConflict && <OpportunityConflictNotice />}
            <Link
              href={opportunityHref(item.bidId, query)}
              title={item.title}
              className="line-clamp-2 rounded-sm type-body break-words outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.title}
            </Link>
            <p className="type-caption wrap-anywhere text-muted-foreground">
              {item.agency ?? "기관 미확인"}
              {early ? ` · ${OPPORTUNITY_STAGES[item.stage] ?? item.stage}` : ""}
            </p>
            {!early && (
              <p className="type-caption text-muted-foreground">
                예산 {item.sourceConflict ? "확인 필요" : formatKrwCompact(item.budgetKrw).text} ·
                마감{" "}
                {item.sourceConflict
                  ? "확인 필요"
                  : item.deadlineAt === null
                    ? "미확인"
                    : formatKstShort(item.deadlineAt)}
              </p>
            )}
          </div>
          <div className="flex min-w-0 flex-col items-end gap-1 text-right tabular-nums">
            {early ? (
              <>
                <span
                  className="type-label font-mono"
                  title={item.sourceConflict ? undefined : formatKrwCompact(item.budgetKrw).full}
                >
                  {item.sourceConflict ? "확인 필요" : formatKrwCompact(item.budgetKrw).text}
                </span>
                <span className="type-caption text-muted-foreground">
                  {item.sourceConflict
                    ? "확인 필요"
                    : item.deadlineAt === null
                      ? "일정 미확인"
                      : formatKstShort(item.deadlineAt)}
                </span>
              </>
            ) : (
              <>
                <span className="type-caption text-muted-foreground">SOL Score</span>
                <span className="type-heading">
                  {item.latestAnalysis?.solScore == null
                    ? "—"
                    : Math.round(item.latestAnalysis.solScore)}
                </span>
                {item.sourceConflict ? (
                  <span className="type-caption text-warning">검토 필요</span>
                ) : item.latestAnalysis?.recommendation ? (
                  <OpportunityRecommendation
                    recommendation={item.latestAnalysis.recommendation}
                    qualificationReview={item.latestAnalysis.qualificationReview}
                  />
                ) : (
                  <span className="type-caption text-muted-foreground">분석 대기</span>
                )}
                {item.latestAnalysis?.status === "PARTIAL" && (
                  <span className="type-caption text-warning">규칙만</span>
                )}
                {item.latestRun && ["QUEUED", "RUNNING"].includes(item.latestRun.status) && (
                  <StatusBadge
                    kind="analysis"
                    value={item.latestRun.status}
                    short
                    variant="inline"
                  />
                )}
              </>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
