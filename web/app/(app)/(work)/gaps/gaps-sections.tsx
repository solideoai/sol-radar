"use client";

import {
  ArrowRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Fragment, useId, useState } from "react";
import { cn } from "cn";
import {
  dDay,
  formatKrwCompact,
  formatKrwFull,
  formatKst,
  formatKstShort,
} from "@/components/bids/format";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { BlockerKind, BlockerRow, GapBucket, GapSummary, OpenedNotice } from "@/server/gaps";
import { formatCount, formatCountDelta, formatEok, formatEokDelta } from "./gaps-format";
import type { AssumeCode, GapsCopy, ReadyGapView } from "./gaps-props";

// 자격 갭 레이더의 구역들(디자인 스펙 docs/plans/2026-10-28-gaps-ui-spec.md §4).
// 요약 띠·막는 자격 표는 늘 원래 값이다. 가정 값은 점선 "가정 시나리오" 띠와 "새로 열리는 공고" 구역에만 나온다(ADR-037).
// 화면 글자에 승률·확률·가능성·수주·% 를 쓰지 않는다. 확률·수주는 계약의 고정 문구(부정문)에만 있다.

export const OPENED_SECTION_ID = "gaps-opened";

const PULSE = "motion-reduce:animate-none";
const TEXT_LINK =
  "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";
// 공고 상세 ProfileBadge 와 같은 출처 배지 모양. 출처 배지라 Chip 으로 바꾸지 않는다(2026-10-28 화면 개편).
const PROFILE_BADGE_CLASS =
  "inline-flex h-5 max-w-full shrink-0 items-center whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-foreground";
const FIRST_ROWS = 10;
const MORE_STEP = 10;

// ── 머리 메타 ──

// 공고 상세 ProfileBadge 와 같은 글자·툴팁(bids/[id]/bid-detail-view.tsx). 그 파일은 이 작업 범위 밖이라 같은 값을 여기 둔다.
const PROFILE_BADGE = { demo: "가상 회사 프로필로 분석", live: "공개 자료 회사 프로필로 분석" };
const PROFILE_TOOLTIP = {
  demo: "실제 공고를 가상 솔리데오 프로필과 대조한 결과입니다",
  live: "공개 자료(홈페이지·기사·채용공고·나라장터 계약·DART 공시·협회 등록 조회)로 만든 솔리데오 프로필과 대조한 결과입니다. 선호 분야는 회사가 정한 선택값입니다. 공개되지 않은 실적·자격은 들어 있지 않습니다",
};

function ProfileBadge({ isDemo }: { isDemo: boolean }) {
  const kind = isDemo ? "demo" : "live";
  return (
    <Tooltip landmark>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={cn(
          PROFILE_BADGE_CLASS,
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        {PROFILE_BADGE[kind]}
      </TooltipTrigger>
      <TooltipContent>{PROFILE_TOOLTIP[kind]}</TooltipContent>
    </Tooltip>
  );
}

export function GapsMeta({ view, copy }: { view: ReadyGapView; copy: GapsCopy }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 type-caption text-muted-foreground">
        <ProfileBadge isDemo={view.profile.isDemo} />
      </div>
      <p className="type-caption wrap-anywhere text-muted-foreground">{copy.sourceNotice}</p>
    </div>
  );
}

/** 계약의 상단 고정 문구 두 줄(§4.2). 상자·아이콘 없이 늘 보인다. */
export function FixedNotices({ copy }: { copy: GapsCopy }) {
  return (
    <div data-slot="gaps-fixed-notices" className="flex flex-col gap-0.5">
      <p className="type-label wrap-anywhere text-foreground">{copy.scopeNotice}</p>
      <p className="type-label wrap-anywhere text-foreground">{copy.budgetNotice}</p>
    </div>
  );
}

// ── 요약 띠 ──

const BUCKET_ICON: Record<GapBucket, { icon: LucideIcon; className: string }> = {
  ELIGIBLE: { icon: CircleCheckIcon, className: "text-success" },
  MISSING_RECORD: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  NOT_HELD: { icon: CircleXIcon, className: "text-destructive" },
  NEEDS_REVIEW: { icon: CircleHelpIcon, className: "text-warning" },
};

const STRIP_BUCKETS: GapBucket[] = ["ELIGIBLE", "MISSING_RECORD", "NOT_HELD", "NEEDS_REVIEW"];

function BudgetText({ won, prefix }: { won: string; prefix?: string }) {
  return (
    <span title={formatKrwFull(won)} className="whitespace-nowrap tabular-nums">
      {prefix}
      {formatEok(won)}
    </span>
  );
}

function CountValue({ count }: { count: number }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="type-title text-foreground tabular-nums">{formatCount(count)}</span>
      <span className="type-body text-muted-foreground">건</span>
    </span>
  );
}

