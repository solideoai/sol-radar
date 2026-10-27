import "server-only";
import { z } from "zod";

// ── documents job(첨부 다운로드 → Storage → /parse → 텍스트 저장)의 설정·저장 port·텍스트 객체 계약 ──
// 규칙만 둔다. Supabase 호출은 document-processing.repo·document-text.repo 몫이다.

type Env = Record<string, string | undefined>;

/** 10진 정수 env. 비었으면 기본값, 범위 밖·형식 오류면 키 이름만 담아 던진다(값은 싣지 않는다). */
function readInt(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error(`documents 설정 오류: ${key}`);
  return value;
}

export type DocumentsSettings = {
  /** 공고(최신 revision)당 처리할 파서 형식 첨부 수 */
  maxPerBid: number;
  /** 복구 회차(60초)마다 documents job 을 넣는 revision 수 */
  roundMaxRevisions: number;
  /** 나라장터 첨부 요청 사이 최소 간격(프로세스 안 모든 job 이 함께 지킨다) */
  fetchIntervalMs: number;
  /** 동시에 처리하는 documents job 수. gateway /parse 의 동시 파서 수(2)를 넘지 않는다 */
  concurrency: number;
  /** 문서 하나를 잡는 리스(단계마다 다시 잡아 늘린다) */
  leaseSeconds: number;
};

/**
 * 기본값 근거(2026-10-27 운영 553건·첨부 1,975행 기준):
 * - maxPerBid 3: 공고당 첨부 평균 3.6건이고 분석에 쓰는 본문 문서(공고서·제안요청서·과업지시서)는 보통 3건 안이다.
 *   Qwen 입력 예산이 12,000자 근사라 그 뒤 문서는 분석에 거의 들어가지 못한다.
 * - roundMaxRevisions 10: 60초마다 최대 10공고 × 3건 = 30건을 넣는다. 아래 간격(2초)이면 분당 최대 30건을 받으므로
 *   넣는 속도와 받는 속도가 같다. 처리 대상은 접수 중·마감 전 공고뿐이라 대기열이 끝없이 늘지 않는다.
 * - fetchIntervalMs 2000: 나라장터에 초당 0.5건 이하로만 요청한다(공식 API 의 일일 예산과 별개인 웹 서버라 보수적으로 둔다).
 * - concurrency 2(최대 2): 내려받기는 간격으로 줄 서고, 업로드·파싱만 겹친다. gateway /parse 는 파서 하위 프로세스를
 *   동시에 2개까지만 띄우므로 그보다 많이 보내면 gateway 안에서 기다리다 timeout 이 난다.
 * - leaseSeconds 600: 한 단계(다운로드 30초 + Storage 업로드·검증 최대 수 분, 또는 /parse 185초 × 재시도 1회)를 덮는다.
 */
export function readDocumentsSettings(env: Env): DocumentsSettings {
  return {
    maxPerBid: readInt(env, "DOCUMENTS_MAX_PER_BID", 3, 1, 20),
    roundMaxRevisions: readInt(env, "DOCUMENTS_ROUND_MAX_REVISIONS", 10, 1, 100),
    fetchIntervalMs: readInt(env, "DOCUMENTS_FETCH_INTERVAL_MS", 2_000, 500, 60_000),
    concurrency: readInt(env, "DOCUMENTS_CONCURRENCY", 2, 1, 2),
    leaseSeconds: readInt(env, "DOCUMENTS_LEASE_SECONDS", 600, 60, 3_600),
  };
}

export type AttachmentTextSettings = {
  parsedBucket: string;
  /** 문서 하나에서 분석에 넣는 최대 글자 수(앞에서부터) */
  maxCharsPerDocument: number;
  /** revision 하나에서 분석에 넣는 첨부 글자 합 */
  maxTotalChars: number;
};

/**
 * 기본값 근거: gateway /extract 는 문자열 하나를 2,000,000자까지 받는다(services/ai contracts.py MAX_TEXT_CHARS).
 * 문서당 200,000자는 인용 검증이 전체 문서에서 유사 검색까지 하는 상한(15 §5.2 "len(doc) > 200,000 이면 3단계까지")이다.
 * 합 600,000자는 공고당 3건 × 200,000자이고, 요청 본문(한글 3바이트)을 2MB 안팎으로 묶는다.
 */
export function readAttachmentTextSettings(env: Env, parsedBucket: string): AttachmentTextSettings {
  return {
    parsedBucket,
    maxCharsPerDocument: readInt(env, "ANALYSIS_ATTACHMENT_MAX_CHARS", 200_000, 1_000, 2_000_000),
    maxTotalChars: readInt(env, "ANALYSIS_ATTACHMENT_TOTAL_CHARS", 600_000, 1_000, 2_000_000),
  };
}

// ── 저장 port ──

/**
 * 다운로드 실패 사유. 화면 계약(@/server/bids bidDocumentSchema.downloadErrorCode)과 DB 함수 fail_document_download 가
 * 받는 일곱 값뿐이다. 그 밖의 값(NOT_FOUND 등)을 쓰면 공고 상세 응답 검증이 깨진다.
 */
