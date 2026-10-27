import {
  BanIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleAlertIcon,
  CircleArrowUpIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleMinusIcon,
  CircleXIcon,
  EyeIcon,
  FilePenIcon,
  FilePlusIcon,
  FlaskConicalIcon,
  InfoIcon,
  Link2OffIcon,
  LoaderCircleIcon,
  OctagonAlertIcon,
  OctagonXIcon,
  ShieldCheckIcon,
  ThumbsUpIcon,
  TriangleAlertIcon,
  UserCheckIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  AnalysisStatus,
  AnalysisView,
  BidStage,
  FactorKey,
  KevView,
  MissingReason,
  NeedsReviewReason,
  Notification,
  QualificationOutcome,
  Recommendation,
  ReviewFlag,
} from "@/server/bids";

// 라벨 글자의 정본은 docs/plans/2026-10-19-c6-screens-design.md 다.
// 클라이언트 부품도 쓰므로 @/server/bids 는 타입으로만 가져온다.

// §3.3
export const RECOMMENDATION_LABEL = {
  BID: "BID",
  WATCH: "WATCH",
  NO_BID: "NO-BID",
} as const satisfies Record<Recommendation, string>;

// §3.3 (자격)
export const QUALIFICATION_LABEL = {
  SATISFIED: "충족",
  NEEDS_REVIEW: "확인 필요",
  NOT_SATISFIED: "미충족",
} as const satisfies Record<QualificationOutcome, string>;

// §3.3 (분석). 표 칸에서는 short 를 쓴다.
export const ANALYSIS_STATUS_LABEL = {
  QUEUED: { long: "대기 중", short: "대기 중" },
  RUNNING: { long: "분석 중", short: "분석 중" },
  COMPLETED: { long: "완료", short: "완료" },
  PARTIAL: { long: "부분 완료 (규칙만)", short: "부분 완료" },
  FAILED: { long: "실패", short: "실패" },
} as const satisfies Record<AnalysisStatus, { long: string; short: string }>;

// §3.3 중 위 표에 없는 상태 글자
export const EXTRA_STATUS_LABEL = {
  NOT_APPLICABLE: "해당 없음",
  NOT_ANALYZED: "미분석",
  CANCELLED: "취소됨",
  DEMO: "DEMO",
  RULE_FIRST: "규칙 우선",
  UNDECIDED: "미결정",
} as const satisfies Record<string, string>;

export type StatusKey =
  Recommendation | QualificationOutcome | AnalysisStatus | keyof typeof EXTRA_STATUS_LABEL;

// 수집 run 상태(N8 디자인 스펙 docs/plans/2026-10-20-n8-admin-ingestion-design.md §3.3). 06 §3.2 에 수집 줄이 없어
// 아이콘·색은 분석 상태 키(key)를 빌린다. PENDING 은 화면 전용 "접수됨"(202 뒤 worker 가 행을 만들기 전, D15)이다.
// short 는 표 칸, long 은 서랍·상태 줄 글자다. PARTIAL 의 long 은 격리 건수를 붙여 쓴다(status-badge).
export type IngestRunBadgeStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

export const INGEST_RUN_STATUS_LABEL = {
  PENDING: { short: "접수됨", long: "접수됨 · 작업 시작 대기", key: "QUEUED" },
  RUNNING: { short: "실행 중", long: "실행 중", key: "RUNNING" },
  SUCCEEDED: { short: "완료", long: "완료", key: "COMPLETED" },
  PARTIAL: { short: "부분 완료", long: "부분 완료", key: "PARTIAL" },
  FAILED: { short: "실패", long: "실패", key: "FAILED" },
} as const satisfies Record<IngestRunBadgeStatus, { short: string; long: string; key: StatusKey }>;

