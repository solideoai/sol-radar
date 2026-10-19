import "server-only";
import type { FixtureBatch } from "./fixture.model";
import type { BidSource } from "./normalized-bid.model";
import type { ChangeDecision, StoredRevision } from "./revision";

// ── 수집 저장 포트. 수집 흐름(service)이 기대하는 저장 동작만 적는다 ──
// Supabase 구현(service role, bid_notices·bid_revisions·outbox·ingest_runs·ingest_errors)은 C2 스키마가 들어온 뒤 붙인다.
// 재시도에 안전해야 하므로 구현은 DB 유일 제약(04)에 기댄다: ingest_runs(job_key)·bid_notices(source, notice_id)·
// bid_revisions(bid_id, revision)·outbox(idempotency_key, on conflict do nothing).
export type IngestRunSource = "fixture" | "g2b";
export type IngestRunMode = "LIVE" | "FIXTURE" | "MOCK";
export type IngestTrigger = "SCHEDULED" | "MANUAL" | "DEMO";
// 04 §4 ingest_status. PARTIAL = 끝까지 처리했지만 일부 레코드를 격리했다.
export type IngestRunStatus = "RUNNING" | "SUCCEEDED" | "PARTIAL" | "FAILED";

export type IngestSummary = {
  created: number;
  changed: number;
  cancelled: number;
  skippedDuplicate: number;
  quarantined: number;
  retried: number;
};

export const EMPTY_INGEST_SUMMARY: Readonly<IngestSummary> = Object.freeze({
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
});

export type StartRunInput = {
  source: IngestRunSource;
  runMode: IngestRunMode;
  jobKey: string;
  trigger: IngestTrigger;
  batch: FixtureBatch | null;
  params: Record<string, unknown> | null;
};

/** 같은 jobKey 의 run 이 이미 있으면 새로 만들지 않고 그것을 돌려준다(재실행 멱등). */
export type StartedRun = {
  runId: string;
  status: IngestRunStatus;
  cursor: string | null;
  summary: IngestSummary;
};

export type IngestErrorInput = {
  sourceKey: string;
  errorCode: string;
  resultCode: string | null;
  redactedDetail: string;
};

export type SavedRevisionDecision = Exclude<ChangeDecision, { kind: "DUPLICATE" }>;
export type SaveRevisionInput = {
  decision: SavedRevisionDecision;
  rawPayload: Record<string, unknown>;
};
export type SavedRevision = { bidId: string; revisionId: string };

export type IngestionRepo = {
  startRun(input: StartRunInput): Promise<StartedRun>;
  findLatestRevision(source: BidSource, noticeId: string): Promise<StoredRevision | null>;
  /** bid_notices upsert + bid_revisions insert + outbox(event.idempotencyKey) 를 한 트랜잭션으로 */
  saveRevision(input: SaveRevisionInput): Promise<SavedRevision>;
  recordError(runId: string, error: IngestErrorInput): Promise<void>;
  saveCheckpoint(
    runId: string,
    checkpoint: { cursor: string | null; summary: IngestSummary },
  ): Promise<void>;
  finishRun(
    runId: string,
    result: { status: IngestRunStatus; summary: IngestSummary },
  ): Promise<void>;
};
