"use client";

import { cn } from "cn";
import { CircleDashedIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { dDay, formatKrwCompact, formatKst, formatKstShort } from "@/components/bids/format";
import { SourceBadge } from "@/components/bids/source-badge";
import { DemoBadge, StatusBadge } from "@/components/bids/status-badge";
import { isUnverifiedOrigin } from "@/components/bids/notice-origin";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EARLY_STAGES,
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_STAGES,
  opportunityHref,
} from "@/components/work/opportunities-copy";
import { OpportunitySourcesDialog } from "@/components/work/opportunities-sources-dialog";
import { OpportunityRecommendation } from "@/components/work/opportunity-recommendation";
import { OpportunityConflictNotice } from "@/components/work/opportunities-conflict-notice";
import { useIsMobile } from "@/lib/use-mobile";
import type { OpportunityItem } from "@/server/opportunities";

// 판정(SOL Score·권고)을 제목 바로 뒤에 둔다. 표가 가로로 넘치는 폭(1280·1440)에서도 판정은 스크롤 없이 보이고,
// 밀려나는 것은 분석 상태·최종 결정 같은 보조 열이다. 열 폭 합은 그대로 1,184px 다.
const COLUMNS = [
  ["출처", 100],
  ["기관", 120],
  ["단계", 80],
  ["제목", 228],
  ["SOL Score", 88],
  ["권고", 96],
  ["분야", 96],
  ["예산", 88],
  ["마감", 88],
  ["분석 상태", 104],
  ["최종 결정", 96],
] as const;

export function OpportunityAnalysis({ item }: { item: OpportunityItem }) {
  const status = item.latestRun?.status ?? item.latestAnalysis?.status;
  return status === undefined ? (
    <span className="inline-flex items-center gap-1 type-caption whitespace-nowrap text-muted-foreground">
      <CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />
      미분석
    </span>
  ) : (
    <span title={status === "PARTIAL" ? "부분 완료 (규칙만)" : undefined}>
      <StatusBadge kind="analysis" value={status} short variant="inline" />
    </span>
  );
}

export function OpportunityDeadline({ item, now }: { item: OpportunityItem; now: Date }) {
  if (item.sourceConflict) return <span className="type-caption text-warning">확인 필요</span>;
  if (item.deadlineAt === null) return <span>—</span>;
  const days = EARLY_STAGES.includes(item.stage) ? null : dDay(item.deadlineAt, now);
  return (
    <div className="flex flex-col tabular-nums" title={`${formatKst(item.deadlineAt)} KST`}>
      <span className="type-label">{days?.label ?? "일정"}</span>
      <time dateTime={item.deadlineAt} className="type-caption text-muted-foreground">
        {formatKstShort(item.deadlineAt)}
      </time>
    </div>
  );
}

// 제목 칸의 보조 줄: 공고번호·게시일. 열을 늘리지 않으려고 제목 아래 한 줄로 두고, 넘치면 말줄임한다(1280px).
function NoticeMeta({ item }: { item: OpportunityItem }) {
  const { noticeId, publishedAt } = item;
  return (
    <span
      data-part="notice-meta"
      className="block max-w-full truncate type-caption text-muted-foreground tabular-nums"
      title={publishedAt === null ? noticeId : `${noticeId} · 게시 ${formatKst(publishedAt)} KST`}
    >
      <span className="font-mono">{noticeId}</span>
      {publishedAt !== null && (
        <>
          {" · 게시 "}
          <time dateTime={publishedAt}>{formatKstShort(publishedAt)}</time>
        </>
      )}
    </span>
  );
}

function Categories({ item }: { item: OpportunityItem }) {
  if (item.categories.length === 0)
    return <span className="type-caption text-muted-foreground">미분류</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {item.categories.slice(0, 2).map((category) => (
        <span
          key={category}
          className="max-w-full rounded-sm border border-border px-1 type-caption whitespace-nowrap"
        >
          {OPPORTUNITY_CATEGORIES[category] ?? category}
        </span>
      ))}
      {item.relevanceState === "NEEDS_REVIEW" ? (
        <span className="type-caption text-warning">확인 필요</span>
      ) : item.categories.length > 2 ? (
        <span
          className="type-caption text-muted-foreground"
          title={item.categories.map((value) => OPPORTUNITY_CATEGORIES[value] ?? value).join(", ")}
        >
          외 {item.categories.length - 2}
        </span>
      ) : null}
    </div>
  );
}

