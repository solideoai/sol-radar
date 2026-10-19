import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type {
  AnalysisContextLoader,
  AnalysisRunTracker,
  ExtractionCacheKey,
  ScoreRunStatus,
  StaleRun,
  StaleRunCursor,
  StaleRunFinder,
} from "./analysis-job.model";
import type { AnalysisRunRecord, ExtractionRecord } from "./analysis.model";
import type { AnalysisRunSink, ExtractionStore } from "./analysis.service";
import {
  toExtractSource,
  toExtractionRow,
  toFailedUpdate,
  toFinishScoreRunPayload,
  toLoadedContext,
  toRunningUpdate,
  type AttachmentTextReader,
} from "./analysis-store.model";
import {
  DEMO_ORG_SLUG,
  toDemoBidRows,
  toPreanalyzeRun,
  toPreanalyzeRunRow,
  type PreanalyzeRun,
  type PreanalyzeStore,
} from "./preanalyze.model";

// ── 저장: 분석 port 네 개와 멈춘 run 찾기 port 의 Supabase 구현. supabase-js 호출만 두고 규칙은 analysis-store.model 에 둔다 ──
// worker 가 service role 클라이언트(getSupabaseAdmin)를 넘긴다. service role 은 RLS 를 거치지 않으므로
// 조직 표(score_runs·company_profiles·team_member_scoring·assignments·자식 3표)의 모든 질의·쓰기에 org_id 를 직접 건다.
// 오류는 일반 Error 라 job 이 재시도한다. message 에는 표·동작·코드만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).

export type AnalysisStores = {
  loader: AnalysisContextLoader;
  tracker: AnalysisRunTracker;
  extraction: ExtractionStore;
  sink: AnalysisRunSink;
  /** 멈춘 run 복구(worker)가 쓴다. 모든 조직의 행을 본다. */
  staleRuns: StaleRunFinder;
};

type Client = SupabaseClient<Database>;

/** 끝나지 않은 run. 이미 끝난(COMPLETED·PARTIAL·FAILED) run 은 바꾸지 않는다. */
const ACTIVE_RUN_STATUSES: readonly ScoreRunStatus[] = ["QUEUED", "RUNNING"];
/** 캐시로 쓸 수 있는 추출 행(e8 판정 2: 성공 행만 저장한다). */
const SUCCESS_EXTRACTION_STATUSES: readonly string[] = ["COMPLETED", "PENDING_REVIEW"];

const SCORE_RUN_COLUMNS =
  "id, org_id, bid_id, revision_id, company_profile_id, idempotency_key, status, queued_at";
const REVISION_COLUMNS = "id, bid_id, revision, raw_payload, normalized, fetched_at";
const STRUCTURED_COLUMNS = "kind, seq, code, name, value, source_operation";
const EXTRACTION_COLUMNS = "id, status, payload, translations";
const PROFILE_COLUMNS =
  "revision, name, is_demo, technologies, technologies_complete, licenses, industry_codes, past_projects, financials, preferences";
const TEAM_SCORING_COLUMNS = "member_id, role, grade, skills, availability";
const ASSIGNMENT_COLUMNS = "member_id, starts_at, ends_at, allocation_percent";
const STALE_RUN_COLUMNS = "id, org_id, idempotency_key, status, queued_at";

/** "analysis store 오류: <표>.<동작> <code>". code 가 없으면 UNKNOWN 이다. */
function storeError(table: string, action: string, error: { code?: string | null }): Error {
  const code = typeof error.code === "string" && error.code !== "" ? error.code : "UNKNOWN";
  return new Error(`analysis store 오류: ${table}.${action} ${code}`);
}

