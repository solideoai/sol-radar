import "server-only";
import type {
  CompanyEvidenceRef,
  CompanyProfile,
  EvidenceRef,
  ExtractedField,
  NormalizedBidSummary,
  QualificationRequirement,
  RequirementExtraction,
  StructuredRequirement,
  StructuredRequirementKind,
} from "./analysis-input.model";
import type {
  NeedsReviewReason,
  ProfileEvidence,
  QualificationCheck,
  QualificationOutcome,
  RequirementBasis,
} from "./analysis-result.model";
import {
  QUALIFICATION_CODES,
  resolveQualificationCode,
  type QualificationCode,
} from "./qualification-codes";

// 필수 자격 판정(08 §5.1, ADR-020). 법적 자격을 자동으로 확정하지 않는다.
// - NOT_SATISFIED 는 공고 근거(EvidenceRef) ≥1 과 회사 쪽 명시적 부정 근거(CompanyEvidenceRef) ≥1 이 둘 다 있을 때만.
// - 정보 부족은 언제나 NEEDS_REVIEW + 사유 코드.
// - 같은 조건을 API 구조화 필드와 추출이 둘 다 주면 API 가 우선(basis=API_FIELD), 다르면 NEEDS_REVIEW(NOTICE_CONFLICTED).
// - 발주계획(stage=PLAN)은 04 §3.4 의 선택지 가운데 "NEEDS_REVIEW + STAGE_NOT_APPLICABLE 로 저장"을 고른다:
//   qualification_outcome 값 집합(3값)을 늘리지 않아도 되고, 결정 경로에서 NEEDS_REVIEW 와 같게 다루는 규칙이 그대로 코드가 된다.

export type QualificationAssessment = {
  status: QualificationOutcome;
  checks: QualificationCheck[];
};

export type QualificationContext = {
  bid: NormalizedBidSummary;
  extraction: RequirementExtraction | null;
  profile: CompanyProfile;
  today: string; // YYYY-MM-DD
};

type CheckBase = Pick<
  QualificationCheck,
  "id" | "requirementCode" | "requirementName" | "mandatory" | "basis" | "evidence"
>;
type Verdict = Pick<
  QualificationCheck,
  "outcome" | "reason" | "reasonCode" | "profileEvidence" | "companyEvidence"
>;

const API_FIELD_BY_KIND: Record<
  StructuredRequirementKind,
  { apiField: string; apiSource: string; label: string }
> = {
  LICENSE_LIMIT: { apiField: "lcnsLmtNm", apiSource: "g2b-bid-license-limit", label: "면허제한" },
  PERMITTED_INDUSTRY: {
    apiField: "permsnIndstrytyList",
    apiSource: "g2b-bid-notice",
    label: "허용 업종",
  },
  PARTICIPATION_REGION: {
    apiField: "prtcptPsblRgnNm",
    apiSource: "g2b-bid-region",
    label: "참가가능지역",
  },
  REGIONAL_JOINT_CONTRACT: {
    apiField: "rgnDutyJntcontrctRt",
    apiSource: "g2b-bid-region",
    label: "지역의무공동도급",
  },
};

const PARSE_FAILURE_WARNING =
  /^(ATTACHMENT_PARSE_FAILED|PARSE_UNSUPPORTED|DOCUMENT_DOWNLOAD_FAILED)/;

/** 첨부를 읽지 못한 공고인지(03 §4.4 warnings 또는 호출자가 준 attachmentsIncomplete). */
export function hasParseFailure(
  bid: NormalizedBidSummary,
  extraction: RequirementExtraction | null,
): boolean {
  return (
    bid.attachmentsIncomplete === true ||
    (extraction?.warnings.some((warning) => PARSE_FAILURE_WARNING.test(warning)) ?? false)
  );
}

function needsReview(
  reasonCode: NeedsReviewReason,
  reason: string,
  partial?: Partial<Verdict>,
): Verdict {
  return {
    outcome: "NEEDS_REVIEW",
    reasonCode,
    reason,
    profileEvidence: partial?.profileEvidence ?? [],
    companyEvidence: partial?.companyEvidence ?? [],
  };
}

