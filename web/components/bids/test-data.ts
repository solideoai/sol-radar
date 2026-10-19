import type {
  AnalysisView,
  BidDocument,
  BidListItem,
  FactorKey,
  KevView,
  Notification,
  QualificationCheckView,
  RequirementAssessmentView,
  Review,
  ScoreFactorView,
} from "@/server/bids";

// 부품 시험과 스토리용 데이터. 숫자의 정본은 fixtures/goldens/FX-0n.json 과 fixtures/kev/FX-0n.json 이다.
// fit.score 는 wire 값(0~4)이고 표시 n/5 는 부품이 floor+1 로 만든다.
// 서버 모듈은 타입으로만 가져온다(클라이언트 번들에 server-only 가 들어가면 안 된다).

const FETCHED_AT = "2026-10-16T00:00:00Z";
const KEV_DISCLAIMER = "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다.";
const SOL_DISCLAIMER =
  "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.";

type EvidenceRef = ScoreFactorView["evidence"][number];

const noticeEvidence = (quotedText: string, page: number): EvidenceRef => ({
  kind: "TEXT",
  documentId: "doc-1",
  revisionId: "rev-1",
  page,
  quotedText,
  fetchedAt: FETCHED_AT,
  match: "EXACT",
});

function factors(
  points: Record<FactorKey, number>,
  notes: Partial<Record<FactorKey, string>> = {},
) {
  const max: Record<FactorKey, number> = {
    skillMatch: 30,
    pastPerformance: 25,
    staffAvailability: 20,
    scaleFit: 15,
    strategicPreference: 10,
  };
  const order: FactorKey[] = [
    "skillMatch",
    "pastPerformance",
    "staffAvailability",
    "scaleFit",
    "strategicPreference",
  ];
  return order.map((factor): ScoreFactorView => ({
    factor,
    rawValue: null,
    normalized: points[factor] / max[factor],
    points: points[factor],
    maxPoints: max[factor],
    missing: false,
    missingReason: null,
    evidence: [],
    note: notes[factor] ?? null,
  }));
}

function satisfiedCheck(
  id: string,
  name: string,
  quote: string,
  page: number,
  company: string,
): QualificationCheckView {
  return {
    id,
    requirementCode: null,
    requirementName: name,
    mandatory: true,
    outcome: "SATISFIED",
    reason: "회사 프로필에 보유 등록이 있습니다",
    reasonCode: null,
    basis: "EXTRACTION",
    evidence: [noticeEvidence(quote, page)],
    profileEvidence: [{ type: "LICENSE", ref: `licenses/${id}`, label: company }],
    companyEvidence: [],
    checkedAt: FETCHED_AT,
  };
}

const kevOff: KevView = {
  enabled: false,
  provider: null,
  model: null,
  questionSetVersion: null,
  suggestedOption: null,
  probabilities: null,
  confidence: null,
  mandatoryRisk: null,
  needsHumanReview: null,
  fit: null,
  scores: null,
  risks: null,
  calibration: null,
  stateTrace: null,
  latencyMs: null,
  requestId: null,
  disclaimer: KEV_DISCLAIMER,
};

function kevOn(args: {
  suggestedOption: "BID" | "WATCH" | "NO_BID";
  probabilities: { BID: number; WATCH: number; NO_BID: number };
  mandatoryRisk: number;
  needsHumanReview: number;
  fitScore: number;
}): KevView {
  return {
    ...kevOff,
    enabled: true,
    provider: "mock",
    model: "kev-mock",
    questionSetVersion: "kev-qs/v0.1",
    suggestedOption: args.suggestedOption,
    probabilities: args.probabilities,
    confidence: args.probabilities[args.suggestedOption],
    mandatoryRisk: args.mandatoryRisk,
    needsHumanReview: args.needsHumanReview,
    fit: {
      score: args.fitScore,
      legend: { "0": "Very poor", "1": "Poor", "2": "Moderate", "3": "Good", "4": "Very good" },
    },
    latencyMs: 0,
    requestId: "req-test",
  };
}

