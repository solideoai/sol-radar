import "server-only";
import { getSupabase } from "@/server/supabase";
import { toAnalysisViewFromRows } from "./analysis-row.mapper";
import type {
  QualificationCheckRow,
  RequirementAssessmentRow,
  ScoreFactorRow,
  ScoreRunRow,
} from "./analysis-row.mapper";
import type { AnalysisView } from "./analysis-view.model";
import type { BidListQuery, BidSort } from "./bid-query";
import { toBidDetail, toBidListItem } from "./bid-row.mapper";
import type { BidDetailParts, BidListItemRow } from "./bid-row.mapper";
import {
  analysisStatusSchema,
  bidDocumentSchema,
  bidStageSchema,
  structuredRequirementSchema,
  type AnalysisStatus,
  type BidDocument,
  type BidRevisionSummary,
  type RunMode,
  type StructuredRequirement,
} from "./bid.model";
import type { AnalysisInput, BidsRepo, CreateRunResult, ListAfter, RunRef } from "./bids.repo";
import { keysetFilter, likePattern, pageOf, quoteValue, uniqueViolation } from "./postgrest";
import { bidExistsIn, readReviews } from "./review.supabase";

// 공고·분석 저장소. 사용자 세션(anon 키) + RLS 로만 읽고 쓴다. service role 은 쓰지 않는다.
// 공고는 모든 조직이 함께 보고, 분석은 조직 것이라 org_id 로 좁힌다.

type Db = Awaited<ReturnType<typeof getSupabase>>;

// ── 공고 목록(뷰 bid_list_items) ──

type SortSpec = {
  column: "published_at" | "deadline_at" | "scored_score" | "budget_krw";
  direction: "asc" | "desc";
  // 커서에 넣는 정렬 값. 금액은 bigint 라 정밀도를 잃지 않게 문자열 열을 쓴다.
  valueOf: (row: BidListItemRow) => string | number | null;
};

const SORTS: Record<BidSort, SortSpec> = {
  "publishedAt:desc": { column: "published_at", direction: "desc", valueOf: (r) => r.published_at },
  "publishedAt:asc": { column: "published_at", direction: "asc", valueOf: (r) => r.published_at },
  "deadlineAt:asc": { column: "deadline_at", direction: "asc", valueOf: (r) => r.deadline_at },
  "deadlineAt:desc": { column: "deadline_at", direction: "desc", valueOf: (r) => r.deadline_at },
  "score:desc": { column: "scored_score", direction: "desc", valueOf: (r) => r.scored_score },
  "budgetKrw:desc": { column: "budget_krw", direction: "desc", valueOf: (r) => r.budget_krw_text },
};

// 검색어는 제목·기관·공고번호 중 하나에 글자 그대로 들어 있으면 된다. 값은 감싸서 예약 문자가 조건을 늘리지 못한다.
function searchFilter(q: string): string {
  const pattern = quoteValue(likePattern(q));
  return `title.ilike.${pattern},agency.ilike.${pattern},notice_id.ilike.${pattern}`;
}

// 결정 필터. NONE 은 "이 조직의 결정이 없음" 이라 latest_decision is null 과 or 로 묶는다.
function decisionFilter(decisions: BidListQuery["decision"]): string {
  const picked = decisions.filter((d) => d !== "NONE");
  const parts = [
    ...(picked.length > 0 ? [`latest_decision.in.(${picked.map(quoteValue).join(",")})`] : []),
    ...(decisions.includes("NONE") ? ["latest_decision.is.null"] : []),
  ];
  return parts.join(",");
}

// 목록 조건(커서·정렬·페이지 크기 제외). 목록과 건수(countBids)가 같은 길을 써서 정의가 갈라지지 않는다(M4).
// countOnly 를 주면 행 없이 건수만 읽는다(head + count exact).
function filteredBids(db: Db, query: BidListQuery, countOnly?: { count: "exact"; head: true }) {
  const source = query.watched === "me" ? "watched_bid_list_items" : "bid_list_items";
  const base = db.from(source).select("*", countOnly).in("status", query.status);
  const byOrigin = query.origin === "all" ? base : base.eq("is_demo", query.origin === "demo");
  const byStage = query.stage.length === 0 ? byOrigin : byOrigin.in("stage", query.stage);
  const byText = query.q === null ? byStage : byStage.or(searchFilter(query.q));
  const byFrom =
    query.deadlineFrom === null ? byText : byText.gte("deadline_at", query.deadlineFrom);
  const byTo = query.deadlineTo === null ? byFrom : byFrom.lte("deadline_at", query.deadlineTo);
  const byRecommendation =
    query.recommendation.length === 0
      ? byTo
      : byTo.in("scored_recommendation", query.recommendation);
  return query.decision.length === 0
    ? byRecommendation
    : byRecommendation.or(decisionFilter(query.decision));
}

