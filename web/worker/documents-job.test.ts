import { createHash } from "node:crypto";
import { DelayedError } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayResult, ParseResponse } from "@/server/analysis";
import {
  parsedDocumentSchema,
  type ClaimResult,
  type DocumentProcessingRepo,
  type ProcessingRevision,
} from "@/server/documents";
import {
  DOCUMENTS_JOB_NAME,
  toDocumentsJobId,
  type AttachmentFetchResult,
} from "@/server/ingestion";
import {
  DOCUMENTS_DEFER_MS,
  createDocumentsProcessor,
  type DocumentsJobDeps,
  type DocumentsJobLike,
} from "@/worker/documents-job";

// 가짜 DB(리스 규칙은 20261027000500 의 SQL 과 같은 뜻으로 흉내 낸다)·가짜 Storage·가짜 gateway 로
// 문서 상태 전이(성공·다운로드 실패·파싱 실패·리스 만료 재처리)를 본다. SQL 자체는 scripts/database.test.mjs 가 본다.

const BID = "b1d00000-0000-4000-8000-000000000001";
const REVISION = "be500000-0000-4000-8000-000000000001";
const CREATED_AT = "2026-10-27T01:02:03.456789+00:00";
const NOW = Date.parse("2026-10-27T03:00:00.000Z");
const DOC_RFP = "d0c00000-0000-4000-8000-000000000001";
const DOC_NOTICE = "d0c00000-0000-4000-8000-000000000002";
const DOC_FORM = "d0c00000-0000-4000-8000-000000000003";
const DOC_SHEET = "d0c00000-0000-4000-8000-000000000004";
const URL_OF = (id: string) =>
  `https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?f=${id}`;
const PDF = new TextEncoder().encode("%PDF-1.7\n제안요청서 본문");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

type Doc = {
  id: string;
  name: string;
  downloadStatus: "PENDING" | "OK" | "FAILED";
  downloadErrorCode: string | null;
  parseStatus: string | null;
  parseErrorCode: string | null;
  parserId: string | null;
  sha256: string | null;
  objectKey: string | null;
  textKey: string | null;
  attemptId: string | null;
  leaseUntil: number | null;
};

const doc = (id: string, name: string): Doc => ({
  id,
  name,
  downloadStatus: "PENDING",
  downloadErrorCode: null,
  parseStatus: null,
  parseErrorCode: null,
  parserId: null,
  sha256: null,
  objectKey: null,
  textKey: null,
  attemptId: null,
  leaseUntil: null,
});

let clock = NOW;
let docs: Map<string, Doc>;
let objects: Map<string, Uint8Array>;
let fetched: string[];
let parsedCalls: number;
let attemptSeq = 0;

const pendingWork = (d: Doc) =>
  d.downloadStatus === "PENDING" || (d.downloadStatus === "OK" && d.parseStatus === "PENDING");

const repo: DocumentProcessingRepo = {
  async loadRevision(): Promise<ProcessingRevision> {
    return {
      bidId: BID,
      revisionId: REVISION,
      revision: 1,
      createdAt: CREATED_AT,
      notice: {
        isDemo: false,
        status: "OPEN",
        deadlineAt: "2026-11-01T00:00:00Z",
        latestRevision: 1,
      },
      documents: [...docs.values()].map((d) => ({
        id: d.id,
        name: d.name,
        downloadStatus: d.downloadStatus,
        parseStatus: d.parseStatus,
      })),
    };
  },
  async claim(id, attemptId, leaseSeconds): Promise<ClaimResult> {
    const d = docs.get(id);
    if (d === undefined) return { claimed: false, reason: "MISSING" };
    if (!pendingWork(d)) return { claimed: false, reason: "DONE" };
    if (d.leaseUntil !== null && d.leaseUntil > clock && d.attemptId !== attemptId)
      return { claimed: false, reason: "BUSY", leaseUntil: new Date(d.leaseUntil).toISOString() };
    d.attemptId = attemptId;
    d.leaseUntil = clock + leaseSeconds * 1000;
    return {
      claimed: true,
      leaseUntil: new Date(d.leaseUntil).toISOString(),
      document: {
        id: d.id,
        bidId: BID,
        revisionId: REVISION,
        name: d.name,
        originalUrl: URL_OF(d.id),
        downloadStatus: d.downloadStatus === "OK" ? "OK" : "PENDING",
        parseStatus: d.parseStatus,
        format: null,
        sha256: d.sha256,
        storageBucket: d.objectKey === null ? null : "bid-documents",
        objectKey: d.objectKey,
      },
    };
  },
  async failDownload({ documentId, attemptId, errorCode }) {
    const d = docs.get(documentId);
    if (d?.attemptId !== attemptId || d.downloadStatus !== "PENDING") return false;
    Object.assign(d, { downloadStatus: "FAILED", downloadErrorCode: errorCode });
    Object.assign(d, { attemptId: null, leaseUntil: null });
    return true;
  },
  async failParse({ documentId, attemptId, status, errorCode, parserId }) {
    const d = docs.get(documentId);
    if (d?.attemptId !== attemptId || d.downloadStatus !== "OK" || d.parseStatus !== "PENDING")
      return false;
    Object.assign(d, { parseStatus: status, parseErrorCode: errorCode, parserId });
    Object.assign(d, { attemptId: null, leaseUntil: null });
    return true;
  },
  async release(documentId, attemptId) {
    const d = docs.get(documentId);
    if (d?.attemptId !== attemptId) return false;
    Object.assign(d, { attemptId: null, leaseUntil: null });
    return true;
  },
};

