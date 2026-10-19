import "server-only";

import type {
  IngestErrorInput,
  IngestionRepo,
  IngestRunStatus,
  IngestSummary,
  SaveRevisionInput,
  StartedRun,
  StartRunInput,
} from "./ingestion.repo";
import type { BidSource, NormalizedBid } from "./normalized-bid.model";
import type { BidEvent, FieldChange } from "./revision";

// 시험 전용 메모리 저장소. 수집 흐름 시험에서 IngestionRepo 자리에 꽂는다(실제 Supabase 는 부르지 않는다).
// 배럴(index.ts)에 넣지 않는다. 제품 코드는 이 파일을 import 하지 않는다.
//
// DB 의 유일 제약을 흉내 낸다(04 DB).
// - bid_notices: UNIQUE(source, notice_id) → bids 는 `${source}:${noticeId}` 로 한 행
// - bid_revisions: UNIQUE(bid_id, revision) → 같은 revision 을 두 번 넣으면 던진다
// - outbox_events: UNIQUE(idempotency_key) → on conflict do nothing(조용히 무시)
// - ingest_runs: UNIQUE(job_key) → 같은 jobKey 의 run 을 돌려준다

export type MemoryBid = {
  bidId: string;
  source: BidSource;
  noticeId: string;
  latestRevision: number;
  normalized: NormalizedBid;
};

export type MemoryRevision = {
  revisionId: string;
  bidId: string;
  revision: number;
  checksum: string;
  kind: SaveRevisionInput["decision"]["kind"];
  changes: FieldChange[];
  reanalyze: boolean;
  normalized: NormalizedBid;
  rawPayload: Record<string, unknown>;
};

export type MemoryOutboxEvent = BidEvent & { bidId: string; revisionId: string };

export type MemoryIngestError = IngestErrorInput & { runId: string };

export type MemoryCheckpoint = { runId: string; cursor: string | null; summary: IngestSummary };

export type MemoryFinish = { runId: string; status: IngestRunStatus; summary: IngestSummary };

export type MemoryRun = {
  runId: string;
  input: StartRunInput;
  status: IngestRunStatus;
  cursor: string | null;
  summary: IngestSummary;
};

export type MemoryIngestionState = {
  /** 키: `${source}:${noticeId}` */
  bids: Map<string, MemoryBid>;
  /** 넣은 순서 그대로 */
  revisions: MemoryRevision[];
  /** idempotencyKey 가 겹치는 이벤트는 들어오지 않는다 */
  outbox: MemoryOutboxEvent[];
  errors: MemoryIngestError[];
  /** 키: jobKey */
  runs: Map<string, MemoryRun>;
  /** saveCheckpoint 호출 기록(순서 그대로) */
  checkpoints: MemoryCheckpoint[];
  /** finishRun 호출 기록(순서 그대로) */
  finishes: MemoryFinish[];
};

export type MemoryIngestionRepo = IngestionRepo & { readonly state: MemoryIngestionState };

export const memoryBidKey = (source: string, noticeId: string): string => `${source}:${noticeId}`;

const zeroSummary = (): IngestSummary => ({
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
});

const toStartedRun = (run: MemoryRun): StartedRun => ({
  runId: run.runId,
  status: run.status,
  cursor: run.cursor,
  summary: { ...run.summary },
});

