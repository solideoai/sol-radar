import {
  countByStatus,
  recommend,
  scoreOf,
  type QualificationCheck,
  type QualificationStatus,
  type Recommendation,
  type ScoreFactor,
} from "@/components/landing/analysis";

// 랜딩 분석 예시의 가상 공고. 기관·사업·숫자는 모두 지어낸 것이고 실제 공고·기관과 관계없다.
// 기관 이름은 "가상"으로 시작해 실제 기관으로 읽히지 않게 한다. 원문 주소는 두지 않는다(링크를 만들지 않는다).
// 이 파일에는 입력만 적는다. 점수는 요소 점수의 합, 권고는 analysis.ts 의 규칙으로 계산한다.
// 공고문 인용도 지어낸 것이다. 실제 공고문에서 옮긴 글이 아니므로 근거처럼 읽히지 않게 가상이라고 밝힌다.

// 인용은 낫표 없이 본문만 적는다. 낫표는 그리는 쪽이 붙이고, 조항 번호는 쓰지 않는다(가상 공고라도 실제 법령과 혼동을 막는다).
export type Evidence = { page: number; quote: string };

export type DemoCheck = QualificationCheck & { evidence: Evidence };

type DemoBidInput = {
  id: string;
  title: string;
  agency: string;
  budgetWon: number;
  /** YYYY-MM-DD */
  proposalDue: string;
  factors: ScoreFactor[];
  checks: DemoCheck[];
  reasons: string[];
  followUps: string[];
};

export type DemoBid = DemoBidInput & {
  score: number;
  recommendation: Recommendation;
  recommendationReason: string;
  counts: Record<QualificationStatus, number>;
};

// 요소와 만점은 docs/08-SCORING.md 의 가중치(30·25·20·15·10)를 따른다.
const factors = (
  tech: number,
  record: number,
  staff: number,
  size: number,
  strategy: number,
): ScoreFactor[] => [
  { label: "기술 스택 적합", points: tech, max: 30 },
  { label: "유사 수행 실적", points: record, max: 25 },
  { label: "인력 가용성", points: staff, max: 20 },
  { label: "규모 적합성", points: size, max: 15 },
  { label: "전략적 선호", points: strategy, max: 10 },
];

// 두 항목은 여러 공고가 함께 쓰므로 인용도 상수에 붙인다. 쪽수는 가상 공고문의 같은 자리를 가리킨다.
const SOFTWARE_BUSINESS: DemoCheck = {
  requirement: "소프트웨어사업자 신고",
  status: "SATISFIED",
  note: "기업 프로필의 신고 정보와 일치합니다.",
  evidence: { page: 2, quote: "소프트웨어사업자로 신고한 자" },
};

const SME_ONLY: DemoCheck = {
  requirement: "중소기업 제한경쟁 참가 자격",
  status: "SATISFIED",
  note: "기업 규모 정보와 일치합니다.",
  evidence: { page: 2, quote: "중소기업자 간 제한경쟁입찰" },
};

