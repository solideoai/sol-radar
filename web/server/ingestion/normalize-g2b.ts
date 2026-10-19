import "server-only";
import type { G2bItem } from "./connector.model";
import {
  collapseSpaces,
  dateOrderWarning,
  definedEntries,
  encodingWarning,
  finishDraft,
  invalidFieldsOutcome,
  isBlank,
  missingFieldsOutcome,
  normalizeBudgetValue,
  normalizeDateValue,
  textOrRaw,
  type NormalizeOutcome,
} from "./normalize-common";
import {
  NORMALIZED_BID_SCHEMA_VERSION,
  STRUCTURED_REQUIREMENT_KINDS,
  type BidStatus,
  type StructuredRequirement,
} from "./normalized-bid.model";
import { sourceKeyOf } from "./validation";

// ── 나라장터 입찰공고 목록 한 행 → NormalizedBidDraft (07 §3.1) ──
// 나라장터 응답은 값이 없을 때 빈 문자열을 준다(실측 마감 19%). 빈 문자열은 "값 없음" 으로 보고 경고하지 않는다.
const G2B_SOURCE = "g2b-bid-notice";
const SPEC_DOC_SLOTS = 10;

export const G2B_NOTICE_KIND_STATUS: Readonly<Record<string, BidStatus>> = {
  등록공고: "OPEN",
  변경공고: "AMENDED",
  취소공고: "CANCELLED",
  재공고: "OPEN",
};

const KIND_ORDER: ReadonlyMap<string, number> = new Map(
  STRUCTURED_REQUIREMENT_KINDS.map((kind, index) => [kind, index]),
);

/** kind 순서로 안정 정렬한다. 저장 쪽이 index 로 seq 를 채우므로 같은 입력이면 같은 순서여야 한다. */
export function sortStructuredRequirements(
  requirements: readonly StructuredRequirement[],
): StructuredRequirement[] {
  return [...requirements].sort(
    (left, right) => (KIND_ORDER.get(left.kind) ?? 0) - (KIND_ORDER.get(right.kind) ?? 0),
  );
}

// 빈 문자열은 키가 없는 것과 같게 undefined 로 바꾼다. 문자열이 아닌 값은 스키마 검증이 거르도록 그대로 둔다.
const present = (raw: unknown): unknown => (isBlank(raw) ? undefined : raw);
const trimmed = (raw: unknown): unknown => textOrRaw(present(raw), (text) => text.trim());

// 표에 없는 종류(연기공고 등)는 추측하지 않는다. 'constructor' 같은 키가 프로토타입에서 오지 않게 자기 키만 본다.
function statusOf(raw: unknown): BidStatus | null {
  if (typeof raw !== "string") return null;
  const kind = raw.trim();
  return Object.hasOwn(G2B_NOTICE_KIND_STATUS, kind) ? G2B_NOTICE_KIND_STATUS[kind] : null;
}

// 07 §3.1: 배정예산이 있으면 그것, 없으면 추정가격. 어느 것을 썼는지 메모로 남긴다.
function budgetSource(item: G2bItem): { raw: unknown; note?: string } {
  if (!isBlank(item.asignBdgtAmt)) {
    return { raw: item.asignBdgtAmt, note: "budgetKrw: asignBdgtAmt 사용" };
  }
  if (!isBlank(item.presmptPrce)) {
    return { raw: item.presmptPrce, note: "budgetKrw: presmptPrce 사용(asignBdgtAmt 없음)" };
  }
  return { raw: undefined };
}

// stdNtceDocUrl 은 목록 첨부와 같은 파일이라 넣지 않는다. mimeType·sizeBytes 는 응답에 없어 지어내지 않는다.
function attachmentsOf(item: G2bItem): { name: string; url: string }[] {
  const slots = Array.from({ length: SPEC_DOC_SLOTS }, (_, index) => index + 1).flatMap((slot) => {
    const url = item[`ntceSpecDocUrl${slot}`];
    if (typeof url !== "string" || url.trim() === "") return [];
    const name = item[`ntceSpecFileNm${slot}`];
    const fileName = typeof name === "string" && name.trim() !== "" ? name.trim() : `첨부 ${slot}`;
    return [{ name: fileName, url: url.trim() }];
  });
  return slots.filter((slot, index) => slots.findIndex(({ url }) => url === slot.url) === index);
}

