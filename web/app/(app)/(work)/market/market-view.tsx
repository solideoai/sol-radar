import { cn } from "cn";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  InboxIcon,
  InfoIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { BarChart } from "@/components/bar-chart";
import { dDay, formatKrwCompact, formatKst } from "@/components/bids/format";
import { MeterBar } from "@/components/bids/meter-bar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OPPORTUNITY_CATEGORIES } from "@/components/work/opportunities-copy";
import type { GapBucket } from "@/server/gaps";
import type {
  MarketGapCounts,
  MarketGapOverlay,
  MarketOverview,
  MarketPeriod,
  MarketQuery,
} from "@/server/market";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { MARKET_SOURCE_BADGE, marketBidHref, marketHref } from "./market-copy";

// 발주 현황(/market) 본문. 값은 서버가 센다(server/market aggregateMarket). 여기서는 그리기만 한다.
// 데이터를 읽지 않아 브라우저 시험에서 mock 값으로 그대로 그린다.

const count = (value: number) => value.toLocaleString("ko-KR");

/** 마지막 수집 성공 시각. at 이 null 이면 기록이 없거나(failed=false) 조회에 실패했다(failed=true) */
export type MarketReference = { at: string | null; failed: boolean };

/** 겹쳐 보기(§6 B2) 문구·주소. gaps 배럴이 server-only 라 페이지가 모아 내린다(/gaps 화면과 같은 방식) */
export type MarketGapCopy = { bucketLabels: Record<GapBucket, string>; gapsHref: string };

type GapRows = { counts: Record<string, MarketGapCounts>; labels: Record<GapBucket, string> };

const GAP_BUCKET_ORDER: GapBucket[] = ["ELIGIBLE", "MISSING_RECORD", "NOT_HELD", "NEEDS_REVIEW"];
// /gaps 묶음 띠와 같은 아이콘·색(gaps-sections BUCKET_ICON). 색만으로 나누지 않게 늘 묶음 이름과 함께 그린다.
const GAP_BUCKET_ICON: Record<GapBucket, { icon: LucideIcon; className: string }> = {
  ELIGIBLE: { icon: CircleCheckIcon, className: "text-success" },
  MISSING_RECORD: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  NOT_HELD: { icon: CircleXIcon, className: "text-destructive" },
  NEEDS_REVIEW: { icon: CircleHelpIcon, className: "text-warning" },
};

function SectionHeader({
  id,
  title,
  description,
}: {
  id: string;
  title: string;
  description: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h2 id={id} className="type-heading text-foreground">
        {title}
      </h2>
      <p className="mt-0.5 type-caption wrap-anywhere text-muted-foreground">{description}</p>
    </div>
  );
}

const ruledList = "mt-3 divide-y divide-border border-y border-border";
const emptyLine = "mt-3 border-y border-border py-4 type-label text-muted-foreground";

function Budget({ krw }: { krw: string }) {
  const value = formatKrwCompact(krw);
  return krw === "0" ? (
    <span title="확인된 예산 없음">예산 —</span>
  ) : (
    <span className="font-mono" title={value.full}>
      {value.text}
    </span>
  );
}

// 이름 · 건수 · 확인 예산 한 줄과 건수 막대. 막대 길이는 같은 목록의 가장 큰 건수에 맞춘다.
function BarRow({
  label,
  rank,
  value,
  max,
  budgetKrw,
  children,
}: {
  label: string;
  rank?: number;
  value: number;
  max: number;
  budgetKrw: string;
  /** 막대 아래 줄(겹쳐 보기). 순위가 있으면 막대와 같이 들여 쓴다 */
  children?: React.ReactNode;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-baseline justify-between gap-3 type-label">
        <span className="flex min-w-0 items-baseline gap-2">
          {rank === undefined ? null : (
            <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">
              {rank}
            </span>
          )}
          <span className="min-w-0 truncate text-foreground" title={label}>
            {label}
          </span>
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="font-semibold text-foreground">{count(value)}건</span>
          <span className="text-muted-foreground">
            {" · "}
            <Budget krw={budgetKrw} />
          </span>
        </span>
      </div>
      <MeterBar
        value={value}
        max={max}
        label={`${label} 공고 수`}
        valueText={`${count(value)}건`}
        tone="brand"
        className={cn("mt-1.5", rank === undefined ? null : "ml-7 w-[calc(100%-1.75rem)]")}
      />
      {children === undefined ? null : (
        <div className={rank === undefined ? undefined : "ml-7"}>{children}</div>
      )}
    </li>
  );
}

