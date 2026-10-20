import "server-only";

// ── 15 §6 검증·격리: 격리 코드와 경고 코드, ingest_errors 에 남길 요약 ──
export const QUARANTINE_CODES = ["MISSING_REQUIRED_FIELD", "SCHEMA_INVALID"] as const;
export const WARNING_CODES = [
  "BUDGET_UNPARSED",
  "DATE_UNPARSED",
  "DATE_ORDER",
  "ENCODING_DEGRADED",
  // 첨부 URL 이 허용 목록(https://www.g2b.go.kr/pn/, 09 SSRF) 밖이라 저장하지 않았다. 공고는 적재한다
  "ATTACHMENT_URL_BLOCKED",
] as const;
export type QuarantineCode = (typeof QUARANTINE_CODES)[number];
export type WarningCode = (typeof WARNING_CODES)[number];

// detail 은 ingest_errors.redacted_detail 로 간다. 필드 이름과 코드만 담고 원문 값(제목·본문·담당자)은 넣지 않는다.
export type IngestIssue = { code: QuarantineCode | WarningCode; sourceKey: string; detail: string };
export type QuarantineIssue = IngestIssue & { code: QuarantineCode };
export type WarningIssue = IngestIssue & { code: WarningCode };

export const REQUIRED_FIELDS = [
  "source",
  "noticeId",
  "title",
  "sourceUrl",
  "stage",
  "fetchedAt",
] as const;
export type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const ENCODING_DEGRADED_RATIO = 0.05;

const REPLACEMENT_CHAR = "�";

export function sourceKeyOf(source: string, noticeId: string | null | undefined): string {
  const hasNoticeId = typeof noticeId === "string" && noticeId.trim().length > 0;
  return `${source}:${hasNoticeId ? noticeId : "unknown"}`;
}

export function replacementCharRatio(text: string): number {
  if (text.length === 0) return 0;
  return (text.split(REPLACEMENT_CHAR).length - 1) / text.length;
}

export const isEncodingDegraded = (text: string): boolean =>
  replacementCharRatio(text) > ENCODING_DEGRADED_RATIO;

export const missingFieldsDetail = (fields: readonly string[]): string =>
  `missing: ${fields.join(", ")}`;

export const invalidFieldsDetail = (paths: readonly string[]): string =>
  `invalid: ${paths.join(", ")}`;

export const encodingDegradedDetail = (text: string): string =>
  `replacement chars ${Number((replacementCharRatio(text) * 100).toFixed(1))}%`;

/** 걸러진 첨부 칸 이름만 적는다. URL 은 응답에서 온 값이라 기록에 싣지 않는다. */
export const attachmentBlockedDetail = (fields: readonly string[]): string =>
  `attachment url not allowed: ${fields.join(", ")}`;
