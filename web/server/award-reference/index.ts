import "server-only";

// ── 배럴: award-reference 도메인의 공개 API. 바깥(app·worker·다른 도메인)은 @/server/award-reference 만 부른다 ──
export {
  AWARD_LOOKBACK_MONTHS,
  AWARD_MIN_SAMPLE,
  AWARD_RATIO_MAX,
  AWARD_RATIO_MIN,
  AWARD_WIDEN_STEPS,
  baseAmountOf,
  methodGroupOf,
} from "./award-reference.model";
export type {
  AwardMethodGroup,
  AwardReference,
  AwardSampleRow,
  AwardTarget,
  BaseAmount,
  CardMethodGroup,
  Quartiles,
  WidenStep,
} from "./award-reference.model";
