import { cn } from "cn";
import { InboxIcon, InfoIcon } from "lucide-react";
import Link from "next/link";
import { BarChart } from "@/components/bar-chart";
import { dDay, formatKrwCompact, formatKst } from "@/components/bids/format";
import { MeterBar } from "@/components/bids/meter-bar";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OPPORTUNITY_CATEGORIES } from "@/components/work/opportunities-copy";
import type { MarketOverview, MarketPeriod, MarketQuery } from "@/server/market";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { MARKET_SOURCE_BADGE, marketBidHref, marketHref } from "./market-copy";

// 발주 현황(/market) 본문. 값은 서버가 센다(server/market aggregateMarket). 여기서는 그리기만 한다.
// 데이터를 읽지 않아 브라우저 시험에서 mock 값으로 그대로 그린다.

const count = (value: number) => value.toLocaleString("ko-KR");

/** 마지막 수집 성공 시각. at 이 null 이면 기록이 없거나(failed=false) 조회에 실패했다(failed=true) */
export type MarketReference = { at: string | null; failed: boolean };

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
}: {
  label: string;
  rank?: number;
  value: number;
  max: number;
  budgetKrw: string;
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
    </li>
  );
}

const maxOf = (values: number[]) => Math.max(1, ...values);

function TopAgencies({ overview }: { overview: MarketOverview }) {
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
            />
          ))}
        </ol>
      )}
    </section>
  );
}

const categoryLabel = (key: string) =>
  key === "NONE" ? "분야 미분류" : (OPPORTUNITY_CATEGORIES[key] ?? key);

function Categories({ overview }: { overview: MarketOverview }) {
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
          />
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
        description={`지금부터 ${overview.upcomingDays}일 안에 마감하는 진행 중 공고 · 배정 예산 큰 순 ${overview.upcoming.length}건`}
      />
      {overview.upcoming.length === 0 ? (
        <p className={emptyLine}>
          {overview.upcomingDays}일 안에 마감하는, 예산이 확인된 공고가 없습니다
        </p>
      ) : (
        <div className="mt-3 border-y border-border">
          <Table>
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
                        <span className="ml-1.5 type-caption text-muted-foreground">
                          {day.label}
                        </span>
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
        </div>
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
          {query.relevance === "relevant"
            ? `SI·AI 관련만 · 전체 업종 ${count(totals.allIndustryNotices)}건`
            : "전체 업종"}
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
      <ul className="flex rounded-lg border border-border p-0.5">
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              className="inline-flex h-7 items-center rounded-md px-3 type-label whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
            >
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** 화면 머리(AppPage actions)의 기간·업종 범위 거르기. 둘 다 주소 쿼리로 든다 */
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
      <Segmented
        label="업종 범위"
        items={[
          {
            href: marketHref({ ...query, relevance: "relevant" }),
            text: "SI·AI 관련",
            current: query.relevance === "relevant",
          },
          {
            href: marketHref({ ...query, relevance: "all" }),
            text: "전체 업종",
            current: query.relevance === "all",
          },
        ]}
      />
    </div>
  );
}

export function MarketView({
  overview,
  reference,
  now,
}: {
  overview: MarketOverview;
  reference: MarketReference;
  now: Date;
}) {
  const { totals, query } = overview;
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
          title={`최근 ${query.period}일 안에 게시된 입찰공고가 없습니다`}
          description={
            query.relevance === "relevant" && totals.allIndustryNotices > 0
              ? `전체 업종으로 보면 ${count(totals.allIndustryNotices)}건이 있습니다.`
              : "수집 현황은 대시보드에서 확인하세요."
          }
          action={
            query.relevance === "relevant" && totals.allIndustryNotices > 0 ? (
              <Link
                href={marketHref({ ...query, relevance: "all" })}
                className={cn(buttonVariants({ variant: "outline" }))}
              >
                전체 업종 보기
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* 칸 수는 화면 폭이 아니라 단 폭으로 정한다. 사이드바를 접고 펴도 같은 규칙이다. */}
          <div className="@container">
            <div className="grid grid-cols-1 gap-x-12 gap-y-10 @min-[56rem]:grid-cols-2">
              <TopAgencies overview={overview} />
              <div className="flex min-w-0 flex-col gap-10">
                <Categories overview={overview} />
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
