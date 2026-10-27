import { randomUUID } from "node:crypto";
import { DelayedError, Queue, Worker } from "bullmq";
import type IORedis from "ioredis";
import {
  createParseClient,
  readParseConfig,
  type GatewayFailure,
  type ParseClient,
} from "@/server/analysis";
import {
  RECORDABLE_DOWNLOAD_ERROR_CODES,
  createDocumentCandidateFinder,
  createDocumentProcessingRepo,
  readDocumentsSettings,
  readStorageSettings,
  scopeSkipReasonOf,
  selectDocuments,
  toParsedDocumentObject,
  type ClaimResult,
  type ClaimedDocument,
  type DocumentProcessingRepo,
  type DocumentsSettings,
  type RecordableDownloadErrorCode,
} from "@/server/documents";
import {
  DOCUMENTS_JOB_NAME,
  DOCUMENTS_QUEUE,
  createG2bAttachmentFetcher,
  createPendingDocumentFinder,
  detectDocumentFormat,
  documentsJobDataSchema,
  toDocumentsJobId,
  type AttachmentFetcher,
  type DocumentFormat,
  type DownloadErrorCode,
} from "@/server/ingestion";
import { getSupabaseAdmin } from "@/server/supabase";
import { createDocumentStorage } from "@/worker/document-storage";
import { startDocumentsReconciler } from "@/worker/documents-reconcile";
import { errorNameOf } from "@/worker/error-name";
import { readRunMode } from "@/worker/ingest-queue";
import { createWorkerStorageClient } from "@/worker/storage-client";

// ── documents job 소비자(07 "documents 큐 소비자 계약", 2026-10-27 실공고 분석 완성) ──
// revision 하나의 첨부를 문서마다: 리스 → 나라장터에서 내려받기 → 원본 Storage 확정 → gateway /parse → 텍스트 Storage 확정.
// - 처리 범위: live 의 실제 공고(is_demo=false), 최신 revision, 접수 중(OPEN·AMENDED), 마감 전. 공고마다 파서 형식(pdf·hwp·hwpx)
//   첨부를 우선순위(공고서·제안요청서·과업지시서 먼저) 상위 DOCUMENTS_MAX_PER_BID 건만. 그 밖의 첨부는 받지 않고 PENDING 으로 둔다.
// - 리스: 문서마다 DB 리스(claim_document_processing)를 잡고 단계마다 다시 잡아 늘린다. 다른 시도가 잡고 있으면(BUSY)
//   그 리스가 끝나는 시각으로 job 을 미룬다. 리스를 잃으면 그 문서는 쓰지 않고 넘긴다.
// - 실패 격리: 문서 하나의 실패는 그 문서에만 남기고 다음 문서를 계속 처리한다.
// - 재시도: 나라장터 일시 장애(TIMEOUT·HTTP_5XX)와 파서 시간 초과(FAILED·PARSER_ERROR)는 BullMQ 재시도(attempts 3, 지수 백오프)에
//   맡기고, 마지막 시도면 FAILED 로 남긴다. 문서 탓인 결과(UNSUPPORTED 전부, FAILED·CORRUPTED 등)는 다시 부르지 않고 바로 남긴다.
//   Storage·gateway·파서 미설정처럼 우리 쪽이 준비되지 않은 경우는 시도를 쓰지 않고 10분씩 미룬다(최대 12번). 그 뒤에는
//   PENDING 으로 두고 job 을 끝낸다(복구 회차가 jobId 보존 1일 뒤 다시 넣는다).
// - 로그: 문서 id·결과 코드만 남긴다. 첨부 이름·URL·본문은 싣지 않는다.

type Env = Record<string, string | undefined>;
export type Closable = { close(): Promise<void> };
type DocumentStorage = ReturnType<typeof createDocumentStorage>;