// §3.3. 색은 글자·아이콘에만 쓴다(바탕 채움 없음). UNDECIDED 는 아이콘이 없다.
export const STATUS_ICON = {
  BID: { icon: CircleArrowUpIcon, className: "text-success" },
  WATCH: { icon: EyeIcon, className: "text-warning" },
  NO_BID: { icon: OctagonXIcon, className: "text-destructive" },
  SATISFIED: { icon: CircleCheckIcon, className: "text-success" },
  NEEDS_REVIEW: { icon: CircleHelpIcon, className: "text-warning" },
  NOT_SATISFIED: { icon: CircleXIcon, className: "text-destructive" },
  NOT_APPLICABLE: { icon: CircleMinusIcon, className: "text-muted-foreground" },
  NOT_ANALYZED: { icon: CircleDashedIcon, className: "text-muted-foreground" },
  QUEUED: { icon: LoaderCircleIcon, className: "text-muted-foreground" },
  RUNNING: { icon: LoaderCircleIcon, className: "text-muted-foreground" },
  COMPLETED: { icon: CheckIcon, className: "text-success" },
  PARTIAL: { icon: TriangleAlertIcon, className: "text-warning" },
  FAILED: { icon: OctagonAlertIcon, className: "text-destructive" },
  CANCELLED: { icon: BanIcon, className: "text-muted-foreground" },
  DEMO: { icon: FlaskConicalIcon, className: "text-demo border-demo" },
  RULE_FIRST: { icon: ShieldCheckIcon, className: "text-warning" },
  UNDECIDED: { icon: null, className: "text-muted-foreground" },
} as const satisfies Record<StatusKey, { icon: LucideIcon | null; className: string }>;

// §5.4.4
export const NEEDS_REVIEW_REASON_LABEL = {
  NOTICE_INFO_MISSING: "공고에서 요구를 찾지 못함",
  NOTICE_CONFLICTED: "공고 값이 서로 다름",
  COMPANY_EVIDENCE_MISSING: "회사 증빙 없음",
  AMBIGUOUS_MATCH: "대응 불확실",
  PARSE_UNSUPPORTED: "첨부를 읽지 못함",
  STAGE_NOT_APPLICABLE: "발주계획 단계(자격 요건 없음)",
} as const satisfies Record<NeedsReviewReason, string>;

// §5.4.5 요소 라벨. 순서는 점수표(08 §2) 순이다.
export const FACTOR_LABEL = {
  skillMatch: "기술 스택 적합",
  pastPerformance: "유사 수행 실적",
  staffAvailability: "인력 가용성",
  scaleFit: "규모 적합성",
  strategicPreference: "전략적 선호",
} as const satisfies Record<FactorKey, string>;

export const FACTOR_ORDER = [
  "skillMatch",
  "pastPerformance",
  "staffAvailability",
  "scaleFit",
  "strategicPreference",
] as const satisfies readonly FactorKey[];

// §5.4.5 missing 사유 라벨
export const MISSING_REASON_LABEL = {
  NO_REQUIREMENTS_EXTRACTED: "공고에서 요구기술을 찾지 못함",
  PROFILE_TECHNOLOGIES_EMPTY: "회사 기술 목록 없음",
  BID_DOMAIN_UNKNOWN: "사업 분야 미확인",
  PROFILE_PROJECTS_EMPTY: "금액이 확인된 회사 실적 없음",
  REQUIRED_FTE_UNKNOWN: "필요 인력 미확인",
  TEAM_EMPTY: "점수 계산 대상 인력 없음",
  BUDGET_UNKNOWN: "예산 미공개",
  PREFERENCES_NOT_SET: "선호 설정 없음",
} as const satisfies Record<MissingReason, string>;

// §5.4.7 수행 리스크 라벨
type KevRiskQid = NonNullable<KevView["risks"]>[number]["qid"];
export const KEV_RISK_LABEL = {
  "risk.schedule": "일정",
  "risk.staffing": "인력",
  "risk.scale": "규모",
  "risk.techGap": "기술 격차",
  "risk.scopeAmbiguity": "범위 모호",
} as const satisfies Record<KevRiskQid, string>;