function createLoader(client: Client, attachments: AttachmentTextReader): AnalysisContextLoader {
  return {
    async load(target, cacheKey) {
      const run = await client
        .from("score_runs")
        .select(SCORE_RUN_COLUMNS)
        .eq("id", target.scoreRunId)
        .eq("org_id", target.orgId)
        .maybeSingle();
      if (run.error) throw storeError("score_runs", "select", run.error);
      if (run.data === null) return null;
      const scoreRun = run.data;

      const revision = await client
        .from("bid_revisions")
        .select(REVISION_COLUMNS)
        .eq("id", scoreRun.revision_id)
        .eq("bid_id", scoreRun.bid_id)
        .maybeSingle();
      if (revision.error) throw storeError("bid_revisions", "select", revision.error);
      if (revision.data === null) return null;

      const structured = await client
        .from("bid_structured_requirements")
        .select(STRUCTURED_COLUMNS)
        .eq("revision_id", scoreRun.revision_id)
        .order("kind")
        .order("seq");
      if (structured.error) {
        throw storeError("bid_structured_requirements", "select", structured.error);
      }

      const extraction = await selectCachedExtraction(client, scoreRun.revision_id, cacheKey);

      const profile = await client
        .from("company_profiles")
        .select(PROFILE_COLUMNS)
        .eq("id", scoreRun.company_profile_id)
        .eq("org_id", target.orgId)
        .maybeSingle();
      if (profile.error) throw storeError("company_profiles", "select", profile.error);
      if (profile.data === null) return null;

      const teamScoring = await client
        .from("team_member_scoring")
        .select(TEAM_SCORING_COLUMNS)
        .eq("org_id", target.orgId)
        .order("member_id");
      if (teamScoring.error) throw storeError("team_member_scoring", "select", teamScoring.error);

      const assignments = await client
        .from("assignments")
        .select(ASSIGNMENT_COLUMNS)
        .eq("org_id", target.orgId)
        .order("member_id")
        .order("starts_at");
      if (assignments.error) throw storeError("assignments", "select", assignments.error);

      const documents = await attachments.readRevisionDocuments(scoreRun.revision_id);

      return toLoadedContext({
        scoreRun,
        revision: revision.data,
        structured: structured.data,
        extraction,
        profile: profile.data,
        teamScoring: teamScoring.data,
        assignments: assignments.data,
        documents,
      });
    },
  };
}

/**
 * 그 revision 의 가장 최근 성공 추출 1행. cacheKey 가 있으면 (model_name, prompt_hash) 가 같은 행만,
 * null(gateway /health 실패)이면 어떤 모델이 추출했는지 모르므로 키와 상관없이 고른다(e8 판정 S6).
 */
async function selectCachedExtraction(
  client: Client,
  revisionId: string,
  cacheKey: ExtractionCacheKey,
) {
  const successRows = client
    .from("requirement_extractions")
    .select(EXTRACTION_COLUMNS)
    .eq("revision_id", revisionId)
    .in("status", SUCCESS_EXTRACTION_STATUSES);
  const keyed =
    cacheKey === null
      ? successRows
      : successRows.eq("model_name", cacheKey.modelName).eq("prompt_hash", cacheKey.promptHash);
  const extraction = await keyed.order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (extraction.error) throw storeError("requirement_extractions", "select", extraction.error);
  return extraction.data;
}

function createExtractionStore(client: Client, attachments: AttachmentTextReader): ExtractionStore {
  return {
    async loadSource(context) {
      const revisionId = context.bid.revisionId;
      const revision = await client
        .from("bid_revisions")
        .select("normalized")
        .eq("id", revisionId)
        .eq("bid_id", context.bidId)
        .single();
      if (revision.error) throw storeError("bid_revisions", "select", revision.error);
      return toExtractSource(
        revision.data.normalized,
        await attachments.readRevisionDocuments(revisionId),
      );
    },

    /**
     * 추출 행은 조직 표가 아니라 (revision_id, model_name, prompt_hash) 키로 여러 조직의 분석이 함께 쓴다(03 §2.1 재사용 키).
     * 같은 키의 행이 이미 있으면 덮지 않는다(on conflict do nothing). 병합 upsert 는 다른 조직의 분석이 쓰는 행을 덮는다.
     * 넣었든 이미 있었든 같은 키로 다시 읽어 그 행의 id 를 돌려준다.
     */
    async save(record: ExtractionRecord) {
      const row = toExtractionRow(record);
      const inserted = await client.from("requirement_extractions").upsert(row, {
        onConflict: "revision_id,model_name,prompt_hash",
        ignoreDuplicates: true,
      });
      if (inserted.error) throw storeError("requirement_extractions", "upsert", inserted.error);

      const saved = await client
        .from("requirement_extractions")
        .select("id")
        .eq("revision_id", row.revision_id)
        .eq("model_name", row.model_name)
        .eq("prompt_hash", row.prompt_hash)
        .maybeSingle();
      if (saved.error) throw storeError("requirement_extractions", "select", saved.error);
      // 넣기는 충돌로 아무것도 하지 않았는데 그 사이 행이 지워졌다.
      if (saved.data === null) {
        throw new Error("analysis store 오류: requirement_extractions.select NOT_FOUND");
      }
      return { id: saved.data.id };
    },
  };
}

