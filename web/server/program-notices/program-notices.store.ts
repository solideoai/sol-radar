import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/lib/database.types";
import type {
  NormalizedProgramNotice,
  ProgramNoticeRunMode,
  ProgramNoticeRunStatus,
  ProgramNoticeSource,
  ProgramRunErrorCode,
} from "./program-notice.model";

// ── 부처 공고 쓰기(worker 전용). service role 클라이언트를 받는다. 화면 쪽 읽기는 program-notices.repo.ts(anon + RLS)다 ──
// 같은 소스 안의 재수집은 (source, source_notice_id) 로 upsert 한다(마이그레이션 20261021000650).

export type ProgramRun = {
  source: ProgramNoticeSource;
  runMode: ProgramNoticeRunMode;
  status: ProgramNoticeRunStatus;
  errorCode: ProgramRunErrorCode | null;
  fetchedCount: number;
  savedCount: number;
  droppedCount: number;
  startedAt: string;
  finishedAt: string;
};

export type ProgramNoticesStore = {
  /** 저장한 행 수를 돌려준다. */
  upsertNotices(rows: NormalizedProgramNotice[]): Promise<number>;
  recordRun(run: ProgramRun): Promise<void>;
};

type Client = SupabaseClient<Database>;

const toRow = (notice: NormalizedProgramNotice): TablesInsert<"program_notices"> => ({
  source: notice.source,
  source_notice_id: notice.sourceNoticeId,
  title: notice.title,
  agency: notice.agency,
  source_url: notice.sourceUrl,
  published_at: notice.publishedAt,
  apply_start_on: notice.applyStartOn,
  apply_end_on: notice.applyEndOn,
  summary: notice.summary,
  apply_method: notice.applyMethod,
  target: notice.target,
  tags: notice.tags,
  dedupe_key: notice.dedupeKey,
  fetched_at: notice.fetchedAt,
  is_demo: notice.isDemo,
});

// DB 오류 메시지에는 넣으려던 값이 실릴 수 있다. 표·동작·오류 코드만 남긴다.
const storeError = (table: string, action: string, error: { code?: string | null }): Error =>
  new Error(`${table} ${action} 실패(code=${error.code ?? "unknown"})`);

export function createSupabaseProgramNoticesStore(admin: Client): ProgramNoticesStore {
  return {
    async upsertNotices(rows) {
      if (rows.length === 0) return 0;
      const result = await admin
        .from("program_notices")
        .upsert(rows.map(toRow), { onConflict: "source,source_notice_id" })
        .select("id");
      if (result.error) throw storeError("program_notices", "upsert", result.error);
      return result.data.length;
    },
    async recordRun(run) {
      const result = await admin.from("program_notice_runs").insert({
        source: run.source,
        run_mode: run.runMode,
        status: run.status,
        error_code: run.errorCode,
        fetched_count: run.fetchedCount,
        saved_count: run.savedCount,
        dropped_count: run.droppedCount,
        started_at: run.startedAt,
        finished_at: run.finishedAt,
      });
      if (result.error) throw storeError("program_notice_runs", "insert", result.error);
    },
  };
}
