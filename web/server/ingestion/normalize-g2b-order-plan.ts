import "server-only";
import type { G2bItem } from "./connector.model";
import { G2B_ORDER_PLAN_SOURCE } from "./g2b-stage.model";
import {
  collapseSpaces,
  definedEntries,
  finishDraft,
  isBlank,
  missingFieldsOutcome,
  normalizeBudgetValue,
  normalizeDateValue,
  textOrRaw,
  type NormalizeOutcome,
} from "./normalize-common";
import { NORMALIZED_BID_SCHEMA_VERSION } from "./normalized-bid.model";
import { sourceKeyOf } from "./validation";

// ── 나라장터 발주계획(getOrderPlanSttusListServc) 한 행 → NormalizedBidDraft (07 §4 단계 연결, P0-8) ──
// 발주계획 통합번호(orderPlanUntyNo)가 이 단계의 공고번호이자 planRef 다. 입찰공고의 orderPlanUntyNo(planRef)가
// 같은 값이면 단계 연결 규칙(PLAN_REF)이 둘을 잇는다. 발주계획에는 마감이 없다(15 fieldState NOT_APPLICABLE).
// 차수 칸이 없어 amendmentNo 는 두지 않는다. 담당자 필드(ofclNm·telNo)는 옮기지 않는다(15 §3 개인정보).
// bidNtceNoList(이어진 입찰공고 번호)는 아직 쓰지 않는다.

const present = (raw: unknown): unknown => (isBlank(raw) ? undefined : raw);
const trimmed = (raw: unknown): unknown => textOrRaw(present(raw), (text) => text.trim());

export function normalizeG2bOrderPlan(
  item: G2bItem,
  context: { fetchedAt: Date },
): NormalizeOutcome {
  const noticeId = trimmed(item.orderPlanUntyNo);
  const sourceKey = sourceKeyOf(
    G2B_ORDER_PLAN_SOURCE,
    typeof noticeId === "string" ? noticeId : null,
  );
  const title = textOrRaw(present(item.bizNm), collapseSpaces);
  const sourceUrl = trimmed(item.orderPlanDtlUrl);

  const missing = [
    noticeId === undefined ? "noticeId" : null,
    title === undefined ? "title" : null,
    sourceUrl === undefined ? "sourceUrl" : null,
  ].filter((field) => field !== null);
  if (missing.length > 0) return missingFieldsOutcome(missing, sourceKey);

  // 합계 발주금액. 0 이어도 응답 값 그대로 둔다(값을 지어내지 않는다).
  const budget = normalizeBudgetValue(present(item.sumOrderAmt), sourceKey);
  const noticeDate = normalizeDateValue(
    "noticeDate",
    present(item.nticeDt),
    context.fetchedAt,
    sourceKey,
  );
  const notes = [
    budget.value === null ? undefined : "budgetKrw: sumOrderAmt 사용",
    noticeDate.note,
  ].filter((note) => note !== undefined);

  const candidate = {
    schemaVersion: NORMALIZED_BID_SCHEMA_VERSION,
    source: G2B_ORDER_PLAN_SOURCE,
    noticeId,
    planRef: noticeId,
    stage: "PLAN",
    // 발주계획 응답에는 취소·변경 종류 칸이 없다. 바뀐 값은 checksum 이 새 revision 으로 잡는다.
    status: "OPEN",
    title,
    agency: textOrRaw(present(item.orderInsttNm), collapseSpaces) ?? null,
    budgetKrw: budget.value,
    noticeDate: noticeDate.value,
    deadlineAt: null,
    sourceUrl,
    content: "",
    attachments: [],
    structuredQualifications: [],
    original: definedEntries({
      noticeNo: typeof item.orderPlanUntyNo === "string" ? item.orderPlanUntyNo : undefined,
      budget: budget.original,
      noticeDate: noticeDate.original,
    }),
    ...(notes.length > 0 ? { normalizationNotes: notes } : {}),
    isDemo: false,
    fetchedAt: context.fetchedAt.toISOString(),
  };

  return finishDraft(candidate, sourceKey, [budget.warning, noticeDate.warning]);
}