function finish(base: CheckBase, verdict: Verdict): QualificationCheck {
  const check = { ...base, ...verdict };
  // 04 §3.4·15 §2 의 불변식. 어기면 코드 결함이므로 조용히 넘기지 않는다.
  if (check.outcome === "NEEDS_REVIEW" && check.reasonCode === null)
    throw new Error(`NEEDS_REVIEW requires reasonCode: ${check.id}`);
  if (check.outcome !== "NEEDS_REVIEW" && check.reasonCode !== null)
    throw new Error(`reasonCode only for NEEDS_REVIEW: ${check.id}`);
  if (
    check.outcome === "NOT_SATISFIED" &&
    (check.evidence.length === 0 || check.companyEvidence.length === 0)
  )
    throw new Error(`NOT_SATISFIED requires evidence on both sides: ${check.id}`);
  return check;
}

// 회사 면허·인증 기록으로 코드 하나를 판정한다. 기록이 없으면 "모름"(NEEDS_REVIEW), NOT_HELD 만 명시적 부정이다.
function judgeLicense(code: QualificationCode, profile: CompanyProfile, today: string): Verdict {
  const dictionaryName = QUALIFICATION_CODES[code].name;
  const index = profile.licenses.findIndex((license) => license.code === code);
  if (index < 0)
    return needsReview(
      "COMPANY_EVIDENCE_MISSING",
      `회사 프로필에 ${dictionaryName}(${code}) 기록이 없음. 보유·미보유를 확인하지 못함`,
    );
  const license = profile.licenses[index];
  const companyEvidence: CompanyEvidenceRef[] = [
    {
      profileRevision: profile.revision,
      kind: "LICENSE",
      recordKey: `licenses[${index}]`,
      documentId: null,
      quotedText: `${license.name} (${license.status})`,
    },
  ];
  const profileEvidence: ProfileEvidence[] = [
    { type: "LICENSE", ref: license.code, label: license.name },
  ];
  if (license.status === "NOT_HELD")
    return {
      outcome: "NOT_SATISFIED",
      reasonCode: null,
      reason: `회사 프로필에 ${license.name} 미보유(NOT_HELD)로 기록됨`,
      profileEvidence,
      companyEvidence,
    };
  if (license.validUntil !== undefined && license.validUntil < today)
    return needsReview(
      "COMPANY_EVIDENCE_MISSING",
      `회사 프로필의 ${license.name} 유효기간(${license.validUntil})이 지남. 갱신 여부 확인 필요`,
      { profileEvidence, companyEvidence },
    );
  return {
    outcome: "SATISFIED",
    reasonCode: null,
    reason: `회사 프로필 등록 ${license.code} 보유(HELD)`,
    profileEvidence,
    companyEvidence,
  };
}

function judgeIndustryCode(code: string, profile: CompanyProfile): Verdict {
  const index = profile.industryCodes.findIndex((entry) => entry.code === code);
  if (index < 0)
    return needsReview(
      "COMPANY_EVIDENCE_MISSING",
      `회사 프로필에 업종 코드 ${code} 기록이 없음. 보유·미보유를 확인하지 못함`,
    );
  const industry = profile.industryCodes[index];
  const companyEvidence: CompanyEvidenceRef[] = [
    {
      profileRevision: profile.revision,
      kind: "INDUSTRY_CODE",
      recordKey: `industryCodes[${index}]`,
      documentId: null,
      quotedText: `${industry.name} (${industry.status})`,
    },
  ];
  const profileEvidence: ProfileEvidence[] = [
    { type: "INDUSTRY_CODE", ref: industry.code, label: industry.name },
  ];
  if (industry.status === "NOT_HELD")
    return {
      outcome: "NOT_SATISFIED",
      reasonCode: null,
      reason: `회사 프로필에 업종 ${industry.name} 미보유(NOT_HELD)로 기록됨`,
      profileEvidence,
      companyEvidence,
    };
  return {
    outcome: "SATISFIED",
    reasonCode: null,
    reason: `회사 프로필 업종 ${industry.code} 보유(HELD)`,
    profileEvidence,
    companyEvidence,
  };
}

