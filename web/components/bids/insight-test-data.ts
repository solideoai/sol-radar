import type { InsightRunFacts } from "@/components/bids/recommendation-insight";
import { FX01_VIEW } from "@/components/bids/test-data";
import type { QualificationCheckView } from "@/server/bids";
import type { InsightPayload, InsightView } from "@/server/insight";

// 추천 분석 패널 시험(부품·공고 상세 두 파일)이 같이 쓰는 가상 데이터. 공고·실적·인용은 지어낸 것이다.
// 점수 run 은 FX-01(test-data.ts 의 FX01_VIEW)이다.

export const INSIGHT_BID_ID = "6b1d6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f60";
export const INSIGHT_BID_TITLE = "가상 문화정보원 통합 민원 포털 고도화 사업";
// INSIGHT_POLL_LIMIT_MS(3분)와 같은 값. 그 상수는 서버 전용 모듈(@/server/insight)이라 브라우저 시험에서 부르지 않는다.
export const INSIGHT_POLL_LIMIT_FOR_TEST = 3 * 60 * 1000;
// INSIGHT_PROMPT_VERSION 과 같은 값(같은 이유로 옮겨 적는다). 이 버전이 아닌 DONE 은 옛 형식이다(ADR-078).
export const INSIGHT_PROMPT_VERSION_FOR_TEST = "insight/v0.2";

// v0.1(옛 형식) 결과. FX-01 운영 결과 91b8a6e5 와 같은 모양이다(새 칸 없음).
export const INSIGHT_PAYLOAD: InsightPayload = {
  summary:
    "필수 자격 3건을 모두 충족했고 유사 사업 수행 실적이 있어 규칙 엔진이 추천으로 판정했습니다.",
  strengths: [
    {
      text: "최근 3년 민원 포털 구축 실적이 공고의 수행 실적 요건과 맞습니다.",
      refIds: ["B1", "C1"],
    },
  ],
  improvements: [
    {
      text: "정보보안 담당 인력의 자격 증빙을 제안서 제출 전에 준비해 두세요.",
      refIds: ["B2"],
    },
  ],
  refs: [
    {
      id: "B1",
      kind: "BID",
      label: "공고문 p.3 참가 자격",
      quotedText: "최근 3년 이내 유사 사업 수행 실적 1건 이상",
    },
    {
      id: "B2",
      kind: "BID",
      label: "공고문 p.5 투입 인력",
      quotedText: "정보보안 담당자 1인 이상 투입",
    },
    {
      id: "C1",
      kind: "COMPANY",
      label: "회사 실적 · 민원 포털 구축",
      quotedText: "가상 문화정보원 통합 민원 포털 구축(2025)",
    },
  ],
};

// v0.2(새 형식) 결과. 섹션 8개를 모두 채운다. 판단 이유 첫 문장이 상세 화면 구역에 보인다.
export const INSIGHT_V2_FIRST_SENTENCE =
  "필수 자격을 모두 충족했고 최근 수행한 민원 포털 구축 사업이 공고 범위와 겹쳐 규칙 엔진이 추천으로 판정했습니다.";
export const INSIGHT_PAYLOAD_V2: InsightPayload = {
  summary: [
    INSIGHT_V2_FIRST_SENTENCE,
    "공고가 요구한 개발 기술을 회사가 대부분 보유하고 있어 기술 일치가 높게 나왔습니다.",
    "사업 기간에 투입할 수 있는 인력도 공고가 요구한 규모를 넘습니다.",
    "다만 정보보호 인증의 적용 범위는 공고문만으로 판단할 수 없어 사람의 확인이 필요합니다.",
    "제안서를 쓰기 전에 인증서 사본과 투입 인력 명단을 먼저 준비해 두면 검토가 빨라집니다.",
  ].join(" "),
  strengths: [
    {
      text: "최근 민원 포털 구축 실적이 공고의 유사 사업 수행 요건과 맞습니다.",
      refIds: ["B1", "C1"],
    },
    {
      text: "Java·Spring 기반 공공 시스템을 오래 운영해 요구 기술과 맞습니다.",
      refIds: ["B3", "C2"],
    },
  ],
  improvements: [
    {
      text: "정보보안 담당 인력의 자격 증빙을 제안서 제출 전에 준비해 두세요.",
      refIds: ["B4"],
    },
    {
      text: "인증 범위를 증명할 자료를 제안서에 함께 붙여 두세요.",
      refIds: ["B2"],
    },
  ],
  factorNotes: [
    {
      factor: "scaleFit",
      text: "사업 예산이 회사가 평소 수행하는 사업 규모 안에 있습니다.",
      refIds: [],
    },
    {
      factor: "skillMatch",
      text: "공고가 요구한 Java·Spring·Oracle 을 모두 보유해 기술 일치가 높습니다.",
      refIds: ["B3", "C2"],
    },
    {
      factor: "pastPerformance",
      text: "최근 민원 포털 구축 실적이 공고의 유사 사업 요건과 같은 분야입니다.",
      refIds: ["B1", "C1"],
    },
    {
      factor: "staffAvailability",
      text: "사업 기간에 투입할 수 있는 인력이 공고가 요구한 인원보다 많습니다.",
      refIds: ["C3"],
    },
  ],
  checkNotes: [
    {
      label: "정보보호 인증",
      text: "보유한 ISMS-P 인증의 범위에 이 사업 대상 시스템이 들어 있는지 인증서로 확인해야 합니다.",
      refIds: ["B2"],
    },
    {
      label: "지역 제한",
      text: "본사 소재지가 공고의 지역 요건과 같은지 사업자등록증으로 한 번 더 확인합니다.",
      refIds: [],
    },
  ],
  nextSteps: [
    { text: "참여하려면 ISMS-P 인증서 사본과 인증 범위 문서를 확인해야 합니다.", refIds: ["B2"] },
    {
      text: "참여하려면 투입 인력 명단에 정보보안 담당자가 들어 있는지 확인해야 합니다.",
      refIds: ["B4"],
    },
    {
      text: "참여하려면 질의 기간 안에 대상 시스템 범위를 발주기관에 물어 확인해야 합니다.",
      refIds: [],
    },
  ],
  staffing: { from: "2026-12-01", to: "2027-06-30", availableFte: 3.5, eligibleStaff: 6 },
  refs: [
    {
      id: "B1",
      kind: "BID",
      label: "공고문 p.3 참가 자격",
      quotedText: "최근 3년 이내 유사 사업 수행 실적 1건 이상",
    },
    {
      id: "B2",
      kind: "BID",
      label: "공고문 p.4 정보보호 인증",
      quotedText: "ISMS 또는 ISMS-P 인증을 보유한 업체(인증 범위에 대상 시스템 포함)",
    },
    {
      id: "B3",
      kind: "BID",
      label: "공고문 p.6 요구 기술",
      quotedText: "Java, Spring, Oracle 기반 개발 및 운영",
    },
    {
      id: "B4",
      kind: "BID",
      label: "공고문 p.5 투입 인력",
      quotedText: "정보보안 담당자 1인 이상 투입",
    },
    {
      id: "C1",
      kind: "COMPANY",
      label: "과거 수행 사업",
      quotedText: "가상 문화정보원 통합 민원 포털 구축 · 공공 민원 · 2025-06-30 완료",
    },
    { id: "C2", kind: "COMPANY", label: "보유 기술", quotedText: "Java · 경력 8년" },
    {
      id: "C3",
      kind: "COMPANY",
      label: "투입 가능 인력",
      quotedText: "사업 기간 2026-12-01~2027-06-30 가용 3.5 FTE · 대상 인원 6명",
    },
  ],
};

