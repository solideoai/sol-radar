import "server-only";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { readableExplanation } from "@/server/shared";
import {
  KEV_DISCLAIMER,
  SOL_SCORE_DISCLAIMER,
  analysisViewSchema,
  companyEvidenceRefSchema,
  evidenceRefSchema,
  kevViewSchema,
  requirementAssessmentViewSchema,
} from "./analysis-view.model";
import type { AnalysisView, KevView, QualificationCheckView } from "./analysis-view.model";
import { factorKeySchema } from "./bid.model";
import type { QualificationOutcome } from "./bid.model";

type Tables = Database["public"]["Tables"];
export type ScoreRunRow = Tables["score_runs"]["Row"];
export type ScoreFactorRow = Tables["score_factors"]["Row"];
export type QualificationCheckRow = Tables["qualification_checks"]["Row"];
export type RequirementAssessmentRow = Tables["requirement_assessments"]["Row"];

// 분석 한 건을 이루는 저장 행 묶음. revision 은 run 의 revision_id 가 가리키는 공고 개정 번호다.
export type AnalysisRows = {
  run: ScoreRunRow;
  revision: number;
  // run 이 가리키는 회사 프로필 revision 의 is_demo. embed 가 null 이면 true 로 읽는다.
  profileIsDemo: boolean;
  factors: ScoreFactorRow[];
  checks: QualificationCheckRow[];
  assessments: RequirementAssessmentRow[];
};

const evidenceListSchema = z.array(evidenceRefSchema);
const companyEvidenceListSchema = z.array(companyEvidenceRefSchema);
// 항목별 Kev 값은 DTO 의 바깥 스키마로 읽는다. 저장 열은 {qid, distribution} + kev_label 이다.
const assessmentKevSchema = requirementAssessmentViewSchema.shape.kev;

type Evidence = z.infer<typeof evidenceRefSchema>;