export type DocumentsJobDeps = {
  repo: DocumentProcessingRepo;
  fetcher: AttachmentFetcher;
  storage: Pick<DocumentStorage, "uploadImmutable" | "readRaw">;
  parser: Pick<ParseClient, "parse">;
  /** 나라장터 요청 직전에 부른다. 프로세스 안 모든 job 이 같은 간격을 지킨다 */
  pace: () => Promise<void>;
  settings: Pick<DocumentsSettings, "maxPerBid" | "leaseSeconds">;
  /** 처리할 공고의 is_demo(07 실행 모드 범위). documents 소비자는 live 에서만 돌아 false 다 */
  expectDemo: boolean;
  now: () => Date;
  newAttemptId: () => string;
  log: (line: string) => void;
};

/** BullMQ Job 에서 쓰는 부분 */
export type DocumentsJobLike = {
  id?: string;
  name: string;
  data: unknown;
  attemptsMade: number;
  attemptsStarted: number;
  opts: { attempts?: number };
  moveToDelayed(timestamp: number, token?: string): Promise<void>;
};

/** 우리 쪽(Storage·gateway·파서)이 준비되지 않았을 때 다시 볼 때까지 */
export const DOCUMENTS_DEFER_MS = 10 * 60_000;
/** 미루기 상한(10분 × 12 = 약 2시간). gateway 재배포·파서 배포를 기다리되 끝없이 돌지 않게 한다 */
export const DOCUMENTS_MAX_DEFERRALS = 12;
/** BUSY 로 미룰 때 최소 간격(리스 끝 시각이 이미 지났어도 바로 다시 돌지 않게) */
const BUSY_MIN_DELAY_MS = 5_000;

const PARSER_FORMATS: ReadonlySet<DocumentFormat> = new Set(["PDF", "HWP", "HWPX"]);
const TRANSIENT_DOWNLOAD: ReadonlySet<RecordableDownloadErrorCode> = new Set([
  "TIMEOUT",
  "HTTP_5XX",
]);
const PARSER_NOT_CONFIGURED = "PARSER_NOT_CONFIGURED";
const encoder = new TextEncoder();

type DocumentOutcome =
  | "PARSED"
  | "PARTIAL"
  | "PARSE_FAILED"
  | "UNSUPPORTED"
  | "DOWNLOAD_FAILED"
  | "ALREADY_DONE"
  | "MISSING"
  | "BUSY"
  | "RETRY"
  | "DEFERRED";

export type DocumentResult = {
  documentId: string;
  outcome: DocumentOutcome;
  /** 사유 코드(다운로드·파싱 오류 코드, gateway 실패 종류 등). 값·URL 은 싣지 않는다 */
  detail?: string;
  /** BUSY 일 때 다른 시도의 리스가 끝나는 시각(epoch ms) */
  until?: number;
};

export type DocumentsJobSummary =
  { status: "SKIPPED"; reason: string } | { status: "DONE"; documents: DocumentResult[] };

/** 정해 둔 코드만 그대로 쓰고, 나머지는 오류 이름으로 줄인다(message 에 값이 섞일 수 있다) */
const codeOf = (error: unknown): string =>
  error instanceof Error && /^[a-z][a-z_]{2,60}$/.test(error.message)
    ? error.message
    : errorNameOf(error);

/** 다운로드 사유를 화면·DB 가 받는 일곱 값으로 맞춘다. NOT_FOUND(fixture 전용)는 4xx 로 본다 */
const recordableOf = (code: DownloadErrorCode): RecordableDownloadErrorCode =>
  RECORDABLE_DOWNLOAD_ERROR_CODES.find((candidate) => candidate === code) ?? "HTTP_4XX";

/** gateway 가 요청을 받고 거절했거나 계약과 다른 응답을 줬다. 같은 바이트로 다시 불러도 같다 */
const isPermanentParseFailure = (failure: GatewayFailure): boolean =>
  failure.kind === "INVALID_RESPONSE" ||
  (failure.kind === "HTTP_ERROR" && failure.httpStatus >= 400 && failure.httpStatus < 500);

const failureCodeOf = (failure: GatewayFailure): string =>
  failure.kind === "HTTP_ERROR" ? `GATEWAY_HTTP_${failure.httpStatus}` : `GATEWAY_${failure.kind}`;

