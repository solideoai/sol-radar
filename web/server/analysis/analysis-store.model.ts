import "server-only";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import type { AttachmentTextReader, RevisionDocumentText } from "@/server/ingestion";
import {
  companyProfileSchema,
  normalizedBidSummarySchema,
  scoringTeamSchema,
  toScoringTeam,
  type ScoringAssignment,
  type ScoringPerson,
} from "@/server/scoring";
import {
  toFixtureStem,
  type AnalysisRunTracker,
  type LoadedAnalysisContext,
  type ScoreRunStatus,
} from "./analysis-job.model";
import type {
  AnalysisRunRecord,
  CachedExtraction,
  DocumentIssue,
  ExtractSource,
  ExtractionRecord,
} from "./analysis.model";
import { AnalysisInputError } from "./analysis.service";
import { toIssueList } from "./gateway.model";

// ── 저장 port 의 행 매핑: DB 행 ↔ 분석 도메인 값의 순수 규칙 (03 §7) ──
// supabase-js·DB 는 부르지 않는다(analysis.repo 몫). JSONB 는 scoring 배럴의 zod 로 검증하고,
// 맞지 않으면 값을 고쳐 살리지 않고 AnalysisInputError(경로·코드만)를 던진다.

type Tables = Database["public"]["Tables"];
type Row<Name extends keyof Tables> = Tables[Name]["Row"];

// ── 첨부 텍스트 port. 타입의 정본은 ingestion 배럴(C3 attachment.model)이다. 이 파일을 부르는 쪽을 위해 다시 내보낸다 ──

export type { AttachmentTextReader, RevisionDocumentText };

/** C3 documents job 구현 전까지 쓰는 빈 구현. 첨부가 없는 것으로 본다(mock·fixture 는 fixtureId 추출이라 영향 없음). */
export const EMPTY_ATTACHMENT_READER: AttachmentTextReader = Object.freeze({
  readRevisionDocuments: async () => [],
});

// ── 읽기 ──

export type LoaderRows = {
  scoreRun: Pick<
    Row<"score_runs">,
    | "id"
    | "org_id"
    | "bid_id"
    | "revision_id"
    | "company_profile_id"
    | "idempotency_key"
    | "status"
    | "queued_at"
  >;
  revision: Pick<
    Row<"bid_revisions">,
    "id" | "bid_id" | "revision" | "raw_payload" | "normalized" | "fetched_at"
  >;
  structured: Pick<
    Row<"bid_structured_requirements">,
    "kind" | "seq" | "code" | "name" | "value" | "source_operation"
  >[];
  extraction: Pick<
    Row<"requirement_extractions">,
    "id" | "status" | "payload" | "translations"
  > | null;
  profile: Pick<
    Row<"company_profiles">,
    | "revision"
    | "name"
    | "is_demo"
    | "technologies"
    | "technologies_complete"
    | "licenses"
    | "industry_codes"
    | "past_projects"
    | "financials"
    | "preferences"
  >;
  teamScoring: Pick<
    Row<"team_member_scoring">,
    "member_id" | "role" | "grade" | "skills" | "availability"
  >[];
  assignments: Pick<
    Row<"assignments">,
    "member_id" | "starts_at" | "ends_at" | "allocation_percent"
  >[];
  documents: RevisionDocumentText[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 문자열 사전순(코드 단위). 프로세스 locale 에 기대지 않아 같은 행이면 늘 같은 순서다. */
function compareText(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** zod 오류 → 값 없는 issue 목록("<접두어>.<경로>: <코드>"). */
function parseOrThrow<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  prefix: string,
): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AnalysisInputError(toIssueList(parsed.error).map((issue) => `${prefix}.${issue}`));
  }
  return parsed.data;
}

const SCORE_RUN_STATUSES: readonly ScoreRunStatus[] = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
];