// 행 하나의 판정 묶음 분포. 0건인 묶음은 빼고, 마감 전 공고 수를 앞에 둔다.
function GapLine({
  counts,
  labels,
}: {
  counts: MarketGapCounts | undefined;
  labels: GapRows["labels"];
}) {
  const open = counts?.open ?? 0;
  return (
    <p
      data-slot="market-gap-line"
      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 type-caption text-muted-foreground"
    >
      <span className="tabular-nums">
        {open === 0 ? "마감 전 공고 없음" : `마감 전 ${count(open)}건`}
      </span>
      {GAP_BUCKET_ORDER.map((bucket) => {
        const value = counts?.buckets[bucket] ?? 0;
        if (value === 0) return null;
        const { icon: Icon, className } = GAP_BUCKET_ICON[bucket];
        return (
          <span
            key={bucket}
            data-bucket={bucket}
            className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums"
          >
            <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />
            {labels[bucket]} {count(value)}건
          </span>
        );
      })}
    </p>
  );
}

// 겹쳐 보기 안내 한 줄. 프로필이 없으면(NO_PROFILE) 아무것도 그리지 않는다.
function GapOverlayNote({ overlay, copy }: { overlay: MarketGapOverlay; copy: MarketGapCopy }) {
  if (overlay.status === "NO_PROFILE") return null;
  if (overlay.status === "FAILED")
    return (
      <p
        data-slot="market-gap-note"
        className="flex items-start gap-2 type-caption wrap-anywhere text-muted-foreground"
      >
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
        자격 판정 묶음을 불러오지 못해 기관·분야 행에 겹쳐 보지 않습니다. 발주 집계는 그대로입니다.
      </p>
    );
  return (
    <p
      data-slot="market-gap-note"
      className="flex items-start gap-2 type-caption wrap-anywhere text-muted-foreground"
    >
      <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span>
        기관·분야 행 아래 자격 판정 묶음은 기간 내 공고 중 지금 마감이 남은 것(마감 전 공고)
        기준입니다 · 자격 갭 레이더는 게시 기간과 무관하게 마감 전 공고 전부를 봅니다 · 회사 프로필
        r{overlay.profile.revision}({overlay.profile.isDemo ? "가상" : "공개 자료"})과 대조
        {overlay.unmatched > 0
          ? ` · 판정을 찾지 못한 ${count(overlay.unmatched)}건은 묶음에서 뺌`
          : ""}
        {" · "}
        <Link
          href={copy.gapsHref}
          className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          자격 갭 레이더에서 근거 보기
        </Link>
      </span>
    </p>
  );
}

const maxOf = (values: number[]) => Math.max(1, ...values);

function TopAgencies({ overview, gap }: { overview: MarketOverview; gap: GapRows | null }) {
  const max = maxOf(overview.topAgencies.map((agency) => agency.count));
  return (
    <section aria-labelledby="market-agencies" className="min-w-0">
      <SectionHeader
        id="market-agencies"
        title="상위 발주기관"
        description={`수요기관 ${count(overview.agencyCount)}곳 중 공고 수 순 ${overview.topAgencies.length}곳 · 건수 · 확인 예산 합`}
      />
      {overview.topAgencies.length === 0 ? (
        <p className={emptyLine}>기관이 확인된 공고가 없습니다</p>
      ) : (
        <ol aria-label="공고 수 상위 발주기관" className={ruledList}>
          {overview.topAgencies.map((agency, index) => (
            <BarRow
              key={agency.name}
              rank={index + 1}
              label={agency.name}
              value={agency.count}
              max={max}
              budgetKrw={agency.knownBudgetKrw}
            >
              {gap === null ? undefined : (
                <GapLine counts={gap.counts[agency.name]} labels={gap.labels} />
              )}
            </BarRow>
          ))}
        </ol>
      )}
    </section>
  );
}

const categoryLabel = (key: string) =>
  key === "NONE" ? "분야 미분류" : (OPPORTUNITY_CATEGORIES[key] ?? key);

function Categories({ overview, gap }: { overview: MarketOverview; gap: GapRows | null }) {
  const max = maxOf(overview.categories.map((category) => category.count));
  return (
    <section aria-labelledby="market-categories" className="min-w-0">
      <SectionHeader
        id="market-categories"
        title="분야별 공고"
        description="수집 때 관련성 판정이 붙인 분야 · 공고 하나가 여러 분야에 들 수 있습니다"
      />
      <ul aria-label="분야별 공고 수" className={ruledList}>
        {overview.categories.map((category) => (
          <BarRow
            key={category.key}
            label={categoryLabel(category.key)}
            value={category.count}
            max={max}
            budgetKrw={category.knownBudgetKrw}
          >
            {gap === null ? undefined : (
              <GapLine counts={gap.counts[category.key]} labels={gap.labels} />
            )}
          </BarRow>
        ))}
      </ul>
    </section>
  );
}