const needsWork = (document: { downloadStatus: string; parseStatus: string | null }): boolean =>
  document.downloadStatus === "PENDING" ||
  (document.downloadStatus === "OK" && document.parseStatus === "PENDING");

/** 리스를 못 잡았을 때의 결과. 잡았으면 null */
function notClaimed(documentId: string, claim: ClaimResult): DocumentResult | null {
  if (claim.claimed) return null;
  if (claim.reason === "BUSY")
    return { documentId, outcome: "BUSY", until: Date.parse(claim.leaseUntil) };
  return { documentId, outcome: claim.reason === "DONE" ? "ALREADY_DONE" : "MISSING" };
}

type Attempt = { attemptId: string; finalAttempt: boolean };

async function processClaimed(
  document: ClaimedDocument,
  attempt: Attempt,
  deps: DocumentsJobDeps,
): Promise<DocumentResult> {
  const { attemptId, finalAttempt } = attempt;
  const documentId = document.id;
  const extend = async () =>
    notClaimed(
      documentId,
      await deps.repo.claim(documentId, attemptId, deps.settings.leaseSeconds),
    );
  const release = () => deps.repo.release(documentId, attemptId);

  // 1. 원본: 처음이면 나라장터에서 받아 Storage 에 확정하고, 이미 확정됐으면 Storage 에서 다시 읽는다(sha256 확인).
  let raw: { bytes: Uint8Array; sha256: string };
  if (document.downloadStatus === "PENDING") {
    await deps.pace();
    const fetched = await deps.fetcher.fetch({ name: document.name, url: document.originalUrl });
    if (fetched.status === "FAILED") {
      const code = recordableOf(fetched.errorCode);
      if (TRANSIENT_DOWNLOAD.has(code) && !finalAttempt) {
        await release();
        return { documentId, outcome: "RETRY", detail: code };
      }
      await deps.repo.failDownload({ documentId, attemptId, errorCode: code, message: code });
      return { documentId, outcome: "DOWNLOAD_FAILED", detail: code };
    }
    const lost = await extend();
    if (lost !== null) return lost;
    await deps.storage.uploadImmutable({
      kind: "raw",
      documentId,
      bidId: document.bidId,
      revisionId: document.revisionId,
      bytes: fetched.bytes,
    });
    raw = { bytes: fetched.bytes, sha256: fetched.sha256 };
  } else {
    if (document.storageBucket === null || document.objectKey === null || document.sha256 === null)
      throw new Error("documents_raw_missing");
    const bytes = await deps.storage.readRaw({
      bucket: document.storageBucket,
      path: document.objectKey,
      sha256: document.sha256,
    });
    raw = { bytes, sha256: document.sha256 };
  }

  // 2. 파서 범위 밖 형식(zip·xlsx·doc 등)은 gateway 에 보내지 않고 UNSUPPORTED 로 끝낸다(03 §10.5).
  const format = detectDocumentFormat(raw.bytes);
  if (!PARSER_FORMATS.has(format)) {
    await deps.repo.failParse({
      documentId,
      attemptId,
      status: "UNSUPPORTED",
      errorCode: "UNSUPPORTED_FORMAT",
      parserId: "none",
      message: `FORMAT_${format}`,
    });
    return { documentId, outcome: "UNSUPPORTED", detail: `FORMAT_${format}` };
  }

  // 3. 파싱. gateway 를 못 쓰면(접속·timeout·5xx·breaker) 기록하지 않고 미룬다.
  const lostBeforeParse = await extend();
  if (lostBeforeParse !== null) return lostBeforeParse;
  const parsed = await deps.parser.parse({ requestId: attemptId, bytes: raw.bytes });
  if (!parsed.ok) {
    const detail = failureCodeOf(parsed.failure);
    if (!isPermanentParseFailure(parsed.failure)) {
      await release();
      return { documentId, outcome: "DEFERRED", detail };
    }
    await deps.repo.failParse({
      documentId,
      attemptId,
      status: "FAILED",
      errorCode: "PARSER_ERROR",
      parserId: "",
      message: detail,
    });
    return { documentId, outcome: "PARSE_FAILED", detail };
  }
  const result = parsed.value;
  if (result.status === "UNSUPPORTED" || result.status === "FAILED") {
    // 파서 어댑터가 아직 없는 gateway 다. 문서 탓이 아니므로 UNSUPPORTED 로 굳히지 않고 파서 배포를 기다린다.
    if (result.warnings.some((warning) => warning.startsWith(PARSER_NOT_CONFIGURED))) {
      await release();
      return { documentId, outcome: "DEFERRED", detail: PARSER_NOT_CONFIGURED };
    }
    const errorCode = result.errorCode ?? "PARSER_ERROR";
    // 파서 시간 초과·내부 오류(FAILED·PARSER_ERROR)만 다시 해 볼 만하다. 마지막 시도가 아니면 기록하지 않고 재시도에 맡긴다.
    if (result.status === "FAILED" && errorCode === "PARSER_ERROR" && !finalAttempt) {
      await release();
      return { documentId, outcome: "RETRY", detail: errorCode };
    }
    await deps.repo.failParse({
      documentId,
      attemptId,
      status: result.status,
      errorCode,
      parserId: result.parserId,
      message: errorCode,
    });
    return {
      documentId,
      outcome: result.status === "UNSUPPORTED" ? "UNSUPPORTED" : "PARSE_FAILED",
      detail: errorCode,
    };
  }
  // 성공이라면서 글자가 없으면 분석에 넣을 것이 없다. 빈 텍스트를 PARSED 로 저장하지 않는다.
  if (result.text.trim() === "") {
    await deps.repo.failParse({
      documentId,
      attemptId,
      status: "FAILED",
      errorCode: "PARSER_ERROR",
      parserId: result.parserId,
      message: "EMPTY_TEXT",
    });
    return { documentId, outcome: "PARSE_FAILED", detail: "EMPTY_TEXT" };
  }

  // 4. 텍스트 객체 확정(finish_document_storage 가 parse_status·parser_id·page_count 를 쓴다).
  const lostBeforeSave = await extend();
  if (lostBeforeSave !== null) return lostBeforeSave;
  const object = toParsedDocumentObject({
    documentId,
    rawSha256: raw.sha256,
    parse: {
      status: result.status,
      format: result.format,
      parserId: result.parserId,
      text: result.text,
      pages: result.pages,
      blocks: result.blocks,
      quality: result.quality,
      warnings: result.warnings,
    },
  });
  await deps.storage.uploadImmutable({
    kind: "parsed",
    documentId,
    bidId: document.bidId,
    revisionId: document.revisionId,
    bytes: encoder.encode(JSON.stringify(object)),
    rawSha256: raw.sha256,
    parserId: result.parserId,
    parseStatus: result.status,
    // HWP·HWPX 는 쪽 구분이 없어 pages 가 비었다. 쪽 수를 0 으로 적지 않고 모름(null)으로 둔다.
    pageCount: result.pages.length > 0 ? result.pages.length : null,
    ...(result.quality === null ? {} : { parseQuality: result.quality }),
  });
  await release();
  return { documentId, outcome: result.status };
}

