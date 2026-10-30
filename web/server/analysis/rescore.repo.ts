import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { RescoreCandidate, RescoreSource, RescoreStore } from "./rescore.model";

// ── 점수 재채점 저장 port(`pnpm score:rescore`, ADR-071)의 Supabase 구현. 규칙은 rescore.model 에 둔다 ──
// worker 컨테이너에서 service role 클라이언트로 돈다. service role 은 RLS 를 거치지 않으므로
// 조직 표(company_profiles·score_runs)의 모든 질의·쓰기에 org_id 를 직접 건다.
// 쓰기는 score_runs 넣기(RUNNING)와 finish_score_run 하나, 실패한 run 닫기다. 옛 run 은 바꾸지 않는다.
// 오류 message 에는 표·동작·코드만 싣는다(PostgREST message·details 에 값이 섞일 수 있다).

type Client = SupabaseClient<Database>;

/** 한 번에 읽는 행 수. PostgREST 최대 행 수(1,000)보다 작게 두고 range 로 이어 읽는다. */
const PAGE_SIZE = 500;
/** in(…) 에 넣는 id 수. 요청 URL 이 길어지지 않게 나눈다. */
const ID_CHUNK = 100;
const SCORED_STATUSES = ["COMPLETED", "PARTIAL"];
const SOURCE_COLUMNS =
  "id, bid_id, revision_id, company_profile_id, profile_revision, extraction_id, algorithm_version, run_mode, ai_provider, idempotency_key, review_flags, score, recommendation, input_snapshot, kev_output";
/** 같은 입력(공고·revision·프로필·알고리즘)의 진행 중 run 은 하나다(20261019000004). */
const ACTIVE_INPUT_CONSTRAINT = "score_runs_active_input_key";
const UNIQUE_VIOLATION = "23505";

function storeError(table: string, action: string, error: { code?: string | null }): Error {
  const code = typeof error.code === "string" && error.code !== "" ? error.code : "UNKNOWN";
  return new Error(`rescore store 오류: ${table}.${action} ${code}`);
}

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

/** 공고마다 최신 revision id. bid_notices.latest_revision 과 같은 번호의 bid_revisions 행이다. */
async function latestRevisionIds(
  client: Client,
  bidIds: readonly string[],
): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  for (const chunk of chunksOf(bidIds, ID_CHUNK)) {
    const notices = await client.from("bid_notices").select("id, latest_revision").in("id", chunk);
    if (notices.error) throw storeError("bid_notices", "select", notices.error);
    const wanted = new Map(notices.data.map((notice) => [notice.id, notice.latest_revision]));
    for (let from = 0; ; from += PAGE_SIZE) {
      const revisions = await client
        .from("bid_revisions")
        .select("id, bid_id, revision")
        .in("bid_id", chunk)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (revisions.error) throw storeError("bid_revisions", "select", revisions.error);
      for (const revision of revisions.data) {
        if (wanted.get(revision.bid_id) === revision.revision)
          latest.set(revision.bid_id, revision.id);
      }
      if (revisions.data.length < PAGE_SIZE) break;
    }
  }
  return latest;
}

/** service role 클라이언트로 재채점 저장 port 를 만든다. 클라이언트는 받기만 하고 모듈에 담아 두지 않는다. */
export function createRescoreStore(client: Client): RescoreStore {
  return {
    async findOrgBySlug(slug) {
      const org = await client.from("organizations").select("id").eq("slug", slug).maybeSingle();
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

    // 화면(opportunity_list_items·공고 상세)과 같은 고르기: 최신 revision·최신 프로필의 COMPLETED·PARTIAL run 가운데 최신.
    async listShownRuns(orgId, companyProfileId) {
      const runs: { id: string; bidId: string; revisionId: string; algorithmVersion: string }[] =
        [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const page = await client
          .from("score_runs")
          .select("id, bid_id, revision_id, algorithm_version")
          .eq("org_id", orgId)
          .eq("company_profile_id", companyProfileId)
          .in("status", SCORED_STATUSES)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);
        if (page.error) throw storeError("score_runs", "select", page.error);
        for (const row of page.data) {
          runs.push({
            id: row.id,
            bidId: row.bid_id,
            revisionId: row.revision_id,
            algorithmVersion: row.algorithm_version,
          });
        }
        if (page.data.length < PAGE_SIZE) break;
      }
      const latest = await latestRevisionIds(client, [...new Set(runs.map((run) => run.bidId))]);
      const shown = new Map<string, RescoreCandidate>();
      for (const run of runs) {
        if (!shown.has(run.bidId) && latest.get(run.bidId) === run.revisionId) {
          shown.set(run.bidId, { id: run.id, algorithmVersion: run.algorithmVersion });
        }
      }
      return [...shown]
        .toSorted(([left], [right]) => (left < right ? -1 : 1))
        .map(([, run]) => run);
    },

    async loadSources(orgId, ids) {
      if (ids.length === 0) return [];
      const rows = await client
        .from("score_runs")
        .select(SOURCE_COLUMNS)
        .in("id", [...ids])
        .eq("org_id", orgId);
      if (rows.error) throw storeError("score_runs", "source", rows.error);
      const byId = new Map(
        rows.data.map((row): [string, RescoreSource] => [
          row.id,
          {
            id: row.id,
            bidId: row.bid_id,
            revisionId: row.revision_id,
            companyProfileId: row.company_profile_id,
            profileRevision: row.profile_revision,
            extractionId: row.extraction_id,
            algorithmVersion: row.algorithm_version,
            runMode: row.run_mode,
            aiProvider: row.ai_provider,
            idempotencyKey: row.idempotency_key,
            reviewFlags: row.review_flags,
            score: row.score,
            recommendation: row.recommendation,
            inputSnapshot: row.input_snapshot,
            kevOutput: row.kev_output,
          },
        ]),
      );
      return ids.flatMap((id) => {
        const source = byId.get(id);
        return source === undefined ? [] : [source];
      });
    },

    async insertRun(row) {
      const inserted = await client
        .from("score_runs")
        .upsert(row, { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select("id");
      if (inserted.error) {
        const busy =
          inserted.error.code === UNIQUE_VIOLATION &&
          (inserted.error.message ?? "").includes(`"${ACTIVE_INPUT_CONSTRAINT}"`);
        if (busy) return { kind: "BUSY" };
        throw storeError("score_runs", "insert", inserted.error);
      }
      const created = inserted.data.at(0);
      return created === undefined ? { kind: "EXISTING" } : { kind: "CREATED", id: created.id };
    },

    async finish(payload) {
      const finished = await client.rpc("finish_score_run", { p: payload });
      if (finished.error) throw storeError("score_runs", "finish", finished.error);
    },

    async markFailed(orgId, runId, finishedAt) {
      const updated = await client
        .from("score_runs")
        .update({ status: "FAILED", error_code: "RESCORE_FAILED", finished_at: finishedAt })
        .eq("id", runId)
        .eq("org_id", orgId)
        .eq("status", "RUNNING");
      if (updated.error) throw storeError("score_runs", "fail", updated.error);
    },
  };
}
