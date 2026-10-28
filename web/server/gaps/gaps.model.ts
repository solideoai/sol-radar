import "server-only";
import {
  QUALIFICATION_CODES,
  assessStructuredQualifications,
  assumeHeldLicenses,
  normalizedBidSummarySchema,
  resolveQualificationCode,
  type CompanyProfile,
  type NormalizedBidSummary,
  type QualificationCheck,
  type QualificationCode,
  type StructuredRequirement,
  type StructuredRequirementKind,
} from "@/server/scoring";

// 자격 갭 레이더(/gaps, 스펙 2026-10-28 §5). 새 판정 규칙을 만들지 않는다.
// 규칙 엔진의 구조화 필드 판정(assessStructuredQualifications)을 공고마다 돌려 네 묶음으로 나누고 집계만 한다.
// 첨부(제안요청서)의 자격 요건은 보지 않는다. "자격 미달"은 회사 프로필의 NOT_HELD 기록이 있을 때만 쓴다(§8-1).

export const GAP_BUCKETS = ["ELIGIBLE", "MISSING_RECORD", "NOT_HELD", "NEEDS_REVIEW"] as const;
export type GapBucket = (typeof GAP_BUCKETS)[number];

/** 사람 확인 필요 사유. 공고 하나가 여러 사유를 가질 수 있다. */
export const GAP_REVIEW_REASONS = [
  "LICENSE_MULTI_ROW",
  "LICENSE_OUT_OF_DICTIONARY",
  "LICENSE_RECORD_MISSING",
  "LICENSE_RECORD_EXPIRED",
  "INDUSTRY_UNVERIFIED",
  "REGION_UNVERIFIED",
  "AUX_LOOKUP_INCOMPLETE",
  "AUX_LOOKUP_ABSENT",
  "STAGE_NOT_APPLICABLE",
  "DATA_INVALID",
] as const;
export type GapReviewReason = (typeof GAP_REVIEW_REASONS)[number];

/** 관련성 기본 거르기(§5 A1). 수집 때 계산한 최신 revision 의 최신 판정 state 다. */
export const RELEVANT_STATES: readonly string[] = ["RELEVANT", "CANDIDATE"];
export type GapScope = "relevant" | "all";

/** 대상 공고 한 건. bid 는 최신 revision 의 규칙 엔진 입력이고, 모양이 틀린 공고는 null 이다(DATA_INVALID 로 센다). */
export type GapNotice = {
  bidId: string;
  title: string;
  agency: string | null;
  budgetKrw: string | null;
  deadlineAt: string | null;
  relevance: string | null;
  bid: NormalizedBidSummary | null;
};

/** API 업종 행(면허제한·허용 업종) 하나. key 는 API 업종 코드, 없으면 이름이다. */
export type IndustryKey = {
  key: string;
  name: string;
  apiCode: string | null;
  code: QualificationCode | null;
};

export type BlockerKind = "MISSING_RECORD" | "NOT_HELD" | "OUT_OF_DICTIONARY";

export type GapVerdict = {
  bucket: GapBucket;
  /** NEEDS_REVIEW 의 사유(중복 없음, GAP_REVIEW_REASONS 순서). 다른 묶음은 빈 배열 */
  reasons: GapReviewReason[];
  /** 이 공고를 막는 유일한 업종 행. MISSING_RECORD·NOT_HELD, 또는 사전 밖 면허제한 1행만 남은 NEEDS_REVIEW */
  blocker: { kind: BlockerKind; industry: IndustryKey } | null;
  /** 면허제한 행 전부(seq 순). 2행 이상이면 순위 표의 "조건 묶음 포함"에 센다 */
  licenseRows: IndustryKey[];
};

export type GapTotal = { count: number; budgetKrw: string };

export type GapSummary = { total: GapTotal; buckets: Record<GapBucket, GapTotal> };

/**
 * 순위 표 한 줄. 사전 코드(code)가 있으면 그 코드로 합친 줄이라 key=code, apiCode 는 합친 API 업종 코드("1468·1469"),
 * name 은 공고가 가장 많은 API 업종 이름이다. 사전 밖이면 key·apiCode·name 은 API 업종 하나의 값이다.
 */
export type BlockerRow = IndustryKey & {
  kind: BlockerKind;
  count: number;
  budgetKrw: string;
  /** 같은 업종이 들어 있는 면허제한 2행 이상 공고 가운데 사람 확인 필요인 공고 수 */
  bundledReviewCount: number;
};

