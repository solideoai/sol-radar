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

// ADR-062 전 템플릿(scoring/explanation.ts 판본 e22de09e·979c25f0·5261730f)이 저장한 설명 문장의 정확한 문구 → 지금 표기.
// DB 는 바꾸지 않고 화면 모델로 옮길 때만 바꾼다. 낱말 BID·WATCH 를 통째로 바꾸지 않는다(템플릿 밖 글은 그대로 둔다).
const LEGACY_EXPLANATION_PHRASES: readonly (readonly [legacy: string, current: string])[] = [
  ["NO-BID(참여 비권고)", RECOMMENDATION_LABEL.NO_BID],
  ["BID(참여 권고)", RECOMMENDATION_LABEL.BID],
  ["WATCH(사람 검토)", RECOMMENDATION_LABEL.WATCH],
  ["참여 권고 구간(75 이상)", `${RECOMMENDATION_LABEL.BID} 구간(75 이상)`],
  ["사람 검토 구간(50~75)", `${RECOMMENDATION_LABEL.WATCH} 구간(50~75)`],
  ["참여 비권고 구간(50 미만)", `${RECOMMENDATION_LABEL.NO_BID} 구간(50 미만)`],
  // 결정 모델 의견 문장은 값을 그대로 넣었다. 979c25f0 전에는 주어가 "Kev는"이었다.
  ...(["결정 모델은", "Kev는"] as const).flatMap((subject) =>
    (["NO_BID", "BID", "WATCH"] as const).map(
      (value) =>
        [
          `${subject} ${value}를 제시했지만`,
          `${subject} ${recommendationWithObject(value)} 제시했지만`,
        ] as const,
    ),
  ),
];

/** 저장된 설명 문장의 옛 권고 표기를 지금 표기로 바꾼다. 위 표의 문구만 바꾼다. */
export const relabelLegacyExplanation = (text: string): string =>
  LEGACY_EXPLANATION_PHRASES.reduce(
    (out, [legacy, current]) => out.replaceAll(legacy, current),
    text,
  );