export const RECORDABLE_DOWNLOAD_ERROR_CODES = [
  "AUTH_REQUIRED",
  "HTTP_4XX",
  "HTTP_5XX",
  "REDIRECT_BLOCKED",
  "HOST_NOT_ALLOWED",
  "TOO_LARGE",
  "TIMEOUT",
] as const;
export type RecordableDownloadErrorCode = (typeof RECORDABLE_DOWNLOAD_ERROR_CODES)[number];

/** 파싱 실패 사유(DB check bid_documents_parse_error_code_check, 03 §10.1 ParseResult.errorCode) */
export const PARSE_ERROR_CODES = [
  "UNSUPPORTED_FORMAT",
  "NO_TEXT_LAYER",
  "ENCRYPTED",
  "DISTRIBUTION_PROTECTED",
  "TOO_LARGE",
  "CORRUPTED",
  "PARSER_ERROR",
] as const;
export type ParseErrorCode = (typeof PARSE_ERROR_CODES)[number];

export type ProcessingRevision = {
  bidId: string;
  revisionId: string;
  revision: number;
  /** bid_revisions.created_at 원문(PostgREST) */
  createdAt: string;
  notice: { isDemo: boolean; status: string; deadlineAt: string | null; latestRevision: number };
  documents: { id: string; name: string; downloadStatus: string; parseStatus: string | null }[];
};

export type ClaimedDocument = {
  id: string;
  bidId: string;
  revisionId: string;
  name: string;
  originalUrl: string;
  downloadStatus: "PENDING" | "OK";
  parseStatus: string | null;
  format: string | null;
  sha256: string | null;
  storageBucket: string | null;
  objectKey: string | null;
};

export type ClaimResult =
  | { claimed: true; leaseUntil: string; document: ClaimedDocument }
  | { claimed: false; reason: "MISSING" | "DONE" }
  | { claimed: false; reason: "BUSY"; leaseUntil: string };

export type DocumentProcessingRepo = {
  loadRevision(input: { bidId: string; revisionId: string }): Promise<ProcessingRevision | null>;
  claim(documentId: string, attemptId: string, leaseSeconds: number): Promise<ClaimResult>;
  failDownload(input: {
    documentId: string;
    attemptId: string;
    errorCode: RecordableDownloadErrorCode;
    message: string;
  }): Promise<boolean>;
  failParse(input: {
    documentId: string;
    attemptId: string;
    status: "UNSUPPORTED" | "FAILED";
    errorCode: ParseErrorCode;
    parserId: string;
    message: string;
  }): Promise<boolean>;
  release(documentId: string, attemptId: string): Promise<boolean>;
};

const isoInstant = z.string().refine((value) => Number.isFinite(Date.parse(value)));

export const claimResultSchema: z.ZodType<ClaimResult> = z.union([
  z.object({
    claimed: z.literal(true),
    leaseUntil: isoInstant,
    document: z.object({
      id: z.guid(),
      bidId: z.guid(),
      revisionId: z.guid(),
      name: z.string(),
      originalUrl: z.string(),
      downloadStatus: z.enum(["PENDING", "OK"]),
      parseStatus: z.string().nullable(),
      format: z.string().nullable(),
      sha256: z.string().nullable(),
      storageBucket: z.string().nullable(),
      objectKey: z.string().nullable(),
    }),
  }),
  z.object({ claimed: z.literal(false), reason: z.enum(["MISSING", "DONE"]) }),
  z.object({ claimed: z.literal(false), reason: z.literal("BUSY"), leaseUntil: isoInstant }),
]);

// ── bid-parsed 의 텍스트 객체(…/result.json). worker 가 쓰고 첨부 텍스트 reader 가 읽는다 ──

export const PARSED_DOCUMENT_SCHEMA_VERSION = "sol-radar/parsed-document/v1";

const pageSchema = z.object({
  page: z.number().int().min(1),
  charOffset: z.number().int().min(0),
});

/** reader 가 읽는 부분. 그 밖의 필드(blocks·quality·warnings 등)는 버리지 않고 저장만 한다 */
export const parsedDocumentSchema = z
  .object({
    schemaVersion: z.literal(PARSED_DOCUMENT_SCHEMA_VERSION),
    documentId: z.guid(),
    rawSha256: z.string().regex(/^[0-9a-f]{64}$/),
    status: z.enum(["PARSED", "PARTIAL"]),
    parserId: z.string().min(1),
    text: z.string(),
    pages: z.array(pageSchema),
  })
  .refine((value) => value.pages.every((page) => page.charOffset <= value.text.length), {
    error: "pages.charOffset 가 text 밖이다",
    path: ["pages"],
  });
export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;

/** 저장할 텍스트 객체. gateway ParseResult(03 §10.1)를 그대로 싣고 원본 해시·문서 id·형식 버전을 붙인다 */
export function toParsedDocumentObject(input: {
  documentId: string;
  rawSha256: string;
  parse: {
    status: "PARSED" | "PARTIAL";
    format: string;
    parserId: string;
    text: string;
    pages: { page: number; charOffset: number }[];
    blocks: unknown[];
    quality: Record<string, unknown> | null;
    warnings: string[];
  };
}): Record<string, unknown> {
  return {
    schemaVersion: PARSED_DOCUMENT_SCHEMA_VERSION,
    documentId: input.documentId,
    rawSha256: input.rawSha256,
    ...input.parse,
  };
}
