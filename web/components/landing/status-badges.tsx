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
import type { Evidence } from "@/components/landing/demo-bids";

// 상태는 아이콘 + 글자 + 색을 함께 쓴다(docs/06-UI-UX.md §3.2). 색만으로 뜻을 전하지 않는다.
// 배지 바탕은 흰색(bg-background)이다 — 상태 색 글자는 연한 바탕 위에서 대비가 4.5:1 아래로 떨어질 수 있다.
type StatusStyle = { label: string; icon: LucideIcon; tone: string };

// 권고 값(BID·WATCH·NO_BID)은 그대로 두고 화면 글자만 한글로 쓴다(docs/16-DECISIONS.md ADR-062).
const RECOMMENDATION_STYLES: Record<Recommendation, StatusStyle> = {
  BID: { label: "추천", icon: CircleArrowUpIcon, tone: "border-success/30 text-success" },
  WATCH: { label: "보류", icon: EyeIcon, tone: "border-warning/30 text-warning" },
  NO_BID: { label: "비추천", icon: OctagonXIcon, tone: "border-destructive/30 text-destructive" },
};

const QUALIFICATION_STYLES: Record<QualificationStatus, StatusStyle> = {
  SATISFIED: { label: "충족", icon: CircleCheckIcon, tone: "text-success" },
  NEEDS_REVIEW: { label: "확인 필요", icon: CircleHelpIcon, tone: "text-warning" },
  NOT_SATISFIED: { label: "미충족", icon: CircleXIcon, tone: "text-destructive" },
};

// 첫 화면의 배지는 한 크기(15px)다 — 가독성 바닥(13px) 아래로 내려가는 작은 배지를 두지 않는다.
// cn 은 type-* 끼리 합쳐 주지 않으므로 쓰는 쪽에서 className 으로 글자 크기를 넘기지 않는다.
const BADGE =
  "inline-flex shrink-0 items-center gap-1 rounded-sm border bg-background px-2 py-1 type-label-lg font-medium whitespace-nowrap [&_svg]:size-4";

export function RecommendationBadge({
  value,
  className,
}: {
  value: Recommendation;
  className?: string;
}) {
  const { label, icon: Icon, tone } = RECOMMENDATION_STYLES[value];
  return (
    <span className={cn(BADGE, tone, className)}>
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
        "inline-flex shrink-0 items-center gap-1.5 type-ui-lg font-semibold whitespace-nowrap",
        tone,
      )}
    >
      <Icon aria-hidden className="size-4.5" />
      {label}
    </span>
  );
}

// 가상 데이터라는 표시. 실제 공고처럼 읽히지 않게 미리보기 창 머리에 둔다 — 판에는 하나만 둔다(docs/09-SECURITY.md DEMO 원칙).
export function DemoBadge({ className }: { className?: string }) {
  return (
    <span className={cn(BADGE, "border-demo/30 text-demo", className)}>
      <FlaskConicalIcon aria-hidden />
      예시 데이터
    </span>
  );
}

// 판단 옆에 붙이는 공고문 인용. 낫표는 글자로 그린다 — 연한 바탕색만으로 인용임을 전하지 않는다.
// 쪽수는 줄지 않게 두고, 긴 인용은 쪽수 옆 칸 안에서 줄을 바꾼다.
export function EvidenceQuote({ evidence }: { evidence: Evidence }) {
  return (
    <span className="flex flex-wrap items-start gap-x-2 gap-y-1 type-label-lg text-foreground">
      <span className="shrink-0 font-semibold text-foreground">공고문 p.{evidence.page}</span>
      <span className="min-w-0 rounded-sm bg-brand/8 px-0.5 wrap-anywhere">
        「{evidence.quote}」
      </span>
    </span>
  );
}