async function listBidRows(
  db: Db,
  query: BidListQuery,
  after: ListAfter,
  spec: SortSpec,
): Promise<BidListItemRow[]> {
  const filtered = filteredBids(db, query);
  const paged =
    after === null ? filtered : filtered.or(keysetFilter(spec.column, spec.direction, after));
  const { data, error } = await paged
    .order(spec.column, { ascending: spec.direction === "asc", nullsFirst: false })
    .order("id", { ascending: true })
    .limit(query.limit + 1);
  if (error) throw error;
  return data;
}

// ── 분석(score_runs + 자식 표) ──

// mapper 가 읽지 않는 큰 열(input_snapshot·kev_output)은 읽지 않는다. 목록 한 쪽이 run 마다 수십 KB 를 싣지 않게 한다.
const RUN_COLUMNS =
  "id,org_id,bid_id,revision_id,company_profile_id,profile_revision,extraction_id,algorithm_version,run_mode,ai_provider,qwen_model,kev_model,question_set_version,kev_calibration,prompt_hash,input_snapshot_hash,injection_suspected,status,score,recommendation,recommendation_basis,explanation,review_flags,missing_factors,model_metadata,kev_assist,fallback_reason,idempotency_key,request_hash,requested_by,error_code,queued_at,started_at,finished_at,created_at";
const ANALYSIS_SELECT =
  `${RUN_COLUMNS},revision:bid_revisions!score_runs_revision_fkey(revision),score_factors!score_factors_score_run_fkey(*),qualification_checks!qualification_checks_score_run_fkey(*),requirement_assessments!requirement_assessments_score_run_fkey(*)` as const;

type StoredRun = Omit<ScoreRunRow, "input_snapshot" | "kev_output"> & {
  revision: { revision: number } | null;
  score_factors: ScoreFactorRow[];
  qualification_checks: QualificationCheckRow[];
  requirement_assessments: RequirementAssessmentRow[];
};

function toAnalysis(stored: StoredRun): AnalysisView {
  const { revision, score_factors, qualification_checks, requirement_assessments, ...run } = stored;
  if (revision === null) throw new Error(`분석 ${run.id} 의 공고 revision 을 읽지 못했습니다`);
  return toAnalysisViewFromRows({
    // 읽지 않은 두 열은 행 타입을 맞추려고 null 로 둔다. mapper 는 이 값을 쓰지 않는다.
    run: { ...run, input_snapshot: null, kev_output: null },
    revision: revision.revision,
    factors: score_factors,
    checks: qualification_checks,
    assessments: requirement_assessments,
  });
}

const SCORED: readonly AnalysisStatus[] = ["COMPLETED", "PARTIAL"];
const ACTIVE: readonly AnalysisStatus[] = ["QUEUED", "RUNNING"];

// 이 조직의 최신 run 한 건(statuses 가 있으면 그 상태 중). 같은 시각이면 id 가 큰 쪽이다(뷰와 같은 순서).
async function latestAnalysis(
  db: Db,
  orgId: string,
  bidId: string,
  statuses: readonly AnalysisStatus[] | null,
): Promise<AnalysisView | null> {
  const base = db
    .from("score_runs")
    .select(ANALYSIS_SELECT)
    .eq("org_id", orgId)
    .eq("bid_id", bidId);
  const filtered = statuses === null ? base : base.in("status", statuses);
  const { data, error } = await filtered
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data === null ? null : toAnalysis(data);
}

const toRunRef = (row: { id: string; status: string }): RunRef => ({
  id: row.id,
  status: analysisStatusSchema.parse(row.status),
});

// 같은 입력(공고 revision·회사 프로필 revision 행·알고리즘)의 run 중 최신 1건(O7c).
async function findSameInput(
  orgId: string,
  bidId: string,
  input: AnalysisInput,
  statuses: readonly AnalysisStatus[],
): Promise<RunRef | null> {
  const db = await getSupabase();
  const { data, error } = await db
    .from("score_runs")
    .select("id,status")
    .eq("org_id", orgId)
    .eq("bid_id", bidId)
    .eq("revision_id", input.revisionId)
    .eq("company_profile_id", input.companyProfileId)
    .eq("algorithm_version", input.algorithmVersion)
    .in("status", statuses)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data === null ? null : toRunRef(data);
}

// ── 공고 상세 ──