const krwText = (krw: string) => formatKrwCompact(krw).text;
const bandLabel = (band: MarketOverview["budgetBands"][number]) =>
  band.minKrw === null
    ? "예산 미확인 · 출처 간 금액 불일치"
    : band.maxKrw === null
      ? `${krwText(band.minKrw)} 이상`
      : band.minKrw === "0"
        ? `${krwText(band.maxKrw)} 미만`
        : `${krwText(band.minKrw)} 이상 ${krwText(band.maxKrw)} 미만`;

function BudgetBands({ overview }: { overview: MarketOverview }) {
  const max = maxOf(overview.budgetBands.map((band) => band.count));
  return (
    <section aria-labelledby="market-bands" className="min-w-0">
      <SectionHeader
        id="market-bands"
        title="예산 규모별 공고"
        description="공고의 배정 예산 기준 · 구간은 하한 이상 상한 미만"
      />
      <ul aria-label="예산 구간별 공고 수" className={ruledList}>
        {overview.budgetBands.map((band) => (
          <BarRow
            key={band.key}
            label={bandLabel(band)}
            value={band.count}
            max={max}
            budgetKrw={band.knownBudgetKrw}
          />
        ))}
      </ul>
    </section>
  );
}

// "2026-10-26" → "10. 26."(KST 날짜 글자)
const weekLabel = (date: string) => {
  const [, month = "", day = ""] = date.split("-");
  return `${Number(month)}. ${Number(day)}.`;
};

function WeeklyTrend({ overview }: { overview: MarketOverview }) {
  return (
    <section aria-labelledby="market-weekly" className="min-w-0">
      <SectionHeader
        id="market-weekly"
        title="주별 게시 추이"
        description={`최근 ${overview.weekly.length}주 · 월요일 시작(KST) · 기간 선택과 별개 · 이번 주는 진행 중`}
      />
      <BarChart
        className="mt-4"
        caption="주별 게시 입찰공고 수(주 시작 월요일, KST)"
        valueHeader="게시 공고 수"
        unit="건"
        days={overview.weekly.map((week) => ({
          date: week.weekStart,
          label: weekLabel(week.weekStart),
          count: week.count,
        }))}
      />
    </section>
  );
}

