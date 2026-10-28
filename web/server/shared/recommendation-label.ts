import type { ReviewDecision } from "./review-input";

// ADR-062 권고·결정 화면 표기. 값(BID·WATCH·NO_BID)은 DB·API·쿼리·결정 모델 입출력 그대로이고 사람이 읽는 글자만 바꾼다.
// 화면(components/bids/labels.ts)·서버 설명 문장(scoring)·알림(인앱·카카오)이 이 표 하나에서 가져온다.
export const RECOMMENDATION_LABEL = {
  BID: "추천",
  WATCH: "보류",
  NO_BID: "비추천",
} as const satisfies Record<ReviewDecision, string>;

const HANGUL_FIRST = 0xac00;

/** 목적격 조사 "을/를"을 붙인 표기. 받침이 있으면 "을"이다("추천을", "보류를"). */
export function recommendationWithObject(value: ReviewDecision): string {
  const label = RECOMMENDATION_LABEL[value];
  const final = (label.charCodeAt(label.length - 1) - HANGUL_FIRST) % 28;
  return `${label}${final === 0 ? "를" : "을"}`;
}
