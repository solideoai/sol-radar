import {
  ArrowRightIcon,
  CircleAlertIcon,
  OctagonAlertIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import { formatPoints } from "@/components/bids/format";
import {
  FACTOR_LABEL,
  FACTOR_ORDER,
  QUALIFICATION_LABEL,
  RECOMMENDATION_LABEL,
  STATUS_ICON,
} from "@/components/bids/labels";
import { StatusBadge } from "@/components/bids/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AnalysisView,
  QualificationCheckView,
  QualificationOutcome,
  Recommendation,
} from "@/server/bids";
import type { WhatIfSummary } from "@/server/scoring";

// "가정 시나리오" 띠와 필수자격 제목 아래 안내 줄(BOOST-2 디자인 스펙 docs/plans/2026-10-20-boost2-what-if-ui.md §4.3·§4.5·§4.6).
// 가정 값은 이 띠 안에만 나온다. 결정 패널·점수 분해·필수자격 행은 저장된 run 그대로다(§3.1).
// 띠·안내·낭독 글자에 확률·승률·%·"가능성"·"수주"를 쓰지 않는다. 점수 차이는 "점"으로만 쓴다(설계 F1).
// 서버 모듈은 타입으로만 가져온다(클라이언트 번들).

export const WHAT_IF_BAND_ID = "what-if-band";
export const WHAT_IF_TITLE_ID = "what-if-title";
/** 서버 본문 검증(zod `max(10)`)과 같은 한도. */
export const MAX_ASSUMPTIONS = 10;

// 고정 문구(계획 Global Constraints). 바꾸지 않는다.
const FIXED_SAVED = "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다.";
const FIXED_KEV = "결정 모델 의견은 가정에 포함하지 않았습니다.";
const NO_FACTOR_CHANGE = "바뀐 요소 없음 · 필수자격 판정은 SOL Score 계산에 들어가지 않습니다";
const NOTICE_TEXT = {
  "no-snapshot":
    "이 분석에는 가정 계산에 쓸 입력 기록이 없습니다. 재분석하면 보유 가정을 켤 수 있습니다.",
  mismatch:
    "저장된 분석과 지금 규칙으로 다시 계산한 값이 달라 가정을 켤 수 없습니다. 재분석하면 쓸 수 있습니다.",
} as const;

export const WHAT_IF_FAILED_MESSAGE = "가정 결과를 계산하지 못했습니다.";
export const WHAT_IF_CLEARED_MESSAGE = "가정을 지웠습니다. 원래 분석 결과만 보입니다.";

export type WhatIfFailure = { code: string; message: string; requestId?: string };

export type WhatIfCalcState =
  | { phase: "calculating" }
  | { phase: "result"; before: WhatIfSummary; after: WhatIfSummary }
  | { phase: "error"; failure: WhatIfFailure };

const CHIP =
  "inline-flex h-5 max-w-full shrink-0 items-center whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-foreground";
const REFERENCE_CHIP =
  "shrink-0 rounded-sm border border-border px-1.5 type-caption text-muted-foreground";
const CELL = "py-1 pr-6 align-top";
const ROW_HEAD = cn(CELL, "w-24 text-left type-label font-normal text-muted-foreground");
const COLUMN_HEAD = cn(CELL, "text-left type-caption font-normal text-muted-foreground");
const NOTE = "type-caption tabular-nums text-muted-foreground";
const PULSE = "motion-reduce:animate-none";
const MINUS = "−";
const UNCHANGED = "변화 없음";

/** 진입 호출을 할 행: 필수 항목이고 자격 코드가 있으며 미충족이거나 회사 증빙이 없어 확인 필요다. 가정 가능 판정은 서버가 한다. */
export const isAssumptionCandidate = (check: QualificationCheckView): boolean =>
  check.mandatory &&
  check.requirementCode !== null &&
  (check.outcome === "NOT_SATISFIED" ||
    (check.outcome === "NEEDS_REVIEW" && check.reasonCode === "COMPANY_EVIDENCE_MISSING"));

/** 다시 계산한 원래 값이 저장된 run 과 같은지(D9). 다르면 띠의 "원래"와 결정 패널이 달라 보이므로 가정을 막는다. */
export const matchesStoredRun = (
  before: WhatIfSummary,
  stored: Pick<AnalysisView, "recommendation" | "solScore" | "qualification">,
): boolean =>
  before.recommendation === stored.recommendation &&
  stored.solScore !== null &&
  Math.round(before.score) === Math.round(stored.solScore) &&
  before.qualificationStatus === stored.qualification.status;