const REVISION_COLUMNS = "id,revision,amendment_no,fetched_at,checksum,changed_fields";
const DOCUMENT_COLUMNS =
  "id,name,mime_type,size_bytes,format,download_status,parse_status,download_error_code,page_count,parse_error_code";
// 분석이 쓰는 추출과 같은 조건(resolveAnalysisInput)이다.
const USABLE_EXTRACTION = ["COMPLETED", "PENDING_REVIEW"];

const toRevisionSummary = (row: {
  id: string;
  revision: number;
  amendment_no: string | null;
  fetched_at: string;
  checksum: string;
  changed_fields: string[];
}): BidRevisionSummary => ({
  id: row.id,
  revision: row.revision,
  amendmentNo: row.amendment_no,
  fetchedAt: row.fetched_at,
  checksum: row.checksum,
  changedFields: row.changed_fields,
});

// 05 §4.3 은 받은 첨부에 다운로드 경로를 둔다. 하지만 내려받기 라우트(/bids/:id/documents/:docId/download)는
// 핵심 컷의 Route Handler 9개에 없다(스펙 D24). 없는 주소를 내보내면 화면에 죽은 링크가 생기므로 라우트가 생길 때까지 null 이다.
const toDocument = (row: {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  format: string | null;
  download_status: string;
  parse_status: string | null;
  download_error_code: string | null;
  page_count: number | null;
  parse_error_code: string | null;
}): BidDocument =>
  bidDocumentSchema.parse({
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    format: row.format,
    downloadStatus: row.download_status,
    parseStatus: row.parse_status,
    downloadErrorCode: row.download_error_code,
    pageCount: row.page_count,
    parseErrorCode: row.parse_error_code,
    downloadPath: null,
  });

const toStructured = (row: {
  kind: string;
  code: string | null;
  name: string | null;
  value: unknown;
  source_operation: string;
}): StructuredRequirement =>
  structuredRequirementSchema.parse({
    kind: row.kind,
    code: row.code,
    name: row.name,
    value: row.value,
    sourceOperation: row.source_operation,
  });

// 쓸 수 있는 추출(COMPLETED·PENDING_REVIEW) 중 최신을 싣는다(05 §4.3). 없으면 최신 추출의 상태만(PENDING·FAILED) 싣는다.
function pickExtraction(
  rows: { id: string; status: string; payload: unknown }[],
): BidDetailParts["extraction"] {
  const usable = rows.find((row) => USABLE_EXTRACTION.includes(row.status));
  if (usable !== undefined) return { id: usable.id, status: usable.status, result: usable.payload };
  const latest = rows[0];
  return latest === undefined ? null : { id: latest.id, status: latest.status, result: null };
}

// 최신 revision 한 건에 딸린 본문·첨부·구조화 자격·추출.
async function readRevisionParts(db: Db, bidId: string, revisionId: string) {
  const [body, documents, structured, extractions] = await Promise.all([
    db.from("bid_revisions").select("normalized").eq("id", revisionId).single(),
    db
      .from("bid_documents")
      .select(DOCUMENT_COLUMNS)
      .eq("bid_id", bidId)
      .eq("revision_id", revisionId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    db
      .from("bid_structured_requirements")
      .select("kind,code,name,value,source_operation")
      .eq("bid_id", bidId)
      .eq("revision_id", revisionId)
      .order("seq", { ascending: true }),
    db
      .from("requirement_extractions")
      .select("id,status,payload")
      .eq("bid_id", bidId)
      .eq("revision_id", revisionId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false }),
  ]);
  if (body.error) throw body.error;
  if (documents.error) throw documents.error;
  if (structured.error) throw structured.error;
  if (extractions.error) throw extractions.error;
  return {
    latestRevisionBody: body.data.normalized,
    documents: documents.data.map(toDocument),
    structured: structured.data.map(toStructured),
    extraction: pickExtraction(extractions.data),
  };
}