/** 바뀐 행 수는 보지 않는다. 이미 끝난 run·다른 시도가 잡은 run 이면 0행이 맞다. */
function createTracker(client: Client): AnalysisRunTracker {
  return {
    async markRunning(input) {
      const updated = await client
        .from("score_runs")
        .update(toRunningUpdate(input))
        .eq("id", input.scoreRunId)
        .eq("org_id", input.orgId)
        .in("status", ACTIVE_RUN_STATUSES);
      if (updated.error) throw storeError("score_runs", "update", updated.error);
    },

    /**
     * attemptStartedAt 이 있으면 그 시도가 잡은 run(RUNNING·started_at 같음)만 닫는다. 늦게 실패한 시도가
     * 다른 시도가 다시 잡은 run 을 FAILED 로 덮지 않게 한다. 없으면(복구·markRunning 전 실패) 끝나지 않은 run 을 닫는다.
     */
    async markFailed(input) {
      const target = client
        .from("score_runs")
        .update(toFailedUpdate(input))
        .eq("id", input.scoreRunId)
        .eq("org_id", input.orgId);
      const { attemptStartedAt } = input;
      const updated = await (attemptStartedAt === undefined
        ? target.in("status", ACTIVE_RUN_STATUSES)
        : target.eq("status", "RUNNING").eq("started_at", attemptStartedAt));
      if (updated.error) throw storeError("score_runs", "update", updated.error);
    },
  };
}

/** finish_score_run 이 raise 하는 거절(message 가 곧 코드). 이 둘만 코드로 옮기고 그 밖의 message 는 싣지 않는다. */
const FINISH_REJECTIONS: ReadonlyMap<string, string> = new Map([
  ["SCORE_RUN_NOT_RUNNING", "NOT_RUNNING"],
  ["SCORE_RUN_NOT_FOUND", "NOT_FOUND"],
]);

function finishError(error: { code?: string | null; message?: string | null }): Error {
  const rejection = FINISH_REJECTIONS.get(error.message ?? "");
  return rejection === undefined
    ? storeError("score_runs", "finish", error)
    : new Error(`analysis store 오류: score_runs.finish ${rejection}`);
}

/**
 * 결과 저장은 finish_score_run(p) 한 번이다(20261019000011, C5-B 보안 후속 2.3). 함수가 한 트랜잭션으로 그 run 을 잠그고,
 * RUNNING 이고 started_at 이 이 시도의 시작 시각일 때만 자식 3표(요소 upsert·나머지 지우고 넣기)와 마감을 쓴다.
 * 이미 끝났거나 다른 시도가 잡은 run 이면 NOT_RUNNING 으로 거절하고 아무것도 바꾸지 않는다. 중간 실패는 통째로 되돌아간다.
 */
function createSink(client: Client): AnalysisRunSink {
  return {
    async save(record: AnalysisRunRecord) {
      const finished = await client.rpc("finish_score_run", {
        p: toFinishScoreRunPayload(record),
      });
      if (finished.error) throw finishError(finished.error);
    },
  };
}

/** Date.toISOString 모양(밀리초·Z)이고 그 값으로 되돌아오는 시각인지. or 필터 문자열에 그대로 넣으므로 다른 모양은 받지 않는다. */
function isIsoInstant(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && new Date(time).toISOString() === value;
}

