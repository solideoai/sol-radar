import "server-only";
import type { CompanyProfileRow, CompanyProfileSummaryRow } from "./company-profile.model";

// scripts/demo/plan.mjs 가 넣는 org-01 revision 2 와 같은 모양(fixtures/company/solideo-profile.json 줄임).
export const ORG_ID = "0f000000-0000-4000-8000-000000000001";
export const AUTHOR_ID = "10000000-0000-4000-8000-000000000001";

export const PROFILE_ROW: CompanyProfileRow = {
  id: "c0000000-0000-4000-8000-000000000002",
  org_id: ORG_ID,
  revision: 2,
  name: "솔리데오",
  technologies: [{ name: "Java" }, { name: "Spring Boot" }, { name: "Kubernetes" }],
  technologies_complete: true,
  licenses: [
    { code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "HELD" },
    { code: "ISMS_P", name: "ISMS-P", status: "NOT_HELD" },
  ],
  industry_codes: [],
  past_projects: [
    {
      id: "P1",
      name: "지자체 민원 시스템 고도화",
      domain: "민원",
      amountKrw: "1200000000",
      completedAt: "2024-11-30",
      evidenceRef: "company-evidence/P1-completion-certificate",
    },
  ],
  financials: {
    fiscalYear: 2025,
    annualRevenueKrw: "18000000000",
    employeeCount: 200,
    maxContractKrw: "5000000000",
  },
  preferences: {
    agencies: [],
    agencyTypes: ["교육청"],
    domains: ["민원", "데이터 플랫폼"],
    excludedDomains: ["국방"],
    excludedKeywords: [],
  },
  is_demo: true,
  effective_at: "2026-10-19T15:00:00+00:00",
  created_by: AUTHOR_ID,
  note: "revision 2: 기술·실적 추가(08 §6.1 가상 프로필)",
  created_at: "2026-10-20T01:00:00+00:00",
  creator: { display_name: "관리자", email: "admin@soltech.invalid" },
};

export const SUMMARY_ROWS: CompanyProfileSummaryRow[] = [
  {
    id: PROFILE_ROW.id,
    revision: 2,
    effective_at: PROFILE_ROW.effective_at,
    created_by: AUTHOR_ID,
    note: PROFILE_ROW.note,
    created_at: PROFILE_ROW.created_at,
    creator: PROFILE_ROW.creator,
  },
  {
    id: "c0000000-0000-4000-8000-000000000001",
    revision: 1,
    effective_at: "2026-07-21T15:00:00+00:00",
    created_by: null,
    note: "revision 1: 초기 등록(기술 4·실적 2, 목록 불완전)",
    created_at: "2026-10-20T01:00:00+00:00",
    creator: null,
  },
];
