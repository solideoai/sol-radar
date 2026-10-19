import "server-only";
import { parseBudgetKrw } from "./normalize-amount";
import { parseKstDateTime } from "./normalize-date";
import { normalizedBidDraftSchema, type NormalizedBidDraft } from "./normalized-bid.model";
import {
  encodingDegradedDetail,
  invalidFieldsDetail,
  isEncodingDegraded,
  missingFieldsDetail,
  type QuarantineIssue,
  type WarningIssue,
} from "./validation";

// ── 출처별 정규화(fixture·나라장터)가 같이 쓰는 규칙. 경고·격리의 모양이 출처마다 달라지지 않게 한곳에 둔다 ──
export type NormalizeOutcome =
  | { ok: true; draft: NormalizedBidDraft; warnings: WarningIssue[] }
  | { ok: false; issue: QuarantineIssue };

export type DateField = "noticeDate" | "deadlineAt";
export type FieldResult = {
  value: unknown;
  original?: string;
  note?: string;
  warning?: WarningIssue;
};

export const isAbsent = (value: unknown): value is null | undefined =>
  value === undefined || value === null;

export const isBlank = (value: unknown): boolean =>
  isAbsent(value) || (typeof value === "string" && value.trim() === "");

export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const collapseSpaces = (text: string): string => text.trim().replace(/\s+/g, " ");

// 값이 없는 선택 키는 undefined 로 두지 않고 뺀다. 15 §3 의 선택 필드는 "키 없음" 이 정상 모양이다.
export const definedEntries = (entries: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

// 타입이 틀린 값은 고쳐 채우지 않고 그대로 넘겨 마지막 스키마 검증이 경로와 함께 거르게 한다.
export const textOrRaw = (raw: unknown, transform: (text: string) => string): unknown =>
  typeof raw === "string" ? transform(raw) : raw;

export function normalizeBudgetValue(raw: unknown, sourceKey: string): FieldResult {
  if (isAbsent(raw)) return { value: null };
  if (typeof raw !== "string" && typeof raw !== "number") return { value: raw };
  const parsed = parseBudgetKrw(raw);
  if (parsed.ok) return { value: parsed.value, original: String(raw) };
  return {
    value: null,
    original: String(raw),
    warning: { code: "BUDGET_UNPARSED", sourceKey, detail: "budget unparsed" },
  };
}

export function normalizeDateValue(
  field: DateField,
  raw: unknown,
  anchor: Date,
  sourceKey: string,
): FieldResult {
  if (isAbsent(raw)) return { value: null };
  if (typeof raw !== "string") return { value: raw };
  const parsed = parseKstDateTime(raw, anchor);
  if (!parsed.ok) {
    return {
      value: null,
      original: raw,
      warning: { code: "DATE_UNPARSED", sourceKey, detail: `${field} unparsed` },
    };
  }
  return {
    value: parsed.value,
    original: raw,
    note: parsed.assumedTime ? `${field}: 시각 없는 값(${raw})을 KST 18:00으로 간주` : undefined,
  };
}

export function dateOrderWarning(
  noticeDate: unknown,
  deadlineAt: unknown,
  sourceKey: string,
): WarningIssue | undefined {
  if (typeof noticeDate !== "string" || typeof deadlineAt !== "string") return undefined;
  if (Date.parse(deadlineAt) >= Date.parse(noticeDate)) return undefined;
  return { code: "DATE_ORDER", sourceKey, detail: "deadlineAt before noticeDate" };
}

export function encodingWarning(content: unknown, sourceKey: string): WarningIssue | undefined {
  if (typeof content !== "string" || !isEncodingDegraded(content)) return undefined;
  return { code: "ENCODING_DEGRADED", sourceKey, detail: encodingDegradedDetail(content) };
}

export const missingFieldsOutcome = (
  missing: readonly string[],
  sourceKey: string,
): NormalizeOutcome => ({
  ok: false,
  issue: { code: "MISSING_REQUIRED_FIELD", sourceKey, detail: missingFieldsDetail(missing) },
});

export const invalidFieldsOutcome = (
  paths: readonly string[],
  sourceKey: string,
): NormalizeOutcome => ({
  ok: false,
  issue: { code: "SCHEMA_INVALID", sourceKey, detail: invalidFieldsDetail(paths) },
});

// zod 의 메시지에는 받은 값이 들어갈 수 있어서 경로만 남긴다.
const issuePaths = (paths: readonly (readonly PropertyKey[])[]): string[] => [
  ...new Set(paths.map((path) => (path.length === 0 ? "(root)" : path.map(String).join(".")))),
];

/** 출처별로 모은 후보를 draft 스키마로 확정한다. 통과하지 못하면 경고는 버리고 격리한다. */
export function finishDraft(
  candidate: Record<string, unknown>,
  sourceKey: string,
  warnings: readonly (WarningIssue | undefined)[],
): NormalizeOutcome {
  const parsed = normalizedBidDraftSchema.safeParse(candidate);
  if (!parsed.success) {
    return invalidFieldsOutcome(issuePaths(parsed.error.issues.map(({ path }) => path)), sourceKey);
  }
  return {
    ok: true,
    draft: parsed.data,
    warnings: warnings.filter((warning) => warning !== undefined),
  };
}
