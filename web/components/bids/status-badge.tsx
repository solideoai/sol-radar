import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ANALYSIS_STATUS_LABEL,
  EXTRA_STATUS_LABEL,
  FLAG_ICON,
  INGEST_RUN_STATUS_LABEL,
  QUALIFICATION_LABEL,
  RECOMMENDATION_LABEL,
  REVIEW_FLAG_LABEL,
  STATUS_ICON,
  type IngestRunBadgeStatus,
  type StatusKey,
} from "@/components/bids/labels";
import type {
  AnalysisStatus,
  BidStatus,
  NeedsReviewReason,
  QualificationOutcome,
  Recommendation,
  ReviewFlag,
} from "@/server/bids";

// 상태는 아이콘 + 글자 + 색 셋으로 나타낸다(스펙 §3.3). 글자·아이콘·색은 labels.ts 표에서만 가져온다.
// 상태 색은 글자·아이콘·테두리에만 쓰고 바탕은 채우지 않는다.

// emphasis 는 권고(추천·보류·비추천) 전용이다. 목록·대시보드·상세 어디서나 같은 모양으로 판정이 먼저 읽히게 한다.
// 바탕은 채우지 않고 상태 색을 글자·아이콘·테두리에만 쓴다(tokens.json $comment).
type BadgeVariant = "badge" | "inline" | "emphasis";

type StatusBadgeProps = { variant?: BadgeVariant; showCode?: boolean } & (
  | { kind: "recommendation"; value: Recommendation }
  | { kind: "qualification"; value: QualificationOutcome; reasonCode?: NeedsReviewReason | null }
  | { kind: "analysis"; value: AnalysisStatus; short?: boolean }
  | { kind: "decision"; value: Recommendation | null }
  | { kind: "flag"; value: ReviewFlag }
  | { kind: "bidStatus"; value: BidStatus }
  // 수집 run(N8). short 는 표 칸 글자, quarantined 를 주면 PARTIAL 긴 글자에 격리 건수를 붙인다.
  | { kind: "ingestRun"; value: IngestRunBadgeStatus; short?: boolean; quarantined?: number }
);

type Resolved = { key: StatusKey | ReviewFlag; label: string; code?: string };

// 권고와 같은 표를 쓰는 결정은 값이 없으면 미결정이다. 취소 외의 공고 상태는 배지를 그리지 않는다.
const resolve = (props: StatusBadgeProps): Resolved | null => {
  switch (props.kind) {
    case "recommendation":
      return { key: props.value, label: RECOMMENDATION_LABEL[props.value] };
    case "decision":
      return props.value === null
        ? { key: "UNDECIDED", label: EXTRA_STATUS_LABEL.UNDECIDED }
        : { key: props.value, label: RECOMMENDATION_LABEL[props.value] };
    case "qualification":
      return props.value === "NEEDS_REVIEW" && props.reasonCode === "STAGE_NOT_APPLICABLE"
        ? {
            key: "NOT_APPLICABLE",
            label: EXTRA_STATUS_LABEL.NOT_APPLICABLE,
            code: props.reasonCode,
          }
        : {
            key: props.value,
            label: QUALIFICATION_LABEL[props.value],
            code: props.reasonCode ?? undefined,
          };
    case "analysis":
      return {
        key: props.value,
        label: ANALYSIS_STATUS_LABEL[props.value][props.short ? "short" : "long"],
      };
    case "flag":
      return {
        key: props.value,
        label: REVIEW_FLAG_LABEL[props.value],
        code: props.value,
      };
    case "bidStatus":
      return props.value === "CANCELLED"
        ? { key: "CANCELLED", label: EXTRA_STATUS_LABEL.CANCELLED }
        : null;
    case "ingestRun": {
      const label = INGEST_RUN_STATUS_LABEL[props.value];
      const withCount =
        !props.short && props.value === "PARTIAL" && props.quarantined !== undefined;
      return {
        key: label.key,
        label: withCount
          ? `${label.long} (격리 ${props.quarantined}건)`
          : label[props.short ? "short" : "long"],
      };
    }
  }
};

const BADGE_BOX =
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption";
const INLINE_BOX = "inline-flex items-center gap-1 whitespace-nowrap type-caption";
const EMPHASIS_BOX =
  "inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-current bg-background px-2 type-label font-semibold";
const BOX: Record<BadgeVariant, string> = {
  badge: BADGE_BOX,
  inline: INLINE_BOX,
  emphasis: EMPHASIS_BOX,
};

function StatusBadge(props: StatusBadgeProps) {
  const resolved = resolve(props);
  if (resolved === null) return null;
  const { variant = "badge", showCode = false } = props;
  const { icon: Icon, className } =
    props.kind === "flag" ? FLAG_ICON[props.value] : STATUS_ICON[resolved.key as StatusKey];
  const code = showCode ? resolved.code : undefined;
  return (
    <span className={cn(BOX[variant], className)}>
      {Icon !== null && (
        <Icon
          aria-hidden="true"
          className={cn(
            variant === "emphasis" ? "size-4 shrink-0" : "size-3.5 shrink-0",
            (resolved.key === "QUEUED" || resolved.key === "RUNNING") &&
              "animate-spin motion-reduce:animate-none",
          )}
        />
      )}
      <span>{resolved.label}</span>
      {code !== undefined && <span className="font-mono text-muted-foreground">{code}</span>}
    </span>
  );
}

// 09 고정 문구. 바꾸지 않는다.
const DEMO_TOOLTIP = "이 데이터는 데모용 가상 공고입니다. 실제 입찰 공고가 아닙니다.";

function DemoBadge({
  withTooltip = false,
  dense = false,
}: {
  withTooltip?: boolean;
  dense?: boolean;
}) {
  const { icon: Icon, className } = STATUS_ICON.DEMO;
  const chip = (
    <>
      {Icon !== null && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      <span>{EXTRA_STATUS_LABEL.DEMO}</span>
    </>
  );
  // dense: 80px 출처 열 같은 좁은 칸용. 안쪽 여백과 간격만 줄이고 아이콘·글자·색은 그대로다.
  if (!withTooltip)
    return <span className={cn(BADGE_BOX, dense && "gap-0.5 px-1", className)}>{chip}</span>;
  return (
    // popup 을 배지가 든 랜드마크(상단바 header·본문 main) 안에 그린다(axe region, D1).
    <Tooltip landmark>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={cn(
          BADGE_BOX,
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        {chip}
      </TooltipTrigger>
      <TooltipContent>{DEMO_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

export { StatusBadge, DemoBadge };
export type { StatusBadgeProps };
