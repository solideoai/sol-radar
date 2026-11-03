import { StatusBadge } from "@/components/bids/status-badge";
import type { Recommendation } from "@/server/bids";

// 사업기회 목록·대시보드의 권고 배지. 필수 자격 확인 필요 때문에 점수와 무관하게 보류인 공고는 사유를 함께 적는다
// (08 §5.2). 점수가 추천 구간인데 보류로 보이는 까닭을 목록에서 바로 읽게 한다.
export function OpportunityRecommendation({
  recommendation,
  qualificationReview,
}: {
  recommendation: Recommendation;
  qualificationReview?: boolean;
}) {
  const showReason = recommendation === "WATCH" && qualificationReview === true;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <StatusBadge kind="recommendation" value={recommendation} variant="inline" />
      {showReason && (
        <span
          className="type-caption whitespace-nowrap text-muted-foreground"
          title="필수 자격 확인이 끝나기 전에는 점수와 무관하게 보류입니다"
        >
          자격 확인
        </span>
      )}
    </span>
  );
}