// C4 규칙(scoring/qualification.ts overallStatus + 지시문 의심)을 옮긴 것이다. 저장 열이 없어 다시 계산한다.
// 도메인 간 런타임 import 를 피하려고 여기에 둔다. 필수 항목만 본다.
export function qualificationStatusOf(
  checks: QualificationCheckView[],
  injectionSuspected: boolean,
): QualificationOutcome {
  if (injectionSuspected) return "NEEDS_REVIEW";
  const mandatory = checks.filter((check) => check.mandatory);
  if (mandatory.some((check) => check.outcome === "NOT_SATISFIED")) return "NOT_SATISFIED";
  if (mandatory.some((check) => check.outcome === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "SATISFIED";
}

const disabledKev = (): KevView => ({
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
});

// kev_assist 가 없으면(C5-B 이전 행) 꺼짐으로 읽는다. 모양이 틀리면 꺼짐 + 로그 1회(O13).
function kevOf(run: ScoreRunRow): KevView {
  if (run.kev_assist === null) return disabledKev();
  const parsed = kevViewSchema.safeParse(run.kev_assist);
  if (parsed.success) return parsed.data;
  console.error(JSON.stringify({ event: "kev_assist_invalid", scoreRunId: run.id }));
  return disabledKev();
}

const quoteKey = (e: Evidence): string =>
  JSON.stringify([
    e.documentId,
    e.page ?? null,
    e.charStart ?? null,
    e.charEnd ?? null,
    e.apiField ?? null,
    e.quotedText,
  ]);

// 자격 → 요소 → 항목 근거 순서로 모으고, 인용 검증에 실패한 것은 빼고, 같은 인용은 하나만 남긴다.
function collectEvidence(lists: Evidence[][]): Evidence[] {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const evidence of lists.flat()) {
    if (evidence.match === "FAILED") continue;
    const key = quoteKey(evidence);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(evidence);
  }
  return out;
}

const isScored = (run: ScoreRunRow): boolean =>
  run.status === "COMPLETED" || run.status === "PARTIAL";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// C5-B writer 는 model_metadata 에 {provider, qwen:{promptVersion…}, …} 를 쓴다.
// 순서: qwen.promptVersion -> 최상위 promptVersion -> "".
function promptVersionOf(metadata: unknown): string {
  if (!isRecord(metadata)) return "";
  const nested = isRecord(metadata.qwen) ? metadata.qwen.promptVersion : undefined;
  if (typeof nested === "string") return nested;
  return typeof metadata.promptVersion === "string" ? metadata.promptVersion : "";
}

// 분포가 없거나 모양이 틀리면 null 이다. 틀린 경우 값은 싣지 않고 id 만 로그에 남긴다.
function assessmentKevOf(row: RequirementAssessmentRow): z.infer<typeof assessmentKevSchema> {
  if (row.kev_label === null || row.kev_distribution === null) return null;
  const stored = row.kev_distribution;
  const candidate = isRecord(stored)
    ? { qid: stored.qid, distribution: stored.distribution, label: row.kev_label }
    : stored;
  const parsed = assessmentKevSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  console.error(JSON.stringify({ event: "kev_distribution_invalid", id: row.id }));
  return null;
}

function modelOf(run: ScoreRunRow): AnalysisView["model"] {
  const promptVersion = promptVersionOf(run.model_metadata);
  return {
    provider: run.ai_provider.toLowerCase() as AnalysisView["model"]["provider"],
    qwen:
      run.qwen_model === null
        ? null
        : {
            name: run.qwen_model,
            promptVersion,
            promptHash: run.prompt_hash ?? "",
          },
    kev:
      run.kev_model !== null && run.question_set_version !== null
        ? { model: run.kev_model, questionSetVersion: run.question_set_version }
        : null,
    algorithmVersion: run.algorithm_version,
  };
}

// 저장 행에서 05 AnalysisView 를 다시 만든다(다시 계산하지 않는다). 대문자 열 값은 소문자 DTO 로 옮긴다.
export function toAnalysisViewFromRows(rows: AnalysisRows): AnalysisView {
  const { run } = rows;
  const scored = isScored(run);

  const checks: QualificationCheckView[] = scored
    ? rows.checks.map((row) => ({
        id: row.id,
        requirementCode: row.requirement_code,
        requirementName: row.requirement_name,
        mandatory: row.mandatory,
        outcome: row.outcome as QualificationOutcome,
        reason: row.reason,
        reasonCode: row.reason_code as QualificationCheckView["reasonCode"],
        basis: row.basis as QualificationCheckView["basis"],
        evidence: evidenceListSchema.parse(row.evidence),
        profileEvidence: (row.profile_evidence ?? []) as QualificationCheckView["profileEvidence"],
        companyEvidence: companyEvidenceListSchema.parse(row.company_evidence),
        checkedAt: row.checked_at,
      }))
    : [];

  const knownFactor = (name: string): boolean => factorKeySchema.options.some((k) => k === name);
  for (const row of scored ? rows.factors : []) {
    if (!knownFactor(row.factor)) {
      console.error(JSON.stringify({ event: "score_factor_unknown", factor: row.factor }));
    }
  }
  const factorRows = scored
    ? factorKeySchema.options.flatMap((key) => rows.factors.filter((f) => f.factor === key))
    : [];
  const scoreBreakdown = factorRows.map((row) => ({
    factor: row.factor,
    rawValue: row.raw_value,
    normalized: row.normalized === null ? null : Number(row.normalized),
    points: Number(row.points),
    maxPoints: Number(row.max_points),
    missing: row.missing,
    missingReason: row.missing_reason,
    evidence: evidenceListSchema.parse(row.evidence),
    note: row.note,
  }));
  // 사유가 없는 누락(C5-B 이전 행)은 목록에서 뺀다. 요소 행에는 missing 만 남는다(O13).
  const missingFactors = factorRows.flatMap((row) =>
    row.missing && row.missing_reason !== null
      ? [{ factor: row.factor, reason: row.missing_reason }]
      : [],
  );

  const assessments = scored
    ? rows.assessments.map((row) => {
        const kev = assessmentKevOf(row);
        return {
          itemId: row.item_id,
          itemKind: row.item_kind,
          ruleStatus: row.rule_status,
          ruleReason: row.rule_reason,
          basis: row.basis,
          noticeEvidence: evidenceListSchema.parse(row.notice_evidence),
          companyEvidence: companyEvidenceListSchema.parse(row.company_evidence),
          kev,
          flags: row.flags,
        };
      })
    : [];

  const evidence = collectEvidence([
    ...checks.map((check) => check.evidence),
    ...scoreBreakdown.map((factor) => factor.evidence),
    ...assessments.map((assessment) => assessment.noticeEvidence),
  ]);

  const view = {
    id: run.id,
    bidId: run.bid_id,
    revisionId: run.revision_id,
    revision: rows.revision,
    profileRevision: run.profile_revision,
    profileIsDemo: rows.profileIsDemo,
    runMode: run.run_mode.toLowerCase(),
    status: run.status,
    solScore: scored && run.score !== null ? Number(run.score) : null,
    recommendation: scored ? run.recommendation : null,
    recommendationBasis: scored ? run.recommendation_basis : null,
    // 저장된 설명은 DB 그대로 두고, ADR-062 전 템플릿의 옛 권고 표기만 화면 모델에서 바꾼다.
    explanation: run.explanation === null ? null : readableExplanation(run.explanation),
    // 점수 run 인데 check 행이 없으면 결측이다(C4 는 늘 1건 이상 만든다). 사람이 본다.
    qualification:
      scored && checks.length > 0
        ? { status: qualificationStatusOf(checks, run.injection_suspected), checks }
        : { status: "NEEDS_REVIEW", checks },
    requirementAssessments: assessments,
    scoreBreakdown,
    missingFactors,
    reviewFlags: run.review_flags,
    injectionSuspected: run.injection_suspected,
    kev: kevOf(run),
    fallbackReason: run.fallback_reason,
    evidence,
    model: modelOf(run),
    errorCode: run.error_code,
    queuedAt: run.queued_at,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    disclaimer: SOL_SCORE_DISCLAIMER,
  };
  return analysisViewSchema.parse(view);
}