// §5.4.9 플래그 라벨 17개. 배지 옆에 코드를 함께 둔다.
export const REVIEW_FLAG_LABEL = {
  MODEL_RULE_DISAGREEMENT: "규칙 우선(결정 모델 의견 상이)",
  KEV_MANDATORY_RISK: "결정 모델 필수자격 위험 신호",
  KEV_NEEDS_REVIEW: "결정 모델 사람 검토 신호",
  KEV_REQUIREMENT_DISAGREEMENT: "항목 판정 상이(결정 모델)",
  KEV_DELIVERY_RISK: "수행 리스크 신호(결정 모델)",
  CITATION_FAILED: "인용 대조 실패",
  EXTRACTION_FAILED: "추출 실패",
  EXTRACTION_LOW_CONFIDENCE: "추출 신뢰 낮음",
  TRANSLATION_INCOMPLETE: "영문 번역 누락 · 원문 검토 필요",
  AI_UNAVAILABLE: "AI 사용 불가",
  QWEN_UNAVAILABLE: "Qwen 서버 미접속",
  // 미접속과 응답 형식 오류를 함께 뜻한다(ADR-031 C6·ADR-032 D9). 그래서 "서버 미접속"이라 쓰지 않는다.
  KEV_UNAVAILABLE: "결정 모델 사용 불가",
  MOCK_FALLBACK: "Mock 대체 결과",
  PARSE_UNSUPPORTED: "첨부 원문 확인",
  DOCUMENT_DOWNLOAD_FAILED: "첨부 원문 확인(내려받기 실패)",
  INSUFFICIENT_DATA: "근거 부족",
  INJECTION_SUSPECTED: "문서 지시문 의심",
  SCALE_LIMIT_EXCEEDED: "수행 상한 초과",
} as const satisfies Record<ReviewFlag, string>;

// 상세 단계 이력(§5.4.3)
export const STAGE_LABEL = {
  PLAN: "발주계획",
  PROCUREMENT_REQUEST: "조달요청",
  PRE_SPEC: "사전규격",
  NOTICE: "입찰공고",
  OPENING: "개찰",
  AWARD: "낙찰",
  CONTRACT: "계약",
} as const satisfies Record<BidStage, string>;

type NotificationType = Notification["type"];

// §5.5
export const NOTIFICATION_TYPE_LABEL = {
  REVIEW_ASSIGNED: "결정 담당 지정",
  ANALYSIS_COMPLETE: "분석 완료",
  BID_CHANGED: "공고 변경",
  BID_CREATED: "새 공고",
  DEADLINE_APPROACHING: "마감 임박",
  BID_RECOMMENDED: "추천 공고",
  KAKAO_EXPIRED: "카카오 연결 만료",
} as const satisfies Record<NotificationType, string>;

export const NOTIFICATION_ICON = {
  REVIEW_ASSIGNED: UserCheckIcon,
  ANALYSIS_COMPLETE: CircleCheckIcon,
  BID_CHANGED: FilePenIcon,
  BID_CREATED: FilePlusIcon,
  DEADLINE_APPROACHING: CalendarClockIcon,
  BID_RECOMMENDED: ThumbsUpIcon,
  KAKAO_EXPIRED: Link2OffIcon,
} as const satisfies Record<NotificationType, LucideIcon>;

// §5.4.9 사람 검토 권장 플래그 5개. 나머지 12개는 중립 배지로 그린다.
export const REVIEW_RECOMMENDED_FLAGS = [
  "MODEL_RULE_DISAGREEMENT",
  "KEV_MANDATORY_RISK",
  "KEV_NEEDS_REVIEW",
  "KEV_REQUIREMENT_DISAGREEMENT",
  "INJECTION_SUSPECTED",
] as const satisfies readonly ReviewFlag[];