// finish_document_storage 와 같은 전이: raw → 다운로드 OK·파싱 PENDING, parsed → 파싱 상태·텍스트 키
const storage: DocumentsJobDeps["storage"] = {
  async uploadImmutable(input) {
    const d = docs.get(input.documentId);
    if (d === undefined) throw new Error("storage_document_missing");
    const key = `${input.kind}/${input.documentId}/${sha(input.bytes)}`;
    objects.set(key, input.bytes);
    if (input.kind === "raw")
      Object.assign(d, {
        downloadStatus: "OK",
        parseStatus: "PENDING",
        sha256: sha(input.bytes),
        objectKey: key,
      });
    else
      Object.assign(d, { parseStatus: input.parseStatus, parserId: input.parserId, textKey: key });
    return {
      id: key,
      bucket: "b",
      path: key,
      sha256: sha(input.bytes),
      sizeBytes: input.bytes.byteLength,
      mimeType: "x",
    };
  },
  async readRaw({ path, sha256 }) {
    const bytes = objects.get(path);
    if (bytes === undefined || sha(bytes) !== sha256) throw new Error("storage_read_failed");
    return bytes;
  },
};

const ok = (bytes: Uint8Array): AttachmentFetchResult => ({
  status: "OK",
  bytes,
  sha256: sha(bytes),
  sizeBytes: bytes.byteLength,
  format: "PDF",
  mimeType: "application/pdf",
});

const parseResult = (overrides: Partial<ParseResponse> = {}): GatewayResult<ParseResponse> => ({
  ok: true,
  attempts: 1,
  value: {
    status: "PARSED",
    format: "PDF",
    parserId: "pdf-test@1",
    text: "제안요청서 본문 자격 요건",
    pages: [{ page: 1, charOffset: 0 }],
    blocks: [],
    quality: { charsPerPage: 12 },
    errorCode: null,
    warnings: [],
    ...overrides,
  },
});

let downloads: Record<string, AttachmentFetchResult>;
let parse: (call: number) => GatewayResult<ParseResponse>;

function deps(overrides: Partial<DocumentsJobDeps> = {}): DocumentsJobDeps {
  return {
    repo,
    fetcher: {
      fetch: async (ref) => {
        fetched.push(ref.url);
        const id = new URL(ref.url).searchParams.get("f") ?? "";
        return downloads[id] ?? ok(PDF);
      },
    },
    storage,
    parser: {
      parse: async () => {
        parsedCalls += 1;
        return parse(parsedCalls);
      },
    },
    pace: async () => undefined,
    settings: { maxPerBid: 2, leaseSeconds: 600 },
    expectDemo: false,
    now: () => new Date(clock),
    newAttemptId: () => `a77e0000-0000-4000-8000-00000000000${(attemptSeq += 1)}`,
    log: () => undefined,
    ...overrides,
  };
}

