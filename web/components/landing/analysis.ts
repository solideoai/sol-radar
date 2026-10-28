// 랜딩 분석 예시의 권고 규칙. 실제 규칙 엔진이 아니라 docs/08-SCORING.md §5.2 결정 정책 v0.1 을 옮긴 것이다.
// §5.2 의 missingFactors(빠진 점수 요소) 2개 이상 → WATCH 분기는 예시 데이터에 없어 옮기지 않았다. 실제 규칙 엔진은 이 파일을 그대로 쓰지 않는다.
// 예시 데이터의 권고는 손으로 적지 않고 이 규칙으로 계산한다 — 따로 적으면 점수·자격 상태와 어긋날 수 있다.

export type QualificationStatus = "SATISFIED" | "NEEDS_REVIEW" | "NOT_SATISFIED";
export type Recommendation = "BID" | "WATCH" | "NO_BID";

export type QualificationCheck = {
  requirement: string;
  status: QualificationStatus;
  note: string;
};

export type ScoreFactor = { label: string; points: number; max: number };

export type Verdict = { recommendation: Recommendation; reason: string };

export const BID_THRESHOLD = 75;
export const WATCH_THRESHOLD = 50;

export const scoreOf = (factors: readonly ScoreFactor[]): number =>
  factors.reduce((total, factor) => total + factor.points, 0);

export const countByStatus = (
  checks: readonly QualificationCheck[],
): Record<QualificationStatus, number> => ({
  SATISFIED: checks.filter((check) => check.status === "SATISFIED").length,
  NEEDS_REVIEW: checks.filter((check) => check.status === "NEEDS_REVIEW").length,
  NOT_SATISFIED: checks.filter((check) => check.status === "NOT_SATISFIED").length,
});

// 필수 자격이 점수보다 먼저다. 미충족이면 점수와 상관없이 NO-BID, 확인 필요가 남으면 BID 를 내지 않는다.
// 이유 문장은 권고를 정한 첫 조건을 그대로 말한다.
export function recommend(checks: readonly QualificationCheck[], score: number): Verdict {
  const counts = countByStatus(checks);
  if (counts.NOT_SATISFIED > 0) {
    return {
      recommendation: "NO_BID",
      reason: `필수 자격 미충족 ${counts.NOT_SATISFIED}건이 있어 참여를 권고하지 않습니다. 점수는 참고용입니다.`,
    };
  }
  if (counts.NEEDS_REVIEW > 0) {
    return {
      recommendation: "WATCH",
      reason: `필수 자격 확인 필요 ${counts.NEEDS_REVIEW}건이 남아 있어 추천 대신 보류로 권고합니다.`,
    };
  }
  if (score >= BID_THRESHOLD) {
    return {
      recommendation: "BID",
      reason: `필수 자격을 모두 충족하고 적합도가 ${BID_THRESHOLD}점 이상입니다.`,
    };
  }
  return score >= WATCH_THRESHOLD
    ? {
        recommendation: "WATCH",
        reason: `필수 자격은 충족하지만 적합도가 ${BID_THRESHOLD}점 미만이라 조건을 더 검토할 사업입니다.`,
      }
    : { recommendation: "NO_BID", reason: `적합도가 ${WATCH_THRESHOLD}점 미만입니다.` };
}