export type OpenedNotice = Pick<
  GapNotice,
  "bidId" | "title" | "agency" | "deadlineAt" | "budgetKrw"
>;

export type GapRadar = {
  summary: GapSummary;
  blockers: BlockerRow[];
  reviewReasons: { reason: GapReviewReason; count: number }[];
};

export type GapAssumption = {
  /** 가정한 사전 코드와 사전 이름(사전 순서) */
  codes: { code: QualificationCode; name: string }[];
  summary: GapSummary;
  /** 지금은 참가 가능이 아니고 가정하면 참가 가능(API 기준)이 되는 공고. 예산 큰 순 */
  opened: OpenedNotice[];
};

// ── 화면 계약(/gaps). 화면은 아래 타입·상수·함수만 쓴다. 계산은 서버(getGapRadar)가 한다 ──

/** 주소 쿼리. `?scope=all` 이면 관련성 거르기를 끈다. `?assume=SW_BUSINESS_REG,ISMS_P` 는 보유 가정 코드다. */
export type GapQuery = { scope: GapScope; assume: QualificationCode[] };

export type GapRadarView =
  /** 이 조직에 회사 프로필 revision 이 없다(또는 RLS 로 읽지 못했다) */
  | { kind: "NO_PROFILE" }
  | {
      kind: "READY";
      profile: { revision: number; isDemo: boolean; name: string | null };
      /** 기준 시각: 읽은 live 공고의 최신 수집 시각(last_synced_at 최댓값). 공고가 없으면 null */
      asOf: string | null;
      /** 판정 기준 날짜(KST "YYYY-MM-DD") */
      today: string;
      query: GapQuery;
      /** 관련성 거르기 전·후 대상 공고 수(토글 옆 숫자) */
      scopeCounts: { relevant: number; all: number };
      /** 원래 프로필로 판정한 결과 */
      radar: GapRadar;
      /** query.assume 이 비었으면 null. 원래 결과는 radar.summary 와 비교한다 */
      assumption: GapAssumption | null;
    };

export const GAP_BUCKET_LABELS: Record<GapBucket, string> = {
  ELIGIBLE: "참가 가능(API 기준)",
  MISSING_RECORD: "회사 기록 없음",
  NOT_HELD: "미보유",
  NEEDS_REVIEW: "사람 확인 필요",
};

export const GAP_REVIEW_REASON_LABELS: Record<GapReviewReason, string> = {
  LICENSE_MULTI_ROW: "면허제한 여러 행(AND/OR 미확인)",
  LICENSE_OUT_OF_DICTIONARY: "면허제한 업종이 자격 코드 사전 밖",
  LICENSE_RECORD_MISSING: "면허 기록 없음(다른 조건도 확인 필요)",
  LICENSE_RECORD_EXPIRED: "회사 면허 유효기간 지남",
  INDUSTRY_UNVERIFIED: "허용 업종 확인 필요",
  REGION_UNVERIFIED: "참가가능지역·지역 공동도급 확인 필요",
  AUX_LOOKUP_INCOMPLETE: "면허·지역 보조 조회 미완료",
  AUX_LOOKUP_ABSENT: "면허·지역 보조 조회 결과 없음",
  STAGE_NOT_APPLICABLE: "공고 단계상 자격 미확정",
  DATA_INVALID: "공고 정규화 데이터 형식 오류",
};

export const GAP_BLOCKER_KIND_LABELS: Record<BlockerKind, string> = {
  MISSING_RECORD: "회사 기록 없음",
  NOT_HELD: "미보유",
  OUT_OF_DICTIONARY: "자격 코드 사전 밖",
};

/** 화면 상단 고정 문구(§5 A2). 늘 보인다. */
export const GAPS_SCOPE_NOTICE =
  "공고 API 의 구조화 필드(면허제한·참가가능지역)만으로 1차 선별했습니다. 첨부(제안요청서)의 자격 요건은 반영하지 않았습니다.";
export const GAPS_BUDGET_NOTICE =
  "예산 합계는 참가 자격이 열리는 공고의 배정 예산 합이며 수주 금액이나 확률이 아닙니다.";
/** 보유 가정 결과 옆 고정 문구(§5 A3-3, 공고 상세 가정 재계산과 같은 말) */
export const GAPS_ASSUMPTION_NOTICE = "가정 결과입니다. 저장되지 않고 결정 기록에 쓰이지 않습니다.";
/** 데이터 출처 표시(§4) */
export const GAPS_SOURCE_NOTICE =
  "나라장터 입찰공고 수집분 기준 · 낙찰·계약 데이터는 수집하지 않습니다 · 발주계획·사전규격 미포함";

