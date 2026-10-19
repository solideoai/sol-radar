import "server-only";
import {
  kevMockResponseSchema,
  requirementExtractionSchema,
  type AnalysisInput,
  type AnalysisResult,
  type CompanyProfile,
  type EvidenceRef,
  type KevMockResponse,
  type NormalizedBidSummary,
  type RequirementExtraction,
  type ScoringTeamInput,
  type StructuredRequirement,
} from "@/server/scoring";
import {
  toExtractionOutcome,
  toFailureDiagnostic,
  type AiUnavailableReason,
  type ExplainOutcome,
  type FailureDiagnostic,
  type KevOutcome,
} from "./fallback.model";
import {
  toIssueList,
  type ExtractRequest,
  type ExtractResponse,
  type GatewayResult,
  type KevResponse,
} from "./gateway.model";

// ── 분석 오케스트레이션 모델: analysis job 의 입력 변환·요청 조립·플래그·메타의 순수 규칙 (03 §2.1·§5.6·§5.7·§7, 05 §4) ──
// 규칙 계산은 scoring 의 analyze 가 한다. 여기서는 그 입력을 만들고 결과(AnalysisResult)는 읽기만 한다.
// 파이프라인이 더하는 값(플래그·근거·설명·모델 정보)은 결과에 섞지 않고 meta 에 따로 둔다(e8 C6).

export type RunMode = "live" | "fixture" | "mock";
export type AiProvider = "mock" | "local" | "hosted";
export type KevQuestionSetVersion = "kev-qs/v0.1" | "kev-qs/v0.2";

/**
 * requirement_extractions 한 행 가운데 분석이 읽는 것. payload 는 JSONB 라 여기서 검증한다.
 * 실패 코드는 읽지 않는다. FAILED 행은 어차피 다시 추출한다.
 */
export type CachedExtraction = {
  /** requirement_extractions.id. 이 캐시를 쓴 run 의 score_runs.extraction_id 가 된다. */
  id: string;
  status: "COMPLETED" | "PENDING_REVIEW" | "FAILED";
  payload: unknown;
  translations: Record<string, string> | null;
};

export type DocumentIssue = {
  documentId: string;
  downloadStatus: string;
  parseStatus: string;
  errorCode: string | null;
};

/** analysis job 하나의 입력. 조직 × revision × 프로필 revision 단위(03 §2). 읽기는 호출자(worker job·repo)가 한다. */
export type AnalysisContext = {
  requestId: string;
  orgId: string;
  /** C6 가 enqueue 전에 QUEUED 로 넣은 score_runs 행의 id(e8 판정 1). */
  scoreRunId: string;
  bidId: string;
  /** score_runs.company_profile_id. loader 가 돌려준다. */
  companyProfileId: string;
  /** isDemo 공고의 "FX-07" 또는 "FX-07.r01"(K5). live 면 null. */
  fixtureId: string | null;
  /** C4 형식의 공고 요약. */
  bid: NormalizedBidSummary;
  /** 캐시 행이 없으면 null. */
  extraction: CachedExtraction | null;
  profile: CompanyProfile;
  team: ScoringTeamInput;
  runMode: RunMode;
  aiProvider: AiProvider;
  kev: { enabled: boolean; questionSetVersion: KevQuestionSetVersion };
  /** 실패·부분 파싱 첨부. 없으면 []. */
  documentIssues: DocumentIssue[];
  /** ISO8601 UTC. job 이 큐에 들어간 시각. */
  queuedAt: string;
  /**
   * ISO8601 UTC. 이 시도의 식별자 = worker 가 markRunning 에 넘긴 startedAt(score_runs.started_at).
   * 결과 저장(finish_score_run)이 이 값으로 그 시도가 잡은 run 인지 확인한다(C5-B 보안 후속 2.1).
   */
  attemptStartedAt: string;
};

/** C4 ReviewFlag 에 없는 파이프라인 플래그. */
export type ExtraReviewFlag = "CITATION_FAILED" | "EXTRACTION_LOW_CONFIDENCE" | "KEV_UNAVAILABLE";