const sourceUrlOf = (item: G2bItem): unknown =>
  trimmed(item.bidNtceDtlUrl) ?? trimmed(item.bidNtceUrl);

export function normalizeG2bBidNotice(
  item: G2bItem,
  context: { fetchedAt: Date },
): NormalizeOutcome {
  const noticeId = trimmed(item.bidNtceNo);
  const sourceKey = sourceKeyOf(G2B_SOURCE, typeof noticeId === "string" ? noticeId : null);
  const title = textOrRaw(present(item.bidNtceNm), collapseSpaces);
  const sourceUrl = sourceUrlOf(item);

  // REQUIRED_FIELDS 순서. source·stage·fetchedAt 은 이 정규화가 채운다.
  const missing = [
    noticeId === undefined ? "noticeId" : null,
    title === undefined ? "title" : null,
    sourceUrl === undefined ? "sourceUrl" : null,
  ].filter((field) => field !== null);
  if (missing.length > 0) return missingFieldsOutcome(missing, sourceKey);

  const status = statusOf(item.ntceKindNm);
  if (status === null) return invalidFieldsOutcome(["ntceKindNm"], sourceKey);

  const budgetChoice = budgetSource(item);
  const budget = normalizeBudgetValue(budgetChoice.raw, sourceKey);
  const noticeDate = normalizeDateValue(
    "noticeDate",
    present(item.bidNtceDt),
    context.fetchedAt,
    sourceKey,
  );
  const deadlineAt = normalizeDateValue(
    "deadlineAt",
    present(item.bidClseDt),
    context.fetchedAt,
    sourceKey,
  );
  const content = "";
  const notes = [budgetChoice.note, noticeDate.note, deadlineAt.note].filter(
    (note) => note !== undefined,
  );

  const candidate = {
    schemaVersion: NORMALIZED_BID_SCHEMA_VERSION,
    source: G2B_SOURCE,
    noticeId,
    ...definedEntries({
      amendmentNo: trimmed(item.bidNtceOrd),
      planRef: trimmed(item.orderPlanUntyNo),
      preSpecRef: trimmed(item.bfSpecRgstNo),
    }),
    stage: "NOTICE",
    status,
    title,
    // ntceInsttNm(공고기관)은 원본에만 둔다. 사업을 발주한 쪽은 수요기관이다.
    agency: textOrRaw(present(item.dminsttNm), collapseSpaces) ?? null,
    budgetKrw: budget.value,
    noticeDate: noticeDate.value,
    deadlineAt: deadlineAt.value,
    sourceUrl,
    content,
    attachments: attachmentsOf(item),
    // 구조화 자격은 보조 조회(다음 단계)가 채운다. 채워도 같은 순서가 되도록 항상 정렬을 거친다.
    structuredQualifications: sortStructuredRequirements([]),
    original: definedEntries({
      noticeNo: typeof item.bidNtceNo === "string" ? item.bidNtceNo : undefined,
      status: typeof item.ntceKindNm === "string" ? item.ntceKindNm : undefined,
      budget: budget.original,
      noticeDate: noticeDate.original,
      deadline: deadlineAt.original,
    }),
    ...(notes.length > 0 ? { normalizationNotes: notes } : {}),
    isDemo: false,
    fetchedAt: context.fetchedAt.toISOString(),
  };

  return finishDraft(candidate, sourceKey, [
    budget.warning,
    noticeDate.warning,
    deadlineAt.warning,
    dateOrderWarning(noticeDate.value, deadlineAt.value, sourceKey),
    encodingWarning(content, sourceKey),
  ]);
}