async function processDocument(
  documentId: string,
  attempt: Attempt,
  deps: DocumentsJobDeps,
): Promise<DocumentResult> {
  try {
    const claim = await deps.repo.claim(documentId, attempt.attemptId, deps.settings.leaseSeconds);
    if (!claim.claimed) return notClaimed(documentId, claim) ?? { documentId, outcome: "MISSING" };
    try {
      return await processClaimed(claim.document, attempt, deps);
    } catch (error) {
      // Storage·DB 오류. 리스를 풀어 다음 시도가 바로 잡게 한다(푸는 것도 실패하면 리스 만료를 기다린다).
      await deps.repo.release(documentId, attempt.attemptId).catch(() => false);
      return { documentId, outcome: "DEFERRED", detail: codeOf(error) };
    }
  } catch (error) {
    return { documentId, outcome: "DEFERRED", detail: codeOf(error) };
  }
}

/**
 * BullMQ processor. 처리할 것이 없거나 범위 밖이면 SKIPPED 로 끝낸다(07: 행이 없으면 no-op, 옛 jobId 는 no-op).
 * 나라장터 일시 장애·파서 시간 초과가 남으면 던져 BullMQ 재시도에 맡기고, BUSY·미룸이 남으면 job 을 그 시각으로 옮긴다(시도 횟수를 쓰지 않는다).
 */
