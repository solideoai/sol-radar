import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CompanyProfile,
  CompanyProfileSummary,
  CompanyStaffing,
} from "@/server/company-profile";
import { CompanyProfileView } from "./company-profile-view";
import { COMPANY_TABS, type CompanyTab } from "./company-tabs";

// /company 본문을 진짜 브라우저에 그린다. 앱 틀 안 본문 폭(1280 → 960, 1440 → 1024 = max-w-5xl)에서 잰다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children, ...rest }: React.ComponentProps<"a">) => (
    <a href={href} className={className} aria-current={rest["aria-current"]}>
      {children}
    </a>
  ),
}));

// scripts/demo/plan.mjs 의 org-01 revision 2(fixtures/company/solideo-profile.json)와 같은 값.
// 단 두 곳은 표시를 보려고 바꿨다: RAG/LLM 의 숙련도·경력(원본에는 없다), P3 증빙(원본에는 있다, 여기서는 "없음").
const PROFILE: CompanyProfile = {
  id: "c0000000-0000-4000-8000-000000000002",
  orgId: "0f000000-0000-4000-8000-000000000001",
  revision: 2,
  name: "솔리데오",
  isDemo: true,
  technologies: [
    { name: "Java" },
    { name: "Spring Boot" },
    { name: "전자정부 표준프레임워크" },
    { name: "NestJS" },
    { name: "Next.js" },
    { name: "PostgreSQL" },
    { name: "Kubernetes" },
    { name: "RAG/LLM 적용", level: "INTERMEDIATE", yearsOfExperience: 2 },
  ],
  technologiesComplete: true,
  licenses: [
    { code: "SW_BUSINESS_REG", name: "소프트웨어사업자 신고확인서", status: "HELD" },
    { code: "DIRECT_PRODUCTION", name: "직접생산확인증명서(소프트웨어개발)", status: "HELD" },
    { code: "SME_CONFIRMATION", name: "중소기업확인서(중기업)", status: "HELD" },
    { code: "ISO_27001", name: "ISO 27001", status: "HELD" },
    { code: "CMMI_L3", name: "CMMI L3", status: "HELD" },
    { code: "ICT_CONSTRUCTION", name: "정보통신공사업 등록", status: "NOT_HELD" },
    { code: "DEFENSE_CONTRACTOR", name: "방산업체 지정", status: "NOT_HELD" },
    { code: "ISMS_P", name: "ISMS-P", status: "NOT_HELD" },
    { code: "CSAP", name: "CSAP", status: "NOT_HELD" },
  ],
  industryCodes: [],
  pastProjects: [
    {
      id: "P1",
      name: "지자체 민원 시스템 고도화",
      domain: "민원",
      amountKrw: "1200000000",
      completedAt: "2024-11-30",
      evidenceRef: "company-evidence/P1-completion-certificate",
    },
    {
      id: "P2",
      name: "공공기관 데이터 플랫폼 구축",
      domain: "데이터 플랫폼",
      amountKrw: "2800000000",
      completedAt: "2024-03-31",
      evidenceRef: "company-evidence/P2-completion-certificate",
    },
    {
      id: "P3",
      name: "교육기관 AI 챗봇 PoC",
      domain: "교육",
      amountKrw: "300000000",
      completedAt: "2025-09-30",
      evidenceRef: null,
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
    agencyTypes: ["지자체", "교육청"],
    domains: ["데이터 플랫폼", "AX", "민원", "교육"],
    excludedDomains: ["국방"],
    excludedKeywords: ["무기체계"],
  },
  effectiveAt: "2026-10-19T15:00:00+00:00",
  createdBy: { id: "10000000-0000-4000-8000-000000000001", name: "관리자" },
  createdAt: "2026-10-20T01:00:00+00:00",
  note: "revision 2: 기술·실적 추가(08 §6.1 가상 프로필)",
};
const REVISIONS: CompanyProfileSummary[] = [
  {
    id: PROFILE.id,
    revision: 2,
    effectiveAt: PROFILE.effectiveAt,
    createdBy: PROFILE.createdBy,
    createdAt: PROFILE.createdAt,
    note: PROFILE.note,
  },
  {
    id: "c0000000-0000-4000-8000-000000000001",
    revision: 1,
    effectiveAt: "2026-07-21T15:00:00+00:00",
    createdBy: null,
    createdAt: PROFILE.createdAt,
    note: "revision 1: 초기 등록(기술 4·실적 2, 목록 불완전)",
  },
];
const STAFFING: CompanyStaffing = { totalCount: 200, scoringCount: 27 };

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const render = (node: React.ReactNode, width = 960) => {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = `${width}px`;
  const root = createRoot(host);
  flushSync(() => root.render(node));
  mounted.push(root);
  return host;
};

const view = (tab: CompanyTab, profile: CompanyProfile | null = PROFILE) => (
  <CompanyProfileView tab={tab} profile={profile} revisions={REVISIONS} staffing={STAFFING} />
);

// overflow-hidden 칸은 넘쳐도 가려지므로 scrollWidth 로 잘림을 잡는다. truncate 가 의도인 칸과
// 화면 읽기 프로그램 전용 글자(sr-only, 1px 로 자르는 것이 의도)는 뺀다.
const spilled = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>("*")]
    .filter(
      (element) =>
        !element.classList.contains("truncate") && !element.classList.contains("sr-only"),
    )
    .filter((element) => element.scrollWidth > element.clientWidth + 1)
    .map((element) => `${element.tagName}.${element.className.slice(0, 40)}`);

