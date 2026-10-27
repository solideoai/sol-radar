// 06 §5.6 /company 탭. 탭은 주소(?tab=)로 바꾸는 링크라 서버가 그린다(알림 화면의 전체/안 읽음과 같은 방식).
export const COMPANY_TABS = [
  { id: "tech", label: "기술 스택" },
  { id: "licenses", label: "보유 자격" },
  { id: "projects", label: "수행 실적" },
  { id: "people", label: "인력" },
  { id: "preferences", label: "선호 설정" },
  { id: "financials", label: "재무" },
  { id: "history", label: "변경 이력" },
] as const;

export type CompanyTab = (typeof COMPANY_TABS)[number]["id"];

const DEFAULT_TAB: CompanyTab = "tech";

const isCompanyTab = (value: string): value is CompanyTab =>
  COMPANY_TABS.some((tab) => tab.id === value);

// 모르는 값·반복된 값은 첫 탭이다. 주소를 손으로 고쳐도 오류 화면이 나오지 않게 한다.
export function parseCompanyTab(raw: string | string[] | undefined): CompanyTab {
  return typeof raw === "string" && isCompanyTab(raw) ? raw : DEFAULT_TAB;
}

export const companyTabHref = (tab: CompanyTab): string =>
  tab === DEFAULT_TAB ? "/company" : `/company?tab=${tab}`;

export const COMPANY_TITLE = "회사 역량";
export const COMPANY_DESCRIPTION = "SOL Score 와 필수 자격 판정이 읽는 회사 프로필입니다.";
