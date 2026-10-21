import "server-only";
import { checkAttachmentUrl } from "./attachment-allowlist";
import type { G2bItem } from "./connector.model";
import { G2B_PRE_SPEC_DOC_SLOTS, G2B_PRE_SPEC_SOURCE } from "./g2b-stage.model";
import {
  collapseSpaces,
  dateOrderWarning,
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
import { attachmentBlockedDetail, sourceKeyOf, type WarningIssue } from "./validation";

// ── 나라장터 사전규격(getPublicPrcureThngInfoServc) 한 행 → NormalizedBidDraft (07 §4 단계 연결, P0-8) ──
// 사전규격 등록번호(bfSpecRgstNo)가 이 단계의 공고번호이고, 입찰공고의 bfSpecRgstNo(preSpecRef)가 이 값을 가리킨다.
// 응답에는 상세 화면 주소가 없다. 확인되지 않은 주소 꼴을 지어내지 않고, 허용 목록 안의 첫 첨부(사전규격서)를
// 원문 주소로 쓴다. 첨부가 하나도 없으면 원문 주소가 없어 격리한다(필수 누락).
// 차수 칸이 없어 amendmentNo 는 두지 않는다. 담당자 필드(ofclNm·ofclTelNo)는 옮기지 않는다(15 §3 개인정보).
// bidNtceNoList(이어진 입찰공고 번호)는 아직 쓰지 않는다. 연결은 입찰공고 쪽 bfSpecRgstNo 로 한다.

const present = (raw: unknown): unknown => (isBlank(raw) ? undefined : raw);
const trimmed = (raw: unknown): unknown => textOrRaw(present(raw), (text) => text.trim());

type SpecDocs = { attachments: { name: string; url: string }[]; blockedFields: string[] };

// 첨부 URL 은 응답에서 오므로 허용 목록(https://www.g2b.go.kr/pn/, 09 SSRF) 밖이면 빼고 칸 이름을 경고로 남긴다.
function specDocsOf(item: G2bItem): SpecDocs {
  const blockedFields: string[] = [];
  const docs = Array.from({ length: G2B_PRE_SPEC_DOC_SLOTS }, (_, index) => index + 1).flatMap(
    (slot) => {
      const field = `specDocFileUrl${slot}`;
      const url = item[field];
      if (typeof url !== "string" || url.trim() === "") return [];
      const checked = checkAttachmentUrl(url.trim());
      if (!checked.ok) {
        blockedFields.push(field);
        return [];
      }
      return [{ name: `사전규격서 ${slot}`, url: checked.url.href }];
    },
  );
  return {
    attachments: docs.filter(
      (doc, index) => docs.findIndex(({ url }) => url === doc.url) === index,
    ),
    blockedFields,
  };
}

const blockedWarning = (
  blockedFields: readonly string[],
  sourceKey: string,
): WarningIssue | undefined =>
  blockedFields.length === 0
    ? undefined
    : { code: "ATTACHMENT_URL_BLOCKED", sourceKey, detail: attachmentBlockedDetail(blockedFields) };

export function normalizeG2bPreSpec(item: G2bItem, context: { fetchedAt: Date }): NormalizeOutcome {
  const noticeId = trimmed(item.bfSpecRgstNo);
  const sourceKey = sourceKeyOf(
    G2B_PRE_SPEC_SOURCE,
    typeof noticeId === "string" ? noticeId : null,
  );
  const title = textOrRaw(present(item.prdctClsfcNoNm), collapseSpaces);
  const docs = specDocsOf(item);
  const sourceUrl = docs.attachments[0]?.url;

  const missing = [
    noticeId === undefined ? "noticeId" : null,
    title === undefined ? "title" : null,
    sourceUrl === undefined ? "sourceUrl" : null,
  ].filter((field) => field !== null);
  if (missing.length > 0) return missingFieldsOutcome(missing, sourceKey);

  const budget = normalizeBudgetValue(present(item.asignBdgtAmt), sourceKey);
  const noticeDate = normalizeDateValue(
    "noticeDate",
    present(item.rgstDt),
    context.fetchedAt,
    sourceKey,
  );
  // 사전규격의 마감은 의견등록 마감이다(07 §6.2 FX-18 "의견등록 +7d").
  const deadlineAt = normalizeDateValue(
    "deadlineAt",
    present(item.opninRgstClseDt),
    context.fetchedAt,
    sourceKey,
  );
  const notes = [
    budget.value === null ? undefined : "budgetKrw: asignBdgtAmt 사용",
    "sourceUrl: 첫 사전규격서(specDocFileUrl) 주소 사용(응답에 상세 주소 없음)",
    noticeDate.note,
    deadlineAt.note,
  ].filter((note) => note !== undefined);

  const candidate = {
    schemaVersion: NORMALIZED_BID_SCHEMA_VERSION,
    source: G2B_PRE_SPEC_SOURCE,
    noticeId,
    preSpecRef: noticeId,
    stage: "PRE_SPEC",
    // 사전규격 응답에는 취소·변경 종류 칸이 없다. 바뀐 값은 checksum 이 새 revision 으로 잡는다.
    status: "OPEN",
    title,
    // 실수요기관이 사업을 발주한 쪽이다. 없으면 공고(발주)기관.
    agency:
      textOrRaw(present(item.rlDminsttNm), collapseSpaces) ??
      textOrRaw(present(item.orderInsttNm), collapseSpaces) ??
      null,
    budgetKrw: budget.value,
    noticeDate: noticeDate.value,
    deadlineAt: deadlineAt.value,
    sourceUrl,
    content: "",
    attachments: docs.attachments,
    structuredQualifications: [],
    original: definedEntries({
      noticeNo: typeof item.bfSpecRgstNo === "string" ? item.bfSpecRgstNo : undefined,
      budget: budget.original,
      noticeDate: noticeDate.original,
      deadline: deadlineAt.original,
    }),
    normalizationNotes: notes,
    isDemo: false,
    fetchedAt: context.fetchedAt.toISOString(),
  };

  return finishDraft(candidate, sourceKey, [
    budget.warning,
    noticeDate.warning,
    deadlineAt.warning,
    dateOrderWarning(noticeDate.value, deadlineAt.value, sourceKey),
    blockedWarning(docs.blockedFields, sourceKey),
  ]);
}