const baseView: AnalysisView = {
  id: "run-fx-01",
  bidId: "bid-fx-01",
  revisionId: "rev-1",
  revision: 1,
  profileRevision: 2,
  runMode: "fixture",
  status: "COMPLETED",
  solScore: null,
  recommendation: null,
  recommendationBasis: "RULES_WITH_KEV_ASSIST",
  explanation: null,
  qualification: { status: "SATISFIED", checks: [] },
  requirementAssessments: [],
  scoreBreakdown: [],
  missingFactors: [],
  reviewFlags: [],
  injectionSuspected: false,
  kev: kevOff,
  fallbackReason: null,
  evidence: [],
  model: {
    provider: "mock",
    qwen: null,
    kev: { model: "kev-mock", questionSetVersion: "kev-qs/v0.1" },
    algorithmVersion: "sol-v0.1.0",
  },
  errorCode: null,
  queuedAt: "2026-10-16T00:00:00Z",
  startedAt: "2026-10-16T00:00:01Z",
  finishedAt: "2026-10-16T00:00:02Z",
  disclaimer: SOL_DISCLAIMER,
};

const fx01Assessments: RequirementAssessmentView[] = [
  {
    itemId: "qualifications[0]",
    itemKind: "QUALIFICATION",
    ruleStatus: "SATISFIED",
    ruleReason: null,
    basis: "EXTRACTION",
    noticeEvidence: [noticeEvidence("소프트웨어사업자 신고 업체", 3)],
    companyEvidence: [],
    kev: {
      qid: "req.qualifications[0]",
      distribution: { SATISFIED: 0.86, NOT_SATISFIED: 0.04, NEEDS_REVIEW: 0.1 },
      label: "SATISFIED",
    },
    flags: [],
  },
];

// FX-01: BID 94. 골든 24/25/20/15/10, Kev 0.71/0.24/0.05, 규칙 권고와 같음.
export const FX01_VIEW: AnalysisView = {
  ...baseView,
  solScore: 94,
  recommendation: "BID",
  explanation: "필수자격을 모두 충족하고 기술·실적·인력 적합도가 높습니다.",
  qualification: {
    status: "SATISFIED",
    checks: [
      satisfiedCheck("q1", "소프트웨어사업자", "소프트웨어사업자 신고 업체", 3, "소프트웨어사업자"),
      satisfiedCheck("q2", "정보보호 인증", "ISMS 인증 보유 업체", 3, "ISMS-P 인증"),
      satisfiedCheck("q3", "지역 제한", "세종특별자치시 소재 업체", 4, "본사 세종특별자치시"),
    ],
  },
  requirementAssessments: fx01Assessments,
  scoreBreakdown: factors({
    skillMatch: 24,
    pastPerformance: 25,
    staffAvailability: 20,
    scaleFit: 15,
    strategicPreference: 10,
  }),
  reviewFlags: [],
  kev: kevOn({
    suggestedOption: "BID",
    probabilities: { BID: 0.71, WATCH: 0.24, NO_BID: 0.05 },
    mandatoryRisk: 0.05,
    needsHumanReview: 0.12,
    fitScore: 3.5,
  }),
};

// FX-02: WATCH 72. 골든 15.0/18.3/14.0/15.0/10.0, Kev 0.36/0.52/0.12, KEV_NEEDS_REVIEW.
export const FX02_VIEW: AnalysisView = {
  ...baseView,
  id: "run-fx-02",
  bidId: "bid-fx-02",
  solScore: 72,
  recommendation: "WATCH",
  explanation: "기술 일치가 절반 수준이라 사람의 검토가 필요합니다.",
  qualification: {
    status: "SATISFIED",
    checks: [
      satisfiedCheck("q1", "소프트웨어사업자", "소프트웨어사업자 신고 업체", 2, "소프트웨어사업자"),
    ],
  },
  scoreBreakdown: factors(
    {
      skillMatch: 15,
      pastPerformance: 18.3,
      staffAvailability: 14,
      scaleFit: 15,
      strategicPreference: 10,
    },
    { staffAvailability: "마감 촉박 일정 계수 0.7" },
  ),
  reviewFlags: ["KEV_NEEDS_REVIEW"],
  kev: kevOn({
    suggestedOption: "WATCH",
    probabilities: { BID: 0.36, WATCH: 0.52, NO_BID: 0.12 },
    mandatoryRisk: 0.1,
    needsHumanReview: 0.74,
    fitScore: 2.2,
  }),
};

