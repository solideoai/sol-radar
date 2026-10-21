import "server-only";

// ── 07 §2.4 AttachmentFetcher 계약과 04 bid_documents 의 저장 키 ──
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024;
export const ATTACHMENT_TIMEOUT_MS = 30_000;
export const ATTACHMENT_MAX_REDIRECTS = 3;

export const DOWNLOAD_ERROR_CODES = [
  "AUTH_REQUIRED",
  "HTTP_4XX",
  "HTTP_5XX",
  "REDIRECT_BLOCKED",
  "HOST_NOT_ALLOWED",
  "TOO_LARGE",
  "TIMEOUT",
  "NOT_FOUND",
] as const;
export type DownloadErrorCode = (typeof DOWNLOAD_ERROR_CODES)[number];

export const DOCUMENT_FORMATS = ["PDF", "HWP", "HWPX", "ZIP", "XLSX", "UNKNOWN"] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

export const DOCUMENT_FORMAT_MIME: Readonly<Record<DocumentFormat, string>> = {
  PDF: "application/pdf",
  HWP: "application/x-hwp",
  HWPX: "application/hwp+zip",
  ZIP: "application/zip",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  UNKNOWN: "application/octet-stream",
};

export const DOCUMENT_FORMAT_EXT: Readonly<Record<DocumentFormat, string>> = {
  PDF: "pdf",
  HWP: "hwp",
  HWPX: "hwpx",
  ZIP: "zip",
  XLSX: "xlsx",
  UNKNOWN: "bin",
};

export type AttachmentRef = { name: string; url: string };

export type AttachmentDownload = {
  status: "OK";
  bytes: Uint8Array;
  sha256: string;
  sizeBytes: number;
  format: DocumentFormat;
  mimeType: string;
};

export type AttachmentFetchResult =
  AttachmentDownload | { status: "FAILED"; errorCode: DownloadErrorCode };

export type AttachmentFetcher = { fetch(ref: AttachmentRef): Promise<AttachmentFetchResult> };

const OBJECT_ID = /^[A-Za-z0-9-]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Supabase Storage 키. 경로 조각에 '/'·'..' 가 섞이면 다른 공고의 원본을 덮어쓸 수 있어 프로그램 오류로 던진다. */
export function attachmentObjectKey(input: {
  bidId: string;
  revisionId: string;
  sha256: string;
  format: DocumentFormat;
}): string {
  if (!OBJECT_ID.test(input.bidId)) {
    throw new Error("attachmentObjectKey: bidId 형식이 잘못됐다");
  }
  if (!OBJECT_ID.test(input.revisionId)) {
    throw new Error("attachmentObjectKey: revisionId 형식이 잘못됐다");
  }
  if (!SHA256_HEX.test(input.sha256)) {
    throw new Error("attachmentObjectKey: sha256 형식이 잘못됐다");
  }
  return `raw/bids/${input.bidId}/${input.revisionId}/${input.sha256}.${DOCUMENT_FORMAT_EXT[input.format]}`;
}

// ── 첨부 텍스트 읽기 port(5-G). 분석 쪽이 revision 의 첨부 텍스트를 읽는 자리다. 구현은 documents job 단계에서 붙인다 ──
export type RevisionDocumentText = {
  documentId: string;
  name: string;
  downloadStatus: "PENDING" | "OK" | "FAILED";
  downloadErrorCode: string | null;
  parseStatus: "PENDING" | "PARSED" | "PARTIAL" | "UNSUPPORTED" | "FAILED" | null;
  parseErrorCode: string | null;
  /** PARSED·PARTIAL 일 때만 있다. 파싱하지 못한 문서의 내용을 추측해 채우지 않는다(15 §5.1) */
  text: string | null;
  /** 03 ParseResult.pages */
  pages: { page: number; charOffset: number }[];
};

export type AttachmentTextReader = {
  readRevisionDocuments(revisionId: string): Promise<RevisionDocumentText[]>;
};