function toScoreRunStatus(value: string): ScoreRunStatus {
  const status = SCORE_RUN_STATUSES.find((candidate) => candidate === value);
  if (status === undefined) throw new AnalysisInputError(["scoreRun.status: invalid_value"]);
  return status;
}

/** PostgREST 의 timestamptz("…+00:00") → ISO8601 UTC(Z). */
function toIsoInstant(value: string, path: string): string {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) throw new AnalysisInputError([`${path}: invalid_date`]);
  return at.toISOString();
}

/** 다운로드 실패이거나 파싱이 끝났는데 텍스트를 다 얻지 못한 문서. PENDING 은 아직 처리 전이라 문제가 아니다. */
function isProblemDocument(document: RevisionDocumentText): boolean {
  return (
    document.downloadStatus === "FAILED" ||
    document.parseStatus === "PARTIAL" ||
    document.parseStatus === "UNSUPPORTED" ||
    document.parseStatus === "FAILED"
  );
}

function toDocumentIssues(documents: RevisionDocumentText[]): DocumentIssue[] {
  return documents
    .filter(isProblemDocument)
    .toSorted((left, right) => compareText(left.documentId, right.documentId))
    .map((document) => ({
      documentId: document.documentId,
      downloadStatus: document.downloadStatus,
      parseStatus: document.parseStatus ?? "NOT_PARSED",
      errorCode: document.downloadErrorCode ?? document.parseErrorCode,
    }));
}

function toStructuredQualifications(rows: LoaderRows["structured"]) {
  return rows
    .toSorted((left, right) => compareText(left.kind, right.kind) || left.seq - right.seq)
    .map((row) => ({
      kind: row.kind,
      seq: row.seq,
      code: row.code,
      name: row.name,
      value: row.value,
      sourceOperation: row.source_operation,
    }));
}

/** bid_revisions.normalized(15 §3 NormalizedBid) → C4 공고 요약. 규칙 엔진이 읽는 필드만 옮긴다. */
function toBidSummary(rows: LoaderRows, hasDocumentIssues: boolean) {
  const { normalized } = rows.revision;
  if (!isRecord(normalized)) throw new AnalysisInputError(["bid.normalized: invalid_type"]);
  return parseOrThrow(
    normalizedBidSummarySchema,
    {
      noticeId: normalized.noticeId,
      revisionId: rows.revision.id,
      title: normalized.title,
      agency: normalized.agency,
      stage: normalized.stage,
      budgetKrw: normalized.budgetKrw,
      deadlineAt: normalized.deadlineAt,
      noticeDate: normalized.noticeDate,
      fetchedAt: normalized.fetchedAt,
      structuredQualifications: toStructuredQualifications(rows.structured),
      // 문제 문서가 없으면 키를 넣지 않는다. 입력 스냅샷이 fixture 경로의 공고 요약과 같은 모양이 되게 한다.
      ...(hasDocumentIssues ? { attachmentsIncomplete: true } : {}),
    },
    "bid",
  );
}

const CACHED_STATUSES: readonly CachedExtraction["status"][] = [
  "COMPLETED",
  "PENDING_REVIEW",
  "FAILED",
];

/** 문자열 → 문자열 사전이 아니면 null 이다(쓸 수 없는 번역은 /kev 에 싣지 않는다). */
function toTranslations(value: Json | null): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const entries = Object.entries(value);
  const strings = entries.flatMap(([key, text]): [string, string][] =>
    typeof text === "string" ? [[key, text]] : [],
  );
  return strings.length === entries.length ? Object.fromEntries(strings) : null;
}

/** payload 검증은 runAnalysis(readCachedExtraction) 몫이다. 알 수 없는 상태의 행은 없는 것으로 본다. */
function toCachedExtraction(row: LoaderRows["extraction"]): CachedExtraction | null {
  if (row === null) return null;
  const status = CACHED_STATUSES.find((candidate) => candidate === row.status);
  if (status === undefined) return null;
  return {
    id: row.id,
    status,
    payload: row.payload,
    translations: toTranslations(row.translations),
  };
}

