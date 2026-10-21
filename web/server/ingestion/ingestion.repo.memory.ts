import "server-only";
import { createHash } from "node:crypto";
import type { IngestCompleteness, PageCapture } from "./connector.model";
import type { IngestRunItemInput, IngestRunSource, IngestWindowScope } from "./ingestion.port";

import type {
  IngestErrorInput,
  IngestionRepo,
  IngestRunStatus,
  IngestSummary,
  LatestRunWindow,
  SaveRevisionInput,
  StartedRun,
  StartRunInput,
} from "./ingestion.repo";
import type { BidSource, NormalizedBid, StructuredRequirement } from "./normalized-bid.model";
import type { BidEvent, FieldChange } from "./revision";

// 시험 전용 메모리 저장소. 수집 흐름 시험에서 IngestionRepo 자리에 꽂는다(실제 Supabase 는 부르지 않는다).
// 배럴(index.ts)에 넣지 않는다. 제품 코드는 이 파일을 import 하지 않는다.
//
// DB 의 유일 제약을 흉내 낸다(04 DB).
// - bid_notices: UNIQUE(source, notice_id) → bids 는 `${source}:${noticeId}` 로 한 행
// - bid_revisions: UNIQUE(bid_id, revision) → 같은 revision 을 두 번 넣으면 던진다
// - outbox_events: UNIQUE(idempotency_key) → on conflict do nothing(조용히 무시)
// - ingest_runs: UNIQUE(job_key) → 같은 jobKey 의 run 을 돌려준다. params 는 처음 시작할 때 받은 값을 그대로 둔다
//   (이어 가는 run 이 처음 정한 fixture anchor 를 다시 쓰게, C3 계약 Stage 5-B)
// 계약 Stage 5-B 의 StartedRun.params·findLatestSeedAnchor 는 교차 타입으로 더해, 포트가 바뀌기 전에도 뒤에도 컴파일된다.
//
// saveRevision 은 RPC ingest_save_revision(C3 계약 6-1)의 거부 규칙을 흉내 낸다. 오류 메시지는 RPC 의 코드로 시작한다.
// - revision 1 인데 같은 (source, notice_id) 가 이미 있다 → INGEST_BID_EXISTS
// - revision > 1 인데 공고가 없다 → INGEST_BID_NOT_FOUND
// - ids.bidId 를 줬는데 저장된 bid 의 id 와 다르다 → INGEST_BID_ID_MISMATCH
// - 저장된 latest_revision 이 revision − 1 이 아니다 → INGEST_REVISION_CONFLICT
// ids(6-2)를 주면 그 id 를 쓰고, 없으면 bid-N·rev-N 을 만든다. findLatestRunWindowEnd(6-2, 7-1 에서 trigger 추가)도 교차 타입으로 더한다.
// revision 의 created_at(C1')은 저장 순번으로 정한다(memoryRevisionCreatedAt). 같은 순서로 저장하면 같은 값이다.

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
  /** bid_revisions.created_at 흉내(PostgREST timestamptz 모양) */
  createdAt: string;
};

export type MemoryOutboxEvent = BidEvent & { bidId: string; revisionId: string };

/** bid_structured_requirements 한 행 흉내. seq 는 structuredQualifications 의 index 다 */
export type MemoryStructuredRequirement = StructuredRequirement & {
  bidId: string;
  revisionId: string;
  seq: number;
};

export type MemoryIngestError = IngestErrorInput & { runId: string };

export type MemoryCheckpoint = { runId: string; cursor: string | null; summary: IngestSummary };

export type MemoryFinish = { runId: string; status: IngestRunStatus; summary: IngestSummary };

export type MemoryRun = {
  runId: string;
  input: StartRunInput;
  status: IngestRunStatus;
  cursor: string | null;
  summary: IngestSummary;
  /** ingest_runs.quota_used 흉내. checkpoint·finish 가 quotaUsed 를 줄 때만 바뀐다 */
  quotaUsed: number;
  completeness: IngestCompleteness;
  fetchedCount: number;
};

