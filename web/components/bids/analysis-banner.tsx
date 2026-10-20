import { RefreshCwIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { STATUS_ICON } from "@/components/bids/labels";
import type { AnalysisView, BidStatus } from "@/server/bids";

// 분석 요약 띠 바로 아래 배너(§5.4.6). 흰 바탕에 테두리와 아이콘만 상태 색이고 글자는 foreground 다.
// 해당하는 배너가 없으면 null 이다. 문구 중 AI 불가·Mock 대체는 09 고정이다.
type Tone = "warning" | "destructive" | "neutral";

const TONE_BORDER = {
  warning: "border-warning",
  destructive: "border-destructive",
  neutral: "border-border",
} as const satisfies Record<Tone, string>;

const TONE_ICON = {
  warning: STATUS_ICON.PARTIAL,
  destructive: STATUS_ICON.FAILED,
  neutral: STATUS_ICON.CANCELLED,
} as const satisfies Record<Tone, { icon: unknown; className: string }>;

// 09 "AI 불가 배너"
const AI_UNAVAILABLE_TEXT =
  "AI 분석을 사용할 수 없어 규칙 기반 점수와 자격 판정만 표시합니다. (상태: PARTIAL)";
// 09 "Mock 대체 배너"
const MOCK_FALLBACK_TEXT =
  "모델 서버에 연결하지 못해 Mock 결과를 표시합니다. (실제 모델 결과 아님)";

type BannerAction = { label: string; onClick: () => void; icon?: boolean };
type BannerSpec = {
  key: string;
  tone: Tone;
  text: string;
  codes: string[];
  action?: BannerAction;
};

function BannerRow({ tone, text, codes, action }: Omit<BannerSpec, "key">) {
  const { icon: Icon, className } = TONE_ICON[tone];
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border bg-background p-4",
        TONE_BORDER[tone],
      )}
    >
      <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", className)} />
      <p className="min-w-0 flex-1 type-body text-foreground">{text}</p>
      {codes.length > 0 && (
        <p className="flex min-w-0 flex-wrap gap-x-3 font-mono type-caption text-muted-foreground">
          {codes.map((code) => (
            <span key={code} className="wrap-anywhere">
              {code}
            </span>
          ))}
        </p>
      )}
      {action !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={action.onClick}>
          {action.icon === true && <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />}
          {action.label}
        </Button>
      )}
    </div>
  );
}

function specsFor(
  analysis: AnalysisView | null,
  bidStatus: BidStatus,
  delayed: boolean,
  handlers: Pick<AnalysisBannerProps, "onReanalyze" | "onRefresh">,
): BannerSpec[] {
  const specs: BannerSpec[] = [];
  if (bidStatus === "CANCELLED") {
    specs.push({
      key: "cancelled",
      tone: "neutral",
      text: "이 공고는 취소되었습니다. 기존 분석·결정 기록은 보존됩니다",
      codes: [],
    });
  }
  if (analysis?.status === "PARTIAL") {
    const aiFlag = analysis.reviewFlags.find(
      (f) => f === "AI_UNAVAILABLE" || f === "QWEN_UNAVAILABLE",
    );
    const codes = [
      analysis.recommendationBasis === null
        ? null
        : `recommendationBasis: ${analysis.recommendationBasis}`,
      analysis.errorCode ?? aiFlag ?? null,
    ].filter((c): c is string => c !== null);
    specs.push({ key: "partial", tone: "warning", text: AI_UNAVAILABLE_TEXT, codes });
  }
  if (analysis?.reviewFlags.includes("MOCK_FALLBACK")) {
    specs.push({
      key: "mock",
      tone: "destructive",
      text: MOCK_FALLBACK_TEXT,
      codes: analysis.fallbackReason === null ? [] : [analysis.fallbackReason],
    });
  }
  if (analysis?.status === "FAILED") {
    specs.push({
      key: "failed",
      tone: "destructive",
      text: "분석에 실패했습니다.",
      codes: analysis.errorCode === null ? [] : [analysis.errorCode],
      action:
        handlers.onReanalyze === undefined
          ? undefined
          : { label: "재분석", onClick: handlers.onReanalyze, icon: true },
    });
  }
  if (delayed) {
    specs.push({
      key: "delayed",
      tone: "warning",
      text: "분석이 지연되고 있습니다.",
      codes: [],
      action:
        handlers.onRefresh === undefined
          ? undefined
          : { label: "새로고침", onClick: handlers.onRefresh },
    });
  }
  return specs;
}

type AnalysisBannerProps = {
  analysis: AnalysisView | null;
  bidStatus: BidStatus;
  delayed?: boolean;
  onReanalyze?: () => void;
  onRefresh?: () => void;
};

function AnalysisBanner({
  analysis,
  bidStatus,
  delayed = false,
  onReanalyze,
  onRefresh,
}: AnalysisBannerProps) {
  const specs = specsFor(analysis, bidStatus, delayed, { onReanalyze, onRefresh });
  if (specs.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {specs.map(({ key, ...spec }) => (
        <BannerRow key={key} {...spec} />
      ))}
    </div>
  );
}

// 분석 run 과 상관없이 AI gateway 가 끊겼을 때(상단바 AI: unavailable) 대시보드 카드 위에 두는 배너(스펙 §5.2).
// 문구는 09 고정 AI 불가 배너 그대로다.
function AiUnavailableNotice() {
  return <BannerRow tone="warning" text={AI_UNAVAILABLE_TEXT} codes={[]} />;
}

export { AnalysisBanner, AiUnavailableNotice };
