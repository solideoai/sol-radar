// 업무 역할(memberships.sol_role)의 화면 이름. 권한 안내 문장과 결정 이력이 쓴다(2026-11-03 사용자 지시: 화면에 영문 코드를 보이지 않는다).
// 역할을 고르고 바꾸는 조직 설정 화면은 코드 글자를 그대로 보인다(N2 디자인 스펙 D1).
// 이 층은 아무것도 import 하지 않으므로 키 검사는 화면 쪽(components/bids/labels.ts)이 한다.
export const SOL_ROLE_LABEL = {
  ADMIN: "관리자",
  SALES: "영업",
  ANALYST: "분석",
  EXECUTIVE: "임원",
  VIEWER: "열람",
} as const;