// 조사 "(으)로". 받침이 없거나 ㄹ 받침이면 "로", 그 밖 받침이면 "으로"다.
// 숫자는 읽는 소리로 정한다(0 영·십·백, 3 삼, 6 육 → 으로). 영문 권고(BID·WATCH·NO-BID)는 모두 "로"로 읽힌다.
const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const RIEUL_FINAL = 8;
function withRo(word: string): string {
  const last = word.at(-1) ?? "";
  const code = last.charCodeAt(0);
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    const final = (code - HANGUL_FIRST) % 28;
    return `${word}${final === 0 || final === RIEUL_FINAL ? "로" : "으로"}`;
  }
  if (/\d/.test(last)) return `${word}${"036".includes(last) ? "으로" : "로"}`;
  return `${word}로`;
}

const changeText = (label: string, from: string, to: string): string =>
  from === to ? `${label} ${from} 그대로.` : `${label} ${from}에서 ${withRo(to)} 바뀜.`;

/** 마지막 응답 하나만 알린다(스펙 §7, W18). 자격 종합 판정이 같으면 그 문장은 뺀다. */
export function whatIfLiveMessage(before: WhatIfSummary, after: WhatIfSummary): string {
  const qualification =
    before.qualificationStatus === after.qualificationStatus
      ? null
      : changeText(
          "필수자격",
          QUALIFICATION_LABEL[before.qualificationStatus],
          QUALIFICATION_LABEL[after.qualificationStatus],
        );
  return [
    "가정 결과.",
    changeText(
      "권고",
      RECOMMENDATION_LABEL[before.recommendation],
      RECOMMENDATION_LABEL[after.recommendation],
    ),
    changeText("SOL Score", String(Math.round(before.score)), String(Math.round(after.score))),
    qualification,
  ]
    .filter((part) => part !== null)
    .join(" ");
}

/** 행의 "가정 시나리오 보기"(D8): 띠로 스크롤하고 제목에 초점을 둔다. 움직임 줄이기면 바로 옮긴다. */
export function showWhatIfBand(): void {
  const band = document.getElementById(WHAT_IF_BAND_ID);
  const title = document.getElementById(WHAT_IF_TITLE_ID);
  if (band === null || title === null) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  band.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  title.focus({ preventScroll: true });
}

// 부호가 있는 차이. 빼기는 하이픈이 아니라 빼기 기호(−)다.
const signed = (delta: number, text: string): string =>
  delta > 0 ? `+${text}` : delta < 0 ? `${MINUS}${text}` : text;