/** searchParams → GapQuery. 모르는 값은 기본값(관련 공고만·가정 없음)으로 둔다. */
export function parseGapQuery(params: {
  scope?: string | string[];
  assume?: string | string[];
}): GapQuery {
  const scope = Array.isArray(params.scope) ? params.scope[0] : params.scope;
  return { scope: scope === "all" ? "all" : "relevant", assume: parseAssume(params.assume) };
}

/** GapQuery → `/gaps?…`. 기본값은 쿼리에 넣지 않는다. 스위치·토글이 이 함수로 다음 주소를 만든다. */
export function gapRadarHref(query: GapQuery): string {
  const params = new URLSearchParams();
  if (query.scope === "all") params.set("scope", "all");
  const assume = parseAssume(query.assume.join(","));
  if (assume.length > 0) params.set("assume", assume.join(","));
  const search = params.toString().replaceAll("%2C", ",");
  return search === "" ? "/gaps" : `/gaps?${search}`;
}

/** 스위치 하나를 켜고 끈 다음 쿼리. */
export function toggleAssume(query: GapQuery, code: QualificationCode, on: boolean): GapQuery {
  const rest = query.assume.filter((entry) => entry !== code);
  return { ...query, assume: parseAssume((on ? [...rest, code] : rest).join(",")) };
}

/** gaps.repo 가 읽는 bid_notices 한 행(최신 revision 고르기 전). 임베드 이름은 repo 의 select 와 같다. */
export type GapNoticeRow = {
  id: string;
  title: string;
  agency: string | null;
  stage: string;
  /** numeric 을 text 로 읽은 값(정밀도 보존). 정수가 아니면 예산 없음으로 둔다 */
  budget_krw: string | null;
  deadline_at: string | null;
  latest_revision: number;
  last_synced_at: string;
  revisions: {
    id: string;
    revision: number;
    fetched_at: string;
    aux: unknown;
    requirements: {
      kind: string;
      seq: number;
      code: string | null;
      name: string | null;
      value: unknown;
      source_operation: string;
    }[];
    relevance: { state: string; created_at: string; id: string }[];
  }[];
};

/**
 * 행 → 대상 공고. 최신 revision(latest_revision)의 구조화 요건·보조 조회 상태로 규칙 엔진 입력을 만든다
 * (분석 입력 조립 analysis-store.model 의 toBidSummary 와 같은 정렬·같은 auxLookup 처리). 관련성은 그 revision 의 최신 판정이다.
 * 입력 모양이 규칙 엔진 스키마에 맞지 않으면 bid=null 이다.
 */
export function toGapNotice(row: GapNoticeRow): GapNotice {
  const revision = row.revisions.find((entry) => entry.revision === row.latest_revision);
  const budgetKrw = row.budget_krw !== null && /^\d+$/.test(row.budget_krw) ? row.budget_krw : null;
  const relevance =
    revision?.relevance.toSorted(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id),
    )[0]?.state ?? null;
  const parsed =
    revision === undefined
      ? null
      : normalizedBidSummarySchema.safeParse({
          revisionId: revision.id,
          title: row.title,
          agency: row.agency,
          stage: row.stage,
          budgetKrw,
          deadlineAt: row.deadline_at,
          noticeDate: null,
          fetchedAt: revision.fetched_at,
          structuredQualifications: revision.requirements
            .toSorted(
              (left, right) =>
                (left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0) ||
                left.seq - right.seq,
            )
            .map((entry) => ({
              kind: entry.kind,
              seq: entry.seq,
              code: entry.code,
              name: entry.name,
              value: entry.value,
              sourceOperation: entry.source_operation,
            })),
          ...(revision.aux === null || revision.aux === undefined
            ? {}
            : { auxLookup: revision.aux }),
        });
  return {
    bidId: row.id,
    title: row.title,
    agency: row.agency,
    budgetKrw,
    deadlineAt: row.deadline_at,
    relevance,
    bid: parsed?.success ? parsed.data : null,
  };
}

/** 읽은 공고의 최신 수집 시각. 없으면 null. */
export function latestSyncedAt(rows: GapNoticeRow[]): string | null {
  return rows.reduce<string | null>(
    (latest, row) =>
      latest === null || Date.parse(row.last_synced_at) > Date.parse(latest)
        ? row.last_synced_at
        : latest,
    null,
  );
}