export function createMemoryIngestionRepo(): MemoryIngestionRepo {
  const state: MemoryIngestionState = {
    bids: new Map(),
    revisions: [],
    outbox: [],
    errors: [],
    runs: new Map(),
    checkpoints: [],
    finishes: [],
  };
  const counters = { run: 0, bid: 0, revision: 0 };

  const requireRun = (runId: string): MemoryRun => {
    const run = [...state.runs.values()].find((candidate) => candidate.runId === runId);
    if (!run) throw new Error(`메모리 저장소: 모르는 runId ${runId}`);
    return run;
  };

  return {
    state,

    async startRun(input) {
      const existing = state.runs.get(input.jobKey);
      if (existing) return toStartedRun(existing);
      counters.run += 1;
      const run: MemoryRun = {
        runId: `run-${counters.run}`,
        input: structuredClone(input),
        status: "RUNNING",
        cursor: null,
        summary: zeroSummary(),
      };
      state.runs.set(input.jobKey, run);
      return toStartedRun(run);
    },

    async findLatestRevision(source, noticeId) {
      const bid = state.bids.get(memoryBidKey(source, noticeId));
      if (!bid) return null;
      const latest = state.revisions.find(
        (revision) => revision.bidId === bid.bidId && revision.revision === bid.latestRevision,
      );
      if (!latest) return null;
      return {
        bidId: latest.bidId,
        revision: latest.revision,
        checksum: latest.checksum,
        normalized: structuredClone(latest.normalized),
      };
    },

    async saveRevision({ decision, rawPayload }) {
      const normalized = structuredClone(decision.bid);
      const key = memoryBidKey(normalized.source, normalized.noticeId);
      const existing = state.bids.get(key);
      const bidId =
        existing?.bidId ??
        (() => {
          counters.bid += 1;
          return `bid-${counters.bid}`;
        })();
      const taken = state.revisions.some(
        (revision) => revision.bidId === bidId && revision.revision === normalized.revision,
      );
      if (taken) {
        throw new Error(
          `메모리 저장소: bid_revisions(bid_id, revision) 유일 제약 위반 ${key} r${normalized.revision}`,
        );
      }
      counters.revision += 1;
      const revisionId = `rev-${counters.revision}`;
      state.revisions.push({
        revisionId,
        bidId,
        revision: normalized.revision,
        checksum: normalized.checksum,
        kind: decision.kind,
        changes: structuredClone(decision.changes),
        reanalyze: decision.reanalyze,
        normalized,
        rawPayload: structuredClone(rawPayload),
      });
      state.bids.set(key, {
        bidId,
        source: normalized.source,
        noticeId: normalized.noticeId,
        latestRevision: normalized.revision,
        normalized: structuredClone(normalized),
      });
      const duplicateEvent = state.outbox.some(
        (event) => event.idempotencyKey === decision.event.idempotencyKey,
      );
      if (!duplicateEvent) state.outbox.push({ ...decision.event, bidId, revisionId });
      return { bidId, revisionId };
    },

    async recordError(runId, error) {
      requireRun(runId);
      state.errors.push({ runId, ...error });
    },

    async saveCheckpoint(runId, checkpoint) {
      const run = requireRun(runId);
      run.cursor = checkpoint.cursor;
      run.summary = { ...checkpoint.summary };
      state.checkpoints.push({
        runId,
        cursor: checkpoint.cursor,
        summary: { ...checkpoint.summary },
      });
    },

    async finishRun(runId, result) {
      const run = requireRun(runId);
      run.status = result.status;
      run.summary = { ...result.summary };
      state.finishes.push({ runId, status: result.status, summary: { ...result.summary } });
    },
  };
}

/** 한 공고(source + noticeId)의 revision 들을 넣은 순서대로 돌려준다. 공고가 없으면 빈 목록. */
export const memoryRevisionsOf = (
  repo: MemoryIngestionRepo,
  source: BidSource,
  noticeId: string,
): MemoryRevision[] => {
  const bid = repo.state.bids.get(memoryBidKey(source, noticeId));
  return bid ? repo.state.revisions.filter((revision) => revision.bidId === bid.bidId) : [];
};

/** 한 공고(source + noticeId)의 outbox 이벤트를 넣은 순서대로 돌려준다. 공고가 없으면 빈 목록. */
export const memoryEventsOf = (
  repo: MemoryIngestionRepo,
  source: BidSource,
  noticeId: string,
): MemoryOutboxEvent[] => {
  const bid = repo.state.bids.get(memoryBidKey(source, noticeId));
  return bid ? repo.state.outbox.filter((event) => event.bidId === bid.bidId) : [];
};
