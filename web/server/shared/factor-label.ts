// SOL Score 요소(08 §2) 화면 이름. 순서는 점수표 순이다.
// 화면(components/bids/labels.ts)과 추천 분석 요청(analysis, 요소 label)이 이 표 하나에서 가져온다.
// 키 타입(FactorKey)은 scoring 도메인에 있고 이 층은 아무것도 import 하지 않으므로, 키 검사는 화면 쪽 labels.ts 가 한다.
export const FACTOR_LABEL = {
  skillMatch: "기술 스택 적합",
  pastPerformance: "유사 수행 실적",
  staffAvailability: "인력 가용성",
  scaleFit: "규모 적합성",
  strategicPreference: "전략적 선호",
} as const;
