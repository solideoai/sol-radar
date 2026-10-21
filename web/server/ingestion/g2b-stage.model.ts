import "server-only";

// ── 나라장터 사전규격·발주계획 (07 §1.1, 15 §8 g2b-pre-spec·g2b-order-plan) ──
// P0-8 Task 3: 응답 한 행의 정규화와 요청 주소 만들기까지만 둔다. worker 는 아직 이 서비스들을 부르지 않는다
// (일정 실행·호출 예산·저장 연결은 freeze 뒤 별도 계획, 기본 꺼짐).

export const G2B_PRE_SPEC_SOURCE = "g2b-pre-spec";
export const G2B_PRE_SPEC_SERVICE_ID = "15129437";
export const G2B_PRE_SPEC_LIST_OPERATION = "getPublicPrcureThngInfoServc";

export const G2B_ORDER_PLAN_SOURCE = "g2b-order-plan";
export const G2B_ORDER_PLAN_SERVICE_ID = "15129462";
export const G2B_ORDER_PLAN_LIST_OPERATION = "getOrderPlanSttusListServc";

/** 사전규격 응답의 첨부 칸 수(specDocFileUrl1~5, 2026-10-19 실응답). */
export const G2B_PRE_SPEC_DOC_SLOTS = 5;