export function OpportunityTable({
  items,
  now,
  listQuery,
  busy = false,
  watchColumn,
  caption = "입찰 공고 사업기회 목록. DEMO는 데모용 가상 공고입니다.",
  removedWatchIds = [],
}: {
  items: OpportunityItem[];
  now: Date;
  listQuery?: string;
  busy?: boolean;
  watchColumn?: (item: OpportunityItem, titleId: string) => ReactNode;
  caption?: string;
  removedWatchIds?: readonly string[];
}) {
  const isMobile = useIsMobile();
  const scrollRef = useRef<HTMLDivElement>(null);
  const hintId = useId();
  const [hasOverflow, setHasOverflow] = useState(false);
  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(() =>
      setHasOverflow(element.scrollWidth > element.clientWidth),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isMobile]);
  return (
    <div className="min-w-0" aria-busy={busy || undefined}>
      {isMobile ? (
        <ul
          aria-label="입찰 공고 요약 목록"
          className="divide-y divide-border rounded-lg border border-border"
        >
          {items.map((item) => {
            const budget = formatKrwCompact(item.budgetKrw);
            const isEarly = EARLY_STAGES.includes(item.stage);
            const titleId = `opportunity-title-mobile-${item.id}`;
            return (
              <li key={item.id} className={cn("min-w-0 space-y-3 p-4", busy && "opacity-60")}>
                <div className="flex flex-wrap items-center gap-2">
                  <SourceBadge family={item.sourceFamily} />
                  {item.isDemo && <DemoBadge dense />}
                  <span className="type-caption text-muted-foreground">
                    {OPPORTUNITY_STAGES[item.stage] ?? item.stage}
                  </span>
                  {item.status === "AMENDED" && (
                    <span className="type-caption text-muted-foreground">정정</span>
                  )}
                  <StatusBadge kind="bidStatus" value={item.status} variant="inline" />
                </div>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      id={titleId}
                      href={opportunityHref(item.bidId, listQuery)}
                      className="block min-h-11 rounded-sm type-body font-medium wrap-anywhere outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {item.title}
                    </Link>
                    <p className="mt-1 type-label wrap-anywhere text-muted-foreground">
                      {item.agency ?? "기관 미확인"}
                    </p>
                    <NoticeMeta item={item} />
                  </div>
                  {watchColumn?.(item, titleId)}
                </div>
                {isUnverifiedOrigin(item) && (
                  <p className="type-caption text-warning">출처 미확인</p>
                )}
                {item.sourceConflict && <OpportunityConflictNotice />}
                {/* 표와 같이 판정(SOL Score·권고)을 첫 줄에, 예산·마감을 다음 줄에 둔다. */}
                <dl className="grid grid-cols-2 gap-3 type-body">
                  <div>
                    <dt className="type-caption text-muted-foreground">SOL Score</dt>
                    <dd className="mt-1 type-heading tabular-nums">
                      {isEarly || item.latestAnalysis?.solScore == null
                        ? "—"
                        : Math.round(item.latestAnalysis.solScore)}
                    </dd>
                  </div>
                  <div>
                    <dt className="type-caption text-muted-foreground">권고</dt>
                    <dd className="mt-1">
                      {item.sourceConflict ? (
                        <span className="text-warning">검토 필요</span>
                      ) : !isEarly && item.latestAnalysis?.recommendation ? (
                        <OpportunityRecommendation
                          recommendation={item.latestAnalysis.recommendation}
                          qualificationReview={item.latestAnalysis.qualificationReview}
                        />
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="type-caption text-muted-foreground">예산</dt>
                    <dd
                      className="mt-1 tabular-nums"
                      title={item.sourceConflict ? undefined : budget.full}
                    >
                      {item.sourceConflict ? "확인 필요" : budget.text}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="type-caption text-muted-foreground">마감</dt>
                    <dd className="mt-1">
                      <OpportunityDeadline item={item} now={now} />
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <OpportunityAnalysis item={item} />
                  <span className="type-caption text-muted-foreground">
                    최종 결정{" "}
                    <StatusBadge kind="decision" value={item.latestDecision} variant="inline" />
                  </span>
                  <OpportunitySourcesDialog item={item} listQuery={listQuery} />
                </div>
                <Categories item={item} />
                {removedWatchIds.includes(item.bidId) && (
                  <p role="status" className="type-caption text-muted-foreground">
                    관심 해제됨
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          {hasOverflow && (
            <p id={hintId} className="mb-2 type-caption text-muted-foreground">
              표를 좌우로 이동해 모든 열을 확인할 수 있습니다.
            </p>
          )}
          {/* 넘침 감지(ref)·가로 스크롤 영역(role·aria) 때문에 ui/table 의 바깥 상자를 쓰지 않는다. 같은 둥근 1px 테두리를 여기서 그린다. */}
          <div
            ref={scrollRef}
            tabIndex={hasOverflow ? 0 : undefined}
            role="region"
            aria-label="입찰 공고 표, 가로 스크롤 가능"
            aria-describedby={hasOverflow ? hintId : undefined}
            // relative: 칸 안의 sr-only 글자(absolute)가 이 상자를 기준으로 잡혀 함께 잘린다. 없으면 768px 에서 페이지가 가로로 넘쳤다.
            className="relative w-full overflow-x-auto rounded-lg border border-border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <table
              className={cn(
                "w-full table-fixed border-collapse type-body",
                watchColumn ? "min-w-[1224px]" : "min-w-[1184px]",
                busy && "opacity-60",
              )}
            >
              <caption className="sr-only">{caption}</caption>
              <colgroup>
                {watchColumn && <col style={{ width: 40 }} />}
                {COLUMNS.map(([label, width]) => (
                  <col key={label} style={{ width: label === "제목" ? undefined : width }} />
                ))}
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {watchColumn && (
                    <TableHead scope="col">
                      <span className="sr-only">관심 공고</span>
                    </TableHead>
                  )}
                  {COLUMNS.map(([label]) => (
                    <TableHead
                      key={label}
                      scope="col"
                      className={
                        label === "예산" || label === "SOL Score" ? "px-2 text-right" : undefined
                      }
                    >
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const budget = formatKrwCompact(item.budgetKrw);
                  const isEarly = EARLY_STAGES.includes(item.stage);
                  return (
                    <TableRow key={item.id} className="h-16">
                      {watchColumn && (
                        <TableCell className="px-1">
                          {watchColumn(item, `opportunity-title-${item.id}`)}
                        </TableCell>
                      )}
                      <TableCell className="py-2">
                        <div className="flex flex-col items-start gap-1">
                          <SourceBadge family={item.sourceFamily} />
                          <OpportunitySourcesDialog item={item} listQuery={listQuery} />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <span className="line-clamp-2 break-words" title={item.agency ?? undefined}>
                          {item.agency ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-col gap-1">
                          <span className="type-label">
                            {OPPORTUNITY_STAGES[item.stage] ?? item.stage}
                          </span>
                          {item.status === "AMENDED" && (
                            <span className="type-caption text-muted-foreground">정정</span>
                          )}
                          <StatusBadge kind="bidStatus" value={item.status} variant="inline" />
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="flex flex-col items-start gap-1">
                          {item.isDemo && <DemoBadge dense />}
                          {isUnverifiedOrigin(item) && (
                            <span
                              data-part="unverified-origin"
                              className="type-caption text-warning"
                            >
                              출처 미확인
                            </span>
                          )}
                          {item.sourceConflict && <OpportunityConflictNotice />}
                          <Link
                            id={`opportunity-title-${item.id}`}
                            href={opportunityHref(item.bidId, listQuery)}
                            title={item.title}
                            className="line-clamp-2 rounded-sm font-medium wrap-anywhere outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            {item.title}
                          </Link>
                          <NoticeMeta item={item} />
                          {removedWatchIds.includes(item.bidId) && (
                            <span role="status" className="type-caption text-muted-foreground">
                              관심 해제됨
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 text-right type-heading text-foreground tabular-nums">
                        {isEarly
                          ? "—"
                          : item.latestAnalysis?.solScore == null
                            ? "—"
                            : Math.round(item.latestAnalysis.solScore)}
                      </TableCell>
                      <TableCell className="px-2">
                        {item.sourceConflict ? (
                          <span className="type-caption text-warning">검토 필요</span>
                        ) : !isEarly && item.latestAnalysis?.recommendation ? (
                          <OpportunityRecommendation
                            recommendation={item.latestAnalysis.recommendation}
                            qualificationReview={item.latestAnalysis.qualificationReview}
                          />
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell>
                        <Categories item={item} />
                      </TableCell>
                      <TableCell
                        className="px-2 text-right font-mono tabular-nums"
                        title={item.sourceConflict ? undefined : budget.full}
                      >
                        {item.sourceConflict ? (
                          <span className="type-caption text-warning">확인 필요</span>
                        ) : (
                          <>
                            <span aria-hidden>{budget.text}</span>
                            <span className="sr-only">{budget.full}</span>
                          </>
                        )}
                      </TableCell>
                      <TableCell>
                        <OpportunityDeadline item={item} now={now} />
                      </TableCell>
                      <TableCell>
                        <OpportunityAnalysis item={item} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge kind="decision" value={item.latestDecision} variant="inline" />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