function toProfile(row: LoaderRows["profile"]) {
  return parseOrThrow(
    companyProfileSchema,
    {
      revision: row.revision,
      name: row.name,
      isDemo: row.is_demo,
      technologies: row.technologies,
      technologiesComplete: row.technologies_complete,
      licenses: row.licenses,
      industryCodes: row.industry_codes,
      pastProjects: row.past_projects,
      financials: row.financials,
      preferences: row.preferences,
    },
    "profile",
  );
}

// team_member_scoring 의 JSONB 열 모양. 날짜·fte 범위는 마지막의 scoringTeamSchema 가 본다.
const teamScoringRowSchema = z.object({
  member_id: z.string().min(1),
  role: z.string(),
  grade: z.string().nullable(),
  skills: z.array(z.string()),
  availability: z.array(z.object({ startsAt: z.string(), endsAt: z.string(), fte: z.number() })),
});

function toScoringPerson(row: LoaderRows["teamScoring"][number], index: number): ScoringPerson {
  const parsed = parseOrThrow(teamScoringRowSchema, row, `teamScoring.${index}`);
  return {
    personId: parsed.member_id,
    scoringEligible: true,
    role: parsed.role,
    grade: parsed.grade,
    skills: parsed.skills,
    availability: parsed.availability,
  };
}

/** 같은 행이면 늘 같은 순서(입력 해시 결정성). */
function compareAssignments(
  left: LoaderRows["assignments"][number],
  right: LoaderRows["assignments"][number],
): number {
  return (
    compareText(left.member_id, right.member_id) ||
    compareText(left.starts_at, right.starts_at) ||
    compareText(left.ends_at, right.ends_at) ||
    left.allocation_percent - right.allocation_percent
  );
}

/** team_member_scoring(availability 에 기존 배정이 접혀 있다) + assignments → C4 팀. asOf 는 score_runs.queued_at 이다. */
function toTeam(rows: LoaderRows, asOf: string) {
  const people = rows.teamScoring
    .toSorted((left, right) => compareText(left.member_id, right.member_id))
    .map(toScoringPerson);
  const assignments: ScoringAssignment[] = rows.assignments
    .toSorted(compareAssignments)
    .map((row) => ({
      personId: row.member_id,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      allocationPercent: row.allocation_percent,
    }));
  return parseOrThrow(scoringTeamSchema, toScoringTeam(people, assignments, asOf), "team");
}

/** fixture 공고는 seed·수집이 raw_payload.fixtureId 에 넣는다. 그 밖의 모양(문자열·배열·없음)은 추측하지 않는다. */
function rawFixtureIdOf(rawPayload: Json): unknown {
  return isRecord(rawPayload) ? rawPayload.fixtureId : null;
}

/** loader 가 읽은 행 → LoadedAnalysisContext. */
export function toLoadedContext(rows: LoaderRows): LoadedAnalysisContext {
  const { scoreRun, revision } = rows;
  const queuedAt = toIsoInstant(scoreRun.queued_at, "scoreRun.queued_at");
  const documentIssues = toDocumentIssues(rows.documents);
  return {
    orgId: scoreRun.org_id,
    scoreRunId: scoreRun.id,
    bidId: scoreRun.bid_id,
    companyProfileId: scoreRun.company_profile_id,
    idempotencyKey: scoreRun.idempotency_key,
    status: toScoreRunStatus(scoreRun.status),
    queuedAt,
    fixtureId: toFixtureStem(rawFixtureIdOf(revision.raw_payload), revision.revision),
    bid: toBidSummary(rows, documentIssues.length > 0),
    extraction: toCachedExtraction(rows.extraction),
    profile: toProfile(rows.profile),
    team: toTeam(rows, queuedAt),
    documentIssues,
  };
}