export type MemoryIngestionState = {
  payloads: (PageCapture & { id: string; runId: string; payloadHash: string })[];
  runItems: (IngestRunItemInput & { runId: string })[];
  /** 키: `${source}:${noticeId}` */
  bids: Map<string, MemoryBid>;
  /** 넣은 순서 그대로 */
  revisions: MemoryRevision[];
  /** idempotencyKey 가 겹치는 이벤트는 들어오지 않는다 */
  outbox: MemoryOutboxEvent[];
  /** 저장한 revision 의 구조화 자격 행(UNIQUE(revision_id, kind, seq) 흉내: 같은 revision 을 다시 쓰면 바꿔 끼운다) */
  structuredRequirements: MemoryStructuredRequirement[];
  errors: MemoryIngestError[];
  /** 키: jobKey */
  runs: Map<string, MemoryRun>;
  /** saveCheckpoint 호출 기록(순서 그대로) */
  checkpoints: MemoryCheckpoint[];
  /** finishRun 호출 기록(순서 그대로) */
  finishes: MemoryFinish[];
};

export type MemoryStartedRun = StartedRun & { params: Record<string, unknown> | null };

export type MemoryIngestionRepo = IngestionRepo & {
  readonly state: MemoryIngestionState;
  startRun(input: StartRunInput): Promise<MemoryStartedRun>;
  /** source 의 SEED run 중 SUCCEEDED·PARTIAL 로 끝난 가장 최근(시작 순서) run 의 params.anchor. ISO 가 아니면 null */
  findLatestSeedAnchor(source: "fixture"): Promise<Date | null>;
  /**
   * source·trigger·service/partition 이 같은 SUCCEEDED + COMPLETE run 중 가장 최근(시작 순서)의 params.window.to. ISO 가 아니면 null.
   * 7-1: 일정 수집 창은 SCHEDULED run 만 잇는다(MANUAL 의 미래 창이 일정 수집을 건너뛰게 하지 않는다)
   */
  findLatestRunWindowEnd(
    source: Exclude<IngestRunSource, "fixture">,
    trigger: "SCHEDULED",
    scope?: IngestWindowScope,
  ): Promise<Date | null>;
  /** source·trigger 가 같은 run 중 가장 최근(시작 순서) run 의 상태와 params.window(상태와 무관). 없으면 null(C8) */
  findLatestRunWindow(
    source: Exclude<IngestRunSource, "fixture">,
    trigger: "SCHEDULED",
    scope?: IngestWindowScope,
  ): Promise<LatestRunWindow | null>;
};

/** C3 계약 6-2 SaveRevisionInput.ids. 포트에 생기기 전에도 읽을 수 있게 따로 꺼낸다 */
export type MemorySaveIds = { bidId?: string; revisionId?: string };

const idsOf = (input: SaveRevisionInput): MemorySaveIds => {
  const ids: unknown = "ids" in input ? input.ids : undefined;
  if (typeof ids !== "object" || ids === null) return {};
  const pick = (key: "bidId" | "revisionId"): string | undefined => {
    const value: unknown = key in ids ? (ids as Record<string, unknown>)[key] : undefined;
    return typeof value === "string" ? value : undefined;
  };
  return { bidId: pick("bidId"), revisionId: pick("revisionId") };
};

export const memoryBidKey = (source: string, noticeId: string): string => `${source}:${noticeId}`;

const MEMORY_REVISION_CREATED_BASE_MS = Date.UTC(2026, 0, 1);

/**
 * n 번째로 저장한 revision 의 created_at. 기준 시각에서 n 초 뒤다.
 * PostgREST 가 timestamptz 를 돌려주는 모양(마이크로초 소수·"+00:00")으로 내, 큐 입구 검증이 그 형식을 받는지 함께 시험되게 한다.
 */
export const memoryRevisionCreatedAt = (sequence: number): string =>
  `${new Date(MEMORY_REVISION_CREATED_BASE_MS + sequence * 1000).toISOString().slice(0, 19)}.123456+00:00`;

const zeroSummary = (): IngestSummary => ({
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
});

