import "server-only";
import type { FixtureRecord } from "./fixture.model";
import {
  collapseSpaces,
  dateOrderWarning,
  definedEntries,
  encodingWarning,
  finishDraft,
  isAbsent,
  isBlank,
  isPlainRecord,
  missingFieldsOutcome,
  normalizeBudgetValue,
  normalizeDateValue,
  textOrRaw,
  type NormalizeOutcome,
} from "./normalize-common";
import { NORMALIZED_BID_SCHEMA_VERSION } from "./normalized-bid.model";
import { normText } from "./text-normalize";
import { REQUIRED_FIELDS, sourceKeyOf } from "./validation";

// ── fixture 레코드 → NormalizedBidDraft (07 §3, 15 §3·§6) ──
// 값이 틀려도 여기서 고쳐 채우지 않는다. 타입이 틀린 값은 그대로 넘겨 마지막 스키마 검증이 경로와 함께 거르게 한다.
export type NormalizeContext = { fetchedAt: Date; anchor: Date };
export type { NormalizeOutcome } from "./normalize-common";

const FIXTURE_SOURCE = "fixture";
// source·fetchedAt 은 정규화가 채우므로 레코드에서 빠질 수 있는 필수 필드는 나머지 넷이다.
const FILLED_BY_NORMALIZER: ReadonlySet<string> = new Set(["source", "fetchedAt"]);

function normalizeAgency(raw: unknown): unknown {
  if (isAbsent(raw)) return null;
  if (typeof raw !== "string") return raw;
  const agency = collapseSpaces(raw);
  return agency === "" ? null : agency;
}

// 빈 연결 키는 "연결 없음" 이다. null 로 두지 않고 키를 빼서 15 §3 의 선택 필드 모양을 지킨다.
function normalizeReference(raw: unknown): unknown {
  if (isAbsent(raw)) return undefined;
  if (typeof raw !== "string") return raw;
  const reference = raw.trim();
  return reference === "" ? undefined : reference;
}

function normalizeAttachment(item: unknown): unknown {
  if (!isPlainRecord(item)) return item;
  return {
    name: item.name,
    url: item.objectKey,
    ...definedEntries({ mimeType: item.mimeType, sizeBytes: item.sizeBytes }),
  };
}

function normalizeAttachments(raw: unknown): unknown {
  if (isAbsent(raw)) return [];
  return Array.isArray(raw) ? raw.map(normalizeAttachment) : raw;
}

function normalizeContent(raw: unknown): unknown {
  return isAbsent(raw) ? "" : textOrRaw(raw, normText);
}

const missingRequiredFields = (record: FixtureRecord): string[] =>
  REQUIRED_FIELDS.filter((field) => !FILLED_BY_NORMALIZER.has(field) && isBlank(record[field]));

export function normalizeFixtureRecord(
  record: FixtureRecord,
  context: NormalizeContext,
): NormalizeOutcome {
  const noticeId = typeof record.noticeId === "string" ? record.noticeId.trim() : null;
  const sourceKey = sourceKeyOf(FIXTURE_SOURCE, noticeId);

  const missing = missingRequiredFields(record);
  if (missing.length > 0) return missingFieldsOutcome(missing, sourceKey);

  const budget = normalizeBudgetValue(record.budgetKrw, sourceKey);
  const noticeDate = normalizeDateValue("noticeDate", record.noticeDate, context.anchor, sourceKey);
  const deadlineAt = normalizeDateValue("deadlineAt", record.deadlineAt, context.anchor, sourceKey);
  const content = normalizeContent(record.content);
  const notes = [noticeDate.note, deadlineAt.note].filter((note) => note !== undefined);

  const candidate = {
    schemaVersion: NORMALIZED_BID_SCHEMA_VERSION,
    source: FIXTURE_SOURCE,
    noticeId: textOrRaw(record.noticeId, (id) => id.trim()),
    amendmentNo: record.amendmentNo,
    ...definedEntries({
      planRef: normalizeReference(record.planRef),
      preSpecRef: normalizeReference(record.preSpecRef),
    }),
    stage: record.stage,
    status: isAbsent(record.status) ? "OPEN" : record.status,
    title: textOrRaw(record.title, collapseSpaces),
    agency: normalizeAgency(record.agency),
    budgetKrw: budget.value,
    noticeDate: noticeDate.value,
    deadlineAt: deadlineAt.value,
    sourceUrl: textOrRaw(record.sourceUrl, (url) => url.trim()),
    content,
    attachments: normalizeAttachments(record.attachments),
    structuredQualifications: [],
    original: definedEntries({
      noticeNo: typeof record.noticeId === "string" ? record.noticeId : undefined,
      budget: budget.original,
      noticeDate: noticeDate.original,
      deadline: deadlineAt.original,
      stage: typeof record.stage === "string" ? record.stage : undefined,
      status: typeof record.status === "string" ? record.status : undefined,
    }),
    ...(notes.length > 0 ? { normalizationNotes: notes } : {}),
    isDemo: true,
    fetchedAt: context.fetchedAt.toISOString(),
  };

  // 경고 순서: BUDGET_UNPARSED → DATE_UNPARSED(noticeDate → deadlineAt) → DATE_ORDER → ENCODING_DEGRADED
  return finishDraft(candidate, sourceKey, [
    budget.warning,
    noticeDate.warning,
    deadlineAt.warning,
    dateOrderWarning(noticeDate.value, deadlineAt.value, sourceKey),
    encodingWarning(content, sourceKey),
  ]);
}