const FLAG_REVIEW = { icon: CircleAlertIcon, className: "text-warning" } as const;
const FLAG_NEUTRAL = { icon: InfoIcon, className: "text-muted-foreground" } as const;

// 플래그 전용 아이콘·색. 규칙 우선은 §3.3 표와 같다. TriangleAlertIcon 은 분석 PARTIAL 용이라 쓰지 않는다.
export const FLAG_ICON = {
  MODEL_RULE_DISAGREEMENT: STATUS_ICON.RULE_FIRST,
  KEV_MANDATORY_RISK: FLAG_REVIEW,
  KEV_NEEDS_REVIEW: FLAG_REVIEW,
  KEV_REQUIREMENT_DISAGREEMENT: FLAG_REVIEW,
  INJECTION_SUSPECTED: FLAG_REVIEW,
  KEV_DELIVERY_RISK: FLAG_NEUTRAL,
  CITATION_FAILED: FLAG_NEUTRAL,
  EXTRACTION_FAILED: FLAG_NEUTRAL,
  EXTRACTION_LOW_CONFIDENCE: FLAG_NEUTRAL,
  TRANSLATION_INCOMPLETE: FLAG_REVIEW,
  AI_UNAVAILABLE: FLAG_NEUTRAL,
  QWEN_UNAVAILABLE: FLAG_NEUTRAL,
  KEV_UNAVAILABLE: FLAG_NEUTRAL,
  MOCK_FALLBACK: FLAG_NEUTRAL,
  PARSE_UNSUPPORTED: FLAG_NEUTRAL,
  DOCUMENT_DOWNLOAD_FAILED: FLAG_NEUTRAL,
  INSUFFICIENT_DATA: FLAG_NEUTRAL,
  SCALE_LIMIT_EXCEEDED: FLAG_NEUTRAL,
} as const satisfies Record<ReviewFlag, { icon: LucideIcon; className: string }>;

// 08 §5.2 결정 정책의 규칙 경로(C4 RulePath)를 Kev 불일치 문장의 사유로 옮긴다.
// 저장소가 rulePath 를 주면 그것을 쓰고, 없으면 자격 상태로 정한다. 둘 다 점수 쪽이면 "SOL Score 기준"이다.
const RULE_PATH_REASON: Record<string, string> = {
  MANDATORY_NOT_SATISFIED: "필수자격 미충족",
  QUALIFICATION_NEEDS_REVIEW: "자격 확인 필요",
  MISSING_FACTORS: "미확인 요소 2개 이상",
  SCORE_BID: "SOL Score 기준",
  SCORE_WATCH: "SOL Score 기준",
  SCORE_NO_BID: "SOL Score 기준",
};

export function ruleReasonOf(
  view: Pick<AnalysisView, "qualification">,
  rulePath?: string | null,
): string {
  const byPath = rulePath ? RULE_PATH_REASON[rulePath] : undefined;
  if (byPath !== undefined) return byPath;
  if (view.qualification.status === "NOT_SATISFIED") return "필수자격 미충족";
  if (view.qualification.status === "NEEDS_REVIEW") return "자격 확인 필요";
  return "SOL Score 기준";
}

// 판단 7: 저장 행의 kev_assist 가 null 이면 kev.enabled=false 로 옮겨진다. 이 run 이 결정 모델을 썼는데(model.kev)
// 결정 모델 불가 플래그가 없으면 꺼진 것이 아니라 기록이 없는 것이다. 화면은 "사용 안 함" 대신 "기록 없음"이라고 쓴다.
export function kevRecordMissing(
  view: Pick<AnalysisView, "kev" | "model" | "reviewFlags">,
): boolean {
  return (
    !view.kev.enabled &&
    view.model.kev !== null &&
    !view.reviewFlags.some((flag) => flag === "KEV_UNAVAILABLE" || flag === "AI_UNAVAILABLE")
  );
}
