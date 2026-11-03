import type { BidStatus } from "@/server/bids";
// page·loading·error·not-found 가 같이 쓰는 값. 서버 부품이 값으로 받게 "use client" 밖에 둔다(상세 detail-copy.ts 와 같은 이유).
export const REVISIONS_TITLE = "변경 이력";
export const REVISIONS_NOT_FOUND_TITLE = "변경 이력을 찾을 수 없습니다";
export const REVISIONS_NOT_FOUND_DESCRIPTION = "공고 주소나 수집 기록 번호가 맞는지 확인하세요.";

export const BID_STATUS_LABEL = {
  OPEN: "공고",
  AMENDED: "정정 공고",
  CANCELLED: "취소됨",
  CLOSED: "마감",
} as const satisfies Record<BidStatus, string>;