const toStartedRun = (run: MemoryRun): MemoryStartedRun => ({
  runId: run.runId,
  status: run.status,
  cursor: run.cursor,
  summary: { ...run.summary },
  params: structuredClone(run.input.params),
  quotaUsed: run.quotaUsed,
  completeness: run.completeness,
  fetchedCount: run.fetchedCount,
});

// Date.prototype.toISOString() 형식만 받는다(서비스가 그 형식으로 쓴다).
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const isoDateOf = (value: unknown): Date | null =>
  typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value))
    ? new Date(value)
    : null;

const FINISHED_SEED_STATUSES: ReadonlySet<IngestRunStatus> = new Set(["SUCCEEDED", "PARTIAL"]);

// 수집 창 끝(params.window.to)은 ISO 8601(오프셋 포함)이면 받는다.
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const windowEndOf = (params: Record<string, unknown> | null): Date | null => {
  const window: unknown = params?.window;
  if (typeof window !== "object" || window === null || !("to" in window)) return null;
  const to: unknown = window.to;
  return typeof to === "string" && ISO_INSTANT.test(to) && !Number.isNaN(Date.parse(to))
    ? new Date(Date.parse(to))
    : null;
};

const isIsoInstant = (value: unknown): value is string =>
  typeof value === "string" && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value));

// C8: 창을 저장한 문자열 그대로 돌려준다(Supabase 저장소의 windowOfParams 와 같은 규칙).
const windowOf = (params: Record<string, unknown> | null): { from: string; to: string } | null => {
  const window: unknown = params?.window;
  if (typeof window !== "object" || window === null) return null;
  const from: unknown = "from" in window ? window.from : null;
  const to: unknown = "to" in window ? window.to : null;
  return isIsoInstant(from) && isIsoInstant(to) ? { from, to } : null;
};