/** /extract 원문: 본문(normalized.content)과 텍스트가 있는 첨부(port 순서 그대로). */
export function toExtractSource(
  normalized: unknown,
  documents: RevisionDocumentText[],
): ExtractSource {
  if (!isRecord(normalized)) throw new AnalysisInputError(["bid.normalized: invalid_type"]);
  const { content } = normalized;
  if (typeof content !== "string") {
    throw new AnalysisInputError(["bid.normalized.content: invalid_type"]);
  }
  return {
    body: content,
    attachments: documents.flatMap((document) =>
      document.text === null
        ? []
        : [{ documentId: document.documentId, text: document.text, pages: document.pages }],
    ),
  };
}

// ── 쓰기 ──

/** JSONB 열에 넣을 값. JSON 으로 한 번 직렬화해 Json 으로 만든다(undefined 키는 빠진다, PostgREST 본문과 같다). */
function toJson(value: unknown): Json {
  const json: Json = JSON.parse(JSON.stringify(value) ?? "null");
  return json;
}

/** 열 값은 대문자 집합이다(04 check). */
function toColumnCase(value: string): string {
  return value.toUpperCase();
}

export function toExtractionRow(
  record: ExtractionRecord,
): Tables["requirement_extractions"]["Insert"] {
  return {
    bid_id: record.bidId,
    revision_id: record.revisionId,
    provider: toColumnCase(record.provider),
    model_name: record.modelName,
    prompt_version: record.promptVersion,
    prompt_hash: record.promptHash,
    schema_version: record.schemaVersion,
    status: record.status,
    payload: toJson(record.payload),
    translations: record.translations,
    warnings: record.warnings,
    latency_ms: record.latencyMs,
    retries: record.retries,
  };
}

export function toRunningUpdate(
  input: Parameters<AnalysisRunTracker["markRunning"]>[0],
): Tables["score_runs"]["Update"] {
  return {
    status: "RUNNING",
    started_at: input.startedAt,
    run_mode: toColumnCase(input.runMode),
    ai_provider: toColumnCase(input.aiProvider),
  };
}

export function toFailedUpdate(
  input: Parameters<AnalysisRunTracker["markFailed"]>[0],
): Tables["score_runs"]["Update"] {
  return { status: "FAILED", error_code: input.errorCode, finished_at: input.finishedAt };
}

/** 순서를 지키며 중복을 뺀다. */
function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * score_runs 마감 열(03 §7). 규칙 결과(result)와 모델 출력(kev_output)·파이프라인 값(meta)을 다른 열에 둔다.
 * started_at 은 넣지 않는다. markRunning 이 쓴 시도 시작 시각(시도 식별자)이라 마감이 바꾸지 않는다(보안 검토 후속).
 */
export function toScoreRunResultUpdate(record: AnalysisRunRecord): Tables["score_runs"]["Update"] {
  const { result, meta } = record;
  return {
    status: result.status,
    score: result.score,
    recommendation: result.recommendation,
    recommendation_basis: result.recommendationBasis,
    error_code: result.errorCode,
    injection_suspected: result.injectionSuspected,
    explanation: meta.explanation.text,
    review_flags: unique<string>([...result.reviewFlags, ...meta.extraReviewFlags]),
    missing_factors: unique<string>(result.missingFactors.map((missing) => missing.factor)),
    input_snapshot: toJson(record.input),
    input_snapshot_hash: result.inputSnapshotHash,
    kev_output: record.kevOutput === null ? null : toJson(record.kevOutput),
    kev_assist: toJson(result.kev),
    model_metadata: toJson({ ...meta.model, explanationSource: meta.explanation.source }),
    qwen_model: meta.model.qwen?.name ?? null,
    prompt_hash: meta.model.qwen?.promptHash ?? null,
    kev_model: meta.model.kev?.model ?? null,
    question_set_version: meta.model.kev?.questionSetVersion ?? null,
    run_mode: toColumnCase(meta.runMode),
    ai_provider: toColumnCase(meta.model.provider),
    extraction_id: record.extractionId,
    finished_at: meta.finishedAt,
    // 보정·자동 대체는 아직 없다(03 §8). 늘 null 이다.
    kev_calibration: null,
    fallback_reason: null,
  };
}