// FX-03: NO_BID 68(참고 점수). 필수자격 미충족, Kev 는 BID 를 제시했지만 규칙이 우선한다.
export const FX03_VIEW: AnalysisView = {
  ...baseView,
  id: "run-fx-03",
  bidId: "bid-fx-03",
  solScore: 68,
  recommendation: "NO_BID",
  explanation: "필수자격 중 정보통신공사업 등록이 없어 참여가 어렵습니다.",
  qualification: {
    status: "NOT_SATISFIED",
    checks: [
      satisfiedCheck("q1", "소프트웨어사업자", "소프트웨어사업자 신고 업체", 2, "소프트웨어사업자"),
      {
        id: "q2",
        requirementCode: null,
        requirementName: "정보통신공사업 등록",
        mandatory: true,
        outcome: "NOT_SATISFIED",
        reason: "프로필에 등록 없음",
        reasonCode: null,
        basis: "EXTRACTION",
        evidence: [noticeEvidence("정보통신공사업 등록 업체", 5)],
        profileEvidence: [
          {
            type: "INDUSTRY_CODE",
            ref: "industryCodes/ict",
            label: "정보통신공사업(보유하지 않음)",
          },
        ],
        companyEvidence: [],
        checkedAt: FETCHED_AT,
      },
    ],
  },
  scoreBreakdown: factors({
    skillMatch: 20,
    pastPerformance: 12.2,
    staffAvailability: 20,
    scaleFit: 9,
    strategicPreference: 7,
  }),
  reviewFlags: ["MODEL_RULE_DISAGREEMENT"],
  kev: kevOn({
    suggestedOption: "BID",
    probabilities: { BID: 0.55, WATCH: 0.3, NO_BID: 0.15 },
    mandatoryRisk: 0.85,
    needsHumanReview: 0.58,
    fitScore: 1.8,
  }),
};

// S6: AI 불가로 규칙만 계산한 PARTIAL. 점수는 FX-01 과 같고 Kev 는 꺼져 있다.
export const FX01_PARTIAL_VIEW: AnalysisView = {
  ...FX01_VIEW,
  id: "run-fx-01-partial",
  status: "PARTIAL",
  recommendationBasis: "RULES_ONLY",
  reviewFlags: ["AI_UNAVAILABLE", "KEV_UNAVAILABLE"],
  kev: kevOff,
  requirementAssessments: [],
  fallbackReason: "KEV_UNAVAILABLE",
  model: { ...baseView.model, kev: null },
};

const docsOk = {
  total: 2,
  pending: 0,
  parsed: 2,
  partial: 0,
  unsupported: 0,
  failed: 0,
  downloadFailed: 0,
};

function listItem(
  overrides: Partial<BidListItem> & Pick<BidListItem, "id" | "title">,
): BidListItem {
  return {
    source: "G2B",
    noticeId: `notice-${overrides.id}`,
    agency: null,
    stage: "NOTICE",
    status: "OPEN",
    budgetKrw: null,
    publishedAt: "2026-10-10T00:00:00Z",
    deadlineAt: null,
    latestRevision: 1,
    planRef: null,
    isDemo: true,
    sourceUrl: "https://example.test/bid",
    lastSyncedAt: FETCHED_AT,
    origin: "demo",
    documentsStatus: docsOk,
    latestAnalysis: null,
    latestReview: null,
    ...overrides,
  };
}