function RecommendationValue({ value }: { value: Recommendation }) {
  const { icon: Icon, className } = STATUS_ICON[value];
  return (
    <span className={cn("inline-flex items-center gap-1.5 type-title", className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{RECOMMENDATION_LABEL[value]}</span>
    </span>
  );
}

function QualificationValue({ value }: { value: QualificationOutcome }) {
  const { icon: Icon, className } = STATUS_ICON[value];
  return (
    <span className={cn("inline-flex items-center gap-1.5 type-heading", className)}>
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{QUALIFICATION_LABEL[value]}</span>
    </span>
  );
}

// ScoreGauge 와 같은 숫자·"/ 100"·`참고`(자격 미충족이면 권고에 쓰지 않은 점수다).
function ScoreValue({ summary }: { summary: WhatIfSummary }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-baseline gap-1">
        <span className="type-title tabular-nums text-foreground">{Math.round(summary.score)}</span>
        <span className="type-label text-muted-foreground">/ 100</span>
      </span>
      {summary.qualificationStatus === "NOT_SATISFIED" && (
        <span className={REFERENCE_CHIP}>참고</span>
      )}
    </span>
  );
}

function Arrow() {
  return <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
}

// 가정 열 한 칸: 화살표 + 값, 그 아래 변화 줄.
function AssumedCell({ children, note }: { children: React.ReactNode; note: string | null }) {
  return (
    <td className={CELL}>
      <span className="inline-flex items-center gap-3">
        <Arrow />
        {children}
      </span>
      {note !== null && <p className={NOTE}>{note}</p>}
    </td>
  );
}

const ROW_LABELS = ["권고", "SOL Score", "필수자격"] as const;

type ComparisonRow = {
  label: (typeof ROW_LABELS)[number];
  original: React.ReactNode;
  assumed: React.ReactNode;
  note: string | null;
};

function comparisonRowsOf(before: WhatIfSummary, after: WhatIfSummary): ComparisonRow[] {
  const scoreDelta = Math.round(after.score) - Math.round(before.score);
  return [
    {
      label: "권고",
      original: <RecommendationValue value={before.recommendation} />,
      assumed: <RecommendationValue value={after.recommendation} />,
      note: before.recommendation === after.recommendation ? UNCHANGED : null,
    },
    {
      label: "SOL Score",
      original: <ScoreValue summary={before} />,
      assumed: <ScoreValue summary={after} />,
      note: scoreDelta === 0 ? UNCHANGED : `${signed(scoreDelta, String(Math.abs(scoreDelta)))}점`,
    },
    {
      label: "필수자격",
      original: <QualificationValue value={before.qualificationStatus} />,
      assumed: <QualificationValue value={after.qualificationStatus} />,
      note: before.qualificationStatus === after.qualificationStatus ? UNCHANGED : null,
    },
  ];
}

// 결과가 없으면(계산 중) 행 머리만 두고 값 칸은 skeleton 이다. 이전 결과를 남기지 않는다(D7).
function ComparisonTable({ rows }: { rows: ComparisonRow[] | null }) {
  return (
    <table className="w-full text-left">
      <caption className="sr-only">원래 결과와 가정 결과 비교</caption>
      <thead>
        <tr>
          <td className={cn(CELL, "w-24")} />
          <th scope="col" className={cn(COLUMN_HEAD, "min-w-40")}>
            원래
          </th>
          <th scope="col" className={COLUMN_HEAD}>
            가정
          </th>
        </tr>
      </thead>
      <tbody>
        {rows === null
          ? ROW_LABELS.map((label) => (
              <tr key={label}>
                <th scope="row" className={ROW_HEAD}>
                  {label}
                </th>
                <td className={cn(CELL, "min-w-40")}>
                  <Skeleton className={cn("h-9 w-28", PULSE)} />
                </td>
                <td className={CELL}>
                  <Skeleton className={cn("h-9 w-28", PULSE)} />
                </td>
              </tr>
            ))
          : rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className={ROW_HEAD}>
                  {row.label}
                </th>
                <td className={cn(CELL, "min-w-40")}>{row.original}</td>
                <AssumedCell note={row.note}>{row.assumed}</AssumedCell>
              </tr>
            ))}
      </tbody>
    </table>
  );
}