export type AnalysisRunMeta = {
  runMode: RunMode;
  model: {
    provider: AiProvider;
    qwen: { name: string; promptVersion: string; promptHash: string } | null;
    kev: { model: string; questionSetVersion: KevQuestionSetVersion } | null;
    algorithmVersion: string;
  };
  /** 03 §8 mock 자동 대체 사유. gateway 계약에 이를 알리는 필드가 아직 없어 늘 null 이다. */
  fallbackReason: null;
  evidence: EvidenceRef[];
  /** = result.errorCode */
  errorCode: string | null;
  queuedAt: string;
  startedAt: string;
  finishedAt: string;
  /** C4 reviewFlags 에 없는 것만, 중복 없이. */
  extraReviewFlags: ExtraReviewFlag[];
  explanation: { text: string; source: "MODEL" | "TEMPLATE" };
};

/** score_runs.kev_output(03 §7). Kev 를 쓰지 않은 run 은 null 이다. */
export type KevOutput = {
  questionSetVersion: KevQuestionSetVersion;
  wire: unknown[];
  stateHash: string | null;
  /** gateway kev.stateTrace(v0.1 은 null). */
  stateTrace: unknown;
  requirements: KevResponse["requirements"];
};

/**
 * 이번 run 에 /extract·/kev 가 왜 쓸 수 없었는지(C5-B 실패 분류). 그 호출이 정상이었거나 부르지 않았으면 null 이다.
 * 200 이 정상 실패 본문(FAILED·enabled=false)을 낸 경우도 null 이다. 그 코드는 result.errorCode·extraReviewFlags 가 말한다.
 * worker 로그에만 싣는다. 저장 port 는 이 값을 DB 에 넣지 않는다(input_snapshot·meta 와 다른 칸).
 */
export type AnalysisRunDiagnostics = {
  extract: FailureDiagnostic | null;
  kev: FailureDiagnostic | null;
};

/** score_runs 에 넘길 저장 직전 값. 열 매핑은 저장 port(C2 repo) 몫이다. */
export type AnalysisRunRecord = {
  orgId: string;
  /** = context.scoreRunId. 저장 port 가 이 행을 결과로 채운다. */
  scoreRunId: string;
  bidId: string;
  /** = bid.revisionId */
  revisionId: string;
  /** = context.companyProfileId */
  companyProfileId: string;
  /**
   * score_runs.extraction_id. 캐시를 썼으면 그 행의 id, 다시 추출해 저장했으면 저장 port 가 돌려준 id,
   * 쓸 수 있는 추출이 없으면 null 이다.
   */
  extractionId: string | null;
  requestId: string;
  /** score_runs.idempotency_key(전역 UNIQUE) = toIdempotencyKey(orgId, requestId) */
  idempotencyKey: string;
  /** = context.attemptStartedAt. 결과 저장은 started_at 이 이 값인 RUNNING run 만 마감한다. meta.startedAt(분석 시작)과 다르다. */
  attemptStartedAt: string;
  /** score_runs.input_snapshot. analyze 에 넣은 값 그대로. */
  input: AnalysisInput;
  /** C4 계산 결과 그대로. 고치지 않는다. */
  result: AnalysisResult;
  meta: AnalysisRunMeta;
  kevOutput: KevOutput | null;
  /** 실패 진단. DB 매핑 밖이다(worker 로그용). */
  diagnostics: AnalysisRunDiagnostics;
};

// ── 입력 변환 ──

/** K12: 구조화 자격 행에 배열 index 로 seq 를 채운다. 입력 순서를 바꾸지 않는다. */
export function withStructuredSeq(
  rows: Omit<StructuredRequirement, "seq">[],
): StructuredRequirement[] {
  return rows.map((row, seq) => ({ ...row, seq }));
}

