import Link from "next/link";
import { formatKrwCompact, formatKstShort } from "@/components/bids/format";
import { SourceBadge } from "@/components/bids/source-badge";
import { DemoBadge, StatusBadge } from "@/components/bids/status-badge";
import { isUnverifiedOrigin } from "@/components/bids/notice-origin";
import { OPPORTUNITY_STAGES, opportunityHref } from "@/components/work/opportunities-copy";
import { OpportunitySourcesDialog } from "@/components/work/opportunities-sources-dialog";
import { OpportunityConflictNotice } from "@/components/work/opportunities-conflict-notice";
import type { OpportunityItem } from "@/server/opportunities";

export function OpportunityReviewRows({
  items,
  query,
  early = false,
}: {
  items: OpportunityItem[];
  query: string;
  early?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {items.map((item) => (
        <li
          key={item.id}
          className="grid grid-cols-[92px_minmax(0,1fr)_112px] items-start gap-3 px-6 py-4"
        >
          <div className="flex flex-col items-start gap-1">
            <SourceBadge family={item.sourceFamily} />
            <OpportunitySourcesDialog item={item} listQuery={query} />
          </div>
          <div className="flex min-w-0 flex-col items-start gap-1">
            {item.isDemo && <DemoBadge dense />}
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
                  <StatusBadge
                    kind="recommendation"
                    value={item.latestAnalysis.recommendation}
                    variant="inline"
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