export function createDocumentsProcessor(
  deps: DocumentsJobDeps,
): (job: DocumentsJobLike, token?: string) => Promise<DocumentsJobSummary> {
  const skip = (job: DocumentsJobLike, reason: string): DocumentsJobSummary => {
    deps.log(JSON.stringify({ event: "documents.job.skipped", jobId: job.id ?? null, reason }));
    return { status: "SKIPPED", reason };
  };

  return async (job, token) => {
    const data = documentsJobDataSchema.safeParse(job.data);
    if (job.name !== DOCUMENTS_JOB_NAME || !data.success) return skip(job, "INVALID_JOB");
    if (job.id !== toDocumentsJobId(data.data)) return skip(job, "STALE_JOB");
    const revision = await deps.repo.loadRevision(data.data);
    if (revision === null) return skip(job, "NO_REVISION");
    // demo:reset 등으로 같은 id 의 revision 이 다시 만들어졌다. 그 revision 의 job 은 따로 들어온다.
    const currentJobId = toDocumentsJobId({
      revisionId: revision.revisionId,
      revisionCreatedAt: revision.createdAt,
    });
    if (currentJobId !== job.id) return skip(job, "STALE_JOB");
    const outOfScope = scopeSkipReasonOf(
      revision.notice,
      revision.revision,
      deps.expectDemo,
      deps.now(),
    );
    if (outOfScope !== null) return skip(job, outOfScope);

    const targets = selectDocuments(revision.documents, deps.settings.maxPerBid).filter(needsWork);
    const attempt: Attempt = {
      attemptId: deps.newAttemptId(),
      finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
    };
    const documents: DocumentResult[] = [];
    for (const target of targets) documents.push(await processDocument(target.id, attempt, deps));

    const deferralsUsed = Math.max(0, job.attemptsStarted - 1 - job.attemptsMade);
    deps.log(
      JSON.stringify({
        event: "documents.job",
        jobId: job.id ?? null,
        revisionId: revision.revisionId,
        attemptsMade: job.attemptsMade,
        deferralsUsed,
        documents,
      }),
    );
    if (documents.some((document) => document.outcome === "RETRY"))
      throw new Error("documents_retry");

    const now = deps.now().getTime();
    const resumeAt = documents.flatMap((document) =>
      document.outcome === "BUSY"
        ? [Math.max(document.until ?? now, now + BUSY_MIN_DELAY_MS)]
        : document.outcome === "DEFERRED"
          ? [now + DOCUMENTS_DEFER_MS]
          : [],
    );
    if (resumeAt.length > 0) {
      if (deferralsUsed < DOCUMENTS_MAX_DEFERRALS) {
        await job.moveToDelayed(Math.min(...resumeAt), token);
        throw new DelayedError();
      }
      // 상한까지 미뤘다. 남은 문서는 PENDING 그대로라 복구 회차가 jobId 보존(1일) 뒤 다시 넣는다.
      deps.log(
        JSON.stringify({ event: "documents.job.gave_up", jobId: job.id ?? null, deferralsUsed }),
      );
    }
    return { status: "DONE", documents };
  };
}

/**
 * 나라장터 요청 간격. 자리를 먼저 예약하고 기다려서, 동시에 부른 job 들도 intervalMs 씩 줄을 선다.
 * 리다이렉트는 같은 요청의 일부로 본다(최대 3회, 허용 목록 안).
 */