function apiEvidence(row: StructuredRequirement, bid: NormalizedBidSummary): EvidenceRef {
  const spec = API_FIELD_BY_KIND[row.kind];
  const quoted = row.name ?? row.code ?? JSON.stringify(row.value);
  return {
    kind: "API_FIELD",
    documentId: null,
    revisionId: bid.revisionId,
    page: null,
    charStart: null,
    charEnd: null,
    apiField: spec.apiField,
    apiSource: spec.apiSource,
    quotedText: quoted.slice(0, 300) || spec.label,
    fetchedAt: bid.fetchedAt,
  };
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

// 배열 필드의 원소별 근거(03 §4.1 "원소마다 근거가 필요하다. 짝이 안 맞는 원소는 버린다").
// note 에 "[i]→evidence[j]" 짝이 있으면 그 짝만 쓴다(없는 원소는 근거 0건). note 가 없으면 이름이 들어간 인용 → 같은 길이면 같은 index → 없음.
// 다른 원소의 인용을 빌려 오지 않는다 — 그래야 근거 없는 항목이 NOT_SATISFIED 가 될 수 없다.
function evidenceForItem(
  field: ExtractedField<QualificationRequirement[]>,
  index: number,
  name: string,
): EvidenceRef[] {
  const pairs = [...(field.note ?? "").matchAll(/((?:\[\d+\],?)+)→evidence\[(\d+)\]/g)];
  if (pairs.length > 0)
    return pairs
      .filter((match) => match[1].match(/\d+/g)?.map(Number).includes(index))
      .map((match) => field.evidence[Number(match[2])])
      .filter((entry): entry is EvidenceRef => entry !== undefined);
  const target = normalizeText(name);
  const byName = field.evidence.filter((entry) => normalizeText(entry.quotedText).includes(target));
  if (byName.length > 0) return byName;
  if (field.value !== null && field.evidence.length === field.value.length)
    return [field.evidence[index]];
  return [];
}

function noticeMissingVerdict(
  context: QualificationContext,
  state: "ABSENT" | ExtractedField<unknown>["state"],
): Verdict {
  const parseFailed = hasParseFailure(context.bid, context.extraction);
  if (state === "CONFLICTED")
    return needsReview("NOTICE_CONFLICTED", "공고 안의 자격 요건 값이 상충함. 원문 확인 필요");
  if (state === "NOT_APPLICABLE")
    return needsReview("STAGE_NOT_APPLICABLE", "이 공고 유형에는 자격 요건 항목이 없음");
  if (parseFailed)
    return needsReview(
      "PARSE_UNSUPPORTED",
      "첨부를 읽지 못해 자격 요건을 확인하지 못함. 원문 확인 필요",
    );
  return needsReview(
    "NOTICE_INFO_MISSING",
    state === "ABSENT"
      ? "추출 결과가 없어 자격 요건을 확인하지 못함"
      : "공고에서 자격 요건을 꺼내지 못함(UNKNOWN). 원문 확인 필요",
  );
}

function syntheticCheck(context: QualificationContext, verdict: Verdict): QualificationCheck {
  const field = context.extraction?.qualifications;
  return finish(
    {
      id: "qualifications",
      requirementCode: null,
      requirementName: "참가 자격 요건",
      mandatory: true,
      basis: "EXTRACTION",
      evidence: field?.state === "CONFLICTED" ? field.evidence : [],
    },
    verdict,
  );
}

type ResolvedItem = {
  index: number;
  item: QualificationRequirement;
  code: QualificationCode | null;
  evidence: EvidenceRef[];
};

function isLicenseKind(item: QualificationRequirement): boolean {
  return item.kind === "LICENSE" || item.kind === "REGISTRATION";
}

function resolveExtractionItems(context: QualificationContext): ResolvedItem[] {
  const field = context.extraction?.qualifications;
  if (!field || field.state !== "KNOWN" || field.value === null) return [];
  return field.value.map((item, index) => ({
    index,
    item,
    code: resolveQualificationCode(item.code, item.name),
    evidence: evidenceForItem(field, index, item.name),
  }));
}

function structuredChecks(
  context: QualificationContext,
  items: ResolvedItem[],
): { checks: QualificationCheck[]; mergedCodes: Set<QualificationCode>; conflictedCodes: boolean } {
  const { bid, profile } = context;
  const checks: QualificationCheck[] = [];
  const mergedCodes = new Set<QualificationCode>();
  let conflictedCodes = false;
  const byKind = (kind: StructuredRequirementKind) =>
    bid.structuredQualifications
      .filter((row) => row.kind === kind)
      .toSorted((left, right) => left.seq - right.seq);
  const base = (row: StructuredRequirement, position: number, code: string | null): CheckBase => ({
    id: `structured:${row.kind}[${position}]`,
    requirementCode: code,
    requirementName: row.name ?? row.code ?? API_FIELD_BY_KIND[row.kind].label,
    mandatory: true,
    basis: "API_FIELD" as RequirementBasis,
    evidence: [apiEvidence(row, bid)],
  });

  const licenseRows = byKind("LICENSE_LIMIT");
  if (licenseRows.length > 1) {
    // 면허제한 여러 행의 AND/OR 는 실제 응답으로 확인 전(15 §3 미검증 가정). 확인 전에는 사람이 본다.
    licenseRows.forEach((row, position) =>
      checks.push(
        finish(
          base(row, position, resolveQualificationCode(row.code, row.name)),
          needsReview(
            "AMBIGUOUS_MATCH",
            `면허제한이 ${licenseRows.length}행이라 AND/OR 를 확인하지 못함. 사람 검토 필요`,
          ),
        ),
      ),
    );
  } else if (licenseRows.length === 1) {
    const row = licenseRows[0];
    const code = resolveQualificationCode(row.code, row.name);
    if (code === null) {
      checks.push(
        finish(
          base(row, 0, null),
          needsReview("AMBIGUOUS_MATCH", "면허제한 값이 자격 코드 사전에 없음. 사람 검토 필요"),
        ),
      );
    } else {
      const extracted = items.filter((entry) => isLicenseKind(entry.item) && entry.code !== null);
      const same = extracted.filter((entry) => entry.code === code);
      if (same.length > 0) mergedCodes.add(code);
      const evidence = [...base(row, 0, code).evidence, ...same.flatMap((entry) => entry.evidence)];
      if (extracted.length > 0 && same.length === 0) {
        conflictedCodes = true;
        const names = extracted.map((entry) => entry.item.name).join(", ");
        checks.push(
          finish(
            { ...base(row, 0, code), evidence },
            needsReview(
              "NOTICE_CONFLICTED",
              `API 면허제한(${row.name ?? code})과 추출된 자격(${names})이 다름. 원문 확인 필요`,
            ),
          ),
        );
      } else {
        checks.push(
          finish({ ...base(row, 0, code), evidence }, judgeLicense(code, profile, context.today)),
        );
      }
    }
  }

  const industryRows = byKind("PERMITTED_INDUSTRY");
  industryRows.forEach((row, position) => {
    if (industryRows.length > 1)
      checks.push(
        finish(
          base(row, position, row.code),
          needsReview(
            "AMBIGUOUS_MATCH",
            `허용 업종이 ${industryRows.length}행이라 AND/OR 를 확인하지 못함. 사람 검토 필요`,
          ),
        ),
      );
    else if (row.code === null)
      checks.push(
        finish(
          base(row, position, null),
          needsReview("AMBIGUOUS_MATCH", "허용 업종에 업종 코드가 없음. 사람 검토 필요"),
        ),
      );
    else checks.push(finish(base(row, position, row.code), judgeIndustryCode(row.code, profile)));
  });

  (["PARTICIPATION_REGION", "REGIONAL_JOINT_CONTRACT"] as const).forEach((kind) =>
    byKind(kind).forEach((row, position) =>
      checks.push(
        finish(
          base(row, position, row.code),
          needsReview(
            "COMPANY_EVIDENCE_MISSING",
            `${API_FIELD_BY_KIND[kind].label} 조건은 회사 프로필에 소재지 기록이 없어 판정하지 못함(v0.1)`,
          ),
        ),
      ),
    ),
  );

  return { checks, mergedCodes, conflictedCodes };
}

function extractionChecks(
  context: QualificationContext,
  items: ResolvedItem[],
  mergedCodes: Set<QualificationCode>,
  conflictedCodes: boolean,
): QualificationCheck[] {
  return items
    .filter((entry) => entry.code === null || !mergedCodes.has(entry.code))
    .map((entry) => {
      const base: CheckBase = {
        id: `qualifications[${entry.index}]`,
        requirementCode: entry.code,
        requirementName: entry.item.name,
        mandatory: entry.item.mandatory,
        basis: "EXTRACTION",
        evidence: entry.evidence,
      };
      if (entry.code === null)
        return finish(
          base,
          needsReview(
            "AMBIGUOUS_MATCH",
            `"${entry.item.name}"은(는) 자격 코드 사전에 없어 의미 대응을 확정하지 못함. 사람 검토 필요`,
          ),
        );
      if (conflictedCodes && isLicenseKind(entry.item))
        return finish(
          base,
          needsReview("NOTICE_CONFLICTED", "API 면허제한과 추출된 자격이 달라 원문 확인이 필요함"),
        );
      if (entry.evidence.length === 0)
        return finish(
          base,
          needsReview("NOTICE_INFO_MISSING", "이 자격 항목을 뒷받침하는 공고 인용이 없음"),
        );
      return finish(base, judgeLicense(entry.code, context.profile, context.today));
    });
}

/**
 * 07 §2.2: 보조 조회(면허제한·참가가능지역)를 받지 못한 공고는 구조화 자격이 비어 있어도 "제한 없음"이 아니다.
 * 확인 필요(NEEDS_REVIEW, NOTICE_INFO_MISSING) 한 건을 둔다. API 필드 근거는 없다(받지 못했으니). 필드가 없으면 만들지 않는다.
 */
function auxLookupChecks(bid: NormalizedBidSummary): QualificationCheck[] {
  const lookup = bid.auxLookup;
  if (lookup === undefined || lookup.status === "OK") return [];
  const isQuota = lookup.status === "SKIPPED_QUOTA";
  const missing = lookup.failed.join(", ");
  return [
    finish(
      {
        id: "structured:AUX_LOOKUP",
        requirementCode: null,
        requirementName: isQuota
          ? "면허·지역 제한 조회 실패(호출 예산)"
          : "면허·지역 제한 조회 실패",
        mandatory: true,
        basis: "API_FIELD",
        evidence: [],
      },
      needsReview(
        "NOTICE_INFO_MISSING",
        isQuota
          ? `공공 API 호출 예산으로 보조 조회(${missing})를 부르지 못함. 면허·지역 제한을 확인하지 못해 사람 검토 필요`
          : `보조 조회(${missing})가 실패해 면허·지역 제한을 확인하지 못함. 사람 검토 필요`,
      ),
    ),
  ];
}

function overallStatus(checks: QualificationCheck[]): QualificationOutcome {
  const mandatory = checks.filter((check) => check.mandatory);
  if (mandatory.some((check) => check.outcome === "NOT_SATISFIED")) return "NOT_SATISFIED";
  if (mandatory.some((check) => check.outcome === "NEEDS_REVIEW")) return "NEEDS_REVIEW";
  return "SATISFIED";
}

/** 필수 자격 판정. 결과의 status 는 mandatory 항목만 본다(08 §5.1 "결정 정책의 필수자격"). */
export function assessQualifications(context: QualificationContext): QualificationAssessment {
  const { bid, extraction } = context;
  const items = resolveExtractionItems(context);
  const structured = structuredChecks(context, items);
  const field = extraction?.qualifications;
  const fromExtraction =
    field !== undefined && field.state === "KNOWN" && field.value !== null && field.value.length > 0
      ? extractionChecks(context, items, structured.mergedCodes, structured.conflictedCodes)
      : [syntheticCheck(context, noticeMissingVerdict(context, field?.state ?? "ABSENT"))];
  const computed = [...structured.checks, ...auxLookupChecks(bid), ...fromExtraction];

  // 발주계획은 자격 요건이 아직 없다. 항목은 보여 주되 전부 확인 필요로 저장한다(위 머리말 결정).
  const checks =
    bid.stage === "PLAN"
      ? computed.map((check) =>
          finish(
            check,
            needsReview(
              "STAGE_NOT_APPLICABLE",
              "발주계획 단계라 자격 요건이 아직 확정되지 않음. 사전규격·입찰공고에서 다시 판정",
              check,
            ),
          ),
        )
      : computed;

  // 03 §4.4: 추출 입력·출력에서 지시문 패턴이 보이면 자격 종합은 사람이 본다.
  const status = extraction?.injectionSuspected ? "NEEDS_REVIEW" : overallStatus(checks);
  return { status, checks };
}