/** 8-4-4-4-12 의 16진수 uuid. or 필터 문자열에 그대로 넣으므로 다른 모양은 받지 않는다. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidCursor(after: StaleRunCursor | null): boolean {
  return after === null || (isIsoInstant(after.queuedAt) && UUID_PATTERN.test(after.id));
}

const STALE_RUN_STATUSES: readonly StaleRun["status"][] = ["QUEUED", "RUNNING"];

function toStaleRun(row: {
  id: string;
  org_id: string;
  idempotency_key: string | null;
  status: string;
  queued_at: string;
}): StaleRun {
  const status = STALE_RUN_STATUSES.find((candidate) => candidate === row.status);
  // status 필터가 QUEUED·RUNNING 만 고르므로 다른 값은 질의가 틀렸다는 뜻이다.
  if (status === undefined)
    throw new Error("analysis store 오류: score_runs.stale UNEXPECTED_STATUS");
  // PostgREST 의 timestamptz("…+00:00", 마이크로초까지)를 Date.toISOString 모양으로 바꾼다. 밀리초 아래는 버려진다.
  const queuedAt = new Date(row.queued_at);
  if (Number.isNaN(queuedAt.getTime())) {
    throw new Error("analysis store 오류: score_runs.stale INVALID_QUEUED_AT");
  }
  return {
    orgId: row.org_id,
    scoreRunId: row.id,
    idempotencyKey: row.idempotency_key,
    status,
    queuedAt: queuedAt.toISOString(),
  };
}

/**
 * 조직 조건을 걸지 않는다(복구는 운영 작업). 행마다 org_id 를 돌려주고 처리하는 쪽이 그 값을 쓴다.
 * QUEUED 는 queued_at, RUNNING 은 started_at 으로 멈췄는지 본다. (queued_at, id) 오름차순으로 limit 건까지.
 * after 가 있으면 keyset 페이지로 (queued_at, id) > (after.queuedAt, after.id) 인 run 만 고른다.
 * 커서 시각은 밀리초(Date.toISOString)이고 DB 는 마이크로초라, 커서와 같은 밀리초 안의 더 늦은 행은 다음 페이지에서 다시 나올 수 있다.
 * 밀리초 아래를 버리므로(올리지 않으므로) 빠지는 행은 없다. 처리가 멱등이고(같은 jobId 는 무시되고 markFailed 는 0행) 한 회차의 페이지 수에 상한이 있어 받아들인다.
 */
function createStaleRunFinder(client: Client): StaleRunFinder {
  return {
    async findStaleRuns(input) {
      const isValidInput =
        isIsoInstant(input.queuedBefore) &&
        isIsoInstant(input.runningBefore) &&
        Number.isInteger(input.limit) &&
        input.limit >= 1 &&
        isValidCursor(input.after);
      if (!isValidInput) throw new Error("analysis store 오류: score_runs.stale INVALID_INPUT");
      const stale = client
        .from("score_runs")
        .select(STALE_RUN_COLUMNS)
        .in("status", ACTIVE_RUN_STATUSES)
        .or(
          `and(status.eq.QUEUED,queued_at.lt.${input.queuedBefore}),` +
            `and(status.eq.RUNNING,started_at.lt.${input.runningBefore})`,
        );
      // or 를 두 번 걸면 PostgREST 는 둘 다 맞는 행만 고른다(AND).
      const after = input.after;
      const page =
        after === null
          ? stale
          : stale.or(
              `queued_at.gt.${after.queuedAt},` +
                `and(queued_at.eq.${after.queuedAt},id.gt.${after.id})`,
            );
      const runs = await page.order("queued_at").order("id").limit(input.limit);
      if (runs.error) throw storeError("score_runs", "stale", runs.error);
      return runs.data.map(toStaleRun);
    },
  };
}

// ── 사전 분석 저장 port(`pnpm demo:preanalyze`, C5-B) ──
// worker 컨테이너에서 service role 클라이언트로 돈다. 조직 표(company_profiles·score_runs)는 모든 질의·쓰기에 org_id 를 건다.
// 쓰기는 score_runs 넣기 하나다. idempotency_key 충돌이면 아무것도 하지 않고(이미 끝난 run 의 결과를 덮지 않는다) 그 키로 다시 읽는다.