export function createBidsRepo(config: { runMode: RunMode; algorithmVersion: string }): BidsRepo {
  return {
    async listBids(_orgId, query, after) {
      const db = await getSupabase();
      const spec = SORTS[query.sort];
      const rows = await listBidRows(db, query, after, spec);
      return pageOf(rows, query.limit, toBidListItem, (row, item) => ({
        sortValue: spec.valueOf(row),
        id: item.id,
      }));
    },

    // 행은 읽지 않고 listBids 와 같은 조건의 건수만 센다.
    async countBids(_orgId, query) {
      const { count, error } = await filteredBids(await getSupabase(), query, {
        count: "exact",
        head: true,
      });
      if (error) throw error;
      return count ?? 0;
    },

    // 뷰 한 줄(+ bid_notices 의 사전규격 번호)·revision 목록·이 조직의 최신 run·결정을 함께 읽고,
    // 공고의 latest_revision 에 딸린 본문·첨부·구조화 자격·추출을 이어서 함께 읽는다.
    async getBid(orgId, id) {
      const db = await getSupabase();
      const [notice, preSpec, revisions, analysis, reviews] = await Promise.all([
        db.from("bid_list_items").select("*").eq("id", id).maybeSingle(),
        db.from("bid_notices").select("pre_spec_ref").eq("id", id).maybeSingle(),
        db
          .from("bid_revisions")
          .select(REVISION_COLUMNS)
          .eq("bid_id", id)
          .order("revision", { ascending: false }),
        latestAnalysis(db, orgId, id, null),
        readReviews(db, orgId, id),
      ]);
      if (notice.error) throw notice.error;
      if (preSpec.error) throw preSpec.error;
      if (revisions.error) throw revisions.error;
      if (notice.data === null) return null;
      const latestRevision = notice.data.latest_revision;
      const latest = revisions.data.find((row) => row.revision === latestRevision);
      if (latest === undefined) {
        throw new Error(`공고 ${id} 의 최신 revision(${latestRevision}) 행이 없습니다`);
      }
      const parts = await readRevisionParts(db, id, latest.id);
      return toBidDetail({
        ...parts,
        notice: { ...notice.data, pre_spec_ref: preSpec.data?.pre_spec_ref ?? null },
        revisions: revisions.data.map(toRevisionSummary),
        latestAnalysis: analysis,
        reviews,
        now: new Date(),
      });
    },

    async bidExists(_orgId, bidId) {
      return bidExistsIn(await getSupabase(), bidId);
    },

    // 분석 이력: created_at 내림차순(nulls last), 같은 시각은 id 내림차순 키셋.
    // 동률 순서는 최신 run 조회(latestAnalysis)·뷰와 같다. 이력 첫 줄이 "최신"과 어긋나지 않는다(M11).
    async listAnalyses(orgId, bidId, limit, after) {
      const db = await getSupabase();
      const base = db
        .from("score_runs")
        .select(ANALYSIS_SELECT)
        .eq("org_id", orgId)
        .eq("bid_id", bidId);
      const paged =
        after === null ? base : base.or(keysetFilter("created_at", "desc", after, "desc"));
      const { data, error } = await paged
        .order("created_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(limit + 1);
      if (error) throw error;
      return pageOf(data, limit, toAnalysis, (row) => ({ sortValue: row.created_at, id: row.id }));
    },

    async getRevisionHistory(bidId) {
      const db = await getSupabase();
      const { data: bid, error: bidError } = await db
        .from("bid_notices")
        .select("title")
        .eq("id", bidId)
        .maybeSingle();
      if (bidError) throw bidError;
      if (bid === null) return null;
      const { data, error } = await db
        .from("bid_revisions")
        .select("id,revision,amendment_no,changed_fields,fetched_at,checksum")
        .eq("bid_id", bidId)
        .order("revision", { ascending: false });
      if (error) throw error;
      return {
        title: bid.title,
        revisions: data.map((row) => ({
          id: row.id,
          checksum: row.checksum,
          revision: row.revision,
          amendmentNo: row.amendment_no,
          changedFields: row.changed_fields,
          fetchedAt: row.fetched_at,
        })),
      };
    },

    async getRevisionSnapshots(bidId, revisions) {
      if (revisions.length === 0) return [];
      const { data, error } = await (
        await getSupabase()
      )
        .from("bid_revisions")
        .select("revision,normalized")
        .eq("bid_id", bidId)
        .in("revision", revisions);
      if (error) throw error;
      return data;
    },

    async getLatestScoredAnalysis(orgId, bidId) {
      return latestAnalysis(await getSupabase(), orgId, bidId, SCORED);
    },

    async getAnalysis(orgId, id) {
      const db = await getSupabase();
      const { data, error } = await db
        .from("score_runs")
        .select(ANALYSIS_SELECT)
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data === null ? null : toAnalysis(data);
    },

    async getAnalysisSnapshot(orgId, id) {
      const db = await getSupabase();
      const { data, error } = await db
        .from("score_runs")
        .select("status,input_snapshot")
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw error;
      return data === null
        ? null
        : { status: analysisStatusSchema.parse(data.status), inputSnapshot: data.input_snapshot };
    },

    findRunningAnalysis(orgId, bidId, input) {
      return findSameInput(orgId, bidId, input, ACTIVE);
    },

    findCompletedSameInput(orgId, bidId, input) {
      return findSameInput(orgId, bidId, input, SCORED);
    },

    // 회사 프로필(주어진 revision, 없으면 최신)과 공고 latest_revision 의 revision 행, 그 revision 의 쓸 수 있는 최신 추출.
    async resolveAnalysisInput(orgId, bidId, profileRevision) {
      const db = await getSupabase();
      const profiles = db.from("company_profiles").select("id,revision").eq("org_id", orgId);
      const [profile, notice] = await Promise.all([
        (profileRevision === undefined
          ? profiles.order("revision", { ascending: false }).limit(1)
          : profiles.eq("revision", profileRevision)
        ).maybeSingle(),
        db.from("bid_notices").select("latest_revision,stage").eq("id", bidId).maybeSingle(),
      ]);
      if (profile.error) throw profile.error;
      if (notice.error) throw notice.error;
      if (profile.data === null) return null;
      if (notice.data === null) throw new Error(`공고 ${bidId} 를 찾을 수 없습니다`);
      const revision = await db
        .from("bid_revisions")
        .select("id")
        .eq("bid_id", bidId)
        .eq("revision", notice.data.latest_revision)
        .maybeSingle();
      if (revision.error) throw revision.error;
      if (revision.data === null) throw new Error(`공고 ${bidId} 의 최신 revision 행이 없습니다`);
      const extraction = await db
        .from("requirement_extractions")
        .select("id")
        .eq("bid_id", bidId)
        .eq("revision_id", revision.data.id)
        .in("status", USABLE_EXTRACTION)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (extraction.error) throw extraction.error;
      return {
        companyProfileId: profile.data.id,
        profileRevision: profile.data.revision,
        revisionId: revision.data.id,
        extractionId: extraction.data?.id ?? null,
        algorithmVersion: config.algorithmVersion,
        stage: bidStageSchema.parse(notice.data.stage),
      };
    },

    // QUEUED 요청 행. 상태·요청자·시각은 열 권한이 없어 DB 기본값이 들어간다(20261019000004 §5).
    async createAnalysisRun(input): Promise<CreateRunResult> {
      const db = await getSupabase();
      const { data, error } = await db
        .from("score_runs")
        .insert({
          org_id: input.orgId,
          bid_id: input.bidId,
          revision_id: input.revisionId,
          company_profile_id: input.companyProfileId,
          profile_revision: input.profileRevision,
          extraction_id: input.extractionId,
          algorithm_version: input.algorithmVersion,
          run_mode: config.runMode.toUpperCase(),
          ai_provider: config.runMode === "mock" ? "MOCK" : "LOCAL",
          idempotency_key: input.idempotencyKey,
          request_hash: input.requestHash,
        })
        .select("id,status")
        .single();
      if (error === null) return { created: toRunRef(data) };
      const conflict = uniqueViolation(error);
      if (conflict === "IDEMPOTENCY_KEY") return { conflict };
      if (conflict === "ACTIVE_INPUT") {
        // 동시 요청이 같은 입력의 run 을 먼저 넣었다. 그 run 을 다시 읽어 돌려준다.
        const run = await findSameInput(input.orgId, input.bidId, input, ACTIVE);
        if (run === null) {
          throw new Error("같은 입력의 진행 중 run 과 충돌했지만 다시 읽지 못했습니다");
        }
        return { conflict, run };
      }
      throw error;
    },

    // 큐 등록 실패 정리는 rpc 하나로만 한다(O4). 함수가 요청자 본인의 QUEUED run 만 FAILED 로 바꾸고 멱등 키를 푼다.
    async markRunFailed(_orgId, scoreRunId, errorCode) {
      if (errorCode !== "ENQUEUE_FAILED") {
        throw new Error(`markRunFailed 는 ENQUEUE_FAILED 만 받습니다: ${errorCode}`);
      }
      const db = await getSupabase();
      const { data, error } = await db.rpc("release_unqueued_score_run", {
        p_score_run_id: scoreRunId,
      });
      if (error) throw error;
      // 이미 worker 가 집었거나(RUNNING) 요청자가 아니면 바꾸지 않는다. 행은 b3 복구가 닫는다.
      if (data === false) {
        console.error({ event: "score_run_release_skipped", scoreRunId });
      }
    },

    async findIdempotency(orgId, key) {
      const db = await getSupabase();
      const { data, error } = await db
        .from("score_runs")
        .select("id,status,request_hash")
        .eq("org_id", orgId)
        .eq("idempotency_key", key)
        .maybeSingle();
      if (error) throw error;
      if (data === null) return null;
      // request_hash 가 없는 옛 행은 어떤 본문과도 같지 않다(다른 본문 → 409).
      return { requestHash: data.request_hash ?? "", run: toRunRef(data) };
    },
  };
}
