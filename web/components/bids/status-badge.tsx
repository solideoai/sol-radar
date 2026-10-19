import { cn } from "cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ANALYSIS_STATUS_LABEL,
  EXTRA_STATUS_LABEL,
  FLAG_ICON,
  QUALIFICATION_LABEL,
  RECOMMENDATION_LABEL,
  REVIEW_FLAG_LABEL,
  STATUS_ICON,
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

type BadgeVariant = "badge" | "inline";

type StatusBadgeProps = { variant?: BadgeVariant; showCode?: boolean } & (
  | { kind: "recommendation"; value: Recommendation }
  | { kind: "qualification"; value: QualificationOutcome; reasonCode?: NeedsReviewReason | null }
  | { kind: "analysis"; value: AnalysisStatus; short?: boolean }
  | { kind: "decision"; value: Recommendation | null }
  | { kind: "flag"; value: ReviewFlag }
  | { kind: "bidStatus"; value: BidStatus }
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
  }
};

const BADGE_BOX =
  "inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption";
const INLINE_BOX = "inline-flex items-center gap-1 whitespace-nowrap type-caption";

function StatusBadge(props: StatusBadgeProps) {
  const resolved = resolve(props);
  if (resolved === null) return null;
  const { variant = "badge", showCode = false } = props;
  const { icon: Icon, className } =
    props.kind === "flag" ? FLAG_ICON[props.value] : STATUS_ICON[resolved.key as StatusKey];
  const code = showCode ? resolved.code : undefined;
  return (
    <span className={cn(variant === "badge" ? BADGE_BOX : INLINE_BOX, className)}>
      {Icon !== null && (
        <Icon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0",
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

function DemoBadge({ withTooltip = false }: { withTooltip?: boolean }) {
  const { icon: Icon, className } = STATUS_ICON.DEMO;
  const chip = (
    <>
      {Icon !== null && <Icon aria-hidden="true" className="size-3.5 shrink-0" />}
      <span>{EXTRA_STATUS_LABEL.DEMO}</span>
    </>
  );
  if (!withTooltip) return <span className={cn(BADGE_BOX, className)}>{chip}</span>;
  return (
    <Tooltip>
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