function DetailBlock({
  title,
  slot,
  children,
}: {
  title: string;
  slot?: string;
  children: React.ReactNode;
}) {
  return (
    <div data-slot={slot} className="flex min-w-0 flex-col gap-1">
      <h3 className="font-heading type-label text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function Details({ before, after }: { before: WhatIfSummary; after: WhatIfSummary }) {
  const outcomeOf = new Map(before.checks.map((check) => [check.id, check.outcome]));
  const changedChecks = after.checks.flatMap((check) => {
    const original = outcomeOf.get(check.id);
    return original === undefined || original === check.outcome ? [] : [{ check, original }];
  });
  const pointsOf = new Map(before.factors.map((factor) => [factor.factor, factor.points]));
  const changedFactors = FACTOR_ORDER.flatMap((key) => {
    const factor = after.factors.find((item) => item.factor === key);
    const original = pointsOf.get(key);
    if (factor === undefined || original === undefined) return [];
    return formatPoints(original) === formatPoints(factor.points) ? [] : [{ factor, original }];
  });
  return (
    <>
      <DetailBlock title="바뀐 자격 항목">
        {changedChecks.length === 0 ? (
          <p className="type-body text-muted-foreground">바뀐 자격 항목 없음</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {changedChecks.map(({ check, original }) => (
              <li key={check.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 type-body text-foreground wrap-anywhere">
                  {check.requirementName}
                </span>
                <StatusBadge kind="qualification" value={original} variant="inline" />
                <Arrow />
                <StatusBadge kind="qualification" value={check.outcome} variant="inline" />
              </li>
            ))}
          </ul>
        )}
      </DetailBlock>
      <DetailBlock title="요소별 점수" slot="what-if-factors">
        {changedFactors.length === 0 ? (
          <p className="type-body text-muted-foreground">{NO_FACTOR_CHANGE}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {changedFactors.map(({ factor, original }) => {
              const delta = factor.points - original;
              return (
                <li
                  key={factor.factor}
                  className="flex flex-wrap gap-x-2 type-body text-foreground"
                >
                  <span>{FACTOR_LABEL[factor.factor]}</span>
                  <span className="tabular-nums">
                    {`${formatPoints(original)} → ${formatPoints(factor.points)} / ${factor.maxPoints} (${signed(delta, formatPoints(Math.abs(delta)))})`}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </DetailBlock>
    </>
  );
}

function CalcError({ failure, onRetry }: { failure: WhatIfFailure; onRetry: () => void }) {
  return (
    <div data-slot="what-if-calc-error" className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <OctagonAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="type-body text-foreground">가정 결과를 계산하지 못했습니다</p>
        <p className="type-label text-foreground wrap-anywhere">{failure.message}</p>
        <p className="font-mono type-caption text-muted-foreground wrap-anywhere">
          {failure.code}
          {failure.requestId !== undefined && ` · ${failure.requestId}`}
        </p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
        다시 시도
      </Button>
    </div>
  );
}

type WhatIfBandProps = {
  /** 켠 가정. 순서는 필수자격 목록 순서, 이름은 저장된 run 의 행 이름이다. */
  assumptions: { code: string; name: string }[];
  state: WhatIfCalcState;
  onClear: () => void;
  onRetry: () => void;
};

// 실선 카드인 실제 분석과 점선으로 구분한다(D4). 상태 알림은 화면의 what-if-live 한 곳이 맡는다.
function WhatIfBand({ assumptions, state, onClear, onRetry }: WhatIfBandProps) {
  return (
    <section
      id={WHAT_IF_BAND_ID}
      data-slot="what-if-band"
      aria-labelledby={WHAT_IF_TITLE_ID}
      aria-busy={state.phase === "calculating" ? true : undefined}
      className="@container flex scroll-mt-20 flex-col gap-4 rounded-lg border border-dashed border-muted-foreground bg-background p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          id={WHAT_IF_TITLE_ID}
          tabIndex={-1}
          className="type-heading text-foreground outline-none"
        >
          가정 시나리오
        </h2>
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          <XIcon data-icon="inline-start" aria-hidden="true" className="size-4" />
          가정 지우기
        </Button>
      </div>
      <div className="flex flex-col gap-0.5">
        <p className="type-body text-foreground">{FIXED_SAVED}</p>
        <p className="type-body text-foreground">{FIXED_KEV}</p>
      </div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="type-label text-muted-foreground">켠 가정</span>
        {assumptions.map(({ code, name }) => (
          <span key={code} title={`${name} 보유`} className={CHIP}>
            <span className="min-w-0 truncate">{name} 보유</span>
          </span>
        ))}
      </div>
      {state.phase === "error" ? (
        <CalcError failure={state.failure} onRetry={onRetry} />
      ) : (
        <>
          <ComparisonTable
            rows={state.phase === "result" ? comparisonRowsOf(state.before, state.after) : null}
          />
          <div className="grid gap-4 border-t border-border pt-4 @2xl:grid-cols-2">
            {state.phase === "result" ? (
              <Details before={state.before} after={state.after} />
            ) : (
              <>
                <Skeleton className={cn("h-5 w-full", PULSE)} />
                <Skeleton className={cn("h-5 w-full", PULSE)} />
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

type WhatIfNoticeProps =
  | { kind: "load-error"; failure: WhatIfFailure; onRetry: () => void }
  | { kind: "no-snapshot" }
  | { kind: "mismatch" };

// 필수자격 제목 아래 한 줄(§4.5). 분석 결과 자체는 멀쩡하므로 붉은 테두리·role="alert" 를 쓰지 않는다.
function WhatIfNotice(props: WhatIfNoticeProps) {
  if (props.kind !== "load-error") {
    return (
      <p data-slot="what-if-unavailable" className="type-label text-muted-foreground">
        {NOTICE_TEXT[props.kind]}
      </p>
    );
  }
  const { failure, onRetry } = props;
  return (
    <div data-slot="what-if-load-error" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <p className="type-label text-foreground">보유 가정을 불러오지 못했습니다</p>
      <p className="min-w-0 font-mono type-caption text-muted-foreground wrap-anywhere">
        {failure.code}
        {failure.requestId !== undefined && ` · ${failure.requestId}`}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

export { WhatIfBand, WhatIfNotice };
export type { WhatIfBandProps, WhatIfNoticeProps };
