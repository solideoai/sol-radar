import { cn } from "cn";
import {
  CircleArrowUpIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
  EyeIcon,
  FlaskConicalIcon,
  OctagonXIcon,
  type LucideIcon,
} from "lucide-react";
import type { QualificationStatus, Recommendation } from "@/components/landing/analysis";

// 상태는 아이콘 + 글자 + 색을 함께 쓴다(docs/06-UI-UX.md §3.2). 색만으로 뜻을 전하지 않는다.
// 배지 바탕은 흰색(bg-background)이다 — 상태 색 글자는 연한 바탕 위에서 대비가 4.5:1 아래로 떨어질 수 있다.
type StatusStyle = { label: string; icon: LucideIcon; tone: string };

const RECOMMENDATION_STYLES: Record<Recommendation, StatusStyle> = {
  BID: { label: "BID", icon: CircleArrowUpIcon, tone: "border-success/30 text-success" },
  WATCH: { label: "WATCH", icon: EyeIcon, tone: "border-warning/30 text-warning" },
  NO_BID: { label: "NO-BID", icon: OctagonXIcon, tone: "border-destructive/30 text-destructive" },
};

const QUALIFICATION_STYLES: Record<QualificationStatus, StatusStyle> = {
  SATISFIED: { label: "충족", icon: CircleCheckIcon, tone: "text-success" },
  NEEDS_REVIEW: { label: "확인 필요", icon: CircleHelpIcon, tone: "text-warning" },
  NOT_SATISFIED: { label: "미충족", icon: CircleXIcon, tone: "text-destructive" },
};

// cn 은 type-* 끼리 합쳐 주지 않는다. 크기는 바탕에 두지 않고 size 로만 고른다.
const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border bg-background font-medium whitespace-nowrap";
const BADGE_SIZES = {
  sm: "px-1.5 py-0.5 type-caption [&_svg]:size-3.5",
  md: "px-2 py-1 type-label [&_svg]:size-4",
} as const;

export function RecommendationBadge({
  value,
  size = "sm",
  className,
}: {
  value: Recommendation;
  size?: keyof typeof BADGE_SIZES;
  className?: string;
}) {
  const { label, icon: Icon, tone } = RECOMMENDATION_STYLES[value];
  return (
    <span className={cn(BADGE, BADGE_SIZES[size], tone, className)}>
      <Icon aria-hidden />
      {label}
    </span>
  );
}

export function QualificationLabel({ status }: { status: QualificationStatus }) {
  const { label, icon: Icon, tone } = QUALIFICATION_STYLES[status];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 type-label font-medium whitespace-nowrap",
        tone,
      )}
    >
      <Icon aria-hidden className="size-4" />
      {label}
    </span>
  );
}

// 가상 데이터라는 표시. 실제 공고처럼 읽히지 않게 미리보기 머리와 공고 제목 위에 둔다(docs/09-SECURITY.md DEMO 원칙).
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn(BADGE, BADGE_SIZES.sm, "border-demo/30 text-demo", className)}>
      <FlaskConicalIcon aria-hidden />
      예시 데이터
    </span>
  );
}

// 아직 만들지 않은 기능에 붙인다. 이용할 수 있는 것처럼 보이지 않게 한다.
export function PlannedBadge() {
  return (
    <span className={cn(BADGE, BADGE_SIZES.sm, "border-border text-muted-foreground")}>
      개발 예정
    </span>
  );
}