// 자식 3표: service role 은 RLS 를 거치지 않으므로 조직(org_id)과 run 은 레코드 값으로 직접 지정한다.

export function toScoreFactorRows(record: AnalysisRunRecord): Tables["score_factors"]["Insert"][] {
  return record.result.factors.map((factor) => ({
    score_run_id: record.scoreRunId,
    org_id: record.orgId,
    factor: factor.factor,
    raw_value: toJson(factor.rawValue),
    normalized: factor.normalized,
    points: factor.points,
    max_points: factor.maxPoints,
    missing: factor.missing,
    missing_reason: factor.missingReason,
    evidence: toJson(factor.evidence),
    note: factor.note,
  }));
}

export function toQualificationCheckRows(
  record: AnalysisRunRecord,
): Tables["qualification_checks"]["Insert"][] {
  return record.result.qualificationChecks.map((check) => ({
    score_run_id: record.scoreRunId,
    org_id: record.orgId,
    bid_id: record.bidId,
    revision_id: record.revisionId,
    requirement_code: check.requirementCode,
    requirement_name: check.requirementName,
    mandatory: check.mandatory,
    outcome: check.outcome,
    reason_code: check.reasonCode,
    reason: check.reason,
    basis: check.basis,
    evidence: toJson(check.evidence),
    profile_evidence: toJson(check.profileEvidence),
    company_evidence: toJson(check.companyEvidence),
  }));
}

export function toRequirementAssessmentRows(
  record: AnalysisRunRecord,
): Tables["requirement_assessments"]["Insert"][] {
  return record.result.requirementAssessments.map((assessment) => ({
    score_run_id: record.scoreRunId,
    org_id: record.orgId,
    item_id: assessment.itemId,
    item_kind: assessment.itemKind,
    rule_status: assessment.ruleStatus,
    rule_reason: assessment.ruleReason,
    basis: assessment.basis,
    notice_evidence: toJson(assessment.noticeEvidence),
    company_evidence: toJson(assessment.companyEvidence),
    // Kev 항목 분포는 v0.2 에서 채운다.
    kev_distribution: null,
    kev_label: null,
    flags: assessment.flags,
  }));
}

/** finish_score_run(p) 의 p(20261019000011). 열 이름은 저장 매핑 함수의 출력 그대로다. */
export type FinishScoreRunPayload = {
  score_run_id: string;
  org_id: string;
  /** 이 시도의 started_at. 함수가 run 의 started_at 과 같은지 본다. */
  attempt_started_at: string;
  run: Tables["score_runs"]["Update"];
  factors: Tables["score_factors"]["Insert"][];
  assessments: Tables["requirement_assessments"]["Insert"][];
  checks: Tables["qualification_checks"]["Insert"][];
};

/**
 * 결과 저장 RPC 본문(보안 검토 후속). 자식 3표와 마감을 함수 하나가 한 트랜잭션으로 쓴다.
 * 그 run 이 RUNNING 이고 started_at 이 attempt_started_at 일 때만 쓰고, 아니면 DB 가 거절한다(끝난 run 을 덮지 않는다).
 */
export function toFinishScoreRunPayload(record: AnalysisRunRecord): FinishScoreRunPayload {
  return {
    score_run_id: record.scoreRunId,
    org_id: record.orgId,
    attempt_started_at: record.attemptStartedAt,
    run: toScoreRunResultUpdate(record),
    factors: toScoreFactorRows(record),
    assessments: toRequirementAssessmentRows(record),
    checks: toQualificationCheckRows(record),
  };
}