export function createPacer(
  intervalMs: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): () => Promise<void> {
  const now = deps.now ?? Date.now;
  const sleep =
    deps.sleep ??
    ((ms: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      }));
  let nextSlot = 0;
  return async () => {
    const current = now();
    const slot = Math.max(current, nextSlot);
    nextSlot = slot + intervalMs;
    if (slot > current) await sleep(slot - current);
  };
}

const consoleLog = (line: string): void => {
  console.log(line);
};

/**
 * documents 등록(전체 worker·documents 전용 worker).
 * - live: documents job 소비자 + 처리 범위 복구 회차(document_processing_candidates, 회차당 DOCUMENTS_ROUND_MAX_REVISIONS).
 * - mock·fixture: 소비자 없이 예전 복구 회차만(데모 공고의 PENDING 행을 큐에 넣기만 한다). 데모 첨부를 처리하면
 *   attachmentsIncomplete 가 붙어 골든(94/72/68)이 바뀌므로 처리하지 않는다.
 * 1단계에서 실행 모드·설정을 읽는다(틀리면 키 이름만 담아 Redis 연결 전에 멈춘다).
 */
export const createDocumentsWorkerRegistration =
  (options: { log?: (line: string) => void } = {}) =>
  async (rawEnv: Env): Promise<(connection: IORedis) => Promise<Closable>> => {
    const log = options.log ?? consoleLog;
    const runMode = readRunMode(rawEnv);
    if (runMode !== "live") {
      return async (connection) => {
        const queue = new Queue(DOCUMENTS_QUEUE, { connection });
        queue.on("error", (error) => {
          log(JSON.stringify({ event: "documents.queue.error", errorName: errorNameOf(error) }));
        });
        const reconciler = startDocumentsReconciler({
          finder: createPendingDocumentFinder(getSupabaseAdmin()),
          queue,
          isDemo: true,
          log,
        });
        return {
          async close() {
            await reconciler.stop();
            await queue.close();
          },
        };
      };
    }
    const settings = readDocumentsSettings(rawEnv);
    const parseConfig = readParseConfig(rawEnv);
    const storageSettings = readStorageSettings(rawEnv);
    return async (connection) => {
      const admin = getSupabaseAdmin();
      const storage = createDocumentStorage(createWorkerStorageClient(rawEnv), storageSettings);
      const worker = new Worker(
        DOCUMENTS_QUEUE,
        createDocumentsProcessor({
          repo: createDocumentProcessingRepo(admin),
          fetcher: createG2bAttachmentFetcher(),
          storage,
          parser: createParseClient(parseConfig),
          pace: createPacer(settings.fetchIntervalMs),
          settings,
          expectDemo: false,
          now: () => new Date(),
          newAttemptId: randomUUID,
          log,
        }),
        { connection, concurrency: settings.concurrency },
      );
      worker.on("error", (error) => {
        log(JSON.stringify({ event: "documents.worker.error", errorName: errorNameOf(error) }));
      });
      const queue = new Queue(DOCUMENTS_QUEUE, { connection });
      queue.on("error", (error) => {
        log(JSON.stringify({ event: "documents.queue.error", errorName: errorNameOf(error) }));
      });
      const reconciler = startDocumentsReconciler({
        finder: createDocumentCandidateFinder(admin, { maxPerBid: settings.maxPerBid }),
        queue,
        isDemo: false,
        batchLimit: settings.roundMaxRevisions,
        log,
      });
      log(
        JSON.stringify({
          event: "documents.enabled",
          maxPerBid: settings.maxPerBid,
          roundMaxRevisions: settings.roundMaxRevisions,
          fetchIntervalMs: settings.fetchIntervalMs,
          concurrency: settings.concurrency,
          leaseSeconds: settings.leaseSeconds,
        }),
      );
      // 복구 회차 → Worker(진행 중 job 을 기다린다) → 큐 순서로 닫는다. 앞이 던져도 뒤를 닫는다.
      return {
        async close() {
          try {
            await reconciler.stop();
            await worker.close();
          } finally {
            await queue.close();
          }
        },
      };
    };
  };
