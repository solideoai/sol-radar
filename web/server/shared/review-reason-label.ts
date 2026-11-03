// 자격 "확인 필요" 사유 코드(08 §5.1 reasonCode)의 화면 이름.
// 화면 자격 목록(components/bids/labels.ts)과 저장된 설명 문장을 화면에 옮기는 readableExplanation 이 이 표 하나를 쓴다.
// 키 타입(NeedsReviewReason)은 scoring 도메인에 있고 이 층은 아무것도 import 하지 않으므로, 키 검사는 화면 쪽 labels.ts 가 한다.
// NOTICE_INFO_MISSING 은 공고에 정보가 없을 때와 공공 API 보조 조회를 받지 못했을 때 둘 다 쓰인다.
// 그래서 "공고에서 찾지 못함"이 아니라 "공고 정보를 확인하지 못함"이다(2026-11-03 사용자 지시).
export const NEEDS_REVIEW_REASON_LABEL = {
  NOTICE_INFO_MISSING: "공고 정보를 확인하지 못함",
  NOTICE_CONFLICTED: "공고 값이 서로 다름",
  COMPANY_EVIDENCE_MISSING: "회사 증빙 없음",
  AMBIGUOUS_MATCH: "같은 자격인지 불확실",
  PARSE_UNSUPPORTED: "첨부를 읽지 못함",
  STAGE_NOT_APPLICABLE: "발주계획 단계(자격 요건 없음)",
} as const;