function job(overrides: Partial<DocumentsJobLike> = {}): DocumentsJobLike {
  const data = { bidId: BID, revisionId: REVISION, revisionCreatedAt: CREATED_AT };
  return {
    id: toDocumentsJobId(data),
    name: DOCUMENTS_JOB_NAME,
    data,
    attemptsMade: 0,
    attemptsStarted: 1,
    opts: { attempts: 3 },
    moveToDelayed: vi.fn(async () => undefined),
    ...overrides,
  };
}

beforeEach(() => {
  clock = NOW;
  docs = new Map(
    [
      doc(DOC_RFP, "4. 제안요청서_최종.pdf"),
      doc(DOC_NOTICE, "(공고서) 정보화사업.pdf"),
      doc(DOC_FORM, "별지 서식_청렴서약서.hwp"),
      doc(DOC_SHEET, "가격 내역서.xlsx"),
    ].map((d) => [d.id, d]),
  );
  objects = new Map();
  fetched = [];
  parsedCalls = 0;
  downloads = {};
  parse = () => parseResult();
});

describe("documents job 상태 전이", () => {
  it("성공: 본문 문서만 공고당 상한까지 받아 원본·텍스트를 확정하고 리스를 푼다", async () => {
    const result = await createDocumentsProcessor(deps())(job());

    expect(result).toMatchObject({
      status: "DONE",
      documents: [
        { documentId: DOC_NOTICE, outcome: "PARSED" },
        { documentId: DOC_RFP, outcome: "PARSED" },
      ],
    });
    // 양식(서약서)은 우선순위 밖이라 상한 2에 들지 않고, xlsx 는 파서 형식이 아니라 받지 않는다(PENDING 그대로).
    expect(fetched).toEqual([URL_OF(DOC_NOTICE), URL_OF(DOC_RFP)]);
    expect(docs.get(DOC_FORM)).toMatchObject({ downloadStatus: "PENDING", parseStatus: null });
    expect(docs.get(DOC_SHEET)).toMatchObject({ downloadStatus: "PENDING", parseStatus: null });
    const rfp = docs.get(DOC_RFP);
    expect(rfp).toMatchObject({ downloadStatus: "OK", parseStatus: "PARSED", attemptId: null });
    // 텍스트 객체는 reader 가 읽는 계약 그대로다(원본 해시·문서 id 가 맞다).
    const text = objects.get(rfp?.textKey ?? "") ?? new Uint8Array();
    expect(parsedDocumentSchema.parse(JSON.parse(new TextDecoder().decode(text)))).toMatchObject({
      documentId: DOC_RFP,
      rawSha256: sha(PDF),
      status: "PARSED",
    });
  });

  it("다운로드 실패: 영구 사유는 바로 FAILED 로 남기고 다른 문서는 계속 처리한다. 일시 사유는 재시도하고 마지막 시도에 FAILED", async () => {
    downloads = {
      [DOC_NOTICE]: { status: "FAILED", errorCode: "AUTH_REQUIRED" },
      [DOC_RFP]: { status: "FAILED", errorCode: "HTTP_5XX" },
    };
    const processor = createDocumentsProcessor(deps());

    await expect(processor(job())).rejects.toThrow("documents_retry");
    expect(docs.get(DOC_NOTICE)).toMatchObject({
      downloadStatus: "FAILED",
      downloadErrorCode: "AUTH_REQUIRED",
    });
    expect(docs.get(DOC_RFP)).toMatchObject({ downloadStatus: "PENDING", attemptId: null });

    // 마지막 시도(3번째)에서는 던지지 않고 FAILED 로 닫는다. 이미 끝난 문서는 다시 받지 않는다.
    fetched = [];
    const last = await processor(job({ attemptsMade: 2, attemptsStarted: 3 }));
    expect(last.status).toBe("DONE");
    expect(fetched).toEqual([URL_OF(DOC_RFP)]);
    expect(docs.get(DOC_RFP)).toMatchObject({
      downloadStatus: "FAILED",
      downloadErrorCode: "HTTP_5XX",
    });
  });

  it("파싱 실패: UNSUPPORTED 는 바로 남기고, gateway 불가는 기록 없이 10분 미루며, 파서 시간 초과(PARSER_ERROR)만 재시도한다", async () => {
    const failed = (status: "FAILED" | "UNSUPPORTED", errorCode: ParseResponse["errorCode"]) =>
      parseResult({ status, parserId: "pdfplumber@0.11.10", text: "", pages: [], errorCode });
    parse = (call) =>
      call === 1
        ? failed("UNSUPPORTED", "NO_TEXT_LAYER")
        : { ok: false, failure: { kind: "UNREACHABLE", code: null }, attempts: 2 };
    const delayed = job();

    await expect(createDocumentsProcessor(deps())(delayed)).rejects.toBeInstanceOf(DelayedError);
    expect(docs.get(DOC_NOTICE)).toMatchObject({
      parseStatus: "UNSUPPORTED",
      parseErrorCode: "NO_TEXT_LAYER",
      parserId: "pdfplumber@0.11.10",
    });
    // gateway 를 못 썼다. 원본만 확정한 채 파싱 상태는 PENDING 으로 두고 리스를 푼다.
    expect(docs.get(DOC_RFP)).toMatchObject({
      downloadStatus: "OK",
      parseStatus: "PENDING",
      attemptId: null,
    });
    expect(delayed.moveToDelayed).toHaveBeenCalledWith(NOW + DOCUMENTS_DEFER_MS, undefined);

    // 다시 돌 때는 나라장터에서 받지 않고 Storage 원본으로 파싱한다. 파서 시간 초과는 기록하지 않고 재시도한다.
    fetched = [];
    parsedCalls = 0;
    parse = () => failed("FAILED", "PARSER_ERROR");
    await expect(createDocumentsProcessor(deps())(job({ attemptsStarted: 2 }))).rejects.toThrow(
      "documents_retry",
    );
    expect(fetched).toEqual([]);
    expect(parsedCalls).toBe(1);
    expect(docs.get(DOC_RFP)).toMatchObject({ parseStatus: "PENDING", attemptId: null });

    // 마지막 시도에서는 FAILED·PARSER_ERROR 로 닫는다.
    await createDocumentsProcessor(deps())(job({ attemptsMade: 2, attemptsStarted: 4 }));
    expect(docs.get(DOC_RFP)).toMatchObject({
      parseStatus: "FAILED",
      parseErrorCode: "PARSER_ERROR",
    });
  });

  it("리스 만료 재처리: 다른 시도가 잡은 문서는 리스 끝으로 미루고, 끝난 뒤에는 이어 받아 처리한다", async () => {
    // 앞 시도가 원본까지 확정하고 멈췄다(리스 5분 남음).
    const raw = await storage.uploadImmutable({
      kind: "raw",
      documentId: DOC_RFP,
      bidId: BID,
      revisionId: REVISION,
      bytes: PDF,
    });
    expect(raw.sha256).toBe(sha(PDF));
    Object.assign(docs.get(DOC_RFP) ?? {}, {
      attemptId: "dead0000-0000-4000-8000-000000000001",
      leaseUntil: NOW + 5 * 60_000,
    });
    const first = job();

    await expect(createDocumentsProcessor(deps())(first)).rejects.toBeInstanceOf(DelayedError);
    expect(first.moveToDelayed).toHaveBeenCalledWith(NOW + 5 * 60_000, undefined);
    expect(docs.get(DOC_RFP)).toMatchObject({ parseStatus: "PENDING" });
    expect(docs.get(DOC_NOTICE)).toMatchObject({ parseStatus: "PARSED" });

    clock = NOW + 5 * 60_000 + 1;
    const second = await createDocumentsProcessor(deps())(job({ attemptsStarted: 2 }));
    expect(second).toMatchObject({
      status: "DONE",
      documents: [{ documentId: DOC_RFP, outcome: "PARSED" }],
    });
    expect(fetched).toEqual([URL_OF(DOC_NOTICE)]);
  });

  it("범위 밖(마감 지남)·옛 jobId 는 문서를 잡지 않고 끝낸다", async () => {
    const claim = vi.spyOn(repo, "claim");
    clock = Date.parse("2026-11-02T00:00:00Z");
    await expect(createDocumentsProcessor(deps())(job())).resolves.toEqual({
      status: "SKIPPED",
      reason: "DEADLINE_PASSED",
    });
    await expect(
      createDocumentsProcessor(deps())(job({ id: `documents-${REVISION}` })),
    ).resolves.toEqual({ status: "SKIPPED", reason: "STALE_JOB" });
    expect(claim).not.toHaveBeenCalled();
    claim.mockRestore();
  });
});