export const BID_LIST: BidListItem[] = [
  listItem({
    id: "bid-fx-01",
    title: "세종특별자치시 차세대 행정정보시스템 고도화 (가상)",
    agency: "세종특별자치시",
    budgetKrw: "1200000000",
    deadlineAt: "2026-11-06T09:00:00Z",
    latestAnalysis: {
      id: "run-fx-01",
      status: "COMPLETED",
      solScore: 94,
      recommendation: "BID",
      recommendationBasis: "RULES_WITH_KEV_ASSIST",
      reviewFlags: [],
      createdAt: FETCHED_AT,
    },
    latestReview: { decision: "BID", decidedAt: "2026-10-16T01:00:00Z", reviewerName: "김영업" },
  }),
  listItem({
    id: "bid-fx-02",
    title: "경기도교육청 통합 LMS 구축 (가상)",
    agency: "경기도교육청",
    budgetKrw: "2800000000",
    deadlineAt: "2026-10-31T09:00:00Z",
    latestAnalysis: {
      id: "run-fx-02",
      status: "COMPLETED",
      solScore: 72,
      recommendation: "WATCH",
      recommendationBasis: "RULES_WITH_KEV_ASSIST",
      reviewFlags: ["KEV_NEEDS_REVIEW"],
      createdAt: FETCHED_AT,
    },
  }),
  listItem({
    id: "bid-fx-03",
    title: "부산광역시 지능형 CCTV 통합관제센터 구축 (가상)",
    agency: "부산광역시",
    budgetKrw: "4500000000",
    deadlineAt: "2026-10-31T09:00:00Z",
    latestAnalysis: {
      id: "run-fx-03",
      status: "COMPLETED",
      solScore: 68,
      recommendation: "NO_BID",
      recommendationBasis: "RULES_WITH_KEV_ASSIST",
      reviewFlags: ["MODEL_RULE_DISAGREEMENT"],
      createdAt: FETCHED_AT,
    },
    latestReview: { decision: "NO_BID", decidedAt: "2026-10-16T02:00:00Z", reviewerName: "김영업" },
  }),
  // null 필드: 기관·예산·마감·게시일이 없고 분석도 없다.
  listItem({ id: "bid-null", title: "예산과 마감이 공개되지 않은 공고 (가상)", publishedAt: null }),
  // 제목 120자
  listItem({
    id: "bid-long",
    title: `${"긴 제목 공고 ".repeat(20)}`.slice(0, 120),
    agency: "한국정보화진흥원",
    budgetKrw: "300000000",
    deadlineAt: "2026-11-20T09:00:00Z",
  }),
];

export const REVIEWS_FX01: Review[] = [
  {
    id: "review-1",
    bidId: "bid-fx-01",
    revisionId: "rev-1",
    scoreRunId: "run-fx-01",
    reviewer: { id: "user-sales", name: "김영업", role: "SALES" },
    decision: "BID",
    reason: "필수자격을 모두 충족하고 실적이 충분해 참여를 권장합니다.",
    decidedAt: "2026-10-16T01:00:00Z",
    assignee: { id: "user-analyst", name: "이분석" },
    systemRecommendationAtDecision: "BID",
    disagreementFlag: false,
  },
];

export const NOTIFICATIONS: Notification[] = (
  [
    ["REVIEW_ASSIGNED", "결정 담당으로 지정되었습니다", null],
    ["ANALYSIS_COMPLETE", "분석이 완료되었습니다", null],
    ["BID_CHANGED", "공고가 정정되었습니다", "2026-10-16T00:30:00Z"],
    ["BID_CREATED", "새 공고가 등록되었습니다", "2026-10-16T00:30:00Z"],
    ["DEADLINE_APPROACHING", "마감이 임박했습니다", "2026-10-16T00:30:00Z"],
  ] as const
).map(([type, message, readAt], i) => ({
  id: `noti-${i + 1}`,
  type,
  channel: "IN_APP",
  status: "SENT",
  payload: {
    bidId: "bid-fx-01",
    title: "세종특별자치시 차세대 행정정보시스템 고도화 (가상)",
    message,
    link: "/bids/bid-fx-01",
  },
  readAt,
  createdAt: `2026-10-16T0${i}:00:00Z`,
}));

const makeDocument = (
  overrides: Partial<BidDocument> & Pick<BidDocument, "id" | "name">,
): BidDocument => ({
  mimeType: "application/pdf",
  sizeBytes: 120_000,
  format: "PDF",
  downloadStatus: "OK",
  parseStatus: "PARSED",
  downloadErrorCode: null,
  pageCount: 12,
  parseErrorCode: null,
  downloadPath: null,
  ...overrides,
});

// 첨부 상태 네 갈래: 내려받기 실패, 읽기 불가, 일부만 읽음, 정상.
export const BID_DOCUMENTS: BidDocument[] = [
  makeDocument({
    id: "doc-down",
    name: "제안요청서.pdf",
    downloadStatus: "FAILED",
    parseStatus: null,
    downloadErrorCode: "HTTP_5XX",
    pageCount: null,
  }),
  makeDocument({
    id: "doc-unsupported",
    name: "과업지시서.hwp",
    format: "HWP",
    parseStatus: "UNSUPPORTED",
    parseErrorCode: "UNSUPPORTED_FORMAT",
    pageCount: null,
  }),
  makeDocument({ id: "doc-partial", name: "평가기준.pdf", parseStatus: "PARTIAL", pageCount: 8 }),
  makeDocument({ id: "doc-parsed", name: "공고문.pdf", pageCount: 5 }),
];