export function createMemoryIngestionRepo(): MemoryIngestionRepo {
  const state: MemoryIngestionState = {
    payloads: [],
    runItems: [],
    bids: new Map(),
    revisions: [],
    outbox: [],
    structuredRequirements: [],
    errors: [],
    runs: new Map(),
    checkpoints: [],
    finishes: [],
  };
  // saved 는 ids 로 id 를 정해도 늘어난다(created_at 순번)
  const counters = { run: 0, bid: 0, revision: 0, saved: 0 };

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
        runId: input.runId ?? `run-${counters.run}`,
        input: structuredClone(input),
        status: "RUNNING",
        cursor: null,
        summary: zeroSummary(),
        quotaUsed: 0,
        completeness: input.serviceKey === undefined ? "COMPLETE" : "UNKNOWN",
        fetchedCount: 0,
      };
      state.runs.set(input.jobKey, run);
      return toStartedRun(run);
    },

    // runs 는 Map 이라 넣은 순서(= 시작 순서)를 지킨다. 같은 jobKey 를 다시 시작해도 순서는 처음 그대로다.
    async findLatestSeedAnchor(source) {
      const latest = [...state.runs.values()]
        .filter(
          (run) =>
            run.input.source === source &&
            run.input.batch === "SEED" &&
            FINISHED_SEED_STATUSES.has(run.status),
        )
        .at(-1);
      return latest ? isoDateOf(latest.input.params?.anchor) : null;
    },

    // trigger 는 7-1 의 포트에서 필수다. 포트가 바뀌기 전의 한 인자 호출도 컴파일되게 선택으로 받되, 주면 그 trigger 만 본다.
    async findLatestRunWindowEnd(
      source: Exclude<IngestRunSource, "fixture">,
      trigger?: "SCHEDULED",
      scope: IngestWindowScope = {},
    ) {
      const latest = [...state.runs.values()]
        .filter(
          (run) =>
            run.input.source === source &&
            (trigger === undefined || run.input.trigger === trigger) &&
            run.status === "SUCCEEDED" &&
            run.completeness === "COMPLETE" &&
            Object.entries(scope).every(
              ([key, value]) => run.input[key as keyof StartRunInput] === value,
            ),
        )
        .at(-1);
      return latest ? windowEndOf(latest.input.params) : null;
    },

    // C8: 상태와 상관없이 가장 최근에 시작한 run 이다(FAILED 창을 다시 쓰려고).
    async findLatestRunWindow(source, trigger, scope = {}) {
      const latest = [...state.runs.values()]
        .filter(
          (run) =>
            run.input.source === source &&
            run.input.trigger === trigger &&
            Object.entries(scope).every(
              ([key, value]) => run.input[key as keyof StartRunInput] === value,
            ),
        )
        .at(-1);
      return latest
        ? {
            status: latest.status,
            completeness: latest.completeness,
            window: windowOf(latest.input.params),
          }
        : null;
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

    async saveRevision(input) {
      const { decision, rawPayload } = input;
      const ids = idsOf(input);
      const normalized = structuredClone(decision.bid);
      const key = memoryBidKey(normalized.source, normalized.noticeId);
      const existing = state.bids.get(key);
      if (normalized.revision === 1 && existing) throw new Error(`INGEST_BID_EXISTS ${key}`);
      if (normalized.revision > 1 && !existing) throw new Error(`INGEST_BID_NOT_FOUND ${key}`);
      if (existing && ids.bidId !== undefined && ids.bidId !== existing.bidId) {
        throw new Error(`INGEST_BID_ID_MISMATCH ${key}`);
      }
      if (existing && existing.latestRevision !== normalized.revision - 1) {
        throw new Error(`INGEST_REVISION_CONFLICT ${key} r${normalized.revision}`);
      }
      const bidId =
        existing?.bidId ??
        ids.bidId ??
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
      const revisionId =
        ids.revisionId ??
        (() => {
          counters.revision += 1;
          return `rev-${counters.revision}`;
        })();
      counters.saved += 1;
      const createdAt = memoryRevisionCreatedAt(counters.saved);
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
        createdAt,
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
      state.structuredRequirements = [
        ...state.structuredRequirements.filter((row) => row.revisionId !== revisionId),
        ...normalized.structuredQualifications.map((row, seq) => ({
          ...structuredClone(row),
          bidId,
          revisionId,
          seq,
        })),
      ];
      return { bidId, revisionId, revisionCreatedAt: createdAt };
    },

    async recordPayload(runId, capture) {
      requireRun(runId);
      const payloadHash = createHash("sha256").update(capture.sanitizedPayload).digest("hex");
      const prior = state.payloads.find(
        (row) =>
          row.runId === runId &&
          row.serviceKey === capture.serviceKey &&
          row.operation === capture.operation &&
          row.partitionKey === capture.partitionKey &&
          row.payloadHash === payloadHash,
      );
      if (prior) return prior.id;
      const id = `payload-${state.payloads.length + 1}`;
      state.payloads.push({ ...structuredClone(capture), id, runId, payloadHash });
      return id;
    },

    async recordRunItem(runId, item) {
      requireRun(runId);
      if (
        state.runItems.some(
          (row) =>
            row.runId === runId &&
            row.sourceRecordKey === item.sourceRecordKey &&
            row.payloadHash === item.payloadHash,
        )
      )
        return false;
      state.runItems.push({ ...structuredClone(item), runId });
      return true;
    },

    async recordError(runId, error) {
      requireRun(runId);
      state.errors.push({ runId, ...error });
    },

    async saveCheckpoint(runId, checkpoint) {
      const run = requireRun(runId);
      run.cursor = checkpoint.cursor;
      run.summary = { ...checkpoint.summary };
      if (checkpoint.quotaUsed !== undefined) run.quotaUsed = checkpoint.quotaUsed;
      if (checkpoint.completeness !== undefined) run.completeness = checkpoint.completeness;
      if (checkpoint.fetchedCount !== undefined) run.fetchedCount = checkpoint.fetchedCount;
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
      if (result.quotaUsed !== undefined) run.quotaUsed = result.quotaUsed;
      if (result.completeness !== undefined) run.completeness = result.completeness;
      if (result.fetchedCount !== undefined) run.fetchedCount = result.fetchedCount;
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
