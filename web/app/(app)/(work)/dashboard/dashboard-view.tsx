import { ChevronRightIcon, CircleDashedIcon } from "lucide-react";
import Link from "next/link";
import { formatKrwCompact, formatKst } from "@/components/bids/format";
import { RECOMMENDATION_LABEL } from "@/components/bids/labels";
import { StatusBadge } from "@/components/bids/status-badge";
import { OpportunityReviewRows } from "@/components/work/opportunities-review-rows";
import { OpportunitySourceStatus } from "@/components/work/opportunities-source-status";
import type {
  OpportunityItem,
  OpportunityLiveMetrics,
  OpportunitySummary,
  SourceSummary,
} from "@/server/opportunities";
import { NoBidsEmptyState } from "@/app/(app)/(work)/empty-state";
import { DashboardAiBanner } from "./dashboard-ai-banner";

export const DASHBOARD_TITLE = "대시보드";
export const DASHBOARD_DESCRIPTION = "검토할 입찰과 마감, 진행 중인 업무를 확인합니다.";
const count = (value: number) => value.toLocaleString("ko-KR");

// 카드 상자 없이 제목 줄과 구분선으로만 구역을 나눈다(2026-10-26 AI 티 걷어내기 §2).
// 구역 제목 아래(12px)보다 구역 사이(32~40px)를 넓게 둬 묶음이 눈에 먼저 들어오게 한다.
function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h2 className="type-heading text-foreground">{title}</h2>
        {description ? (
          <p className="mt-0.5 type-caption wrap-anywhere text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

const ruledList = "mt-3 divide-y divide-border border-y border-border";

function OpportunityPanel({
  title,
  description,
  items,
  query,
  emptyText,
  early = false,
}: {
  title: string;
  description: React.ReactNode;
  items: OpportunityItem[] | null;
  query: string;
  emptyText: string;
  early?: boolean;
}) {
  return (
    <section className="min-w-0">
      <SectionHeader
        title={title}
        description={description}
        action={
          <Link
            href={`/bids?${query}`}
            aria-label={`${title} 전체 보기`}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm type-label whitespace-nowrap text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            전체 보기
            <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
          </Link>
        }
      />
      {items === null ? (
        <p className="mt-3 border-y border-border py-4 type-label text-muted-foreground">
          목록을 불러오지 못했습니다. 데이터 새로고침으로 다시 시도하세요.
        </p>
      ) : items.length === 0 ? (
        <p className="mt-3 border-y border-border py-4 type-label text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <OpportunityReviewRows
          items={items}
          query={query}
          early={early}
          className="mt-3 border-y border-border"
        />
      )}
    </section>
  );
}

function Portfolio({ summary }: { summary: OpportunitySummary }) {
  return (
    <section className="min-w-0">
      <SectionHeader
        title="입찰 포트폴리오"
        description="권고 분포 · 입찰 프로젝트·수주 실적이 아닙니다"
      />
      <ul className={ruledList}>
        {(["BID", "WATCH", "NO_BID", "PENDING"] as const).map((key) => (
          <li key={key} className="flex items-center justify-between gap-3 py-2.5">
            {key === "PENDING" ? (
              <span className="inline-flex items-center gap-1 type-caption text-muted-foreground">
                <CircleDashedIcon aria-hidden className="size-4" />
                분석 대기
              </span>
            ) : (
              <StatusBadge kind="recommendation" value={key} variant="inline" />
            )}
            <span className="type-body font-semibold tabular-nums">
              {count(summary.portfolio[key])}건
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 type-caption wrap-anywhere text-muted-foreground">
        확인 예산{" "}
        <span className="font-mono" title={formatKrwCompact(summary.knownBudgetKrw).full}>
          {formatKrwCompact(summary.knownBudgetKrw).text}
        </span>
        <br />
        예산 미확인 {count(summary.unknownBudgetCount)}건
      </p>
    </section>
  );
}

/** 다음 정기 수집 예정. at 은 마지막 정기 수집 + 주기(없으면 null), failed 는 정기 수집 시각 조회 실패다 */
export type NextIngest = { at: string | null; failed: boolean };

// "2026-10-25 14:05" → 값 칸에는 시각, 보조 줄에는 날짜. 좁은 칸에서 값이 꺾이지 않게 나눈다.
function kstParts(iso: string): { time: string; day: string } {
  const [day = "—", time = "—"] = formatKst(iso).split(" ");
  return { time, day };
}

const latestOf = (values: (string | null)[]): string | null =>
  values
    .filter((value): value is string => value !== null && !Number.isNaN(Date.parse(value)))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
    .at(-1) ?? null;

// 오른쪽 칸의 라벨-값 한 줄. 값은 숫자 띠보다 작게, 보조 설명은 라벨 아래 줄에 둔다.
function MetricRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 py-2.5">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="type-body font-semibold text-foreground tabular-nums">{value}</dd>
      <dd className="col-span-2 type-caption wrap-anywhere text-muted-foreground">{hint}</dd>
    </div>
  );
}

function TimeRow({
  label,
  at,
  empty,
  suffix,
  late,
}: {
  label: string;
  at: string | null;
  empty: string;
  suffix?: string;
  late?: string;
}) {
  if (at === null) return <MetricRow label={label} value="—" hint={empty} />;
  const { time, day } = kstParts(at);
  return (
    <MetricRow
      label={label}
      value={time}
      hint={
        <>
          <time dateTime={at}>
            {day}
            {suffix}
          </time>
          {late !== undefined && <span className="block text-warning">{late}</span>}
        </>
      }
    />
  );
}

// 10-25 실수집 계획 B3. 값은 서버가 센다(procurement_summary·procurement_live_metrics·수집 소스 상태).
// 출처는 화면이 고른 origin 과 같다. live 는 실제 수집 출처의 공고만 센다(출처 미확인 제외).
function IngestMetrics({
  summary,
  metrics,
  sources,
  nextIngest,
  now,
}: {
  summary: OpportunitySummary;
  metrics: OpportunityLiveMetrics | null;
  sources: SourceSummary | null;
  nextIngest: NextIngest | null;
  now: Date;
}) {
  const lastSuccess = latestOf(sources?.groups.map((group) => group.lastSuccessAt) ?? []);
  const nextAt = nextIngest?.at ?? null;
  return (
    <section aria-label="수집 지표" className="min-w-0">
      <SectionHeader title="수집 지표" />
      <dl className={ruledList}>
        <MetricRow
          label="수집된 IT 공고"
          value={count(summary.totalOpportunities)}
          hint="IT 입찰공고 · 출처 사본은 1건"
        />
        <TimeRow
          label="마지막 수집 성공"
          at={lastSuccess}
          empty={sources === null ? "수집 현황 조회 실패" : "성공 기록 없음"}
        />
        {nextIngest !== null && (
          <TimeRow
            label="다음 수집 예정"
            at={nextAt}
            empty={nextIngest.failed ? "조회 실패" : "정기 수집 기록 없음"}
            suffix=" · 예정"
            late={
              nextAt !== null && Date.parse(nextAt) < now.getTime()
                ? "예정 시각 지남 · 수집 확인 필요"
                : undefined
            }
          />
        )}
        <MetricRow
          label={`진행 중 ${RECOMMENDATION_LABEL.WATCH}`}
          value={metrics === null ? "—" : count(metrics.activeWatch)}
          hint={metrics === null ? "지표 조회 실패" : "현재 유효 분석 · 진행 중"}
        />
      </dl>
    </section>
  );
}

function TopAgencies({ metrics }: { metrics: OpportunityLiveMetrics | null }) {
  return (
    <section className="min-w-0">
      <SectionHeader title="기관별 공고 수" />
      {metrics === null ? (
        <p className="mt-3 border-y border-border py-2.5 type-caption text-muted-foreground">
          지표 조회 실패
        </p>
      ) : metrics.topAgencies.length === 0 ? (
        <p className="mt-3 border-y border-border py-2.5 type-caption text-muted-foreground">
          기관이 확인된 입찰공고 없음
        </p>
      ) : (
        <ol aria-label="기관별 입찰공고 수 상위" className={ruledList}>
          {metrics.topAgencies.map((agency) => (
            <li
              key={agency.name}
              className="flex items-baseline justify-between gap-3 py-2 type-label"
            >
              <span className="min-w-0 truncate" title={agency.name}>
                {agency.name}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{count(agency.count)}건</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

type Figure = { label: string; value: string; hint: React.ReactNode };

// 공공조달 요약 숫자 띠. 이 화면에서만 쓰므로 공용 부품으로 빼지 않는다(design-system "두 번 이상 쓴 것만").
// 칸마다 라벨·값·보조 줄을 subgrid 로 같은 줄에 맞춰, 라벨이 두 줄로 꺾여도 숫자 자리가 어긋나지 않는다.
function SummaryStrip({ figures }: { figures: Figure[] }) {
  return (
    <section aria-label="공공조달 요약">
      <dl className="grid grid-cols-2 gap-y-1 border-y border-border md:grid-cols-3 xl:grid-cols-5">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="row-span-3 grid min-w-0 grid-rows-subgrid border-l border-border px-3 py-4 odd:border-l-0 md:odd:border-l xl:px-5 xl:first:border-l-0 xl:first:pl-0 xl:last:pr-0"
          >
            <dt className="type-label wrap-anywhere text-muted-foreground">{figure.label}</dt>
            <dd className="type-title text-foreground tabular-nums">{figure.value}</dd>
            <dd className="type-caption wrap-anywhere text-muted-foreground">{figure.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function DashboardView({
  summary,
  metrics,
  nextIngest,
  activeProjects,
  review,
  early,
  sources,
  reviewQuery,
  earlyQuery,
  now,
  canRunIngestion,
}: {
  summary: OpportunitySummary;
  /** 실수집 지표. null 은 조회 실패다 */
  metrics: OpportunityLiveMetrics | null;
  /** 다음 수집 예정. null 이면 줄을 숨긴다. 웹은 수집 간격 env 를 읽지 않아(정기 일정은 worker Job Scheduler) 지금은 늘 null 이다 */
  nextIngest: NextIngest | null;
  activeProjects: number | null;
  review: OpportunityItem[] | null;
  early: OpportunityItem[] | null;
  sources: SourceSummary | null;
  reviewQuery: string;
  earlyQuery: string;
  now: Date;
  canRunIngestion: boolean;
}) {
  const figures: Figure[] = [
    {
      label: "신규 발견",
      value: count(summary.newlyDiscovered),
      hint: "최근 24시간 · 입찰공고",
    },
    {
      label: "마감 임박 (7일)",
      value: count(summary.closingSoon),
      hint: "정확한 마감 확인 · 진행 중",
    },
    {
      label: "분석 대기",
      value: count(summary.pendingAnalysis),
      hint: "현재 입력의 분석 결과 없음",
    },
    {
      label: `${RECOMMENDATION_LABEL.BID} 권고`,
      value: count(summary.bidRecommended),
      hint: "현재 유효 분석 · 진행 중",
    },
    {
      label: "진행 중 입찰 프로젝트",
      value: activeProjects === null ? "—" : count(activeProjects),
      hint:
        activeProjects === null ? (
          "프로젝트 현황 조회 실패"
        ) : (
          <Link
            href="/projects"
            className="rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            종료 제외 · 프로젝트 보기
          </Link>
        ),
    },
  ];
  return (
    <>
      <DashboardAiBanner />
      {summary.isDemo && (
        <p className="type-caption text-muted-foreground">DEMO · 예시 공고 기준</p>
      )}
      {summary.origin === "all" && (
        <p className="type-caption text-muted-foreground">
          전체 출처 · DEMO 예시 공고와 출처 미확인 공고 포함
        </p>
      )}
      <SummaryStrip figures={figures} />
      {summary.totalOpportunities === 0 && <NoBidsEmptyState canRun={canRunIngestion} />}
      {(summary.sourceConflictCount ?? 0) > 0 && (
        <p className="type-label text-warning">
          출처 간 확인 필요 {count(summary.sourceConflictCount ?? 0)}건 · 별도 검토
        </p>
      )}
      {sources === null ? (
        <p className="type-label text-warning">
          수집 현황을 확인하지 못했습니다. 공고의 최신 여부를 확인하세요.
        </p>
      ) : !sources.isDemo && sources.groups.some((group) => group.status === "DEGRADED") ? (
        <p className="type-label text-warning">
          일부 출처의 수집이 미완료입니다. 공고의 최신 여부를 확인하세요.
        </p>
      ) : null}
      {metrics === null && (
        <p className="type-label text-warning">
          참고 통계를 불러오지 못했습니다. 수집 현황·참고 통계에서 확인하세요.
        </p>
      )}
      {nextIngest?.failed ? (
        <p className="type-label text-warning">다음 수집 예정 시각을 확인하지 못했습니다.</p>
      ) : nextIngest?.at && Date.parse(nextIngest.at) < now.getTime() ? (
        <p className="type-label text-warning">
          수집 예정 시각이 지났습니다. 공고의 최신 여부를 확인하세요.
        </p>
      ) : null}
      <div className="mt-4 flex min-w-0 flex-col gap-10">
        <OpportunityPanel
          title="우선 검토할 입찰"
          description={
            <>
              AI·SI 우선 · 추천순
              {summary.potentialDuplicateCount > 0 &&
                ` · 중복 후보 ${count(summary.potentialDuplicateCount)}건은 별도 사업기회로 집계됩니다.`}
            </>
          }
          items={review}
          query={reviewQuery}
          emptyText="검토할 입찰공고가 없습니다"
        />
        <OpportunityPanel
          title="예정 사업 및 사전규격"
          description="발주계획·조달요청·사전규격 · 별도 집계"
          items={early}
          query={earlyQuery}
          early
          emptyText="예정 사업 및 사전규격이 없습니다"
        />
      </div>
      <details className="min-w-0 border-t border-border pt-4 @container">
        <summary className="w-fit min-h-8 cursor-pointer content-center rounded-sm type-label text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          수집 현황·참고 통계
        </summary>
        <nav aria-label="현황 자세히 보기" className="mt-4 flex flex-wrap gap-4 type-label">
          <Link href="/market" className="underline underline-offset-4">
            발주 현황 보기
          </Link>
          {canRunIngestion && (
            <Link href="/admin/ingestion" className="underline underline-offset-4">
              데이터 수집 관리
            </Link>
          )}
        </nav>
        <div className="mt-6 grid min-w-0 grid-cols-1 items-start gap-x-12 gap-y-9 @min-[40rem]:grid-cols-2">
          <IngestMetrics
            summary={summary}
            metrics={metrics}
            sources={sources}
            nextIngest={nextIngest}
            now={now}
          />
          <OpportunitySourceStatus summary={sources} now={now} canManage={canRunIngestion} />
          <TopAgencies metrics={metrics} />
          <Portfolio summary={summary} />
        </div>
      </details>
    </>
  );
}