const DEMO_BID_SOURCE = "fixture";
/** bid_notices 는 공고마다 하나라 다대일 임베드다. !inner 로 조건에 맞는 공고의 revision 만 남긴다. */
const DEMO_REVISION_COLUMNS =
  "id, bid_id, revision, raw_payload, notice:bid_notices!inner(latest_revision)";

function toRunOrThrow(row: { id: string; status: string }, action: string): PreanalyzeRun {
  const run = toPreanalyzeRun(row);
  if (run === null) {
    throw new Error(`analysis store 오류: score_runs.${action} UNEXPECTED_STATUS`);
  }
  return run;
}

/** service role 클라이언트로 사전 분석 저장 port 를 만든다. 클라이언트는 받기만 하고 모듈에 담아 두지 않는다. */
export function createPreanalyzeStore(client: SupabaseClient<Database>): PreanalyzeStore {
  return {
    async findDemoOrg() {
      const org = await client
        .from("organizations")
        .select("id")
        .eq("slug", DEMO_ORG_SLUG)
        .eq("is_demo", true)
        .maybeSingle();
      if (org.error) throw storeError("organizations", "select", org.error);
      return org.data === null ? null : org.data.id;
    },

    async latestProfile(orgId) {
      const profile = await client
        .from("company_profiles")
        .select("id, revision")
        .eq("org_id", orgId)
        .order("revision", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (profile.error) throw storeError("company_profiles", "select", profile.error);
      return profile.data === null
        ? null
        : { id: profile.data.id, revision: profile.data.revision };
    },

    async listDemoBids() {
      const revisions = await client
        .from("bid_revisions")
        .select(DEMO_REVISION_COLUMNS)
        .eq("notice.is_demo", true)
        .eq("notice.source", DEMO_BID_SOURCE);
      if (revisions.error) throw storeError("bid_revisions", "select", revisions.error);
      return toDemoBidRows(revisions.data);
    },

    async latestExtractionId(revisionId) {
      const extraction = await client
        .from("requirement_extractions")
        .select("id")
        .eq("revision_id", revisionId)
        .in("status", SUCCESS_EXTRACTION_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (extraction.error) {
        throw storeError("requirement_extractions", "select", extraction.error);
      }
      return extraction.data === null ? null : extraction.data.id;
    },

    async ensureQueuedRun(input) {
      const inserted = await client.from("score_runs").upsert(toPreanalyzeRunRow(input), {
        onConflict: "idempotency_key",
        ignoreDuplicates: true,
      });
      if (inserted.error) throw storeError("score_runs", "insert", inserted.error);

      const run = await client
        .from("score_runs")
        .select("id, status")
        .eq("idempotency_key", input.idempotencyKey)
        .eq("org_id", input.orgId)
        .maybeSingle();
      if (run.error) throw storeError("score_runs", "select", run.error);
      // 같은 키의 행이 다른 조직에 있다. 남의 run 을 가리키지 않는다.
      if (run.data === null) throw new Error("analysis store 오류: score_runs.select NOT_FOUND");
      return toRunOrThrow(run.data, "select");
    },

    async readStatuses(orgId, ids) {
      if (ids.length === 0) return [];
      const runs = await client
        .from("score_runs")
        .select("id, status")
        .in("id", [...ids])
        .eq("org_id", orgId);
      if (runs.error) throw storeError("score_runs", "status", runs.error);
      return runs.data.map((row) => toRunOrThrow(row, "status"));
    },
  };
}

/** service role 클라이언트로 네 port 와 멈춘 run 찾기 port 를 만든다. 클라이언트는 받기만 하고 모듈에 담아 두지 않는다. */
export function createAnalysisStores(
  client: SupabaseClient<Database>,
  attachments: AttachmentTextReader,
): AnalysisStores {
  return {
    loader: createLoader(client, attachments),
    tracker: createTracker(client),
    extraction: createExtractionStore(client, attachments),
    sink: createSink(client),
    staleRuns: createStaleRunFinder(client),
  };
}