function Upcoming({ overview, now }: { overview: MarketOverview; now: Date }) {
  return (
    <section aria-labelledby="market-upcoming" className="min-w-0">
      <SectionHeader
        id="market-upcoming"
        title="마감 다가오는 큰 사업"
        description={`기간 선택과 별개로 ${weekLabel(overview.upcomingFromDate)} 이후 게시분 중 지금부터 ${overview.upcomingDays}일 안에 마감하는 진행 중 공고 · 예산 확인분을 배정 예산 큰 순으로 ${overview.upcoming.length}건`}
      />
      {overview.upcoming.length === 0 ? (
        <p className={emptyLine}>
          {overview.upcomingDays}일 안에 마감하는, 예산이 확인된 공고가 없습니다
        </p>
      ) : (
        <Table containerClassName="mt-3">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50%]">공고명</TableHead>
              <TableHead>수요기관</TableHead>
              <TableHead className="w-44">마감</TableHead>
              <TableHead className="w-28 text-right">배정 예산</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.upcoming.map((item) => {
              const day = dDay(item.deadlineAt, now);
              const budget = formatKrwCompact(item.budgetKrw);
              return (
                <TableRow key={item.bidId}>
                  <TableCell className="max-w-0 whitespace-normal">
                    <Link
                      href={marketBidHref(item.bidId)}
                      className="line-clamp-2 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-0">
                    <span className="block truncate" title={item.agency ?? undefined}>
                      {item.agency ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    <time dateTime={item.deadlineAt}>{formatKst(item.deadlineAt)}</time>
                    {day ? (
                      <span className="ml-1.5 type-caption text-muted-foreground">{day.label}</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <span title={budget.full}>{budget.text}</span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

type Figure = { label: string; value: string; title?: string; hint: React.ReactNode };

// 요약 숫자 띠. 모양은 대시보드 숫자 띠와 같다(칸마다 라벨·값·보조 줄을 subgrid 로 맞춘다).
function SummaryStrip({ figures }: { figures: Figure[] }) {
  return (
    <section aria-label="발주 현황 요약">
      <dl className="grid grid-cols-4 gap-y-1 border-y border-border">
        {figures.map((figure) => (
          <div
            key={figure.label}
            className="row-span-3 grid min-w-0 grid-rows-subgrid border-l border-border px-5 py-4 first:border-l-0 first:pl-0 last:pr-0"
          >
            <dt className="type-label wrap-anywhere text-muted-foreground">{figure.label}</dt>
            <dd className="type-title text-foreground tabular-nums" title={figure.title}>
              {figure.value}
            </dd>
            <dd className="type-caption wrap-anywhere text-muted-foreground">{figure.hint}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function figuresOf(overview: MarketOverview, reference: MarketReference): Figure[] {
  const { totals, query } = overview;
  const budget = formatKrwCompact(totals.knownBudgetKrw);
  const [day = "—", time = "—"] = reference.at === null ? [] : formatKst(reference.at).split(" ");
  return [
    {
      label: `최근 ${query.period}일 게시 공고`,
      value: count(totals.notices),
      hint: (
        <>
          {weekLabel(overview.periodStartDate)} 이후 게시 · 취소 {count(totals.cancelledNotices)}건
          제외
          <br />
          IT 공고만
        </>
      ),
    },
    {
      label: "배정 예산 합",
      value: budget.text,
      title: budget.full,
      hint: `예산 미확인 ${count(totals.unknownBudgetCount)}건 제외`,
    },
    {
      label: "마감 전 공고",
      value: count(totals.openNotices),
      hint: "기간 내 공고 중 지금 마감이 남은 것",
    },
    {
      label: "기준 시각",
      value: time,
      hint:
        reference.at === null ? (
          reference.failed ? (
            "수집 기록 조회 실패"
          ) : (
            "수집 성공 기록 없음"
          )
        ) : (
          <time dateTime={reference.at}>{day} KST · 마지막 수집 성공</time>
        ),
    },
  ];
}

// 거르기 링크 묶음. 주소만 바꾸는 링크라 탭(role="tablist")이 아니라 링크 + aria-current 다.
function Segmented({
  label,
  items,
}: {
  label: string;
  items: { href: string; text: string; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex items-center gap-2">
      <span className="type-label text-muted-foreground">{label}</span>
      <ul className="inline-flex rounded-lg border border-border p-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className="inline-flex items-center rounded-md px-3 py-1 type-label whitespace-nowrap text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-selected-foreground"
            >
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 화면 머리(AppPage actions)의 기간 거르기. 주소 쿼리로 든다. 업종 범위는 늘 IT 공고다(ADR-069) */
export function MarketFilters({
  query,
  periods,
}: {
  query: MarketQuery;
  periods: readonly MarketPeriod[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      <Segmented
        label="기간"
        items={periods.map((period) => ({
          href: marketHref({ ...query, period }),
          text: `최근 ${period}일`,
          current: period === query.period,
        }))}
      />
    </div>
  );
}

export function MarketView({
  overview,
  reference,
  now,
  gapCopy,
}: {
  overview: MarketOverview;
  reference: MarketReference;
  now: Date;
  gapCopy: MarketGapCopy;
}) {
  const { totals, query, gapOverlay } = overview;
  const ready = gapOverlay.status === "READY" ? gapOverlay : null;
  const labels = gapCopy.bucketLabels;
  return (
    <>
      <p className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 type-label text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {MARKET_SOURCE_BADGE}
      </p>
      <SummaryStrip figures={figuresOf(overview, reference)} />
      {totals.notices === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title={`최근 ${query.period}일 안에 게시된 IT 공고가 없습니다`}
          description="수집 현황은 대시보드에서 확인하세요."
        />
      ) : (
        <>
          {/* 칸 수는 화면 폭이 아니라 단 폭으로 정한다. 사이드바를 접고 펴도 같은 규칙이다. */}
          <div className="flex flex-col gap-4 @container">
            <GapOverlayNote overlay={gapOverlay} copy={gapCopy} />
            <div className="grid grid-cols-1 gap-x-12 gap-y-10 @min-[56rem]:grid-cols-2">
              <TopAgencies overview={overview} gap={ready && { counts: ready.agencies, labels }} />
              <div className="flex min-w-0 flex-col gap-10">
                <Categories
                  overview={overview}
                  gap={ready && { counts: ready.categories, labels }}
                />
                <BudgetBands overview={overview} />
              </div>
            </div>
          </div>
          <WeeklyTrend overview={overview} />
          <Upcoming overview={overview} now={now} />
        </>
      )}
    </>
  );
}