export const INSIGHT_PENDING: InsightView = {
  id: "insight-1",
  scoreRunId: FX01_VIEW.id,
  status: "PENDING",
  source: null,
  payload: null,
  fallbackReason: null,
  modelName: null,
  promptVersion: null,
  errorCode: null,
  createdAt: "2026-10-29T05:00:00Z",
  finishedAt: null,
};
/** 옛 형식(v0.1) 모델 결과. */
export const INSIGHT_DONE_MODEL: InsightView = {
  ...INSIGHT_PENDING,
  status: "DONE",
  source: "MODEL",
  payload: INSIGHT_PAYLOAD,
  modelName: "Qwen3.8-Flash-Next-AWQ-INT4",
  promptVersion: "insight/v0.1",
  finishedAt: "2026-10-29T05:00:20Z",
};
/** 새 형식(v0.2) 모델 결과. */
export const INSIGHT_DONE_V2: InsightView = {
  ...INSIGHT_DONE_MODEL,
  id: "insight-2",
  payload: INSIGHT_PAYLOAD_V2,
  promptVersion: INSIGHT_PROMPT_VERSION_FOR_TEST,
  createdAt: "2026-11-03T05:00:00Z",
  finishedAt: "2026-11-03T05:01:30Z",
};
/** 새 형식 대체 결과. 새 칸은 gateway 가 규칙 값으로 채운다. */
export const INSIGHT_DONE_TEMPLATE: InsightView = {
  ...INSIGHT_DONE_V2,
  source: "TEMPLATE",
  fallbackReason: "FORBIDDEN_WORD",
};
export const INSIGHT_FAILED: InsightView = {
  ...INSIGHT_PENDING,
  status: "FAILED",
  errorCode: "GATEWAY_UNAVAILABLE",
  finishedAt: "2026-10-29T05:00:30Z",
};

/** 이 시각에 요청한 PENDING. 진행률·늦음은 행의 createdAt 부터 센다(계획 Q3). */
export const insightPendingAt = (epochMs: number): InsightView => ({
  ...INSIGHT_PENDING,
  createdAt: new Date(epochMs).toISOString(),
});

const baseCheck = FX01_VIEW.qualification.checks[0]!;
const check = (
  id: string,
  requirementName: string,
  mandatory: boolean,
  outcome: QualificationCheckView["outcome"],
  reason: string,
): QualificationCheckView => ({ ...baseCheck, id, requirementName, mandatory, outcome, reason });

/** 자격 요건 해설(섹션 4)의 짝으로 쓰는 "걸린 것". 같은 이름의 충족 자격은 건너뛰고 이 확인 필요 자격과 짝짓는다. */
export const INSIGHT_REVIEW_REASON =
  "ISMS-P 인증 범위에 이 사업 대상 시스템이 들어 있는지 확인하지 못했습니다.";

/** 팝업 머리·점수 요소·자격 해설이 쓰는 규칙 값. FX-01 점수에 같은 이름 자격 두 건(운영에서 확인한 겹침)을 더했다. */
export const INSIGHT_RUN: InsightRunFacts = {
  solScore: FX01_VIEW.solScore,
  recommendation: FX01_VIEW.recommendation,
  referenceScore: false,
  factors: FX01_VIEW.scoreBreakdown,
  checks: [
    check("q1", "소프트웨어사업자", true, "SATISFIED", "소프트웨어사업자 신고 확인"),
    check("q2", "정보보호 인증", true, "SATISFIED", "ISMS-P 인증 보유"),
    check("q3", "지역 제한", true, "SATISFIED", "본사 세종특별자치시"),
    check("q4", "정보보호 인증", false, "NEEDS_REVIEW", INSIGHT_REVIEW_REASON),
  ],
};