/** score_runs.idempotency_key. 조직 접두어를 붙여 (org_id, requestId) 쌍과 같은 효과를 낸다. 저장 port 가 on conflict 로 upsert 한다. */
export function toIdempotencyKey(orgId: string, requestId: string): string {
  return `${orgId}:${requestId}`;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 시각 → KST 날짜 "YYYY-MM-DD"(config.today). KST 는 일광절약시간이 없어 +9시간의 UTC 날짜가 곧 KST 날짜다. 프로세스 시간대를 읽지 않는다. */
export function toKstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// ── 추출 ──

/** 캐시 행 → 쓸 수 있는 추출. 못 쓰면 null(= 같은 job 안에서 /extract 를 다시 부른다, e8 정정). */
export function readCachedExtraction(
  cached: CachedExtraction | null,
): RequirementExtraction | null {
  // FAILED 행은 없는 것으로 본다. payload 가 남아 있어도 쓰지 않는다.
  if (cached === null || cached.status === "FAILED") return null;
  // 스키마를 통과하지 못한 값은 고쳐 살리지 않고 다시 추출한다.
  const parsed = requirementExtractionSchema.safeParse(cached.payload);
  return parsed.success ? parsed.data : null;
}

export type ExtractReading =
  | { kind: "EXTRACTED"; extraction: RequirementExtraction; response: ExtractResponse }
  // response 는 200 FAILED 일 때만 있고, 호출 실패·payload 스키마 위반이면 null 이다. 어느 쪽도 저장하지 않는다(e8 판정 2).
  // diagnostic 은 호출 실패·payload 스키마 위반일 때만 있다. 200 FAILED 는 gateway 가 낸 코드(reason)가 이유라 null 이다.
  | {
      kind: "UNAVAILABLE";
      reason: AiUnavailableReason;
      response: ExtractResponse | null;
      diagnostic: FailureDiagnostic | null;
    };

/** /extract 결과 → 쓸 수 있는 추출 또는 PARTIAL 사유. 1단계 toExtractionOutcome 뒤 payload 를 scoring 스키마로 검증한다. */
export function readExtractResult(result: GatewayResult<ExtractResponse>): ExtractReading {
  const outcome = toExtractionOutcome(result);
  if (outcome.kind === "UNAVAILABLE") {
    return result.ok
      ? { kind: "UNAVAILABLE", reason: outcome.reason, response: result.value, diagnostic: null }
      : {
          kind: "UNAVAILABLE",
          reason: outcome.reason,
          response: null,
          diagnostic: toFailureDiagnostic(result.failure),
        };
  }
  const parsed = requirementExtractionSchema.safeParse(outcome.response.payload);
  if (!parsed.success) {
    // gateway 가 응답했으므로 추출 실패다. issue 에는 경로·코드만 있고 payload 값(공고 원문)은 없다.
    return {
      kind: "UNAVAILABLE",
      reason: "EXTRACTION_FAILED",
      response: null,
      diagnostic: { failure: "PAYLOAD_INVALID", issues: toIssueList(parsed.error) },
    };
  }
  return { kind: "EXTRACTED", extraction: parsed.data, response: outcome.response };
}

/** NormalizedBid.content + /parse 텍스트(파싱 실패 첨부는 뺀다). 읽기는 추출 저장 port 가 한다. */
export type ExtractSource = { body: string; attachments: ExtractRequest["attachments"] };

/**
 * requirement_extractions 에 넘길 값. 성공 행(COMPLETED·PENDING_REVIEW)만 저장한다(e8 판정 2).
 * 재사용 키(revision_id, model_name, prompt_hash) upsert·열 매핑(provider 대문자 등)은 저장 port 몫이다.
 */
export type ExtractionRecord = {
  bidId: string;
  /** = bid.revisionId */
  revisionId: string;
  /** 아래 넷과 retries 는 검증한 추출의 model 에서 온다. */
  provider: AiProvider;
  modelName: string;
  promptVersion: string;
  promptHash: string;
  schemaVersion: string;
  status: "COMPLETED" | "PENDING_REVIEW";
  /** 검증한 추출 */
  payload: RequirementExtraction;
  translations: Record<string, string> | null;
  /** = response.warnings */
  warnings: string[];
  /** = response.timings.extractMs */
  latencyMs: number;
  retries: number;
};

/**
 * /extract 200 성공 응답 → 추출 저장 레코드(e8 판정: 성공 행만 저장). 모델 정보·payload 는 검증한 추출에서, 상태·번역·경고·지연은 응답에서 옮긴다.
 * FAILED 응답은 저장하지 않으므로 받으면 던진다. 호출자가 EXTRACTED 일 때만 부른다.
 */
export function toExtractionRecord(
  context: AnalysisContext,
  response: ExtractResponse,
  extraction: RequirementExtraction,
): ExtractionRecord {
  if (response.status === "FAILED") {
    throw new Error("toExtractionRecord: FAILED 응답은 저장하지 않는다");
  }
  const { model } = extraction;
  return {
    bidId: context.bidId,
    revisionId: context.bid.revisionId,
    provider: model.provider,
    modelName: model.name,
    promptVersion: model.promptVersion,
    promptHash: model.promptHash,
    schemaVersion: extraction.schemaVersion,
    status: response.status,
    payload: extraction,
    translations: response.translations,
    warnings: response.warnings,
    latencyMs: response.timings.extractMs,
    retries: model.retries,
  };
}

/** live 공고(fixtureId=null)는 키 자체를 넣지 않는다. mock 어댑터가 키 유무로 fixture 를 고른다. */
function fixtureIdField(fixtureId: string | null): { fixtureId?: string } {
  return fixtureId === null ? {} : { fixtureId };
}

/** /extract 요청(03 §2.1 ExtractRequest). */
export function toExtractRequest(context: AnalysisContext, source: ExtractSource): ExtractRequest {
  const { bid } = context;
  return {
    requestId: context.requestId,
    bidId: context.bidId,
    revisionId: bid.revisionId,
    ...fixtureIdField(context.fixtureId),
    meta: {
      stage: bid.stage,
      agency: bid.agency,
      budgetKrw: bid.budgetKrw,
      deadlineAt: bid.deadlineAt,
    },
    body: source.body,
    attachments: source.attachments,
  };
}

// ── Kev ──

/** /kev 요청(03 §5.7 KevAdapterInput + K6). 규칙 결과(자격·점수·권고)를 넣지 않는다(03 §5.6). */
export type KevRequest = {
  requestId: string;
  /** context.fixtureId 가 null 이면 키를 넣지 않는다. */
  fixtureId?: string;
  bidId: string;
  orgId: string;
  /** bid.revisionId */
  revisionId: string;
  /** profile.revision */
  profileRevision: number;
  extraction: RequirementExtraction;
  translations: Record<string, string> | null;
  /** 인력 가용(K6)은 아직 채우지 않는다. */
  profileSummary: CompanyProfile & { staffAvailability: null };
  attachmentsIncomplete: boolean;
  questionSetVersion: KevQuestionSetVersion;
  /** 운영은 영어 state 만 보낸다(03 §5.11). */
  stateLanguage: "en";
};

const ATTACHMENT_PARSE_FAILED_PREFIX = "ATTACHMENT_PARSE_FAILED:";

/**
 * translations 는 호출자가 고른다. 이번 run 에 다시 추출했으면 그 응답의 값(null 이어도 그대로),
 * 캐시를 썼으면 캐시 행의 값이다. 쓸 수 없던 캐시 행의 번역은 오래된 값이라 쓰지 않는다.
 */
export function toKevRequest(
  context: AnalysisContext,
  extraction: RequirementExtraction,
  translations: Record<string, string> | null,
): KevRequest {
  const { bid } = context;
  const attachmentsIncomplete =
    bid.attachmentsIncomplete === true ||
    extraction.warnings.some((warning) => warning.startsWith(ATTACHMENT_PARSE_FAILED_PREFIX)) ||
    context.documentIssues.length > 0;
  return {
    requestId: context.requestId,
    ...fixtureIdField(context.fixtureId),
    bidId: context.bidId,
    orgId: context.orgId,
    revisionId: bid.revisionId,
    profileRevision: context.profile.revision,
    extraction,
    translations,
    profileSummary: { ...context.profile, staffAvailability: null },
    attachmentsIncomplete,
    questionSetVersion: context.kev.questionSetVersion,
    stateLanguage: "en",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type WireElement = { responses: Record<string, unknown> };

function isWireElement(element: unknown): element is WireElement {
  return isRecord(element) && isRecord(element.responses);
}

type WireMerge = { ok: true; responses: Record<string, unknown> } | { ok: false; issues: string[] };

/**
 * wire 원소들의 responses 를 순서대로 펼쳐 합친다(분할 호출, 03 §5.10). 같은 질문이 겹치면 나중 원소가 이긴다.
 * 원소 하나라도 responses 객체가 아니면 응답 전체를 쓰지 않는다. 그때 issue 는 처음 어긋난 원소의 경로 하나다.
 */
function mergeWireResponses(wire: unknown[]): WireMerge {
  if (wire.length === 0) return { ok: false, issues: ["wire: too_small"] };
  const badIndex = wire.findIndex((element) => !isWireElement(element));
  if (badIndex !== -1) return { ok: false, issues: [`wire.${badIndex}.responses: invalid_type`] };
  const parts = wire.filter(isWireElement).map((element) => element.responses);
  return { ok: true, responses: Object.fromEntries(parts.flatMap((part) => Object.entries(part))) };
}

/** wire 읽기 결과. 쓸 수 있으면 analyze 입력과 원래 wire(kev_output 저장용)를, 못 쓰면 issue 목록("경로: 코드")을 돌려준다. */
export type KevWireReading =
  { ok: true; kevWire: KevMockResponse; wire: unknown[] } | { ok: false; issues: string[] };

/** gateway /kev 응답 → C4 analyze 의 kev 입력(wire 형식, kevMockResponseSchema). 못 쓰면 이유를 issue 로 돌려준다(값은 싣지 않는다). */
export function readKevWire(response: KevResponse): KevWireReading {
  if (response.wire === null) return { ok: false, issues: ["wire: invalid_type"] };
  const merged = mergeWireResponses(response.wire);
  if (!merged.ok) return merged;
  // kev 안쪽은 1단계에서 봉투만 검증했다(looseObject). 값의 형식은 여기서 scoring 스키마에 맡긴다.
  const { kev } = response;
  const parsed = kevMockResponseSchema.safeParse({
    provider: kev.provider,
    model: kev.model ?? null,
    questionSetVersion: kev.questionSetVersion,
    requestId: kev.requestId ?? null,
    responses: merged.responses,
    latency_ms: response.timings.kevMs,
  });
  return parsed.success
    ? { ok: true, kevWire: parsed.data, wire: response.wire }
    : { ok: false, issues: toIssueList(parsed.error) };
}

/** gateway /kev 응답 → C4 analyze 의 kev 입력. 못 만들면 null. 이유가 필요하면 readKevWire 를 쓴다. */
export function toKevWire(response: KevResponse): KevMockResponse | null {
  const reading = readKevWire(response);
  return reading.ok ? reading.kevWire : null;
}

// ── 결과 읽기 ──

/** 같은 근거 판정 키. 없는 것(undefined)과 null 은 같게 본다. */
function evidenceKey(ref: EvidenceRef): string {
  return JSON.stringify([
    ref.kind ?? "TEXT",
    ref.documentId,
    ref.revisionId,
    ref.page ?? null,
    ref.charStart ?? null,
    ref.charEnd ?? null,
    ref.apiField ?? null,
    ref.quotedText,
  ]);
}

/** 결과에 쓰인 공고 쪽 근거를 모은다. 자격 검사 → 요소 순서이고, match=FAILED 를 먼저 뺀 뒤 같은 근거는 처음 것 하나만 남긴다. */
export function collectEvidence(result: AnalysisResult): EvidenceRef[] {
  const candidates = [
    ...result.qualificationChecks.flatMap((check) => check.evidence),
    ...result.factors.flatMap((factor) => factor.evidence),
  ].filter((ref) => ref.match !== "FAILED");
  const firstByKey = new Map<string, EvidenceRef>();
  for (const ref of candidates) {
    const key = evidenceKey(ref);
    if (!firstByKey.has(key)) firstByKey.set(key, ref);
  }
  return [...firstByKey.values()];
}

/** K1 인용 검증 실패를 표시하는 추출 필드. */
const EXTRACTED_FIELD_KEYS = [
  "summary",
  "projectType",
  "domain",
  "requiredSkills",
  "preferredSkills",
  "qualifications",
  "pastPerformance",
  "staffing",
  "budgetKrw",
  "deadlineAt",
  "contractMethod",
  "restrictions",
  "submission",
] as const satisfies readonly (keyof RequirementExtraction)[];

const CITATION_FAILED = "CITATION_FAILED";

function hasCitationFailure(extraction: RequirementExtraction): boolean {
  const inWarnings = extraction.warnings.some(
    (warning) => warning === CITATION_FAILED || warning.startsWith(`${CITATION_FAILED}:`),
  );
  return inWarnings || EXTRACTED_FIELD_KEYS.some((key) => extraction[key].note === CITATION_FAILED);
}

/** C4 reviewFlags 에 없는 파이프라인 플래그. 순서는 CITATION_FAILED → EXTRACTION_LOW_CONFIDENCE → KEV_UNAVAILABLE. */
export function extraReviewFlags(input: {
  extraction: RequirementExtraction | null;
  kev: KevOutcome | null;
  resultFlags: readonly string[];
}): ExtraReviewFlag[] {
  const { extraction, kev, resultFlags } = input;
  const candidates: [ExtraReviewFlag, boolean][] = [
    ["CITATION_FAILED", extraction !== null && hasCitationFailure(extraction)],
    // 3b 통보: 인용 검증이 대량으로 실패하면 gateway 가 이 경고를 낸다(03 §8).
    [
      "EXTRACTION_LOW_CONFIDENCE",
      extraction?.warnings.includes("EXTRACTION_LOW_CONFIDENCE") ?? false,
    ],
    // Kev 만 불가(200 KEV_UNAVAILABLE)와 gateway 가 응답했지만 쓸 수 없음(UNUSABLE)은 같은 플래그다.
    // gateway 불가(GATEWAY_DOWN)는 C4 의 AI_UNAVAILABLE 몫이라 여기서 내지 않는다.
    [
      "KEV_UNAVAILABLE",
      (kev?.kind === "DISABLED" && kev.kevUnavailable) || kev?.kind === "UNUSABLE",
    ],
  ];
  return candidates
    .filter(([flag, raised]) => raised && !resultFlags.includes(flag))
    .map(([flag]) => flag);
}

// ── 설명 ──

/** /explain 요청(K8). 설명 대상이므로 규칙 결과를 넣는다(03 §2.1). 안쪽 이름은 C4 그대로다. */
export type ExplainRequest = {
  requestId: string;
  qualificationChecks: AnalysisResult["qualificationChecks"];
  scoreBreakdown: {
    score: number;
    factors: AnalysisResult["factors"];
    recommendation: AnalysisResult["recommendation"];
    recommendationBasis: AnalysisResult["recommendationBasis"];
    /** result.reviewFlags 뒤에 파이프라인 플래그(중복 없이). */
    reviewFlags: string[];
    missingFactors: AnalysisResult["missingFactors"];
  };
  evidence: EvidenceRef[];
  /** result.kev.enabled 가 false 면 null. */
  kevSummary: AnalysisResult["kev"] | null;
  documentIssues: DocumentIssue[];
};

export function toExplainRequest(input: {
  requestId: string;
  result: AnalysisResult;
  extraFlags: ExtraReviewFlag[];
  evidence: EvidenceRef[];
  documentIssues: DocumentIssue[];
}): ExplainRequest {
  const { result } = input;
  return {
    requestId: input.requestId,
    qualificationChecks: result.qualificationChecks,
    scoreBreakdown: {
      score: result.score,
      factors: result.factors,
      recommendation: result.recommendation,
      recommendationBasis: result.recommendationBasis,
      reviewFlags: [...new Set<string>([...result.reviewFlags, ...input.extraFlags])],
      missingFactors: result.missingFactors,
    },
    evidence: input.evidence,
    kevSummary: result.kev.enabled ? result.kev : null,
    documentIssues: input.documentIssues,
  };
}

/** 설명 문장. 모델 문장(fallback=false)만 모델 것으로 쓰고, 그 밖에는 C4 템플릿이다(K3). gateway 의 템플릿 문장은 쓰지 않는다. */
export function chooseExplanation(
  outcome: ExplainOutcome | null,
  result: AnalysisResult,
): AnalysisRunMeta["explanation"] {
  return outcome?.kind === "MODEL_TEXT"
    ? { text: outcome.text, source: "MODEL" }
    : { text: result.explanation, source: "TEMPLATE" };
}

// ── 메타 ──

/** 메타의 model 칸(05 AnalysisResult.model). */
export function toModelMeta(input: {
  aiProvider: AiProvider;
  extraction: RequirementExtraction | null;
  result: AnalysisResult;
}): AnalysisRunMeta["model"] {
  const { aiProvider, extraction, result } = input;
  const { model, questionSetVersion } = result.kev;
  return {
    provider: aiProvider,
    qwen:
      extraction === null
        ? null
        : {
            name: extraction.model.name,
            promptVersion: extraction.model.promptVersion,
            promptHash: extraction.model.promptHash,
          },
    // fixture wire 처럼 model 이 없으면 무엇을 썼는지 말할 수 없으므로 null 이다.
    kev:
      result.kev.enabled && model !== null && questionSetVersion !== null
        ? { model, questionSetVersion }
        : null,
    algorithmVersion: result.algorithmVersion,
  };
}