// 대시보드 SummaryStrip 과 같은 마크업(dashboard-view.tsx). 칸마다 라벨·값·보조 줄을 subgrid 로 같은 줄에 맞춘다.
export function SummaryStrip({ view, copy }: { view: ReadyGapView; copy: GapsCopy }) {
  const { summary } = view.radar;
  return (
    <section aria-label="자격 갭 요약">
      <dl className="grid grid-cols-2 gap-y-1 border-y border-border md:grid-cols-3 xl:grid-cols-5">
        <div className="row-span-3 grid min-w-0 grid-rows-subgrid border-l border-border px-3 py-3 odd:border-l-0 md:odd:border-l xl:px-5 xl:first:border-l-0 xl:first:pl-0">
          <dt className="type-label wrap-anywhere text-muted-foreground">대상 공고</dt>
          <dd>
            <CountValue count={summary.total.count} />
          </dd>
          <dd className="type-caption wrap-anywhere text-muted-foreground">
            마감 전 · IT 공고 · <BudgetText won={summary.total.budgetKrw} prefix="예산 합 " />
          </dd>
        </div>
        {STRIP_BUCKETS.map((bucket) => {
          const { icon: Icon, className } = BUCKET_ICON[bucket];
          const total = summary.buckets[bucket];
          return (
            <div
              key={bucket}
              data-bucket={bucket}
              className="row-span-3 grid min-w-0 grid-rows-subgrid border-l border-border px-3 py-3 odd:border-l-0 md:odd:border-l xl:px-5 xl:last:pr-0"
            >
              <dt className="flex items-start gap-1.5 type-label wrap-anywhere text-muted-foreground">
                <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", className)} />
                {copy.bucketLabels[bucket]}
              </dt>
              <dd>
                <CountValue count={total.count} />
              </dd>
              <dd className="type-caption wrap-anywhere text-muted-foreground">
                <BudgetText won={total.budgetKrw} prefix="예산 합 " />
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// ── 가정 시나리오 띠 ──

function Arrow() {
  return (
    <ArrowRightIcon
      aria-hidden="true"
      className="size-4 shrink-0 self-center text-muted-foreground"
    />
  );
}

function Figure({
  label,
  before,
  after,
  delta,
}: {
  label: string;
  before: React.ReactNode;
  after: React.ReactNode;
  delta: string;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="type-label text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-3">
        <span className="sr-only">원래</span>
        {before}
        <Arrow />
        <span className="sr-only">가정</span>
        {after}
        <span className="sr-only">차이</span>
        <span className="type-label font-semibold text-foreground tabular-nums">{delta}</span>
      </dd>
    </div>
  );
}

function EokValue({ won }: { won: string }) {
  return (
    <span title={formatKrwFull(won)} className="type-title text-foreground tabular-nums">
      {formatEok(won)}
    </span>
  );
}

const MOVED_BUCKETS: GapBucket[] = ["MISSING_RECORD", "NOT_HELD", "NEEDS_REVIEW"];

function movementText(before: GapSummary, after: GapSummary, copy: GapsCopy): string {
  return MOVED_BUCKETS.map((bucket) => {
    const from = before.buckets[bucket].count;
    const to = after.buckets[bucket].count;
    const label = copy.bucketLabels[bucket];
    return from === to
      ? `${label} 변화 없음`
      : `${label} ${formatCount(from)} → ${formatCount(to)}건`;
  }).join(" · ");
}

const BAND_GUIDE =
  "아래 막는 자격 표에서 '보유 가정'을 켜면, 그 자격을 가졌다고 가정했을 때 참가 가능(API 기준) 공고 수와 배정 예산 합이 어떻게 바뀌는지 여기에 보입니다.";

/**
 * 점선 띠(공고 상세 WhatIfBand 와 같은 겉모양). 자리를 늘 차지하고, 가정이 없을 때·계산 중·결과 모두 같은 줄 수를 써서
 * 스위치를 켜도 아래 표가 밀리지 않는다(§4.3).
 */
export function AssumptionBand({
  view,
  copy,
  pending,
  titleRef,
  clearControl,
}: {
  view: ReadyGapView;
  copy: GapsCopy;
  pending: boolean;
  titleRef: React.Ref<HTMLHeadingElement>;
  clearControl: React.ReactNode;
}) {
  const titleId = useId();
  const { assumption } = view;
  const before = view.radar.summary;
  const eligibleLabel = copy.bucketLabels.ELIGIBLE;
  return (
    <section
      data-slot="gaps-assumption-band"
      aria-labelledby={titleId}
      aria-busy={pending || undefined}
      className="flex min-h-43 flex-col gap-2 rounded-lg border border-dashed border-muted-foreground bg-background p-3"
    >
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h2
            id={titleId}
            ref={titleRef}
            tabIndex={-1}
            className="type-heading text-foreground outline-none"
          >
            가정 시나리오
          </h2>
          {assumption !== null && !pending && (
            <>
              <span className="type-label text-muted-foreground">켠 가정</span>
              {assumption.codes.map(({ code, name }) => (
                // 공고 상세 가정 띠(what-if-band.tsx)와 같은 칩이다.
                <Chip
                  key={code}
                  size="sm"
                  title={`${name} 보유`}
                  className="max-w-full shrink-0 whitespace-nowrap"
                >
                  <span className="min-w-0 truncate">{name} 보유</span>
                </Chip>
              ))}
            </>
          )}
        </div>
        {assumption !== null && !pending && clearControl}
      </div>
      <div className="min-h-14">
        {pending ? (
          <div aria-hidden className="grid grid-cols-2 gap-x-8">
            <Skeleton className={cn("h-14 w-full", PULSE)} />
            <Skeleton className={cn("h-14 w-full", PULSE)} />
          </div>
        ) : assumption === null ? (
          <p className="type-body text-muted-foreground">{BAND_GUIDE}</p>
        ) : (
          <dl data-slot="gaps-assumption-figures" className="grid grid-cols-2 gap-x-8 gap-y-2">
            <Figure
              label={eligibleLabel}
              before={<CountValue count={before.buckets.ELIGIBLE.count} />}
              after={<CountValue count={assumption.summary.buckets.ELIGIBLE.count} />}
              delta={formatCountDelta(
                before.buckets.ELIGIBLE.count,
                assumption.summary.buckets.ELIGIBLE.count,
              )}
            />
            <Figure
              label="배정 예산 합"
              before={<EokValue won={before.buckets.ELIGIBLE.budgetKrw} />}
              after={<EokValue won={assumption.summary.buckets.ELIGIBLE.budgetKrw} />}
              delta={formatEokDelta(
                before.buckets.ELIGIBLE.budgetKrw,
                assumption.summary.buckets.ELIGIBLE.budgetKrw,
              )}
            />
          </dl>
        )}
      </div>
      <p className="min-h-4 type-caption wrap-anywhere text-muted-foreground">
        {assumption !== null && !pending && movementText(before, assumption.summary, copy)}
      </p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p data-slot="gaps-assumption-notice" className="type-label text-foreground">
          {copy.assumptionNotice}
        </p>
        {assumption !== null && !pending && (
          <a
            href={`#${OPENED_SECTION_ID}`}
            className={cn("type-label text-foreground underline", TEXT_LINK)}
          >
            새로 열리는 공고 {formatCount(assumption.opened.length)}건 보기
          </a>
        )}
      </div>
    </section>
  );
}

// ── 막는 자격 표 ──

const KIND_ICON: Record<BlockerKind, { icon: LucideIcon; className: string }> = {
  MISSING_RECORD: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  NOT_HELD: { icon: CircleXIcon, className: "text-destructive" },
  OUT_OF_DICTIONARY: { icon: CircleHelpIcon, className: "text-warning" },
};

const BLOCKERS_HINT =
  "'보유 가정'을 켜면 저장하지 않고 서버에서 다시 계산합니다. 위 요약과 이 표의 숫자는 원래 값 그대로입니다.";
const BUNDLED_FOOTNOTE =
  "조건 묶음 포함: 이 업종이 다른 업종과 함께 걸린 면허제한 2행 이상 공고입니다. AND/OR 를 확인하지 못해 사람 확인 필요로 셉니다. 묶인 업종을 모두 보유하면(가정 포함) AND/OR 와 상관없이 참가 가능으로 셉니다.";

/** 이 행에 "보유 가정" 스위치를 다는지. 사전 코드가 있고 회사 기록 없음·미보유인 행만이다(사전 밖은 가정할 수 없다). */
const isAssumable = (row: BlockerRow): row is BlockerRow & { code: AssumeCode } =>
  row.code !== null && row.kind !== "OUT_OF_DICTIONARY";

// 합친 행의 API 코드 목록("7101·7102·…")은 숫자 가운데가 아니라 가운뎃점 뒤에서 줄을 바꾼다.
function ApiCodes({ apiCode }: { apiCode: string }) {
  return apiCode.split("·").map((part, index) => (
    <Fragment key={`${index}:${part}`}>
      {index > 0 && (
        <>
          ·<wbr />
        </>
      )}
      {part}
    </Fragment>
  ));
}

function IndustryNote({ row, copy }: { row: BlockerRow; copy: GapsCopy }) {
  const dictionary =
    row.code !== null
      ? `사전: ${copy.dictionaryNames[row.code] ?? row.code}`
      : copy.blockerKindLabels.OUT_OF_DICTIONARY;
  return (
    <span className="block type-caption wrap-anywhere text-muted-foreground">
      {row.apiCode !== null && (
        <>
          {"API "}
          <ApiCodes apiCode={row.apiCode} />
          {" · "}
        </>
      )}
      {dictionary}
    </span>
  );
}

// 공고 상세 AssumptionSwitch 와 같은 묶음(qualification-checklist.tsx). 이름은 "{업종 이름} 보유 가정"이다(WCAG 2.5.3).
function AssumeSwitch({
  nameId,
  hintId,
  code,
  checked,
  disabled,
  onToggle,
}: {
  nameId: string;
  hintId: string;
  code: AssumeCode;
  checked: boolean;
  /** 이동(서버 재계산) 중. 겹쳐 누르면 앞의 조작이 사라지므로 끝날 때까지 막는다. */
  disabled: boolean;
  onToggle: (code: AssumeCode, on: boolean) => void;
}) {
  const switchId = useId();
  const labelId = useId();
  return (
    <div className="flex items-center gap-2">
      <Label id={labelId} htmlFor={switchId} className="text-foreground">
        보유 가정
      </Label>
      <Switch
        id={switchId}
        data-slot="gaps-assume-switch"
        data-code={code}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onToggle(code, next)}
        aria-labelledby={`${nameId} ${labelId}`}
        aria-describedby={hintId}
      />
    </div>
  );
}

function BlockerTableRow({
  row,
  rank,
  copy,
  hintId,
  assumed,
  pending,
  onToggle,
}: {
  row: BlockerRow;
  rank: number;
  copy: GapsCopy;
  hintId: string;
  assumed: readonly AssumeCode[];
  pending: boolean;
  onToggle: (code: AssumeCode, on: boolean) => void;
}) {
  const nameId = useId();
  const { icon: Icon, className } = KIND_ICON[row.kind];
  return (
    <TableRow data-blocker={`${row.kind}|${row.key}`} className="hover:bg-transparent">
      <TableCell className="type-label text-muted-foreground tabular-nums">{rank}</TableCell>
      <th scope="row" className="px-3 py-2.5 text-left align-middle font-normal">
        <span id={nameId} className="block type-body wrap-anywhere text-foreground">
          {row.name}
        </span>
        <IndustryNote row={row} copy={copy} />
      </th>
      <TableCell className="whitespace-normal">
        <span className="inline-flex items-start gap-1.5 type-label text-foreground">
          <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", className)} />
          {copy.blockerKindLabels[row.kind]}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatCount(row.count)}건
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <BudgetText won={row.budgetKrw} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {row.bundledReviewCount > 0 ? `${formatCount(row.bundledReviewCount)}건` : "—"}
      </TableCell>
      <TableCell>
        {isAssumable(row) ? (
          <AssumeSwitch
            nameId={nameId}
            hintId={hintId}
            code={row.code}
            checked={assumed.includes(row.code)}
            disabled={pending}
            onToggle={onToggle}
          />
        ) : (
          <span className="type-caption text-muted-foreground">가정 불가</span>
        )}
      </TableCell>
    </TableRow>
  );
}

export function BlockerTable({
  view,
  copy,
  assumed,
  pending,
  onToggle,
}: {
  view: ReadyGapView;
  copy: GapsCopy;
  /** 스위치에 보일 켠 코드(낙관적 값). */
  assumed: readonly AssumeCode[];
  /** 이동(서버 재계산) 중이면 스위치를 막는다. */
  pending: boolean;
  onToggle: (code: AssumeCode, on: boolean) => void;
}) {
  const headingId = useId();
  const hintId = useId();
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const rows = view.radar.blockers;
  const shown = expanded ? rows : rows.slice(0, FIRST_ROWS);
  const hidden = rows.length - FIRST_ROWS;
  const excluded = excludedNotHeldCount(view);
  return (
    <section
      data-slot="gaps-blockers"
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col"
    >
      <h2 id={headingId} className="type-heading text-foreground">
        막는 자격
      </h2>
      <p className="mt-0.5 type-caption wrap-anywhere text-muted-foreground">
        자격 하나만 보유로 확인되면(회사 기록 없음·미보유) 참가 가능(API 기준)으로 셀 수 있는 공고를
        자격별로 묶었습니다. 사전 밖 업종은 사람 확인 필요입니다. 공고 수가 많은 순, 같으면 예산
        합이 큰 순입니다.
      </p>
      <p id={hintId} className="mt-1 type-label wrap-anywhere text-muted-foreground">
        {BLOCKERS_HINT}
      </p>
      {rows.length === 0 ? (
        <>
          <p className="mt-3 border-y border-border py-3 type-label text-muted-foreground">
            {excluded > 0
              ? "막는 자격이 없습니다. 자격 하나만 걸려 막힌 공고가 없습니다."
              : "막는 자격이 없습니다. 회사 기록 없음·미보유로 분류된 공고가 없습니다."}
          </p>
          {excluded > 0 && <ExcludedNotHeld count={excluded} />}
        </>
      ) : (
        <>
          <Table containerClassName="mt-2" className="table-fixed">
            <caption className="sr-only">막는 자격 순위</caption>
            <colgroup>
              <col className="w-12" />
              <col />
              <col className="w-40" />
              <col className="w-24" />
              <col className="w-28" />
              <col className="w-28" />
              <col className="w-32" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">순위</TableHead>
                <TableHead scope="col">자격(API 업종)</TableHead>
                <TableHead scope="col">판정</TableHead>
                <TableHead scope="col" className="text-right">
                  막힌 공고
                </TableHead>
                <TableHead scope="col" className="text-right">
                  예산 합
                </TableHead>
                <TableHead scope="col" className="text-right">
                  조건 묶음 포함
                </TableHead>
                <TableHead scope="col">보유 가정</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody id={bodyId}>
              {shown.map((row) => (
                <BlockerTableRow
                  key={`${row.kind}|${row.key}`}
                  row={row}
                  rank={rows.indexOf(row) + 1}
                  copy={copy}
                  hintId={hintId}
                  assumed={assumed}
                  pending={pending}
                  onToggle={onToggle}
                />
              ))}
            </TableBody>
          </Table>
          {hidden > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 self-start"
              aria-expanded={expanded}
              aria-controls={bodyId}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded
                ? `상위 ${FIRST_ROWS}개 업종만 보기`
                : `나머지 ${formatCount(hidden)}개 업종 보기`}
            </Button>
          )}
          {excluded > 0 && <ExcludedNotHeld count={excluded} />}
          <p className="mt-2 type-caption wrap-anywhere text-muted-foreground">
            {BUNDLED_FOOTNOTE}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * 순위에서 빠진 미보유 공고 수. 서버는 미보유 자격이 유일한 장애인 공고만 순위 행에 센다(soleBlocker).
 * 다른 확인 사항이 함께 걸린 미보유 공고는 요약 띠에만 있어, 띠와 표의 합이 어긋난 만큼을 밝힌다.
 */
function excludedNotHeldCount(view: ReadyGapView): number {
  const ranked = view.radar.blockers
    .filter((row) => row.kind === "NOT_HELD")
    .reduce((sum, row) => sum + row.count, 0);
  return Math.max(0, view.radar.summary.buckets.NOT_HELD.count - ranked);
}

function ExcludedNotHeld({ count }: { count: number }) {
  return (
    <p data-slot="gaps-excluded-not-held" className="mt-2 type-label wrap-anywhere text-foreground">
      다른 확인 사항이 함께 걸려 순위에서 뺀 미보유 공고 {formatCount(count)}건
    </p>
  );
}

// ── 새로 열리는 공고 ──

function DeadlineText({ deadlineAt, now }: { deadlineAt: string | null; now: Date }) {
  if (deadlineAt === null) return <span className="text-muted-foreground">—</span>;
  const day = dDay(deadlineAt, now);
  return (
    <time dateTime={deadlineAt} title={formatKst(deadlineAt)} className="tabular-nums">
      {formatKstShort(deadlineAt)}
      {day !== null && <span className="text-muted-foreground"> · {day.label}</span>}
    </time>
  );
}

function OpenedRow({ notice, now }: { notice: OpenedNotice; now: Date }) {
  const budget = formatKrwCompact(notice.budgetKrw);
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="whitespace-normal">
        <Link
          href={`/bids/${notice.bidId}?origin=live`}
          title={notice.title}
          className={cn("line-clamp-2 type-body wrap-anywhere text-foreground", TEXT_LINK)}
        >
          {notice.title}
        </Link>
      </TableCell>
      <TableCell className="max-w-0">
        <span
          title={notice.agency ?? undefined}
          className="block truncate type-label text-foreground"
        >
          {notice.agency ?? "—"}
        </span>
      </TableCell>
      <TableCell className="type-label">
        <DeadlineText deadlineAt={notice.deadlineAt} now={now} />
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        <span title={budget.full}>{budget.text}</span>
      </TableCell>
    </TableRow>
  );
}

export function OpenedNotices({
  opened,
  now,
  pending,
}: {
  opened: OpenedNotice[];
  now: Date;
  /** 이동(서버 재계산) 중. 목록은 이전 가정의 결과라 흐리게 두고 읽는 중임을 알린다. */
  pending: boolean;
}) {
  const headingId = useId();
  const [limit, setLimit] = useState(MORE_STEP);
  const rest = opened.length - limit;
  return (
    <section
      id={OPENED_SECTION_ID}
      aria-labelledby={headingId}
      aria-busy={pending || undefined}
      className={cn(
        "flex min-w-0 scroll-mt-20 flex-col transition-opacity motion-reduce:transition-none",
        pending && "opacity-50",
      )}
    >
      <h2 id={headingId} className="type-heading text-foreground">
        새로 열리는 공고 {formatCount(opened.length)}건
      </h2>
      <p className="mt-0.5 type-caption text-muted-foreground">
        보유 가정으로 참가 가능(API 기준)이 되는 마감 전 공고입니다. 예산이 큰 순입니다.
      </p>
      {opened.length === 0 ? (
        <p className="mt-3 border-y border-border py-3 type-label text-muted-foreground">
          새로 열리는 공고가 없습니다. 이 자격 말고도 다른 조건(복수 면허·지역)이 함께 걸려 있을 수
          있습니다.
        </p>
      ) : (
        <>
          <Table containerClassName="mt-3" className="table-fixed">
            <caption className="sr-only">가정 시 새로 열리는 공고</caption>
            <colgroup>
              <col />
              <col className="w-50" />
              <col className="w-30" />
              <col className="w-24" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead scope="col">제목</TableHead>
                <TableHead scope="col">발주기관</TableHead>
                <TableHead scope="col">마감</TableHead>
                <TableHead scope="col" className="text-right">
                  예산
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {opened.slice(0, limit).map((notice) => (
                <OpenedRow key={notice.bidId} notice={notice} now={now} />
              ))}
            </TableBody>
          </Table>
          {rest > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 self-start"
              onClick={() => setLimit((current) => current + MORE_STEP)}
            >
              {formatCount(Math.min(MORE_STEP, rest))}건 더 보기
            </Button>
          )}
        </>
      )}
    </section>
  );
}

// ── 사람 확인 필요 사유 ──

export function ReviewReasons({ view, copy }: { view: ReadyGapView; copy: GapsCopy }) {
  const headingId = useId();
  const { reviewReasons } = view.radar;
  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col">
      <h2 id={headingId} className="type-heading text-foreground">
        사람 확인 필요 사유
      </h2>
      <p className="mt-0.5 type-caption wrap-anywhere text-muted-foreground">
        공고 하나에 사유가 여러 개일 수 있어 합이 사람 확인 필요 공고 수(
        {formatCount(view.radar.summary.buckets.NEEDS_REVIEW.count)}건)보다 클 수 있습니다.
      </p>
      {reviewReasons.length === 0 ? (
        <p className="mt-3 max-w-160 border-y border-border py-3 type-label text-muted-foreground">
          사람 확인이 필요한 공고가 없습니다.
        </p>
      ) : (
        <dl className="mt-3 max-w-160 divide-y divide-border border-y border-border">
          {reviewReasons.map(({ reason, count }) => (
            <div
              key={reason}
              data-reason={reason}
              className="flex items-baseline justify-between gap-3 py-2.5"
            >
              <dt className="type-label wrap-anywhere text-foreground">
                {copy.reasonLabels[reason]}
              </dt>
              <dd className="shrink-0 type-body font-semibold text-foreground tabular-nums">
                {formatCount(count)}건
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