const INPUTS: DemoBidInput[] = [
  {
    id: "demo-1",
    title: "공공기관 업무지원 시스템 고도화",
    agency: "가상 행정지원청",
    budgetWon: 1_450_000_000,
    proposalDue: "2026-11-20",
    factors: factors(24, 22, 16, 12, 8),
    checks: [
      SOFTWARE_BUSINESS,
      SME_ONLY,
      {
        requirement: "필수 증빙(인증서) 제출",
        status: "NEEDS_REVIEW",
        note: "등록된 증빙의 유효기간을 확인할 수 없습니다.",
        evidence: { page: 4, quote: "입찰 마감일 기준 유효한 인증서 사본" },
      },
    ],
    reasons: [
      "유사 사업 실적 보유 — 최근 3년 업무지원 시스템 구축 2건",
      "주요 기술 요구사항 부합 — 요구 기술 6개 중 5개 보유",
    ],
    followUps: ["필수 증빙의 유효기간 확인 필요"],
  },
  {
    id: "demo-2",
    title: "통합 민원 포털 기능 개선",
    agency: "가상 문화정보원",
    budgetWon: 880_000_000,
    proposalDue: "2026-11-27",
    factors: factors(27, 23, 18, 12, 8),
    checks: [
      SOFTWARE_BUSINESS,
      SME_ONLY,
      {
        requirement: "직접생산확인증명",
        status: "SATISFIED",
        note: "유효기간 안의 증명서가 등록되어 있습니다.",
        evidence: { page: 3, quote: "직접생산확인증명서를 보유한 자" },
      },
    ],
    reasons: [
      "유사 사업 실적 보유 — 민원 포털 구축 3건",
      "주요 기술 요구사항 부합 — 요구 기술 5개 모두 보유",
    ],
    followUps: [],
  },
  {
    id: "demo-3",
    title: "원격 교육 플랫폼 구축",
    agency: "가상 교육연구원",
    budgetWon: 2_300_000_000,
    proposalDue: "2026-11-13",
    factors: factors(18, 12, 16, 10, 8),
    checks: [
      SOFTWARE_BUSINESS,
      {
        requirement: "원격교육 분야 수행 실적 1건 이상",
        status: "NOT_SATISFIED",
        note: "등록된 실적에 원격교육 분야 사업이 없습니다.",
        evidence: { page: 3, quote: "원격교육 분야 수행 실적 1건 이상" },
      },
      SME_ONLY,
    ],
    reasons: [
      "필수 실적 요건 미충족 — 원격교육 분야 수행 실적 없음",
      "주요 기술 요구사항 일부 부합 — 요구 기술 7개 중 4개 보유",
    ],
    followUps: ["유사 분야 실적을 인정하는지 공고 원문 확인"],
  },
];

const withAnalysis = (input: DemoBidInput): DemoBid => {
  const score = scoreOf(input.factors);
  const { recommendation, reason } = recommend(input.checks, score);
  return {
    ...input,
    score,
    recommendation,
    recommendationReason: reason,
    counts: countByStatus(input.checks),
  };
};

export const DEMO_BIDS: readonly DemoBid[] = INPUTS.map(withAnalysis);

// 히어로 아래 업무 데모(work-demo.tsx)의 관련 공고 표에만 더 보이는 가상 공고. 분석 예시 목록(DEMO_BIDS)은 3건 그대로다.
const MORE_INPUTS: DemoBidInput[] = [
  {
    id: "demo-4",
    title: "지역 행정 데이터 분석 플랫폼 구축",
    agency: "가상 지역정보진흥원",
    budgetWon: 960_000_000,
    proposalDue: "2026-11-24",
    factors: factors(25, 20, 17, 12, 7),
    checks: [
      SOFTWARE_BUSINESS,
      {
        requirement: "정보보호 관리체계 인증",
        status: "NEEDS_REVIEW",
        note: "등록된 인증의 범위가 공고 요구 범위와 같은지 확인이 필요합니다.",
        evidence: { page: 3, quote: "정보보호 관리체계 인증을 보유한 자" },
      },
    ],
    reasons: ["유사 사업 실적 보유 — 데이터 분석 플랫폼 구축 2건"],
    followUps: ["인증 범위 확인 필요"],
  },
  {
    id: "demo-5",
    title: "공공 데이터 개방 포털 유지관리",
    agency: "가상 데이터진흥원",
    budgetWon: 420_000_000,
    proposalDue: "2026-11-18",
    factors: factors(26, 21, 17, 13, 9),
    checks: [SOFTWARE_BUSINESS, SME_ONLY],
    reasons: ["유사 사업 실적 보유 — 포털 유지관리 4건"],
    followUps: [],
  },
  {
    id: "demo-6",
    title: "AI 민원 상담 챗봇 구축",
    agency: "가상 시민소통청",
    budgetWon: 1_200_000_000,
    proposalDue: "2026-12-02",
    factors: factors(23, 18, 15, 11, 9),
    checks: [SOFTWARE_BUSINESS, SME_ONLY],
    reasons: ["주요 기술 요구사항 부합 — 요구 기술 6개 중 5개 보유"],
    followUps: [],
  },
];

// 업무 데모 표는 SOL Score 가 높은 순이다.
export const WORK_DEMO_BIDS: readonly DemoBid[] = [
  ...DEMO_BIDS,
  ...MORE_INPUTS.map(withAnalysis),
].sort((a, b) => b.score - a.score);