describe("CompanyProfileView", () => {
  it.each(COMPANY_TABS.flatMap((tab) => [960, 1024].map((width) => [tab.id, width] as const)))(
    "%s 탭이 %ipx 에서 가로로 넘치지 않는다",
    (tab, width) => {
      const host = render(view(tab), width);
      expect(host.scrollWidth).toBeLessThanOrEqual(width);
      expect(spilled(host)).toEqual([]);
    },
  );

  it("탭 줄은 지금 탭에만 aria-current 를 달고, 건수를 함께 보인다", () => {
    const host = render(view("licenses"));
    const links = [...host.querySelectorAll("nav[aria-label='회사 역량 항목'] a")];
    expect(links.map((link) => link.textContent)).toEqual([
      "기술 스택8",
      "보유 자격9",
      "수행 실적3",
      "인력",
      "선호 설정",
      "재무",
      "변경 이력2",
    ]);
    expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(host.querySelector("a[aria-current='page']")?.getAttribute("href")).toBe(
      "/company?tab=licenses",
    );
  });

  it("머리 줄에 가상 프로필·revision·적용일을 보인다", () => {
    const text = render(view("tech")).textContent ?? "";
    expect(text).toContain("가상 회사 프로필");
    expect(text).toContain("rev 2 · 2026-10-20 적용");
  });

  it("기술 탭은 목록이 완전한지와 점수 요소를 밝힌다", () => {
    const host = render(view("tech"));
    expect(host.querySelector("h2")?.textContent).toBe("기술 스택 8개");
    expect(host.textContent).toContain("「기술 스택 적합」(30점)");
    expect(host.textContent).toContain("목록에 없는 기술은 ‘보유하지 않음’으로 판정합니다");
    expect(host.textContent).toContain("중급 · 경력 2년");
    const incomplete = render(view("tech", { ...PROFILE, technologiesComplete: false }));
    expect(incomplete.textContent).toContain("목록에 없는 기술은 ‘확인 필요’로 판정합니다");
  });

  it("자격 탭은 보유·미보유를 글자로 보이고 업종 코드 빈 상태를 밝힌다", () => {
    const host = render(view("licenses"));
    expect(host.querySelector("h2")?.textContent).toBe("보유 자격 5개 · 미보유 4개");
    const statuses = [...host.querySelectorAll("tbody tr td:nth-child(3)")].map(
      (cell) => cell.textContent,
    );
    expect(statuses).toEqual([
      "보유",
      "보유",
      "보유",
      "보유",
      "보유",
      "미보유",
      "미보유",
      "미보유",
      "미보유",
    ]);
    expect(host.textContent).toContain("등록된 업종 코드가 없습니다");
  });

  it("실적 탭은 최근 완료 순이고 금액·증빙을 보인다", () => {
    const host = render(view("projects"));
    const rows = [...host.querySelectorAll("tbody tr")].map((row) =>
      [...row.querySelectorAll("td")].map((cell) => cell.textContent),
    );
    expect(rows).toEqual([
      ["교육기관 AI 챗봇 PoC", "교육", "3억원", "2025-09-30", "없음"],
      ["지자체 민원 시스템 고도화", "민원", "12억원", "2024-11-30", "있음"],
      ["공공기관 데이터 플랫폼 구축", "데이터 플랫폼", "28억원", "2024-03-31", "있음"],
    ]);
  });

  it("인력 탭은 27명·200명과 명부 링크를 보인다", () => {
    const host = render(view("people"));
    expect(host.textContent).toContain("27명");
    expect(host.textContent).toContain("200명");
    expect(host.querySelector("a[href='/people?scoring=1']")?.textContent).toBe(
      "점수 계산 대상 인력 보기",
    );
  });

  it("선호·재무가 없으면 점수 영향을 문장으로 밝힌다", () => {
    const empty = { ...PROFILE, preferences: null, financials: null };
    expect(render(view("preferences", empty)).textContent).toContain("중립 점수(5점)");
    expect(render(view("financials", empty)).textContent).toContain("재무 정보가 없습니다");
    expect(render(view("financials")).textContent).toContain("5,000,000,000원");
  });

  it("이력 탭은 현재 revision 을 표시하고 지워진 작성자를 밝힌다", () => {
    const host = render(view("history"));
    const rows = [...host.querySelectorAll("tbody tr")];
    expect(rows[0].textContent).toContain("rev 2현재");
    expect(rows[1].textContent).toContain("탈퇴한 사용자");
  });

  it("프로필이 없으면 탭 없이 안내만 보인다", () => {
    const host = render(view("tech", null));
    expect(host.querySelector("nav")).toBeNull();
    expect(host.textContent).toContain("등록된 회사 프로필이 없습니다");
  });
});
