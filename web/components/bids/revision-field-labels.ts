import type { RevisionFieldChange } from "@/server/bids";

// 변경 이력 화면의 항목 이름(스펙 §3.3·§7). amendmentNo 는 항목 표에 넣지 않고 머리말(차수)에 보인다(J5).
export const REVISION_FIELD_LABEL = {
  budgetKrw: "예산",
  deadlineAt: "마감",
  structuredQualifications: "자격 요건",
  attachments: "첨부",
  content: "본문",
  status: "공고 상태",
  title: "공고명",
  agency: "발주기관",
  noticeDate: "공고일",
  stage: "단계",
  sourceUrl: "원문 주소",
  planRef: "발주계획 번호",
  preSpecRef: "사전규격 번호",
} as const satisfies Record<RevisionFieldChange["field"], string>;

const KNOWN_FIELDS: ReadonlySet<string> = new Set(Object.keys(REVISION_FIELD_LABEL));

// 저장된 changed_fields 가운데 화면이 이름을 아는 것만, 중복 없이 센다. 레일의 "바뀐 항목 N개"가 쓴다.
export function shownChangeCount(changedFields: readonly string[]): number {
  return new Set(changedFields.filter((field) => KNOWN_FIELDS.has(field))).size;
}