const CHECK_ID = /^structured:([A-Z_]+)\[(\d+)\]$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 시각 → KST 날짜 "YYYY-MM-DD"(규칙 엔진의 today). 프로세스 시간대를 읽지 않는다. */
export function toKstDate(at: Date): string {
  return new Date(at.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function rowsOf(
  bid: NormalizedBidSummary,
  kind: StructuredRequirementKind,
): StructuredRequirement[] {
  return bid.structuredQualifications
    .filter((row) => row.kind === kind)
    .toSorted((left, right) => left.seq - right.seq);
}

function industryKey(row: StructuredRequirement): IndustryKey {
  const apiCode = row.code?.trim() || null;
  const name = row.name?.trim() || apiCode || "이름 없는 업종";
  return {
    key: apiCode ?? name,
    name,
    apiCode,
    code: row.kind === "LICENSE_LIMIT" ? resolveQualificationCode(row.code, row.name) : null,
  };
}

// 판정 항목이 어느 구조화 행에서 나왔는지. 규칙 엔진의 id 는 `structured:<kind>[<같은 kind 안의 seq 순번>]` 이다.
function rowOfCheck(bid: NormalizedBidSummary, check: QualificationCheck) {
  const match = CHECK_ID.exec(check.id);
  if (!match) return null;
  const kind = match[1] as StructuredRequirementKind;
  const row = rowsOf(bid, kind)[Number(match[2])];
  return row === undefined ? null : { kind, row };
}

function reasonOf(
  bid: NormalizedBidSummary,
  check: QualificationCheck,
  licenseRowCount: number,
): GapReviewReason {
  if (check.id === "structured:AUX_LOOKUP") return "AUX_LOOKUP_INCOMPLETE";
  if (check.reasonCode === "STAGE_NOT_APPLICABLE") return "STAGE_NOT_APPLICABLE";
  const source = rowOfCheck(bid, check);
  if (source?.kind === "LICENSE_LIMIT") {
    if (licenseRowCount > 1) return "LICENSE_MULTI_ROW";
    if (check.reasonCode === "AMBIGUOUS_MATCH") return "LICENSE_OUT_OF_DICTIONARY";
    return check.companyEvidence.length > 0 ? "LICENSE_RECORD_EXPIRED" : "LICENSE_RECORD_MISSING";
  }
  if (source?.kind === "PERMITTED_INDUSTRY") return "INDUSTRY_UNVERIFIED";
  return "REGION_UNVERIFIED";
}

function sortedReasons(reasons: GapReviewReason[]): GapReviewReason[] {
  return GAP_REVIEW_REASONS.filter((reason) => reasons.includes(reason));
}

/** 공고 한 건의 판정 묶음(§5 A2 표). 같은 공고를 공고 상세에서 분석한 구조화 필드 판정과 같은 결과를 묶는다. */
export function classifyNotice(
  notice: GapNotice,
  profile: CompanyProfile,
  today: string,
): GapVerdict {
  const { bid } = notice;
  if (bid === null)
    return { bucket: "NEEDS_REVIEW", reasons: ["DATA_INVALID"], blocker: null, licenseRows: [] };

  const licenseRows = rowsOf(bid, "LICENSE_LIMIT").map(industryKey);
  const checks = assessStructuredQualifications({ bid, profile, today });
  const open = checks.filter((check) => check.outcome !== "SATISFIED");
  const blockerOf = (kind: BlockerKind, check: QualificationCheck) => {
    const source = rowOfCheck(bid, check);
    return source === null ? null : { kind, industry: industryKey(source.row) };
  };

  // 보조 조회(면허제한·참가가능지역)를 다 받지 못했으면 행이 없어도 "제한 없음"이 아니다(07 §2.2).
  const auxOk = bid.auxLookup?.status === "OK";
  // 막는 행으로 셀 수 있는 것은 남은 장애가 그 행 하나뿐일 때다. 그래야 순위 표 건수 = 가정으로 열리는 건수다.
  const soleBlocker = auxOk && open.length === 1;

  // 회사가 NOT_HELD 로 적은 자격이 하나라도 걸리면 다른 항목과 상관없이 미보유다(규칙 엔진 overallStatus 와 같은 우선순위).
  const notHeld = open.find((check) => check.outcome === "NOT_SATISFIED");
  if (notHeld !== undefined)
    return {
      bucket: "NOT_HELD",
      reasons: [],
      blocker: soleBlocker ? blockerOf("NOT_HELD", notHeld) : null,
      licenseRows,
    };

  if (open.length === 0 && auxOk)
    return { bucket: "ELIGIBLE", reasons: [], blocker: null, licenseRows };

  const [only] = open;
  const onlyLicense =
    soleBlocker && licenseRows.length === 1 && rowOfCheck(bid, only)?.kind === "LICENSE_LIMIT";
  // 사전 밖 면허는 규칙 엔진이 AMBIGUOUS_MATCH 로 두므로, 기록 없음(COMPANY_EVIDENCE_MISSING·회사 근거 0건)이면 사전 코드다.
  if (
    onlyLicense &&
    only.reasonCode === "COMPANY_EVIDENCE_MISSING" &&
    only.companyEvidence.length === 0
  )
    return {
      bucket: "MISSING_RECORD",
      reasons: [],
      blocker: blockerOf("MISSING_RECORD", only),
      licenseRows,
    };

  const reasons = open.map((check) => reasonOf(bid, check, licenseRows.length));
  if (bid.auxLookup === undefined) reasons.push("AUX_LOOKUP_ABSENT");
  const outOfDictionary = onlyLicense && only.reasonCode === "AMBIGUOUS_MATCH";
  return {
    bucket: "NEEDS_REVIEW",
    reasons: sortedReasons(reasons),
    blocker: outOfDictionary ? blockerOf("OUT_OF_DICTIONARY", only) : null,
    licenseRows,
  };
}

const ZERO = BigInt(0);

function budgetOf(notice: GapNotice): bigint {
  return notice.budgetKrw !== null && /^\d+$/.test(notice.budgetKrw)
    ? BigInt(notice.budgetKrw)
    : ZERO;
}

/** 큰 값이 앞으로 오는 bigint 비교. */
function descending(left: bigint, right: bigint): number {
  return left === right ? 0 : left > right ? -1 : 1;
}

function total(notices: GapNotice[]): GapTotal {
  return {
    count: notices.length,
    budgetKrw: notices.reduce((sum, notice) => sum + budgetOf(notice), ZERO).toString(),
  };
}

type Judged = { notice: GapNotice; verdict: GapVerdict };

function summarize(judged: Judged[]): GapSummary {
  const inBucket = (bucket: GapBucket) =>
    judged.filter((entry) => entry.verdict.bucket === bucket).map((entry) => entry.notice);
  return {
    total: total(judged.map((entry) => entry.notice)),
    buckets: {
      ELIGIBLE: total(inBucket("ELIGIBLE")),
      MISSING_RECORD: total(inBucket("MISSING_RECORD")),
      NOT_HELD: total(inBucket("NOT_HELD")),
      NEEDS_REVIEW: total(inBucket("NEEDS_REVIEW")),
    },
  };
}

const BLOCKER_ORDER: Record<BlockerKind, number> = {
  NOT_HELD: 0,
  MISSING_RECORD: 1,
  OUT_OF_DICTIONARY: 2,
};

// 막는 자격 순위(§5 A3-2). 사전 코드로 풀리는 행은 (종류, 사전 코드)로 합친다 — 보유 가정 스위치 하나가 한 줄이다.
// 사전 밖 행은 API 업종 코드(없으면 이름)로 묶는다. 건수 → 예산 → 종류 → 키 순. 같은 업종이 든 2행 이상 공고 수를 따로 센다.
function rankBlockers(judged: Judged[]): BlockerRow[] {
  type Group = {
    kind: BlockerKind;
    code: QualificationCode | null;
    key: string;
    entries: { industry: IndustryKey; notice: GapNotice }[];
  };
  const groups = new Map<string, Group>();
  for (const { notice, verdict } of judged) {
    if (verdict.blocker === null) continue;
    const { kind, industry } = verdict.blocker;
    const key = industry.code ?? industry.key;
    const group = groups.get(`${kind}|${key}`) ?? { kind, code: industry.code, key, entries: [] };
    group.entries.push({ industry, notice });
    groups.set(`${kind}|${key}`, group);
  }
  const bundled = (group: Group) =>
    judged.filter(
      ({ verdict }) =>
        verdict.bucket === "NEEDS_REVIEW" &&
        verdict.licenseRows.length > 1 &&
        verdict.licenseRows.some((row) =>
          group.code === null ? row.key === group.key : row.code === group.code,
        ),
    ).length;
  // 대표 이름은 공고가 가장 많은 API 업종(같으면 키 순)이다. API 코드는 그 순서로 이어 붙인다(예: "1468·1469").
  const apiIndustries = (group: Group) => {
    const counts = new Map<string, { industry: IndustryKey; count: number }>();
    for (const { industry } of group.entries) {
      const entry = counts.get(industry.key) ?? { industry, count: 0 };
      entry.count += 1;
      counts.set(industry.key, entry);
    }
    return [...counts.values()]
      .toSorted(
        (left, right) =>
          right.count - left.count || left.industry.key.localeCompare(right.industry.key),
      )
      .map((entry) => entry.industry);
  };
  return [...groups.values()]
    .map((group) => {
      const industries = apiIndustries(group);
      const apiCodes = industries.flatMap((industry) =>
        industry.apiCode === null ? [] : [industry.apiCode],
      );
      return {
        key: group.key,
        name: industries[0].name,
        apiCode: apiCodes.length === 0 ? null : apiCodes.join("·"),
        code: group.code,
        kind: group.kind,
        ...total(group.entries.map((entry) => entry.notice)),
        bundledReviewCount: bundled(group),
      };
    })
    .toSorted(
      (left, right) =>
        right.count - left.count ||
        descending(BigInt(left.budgetKrw), BigInt(right.budgetKrw)) ||
        BLOCKER_ORDER[left.kind] - BLOCKER_ORDER[right.kind] ||
        left.key.localeCompare(right.key),
    );
}

function countReasons(judged: Judged[]): GapRadar["reviewReasons"] {
  return GAP_REVIEW_REASONS.map((reason) => ({
    reason,
    count: judged.filter((entry) => entry.verdict.reasons.includes(reason)).length,
  })).filter((entry) => entry.count > 0);
}

function judge(notices: GapNotice[], profile: CompanyProfile, today: string): Judged[] {
  return notices.map((notice) => ({ notice, verdict: classifyNotice(notice, profile, today) }));
}

/** 관련성 거르기(§5 A1). all 이면 그대로. */
export function inScope(notices: GapNotice[], scope: GapScope): GapNotice[] {
  return scope === "all"
    ? notices
    : notices.filter(
        (notice) => notice.relevance !== null && RELEVANT_STATES.includes(notice.relevance),
      );
}

/** 주소 쿼리 `assume=SW_BUSINESS_REG,ISMS_P` → 사전 코드만, 중복 없이, 사전 순서로. 사전 밖 값은 버린다. */
export function parseAssume(raw: string | string[] | undefined): QualificationCode[] {
  const values = (Array.isArray(raw) ? raw : [raw ?? ""]).flatMap((value) => value.split(","));
  const wanted = new Set(values.map((value) => value.trim()));
  return (Object.keys(QUALIFICATION_CODES) as QualificationCode[]).filter((code) =>
    wanted.has(code),
  );
}

export function buildGapRadar(
  notices: GapNotice[],
  profile: CompanyProfile,
  today: string,
): GapRadar {
  const judged = judge(notices, profile, today);
  return {
    summary: summarize(judged),
    blockers: rankBlockers(judged),
    reviewReasons: countReasons(judged),
  };
}

/** 보유 가정 재계산(§5 A3-3). 프로필 사본에 가정 코드를 HELD 로 넣고 같은 판정을 다시 한다. 저장하지 않는다. */
export function assumeGapRadar(
  notices: GapNotice[],
  profile: CompanyProfile,
  today: string,
  codes: QualificationCode[],
): GapAssumption {
  const before = judge(notices, profile, today);
  const after = judge(notices, assumeHeldLicenses(profile, codes), today);
  const opened = after
    .filter(
      (entry, index) =>
        entry.verdict.bucket === "ELIGIBLE" && before[index].verdict.bucket !== "ELIGIBLE",
    )
    .map(({ notice }) => notice)
    .toSorted(
      (left, right) =>
        descending(budgetOf(left), budgetOf(right)) || left.bidId.localeCompare(right.bidId),
    )
    .map(({ bidId, title, agency, deadlineAt, budgetKrw }) => ({
      bidId,
      title,
      agency,
      deadlineAt,
      budgetKrw,
    }));
  return {
    codes: codes.map((code) => ({ code, name: QUALIFICATION_CODES[code].name })),
    summary: summarize(after),
    opened,
  };
}
