import "server-only";
import type { IngestCompleteness, PageCapture } from "./connector.model";
import type { FixtureBatch } from "./fixture.model";
import type { BidSource } from "./normalized-bid.model";
import type { ChangeDecision, StoredRevision } from "./revision";

// ── 수집 저장 포트. 수집 흐름(service)이 기대하는 저장 동작만 적는다 ──
// 구현은 ingestion.repo.ts(Supabase)와 시험용 ingestion.repo.memory.ts 다. 행 ↔ 포트 변환은 ingestion.store.ts(순수)에 둔다.
// 재시도에 안전해야 하므로 구현은 DB 유일 제약(04)에 기댄다: ingest_runs(job_key)·bid_notices(source, notice_id)·
// bid_revisions(bid_id, revision)·outbox(idempotency_key, on conflict do nothing).
export type IngestRunSource = "fixture" | "g2b" | "kwater" | "lh" | "kepco";
export type IngestWindowScope = { serviceKey?: string; operation?: string; partitionKey?: string };
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

export type StartRunInput = IngestWindowScope & {
  source: IngestRunSource;
  runMode: IngestRunMode;
  jobKey: string;
  trigger: IngestTrigger;
  batch: FixtureBatch | null;
  params: Record<string, unknown> | null;
  /** 수동 수집을 요청한 사용자(auth.users id). 일정·데모 실행은 없다 */
  requestedBy?: string | null;
  /** 수동 수집 요청의 Idempotency-Key(05) */
  idempotencyKey?: string | null;
  /** 수동 수집 요청이 미리 정한 run id(N8). 있으면 새 ingest_runs 행의 id 다. 같은 jobKey 의 기존 행은 그대로 쓴다 */
  runId?: string;
};

/** 같은 jobKey 의 run 이 이미 있으면 새로 만들지 않고 그것을 돌려준다(재실행 멱등). */
export type StartedRun = {
  runId: string;
  status: IngestRunStatus;
  cursor: string | null;
  summary: IngestSummary;
  /** 처음 시작할 때 저장한 params. 이어 가는 run 이 처음 정한 fixture anchor 를 다시 쓴다(5-B) */
  params: Record<string, unknown> | null;
  /** 이 run 이 지금까지 쓴 공공 API 호출 수(ingest_runs.quota_used). 이어 가는 g2b run 이 여기서부터 더 센다 */
  quotaUsed?: number;
  completeness?: IngestCompleteness;
  fetchedCount?: number;
};

/** source·trigger 가 같은 run 중 가장 최근 run 의 상태와 수집 창(C8 창 재사용) */
export type LatestRunWindow = {
  completeness?: IngestCompleteness;
  status: IngestRunStatus;
  /** params.window. 둘 다 ISO 시각이 아니면 null */
  window: { from: string; to: string } | null;
};

export type IngestErrorInput = {
  sourceKey: string;
  errorCode: string;
  resultCode: string | null;
  redactedDetail: string;
};

// 중복·이전 차수(STALE)는 저장하지 않는다.
export type SavedRevisionDecision = Exclude<ChangeDecision, { kind: "DUPLICATE" | "STALE" }>;
export type SaveRevisionInput = {
  decision: SavedRevisionDecision;
  rawPayload: Record<string, unknown>;
  /** 주면 그 id 로 저장한다(demo:reset 의 결정적 id). 없으면 DB 가 만든다(6-2) */
  ids?: { bidId?: string; revisionId?: string };
};
export type SavedRevision = {
  bidId: string;
  revisionId: string;
  /** 저장한 bid_revisions 행의 created_at(DB timestamptz 문자열). documents jobId 를 만든다(C1') */
  revisionCreatedAt: string;
};

export type IngestRunItemInput = {
  sourceRecordKey: string;
  payloadHash: string;
  payloadId: string | null;
  bidId?: string;
  revisionId?: string;
  outcome: "CREATED" | "CHANGED" | "CANCELLED" | "DUPLICATE" | "QUARANTINED";
  errorCode?: string;
};
export type IngestionRepo = {
  recordPayload?(runId: string, capture: PageCapture): Promise<string>;
  recordRunItem?(runId: string, item: IngestRunItemInput): Promise<boolean>;
  ensureRevisionProjection?(source: BidSource, noticeId: string): Promise<void>;
  startRun(input: StartRunInput): Promise<StartedRun>;
  findLatestRevision(source: BidSource, noticeId: string): Promise<StoredRevision | null>;
  /** source 의 SEED run 중 SUCCEEDED·PARTIAL 로 끝난 가장 최근(started_at) run 의 params.anchor. ISO 가 아니면 null */
  findLatestSeedAnchor(source: "fixture"): Promise<Date | null>;
  /**
   * source·trigger·service/partition 이 같은 SUCCEEDED + COMPLETE run 중 가장 최근(started_at)의 params.window.to. ISO 가 아니면 null.
   * 7-1: 일정 수집 창은 SCHEDULED run 만 잇는다. MANUAL 의 미래 창이 일정 수집을 건너뛰게 하지 않는다
   */
  findLatestRunWindowEnd(
    source: Exclude<IngestRunSource, "fixture">,
    trigger: "SCHEDULED",
    scope?: IngestWindowScope,
  ): Promise<Date | null>;
  /**
   * source·trigger 가 같은 run 중 가장 최근(started_at) run 의 상태와 params.window(상태와 무관, RUNNING·FAILED 포함). 없으면 null.
   * C8: FAILED 로 끝난 일정 run 의 창을 다시 써 재기동마다 새 24h 창을 열지 않는다(web/worker/ingest-queue.ts)
   */
  findLatestRunWindow(
    source: Exclude<IngestRunSource, "fixture">,
    trigger: "SCHEDULED",
    scope?: IngestWindowScope,
  ): Promise<LatestRunWindow | null>;
  /**
   * bid_notices upsert + bid_revisions insert + outbox(event.idempotencyKey) 를 한 트랜잭션으로.
   * 그 뒤 decision.bid.structuredQualifications 를 bid_structured_requirements 에 revision 단위로 쓴다(UNIQUE(revision_id, kind, seq) upsert)
   */
  saveRevision(input: SaveRevisionInput): Promise<SavedRevision>;
  recordError(runId: string, error: IngestErrorInput): Promise<void>;
  /** quotaUsed 는 공공 API 를 부른 run(g2b)만 준다. 주지 않으면 ingest_runs.quota_used 를 건드리지 않는다(fixture 는 0) */
  saveCheckpoint(
    runId: string,
    checkpoint: {
      cursor: string | null;
      summary: IngestSummary;
      quotaUsed?: number;
      completeness?: IngestCompleteness;
      fetchedCount?: number;
    },
  ): Promise<void>;
  finishRun(
    runId: string,
    result: {
      status: IngestRunStatus;
      summary: IngestSummary;
      quotaUsed?: number;
      completeness?: IngestCompleteness;
      fetchedCount?: number;
    },
  ): Promise<void>;
};
