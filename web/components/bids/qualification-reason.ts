import type { QualificationCheckView } from "@/server/bids";

// 자격 행의 이름·사유를 화면 문장으로 옮긴다. 저장된 값(qualification_checks)은 고치지 않는다.
// 바꾸는 문장은 규칙 엔진(scoring/qualification.ts)이 만든 고정 문구다. 보조 조회 키·규칙 버전·영어 코드처럼
// 사용자가 읽을 수 없는 내부 이름을 뺀다(2026-11-03 사용자 지시). 그 밖의 문장은 그대로 둔다.

// scoring auxLookupChecks 의 행 이름. 공공 API 보조 조회(면허제한·참가가능지역·e발주 첨부)를 받지 못한 공고에 붙는다.
// 공고에 정보가 없는 것이 아니라 우리가 받아 오지 못한 것이라, 그렇게 읽히게 쓴다.
const AUX_LOOKUP_REASON = new Map([
  [
    "면허·지역 제한 조회 실패(호출 예산)",
    "나라장터 API의 하루 호출 한도에 걸려 면허·지역 제한 정보를 받아 오지 못했습니다. 나라장터 공고 원문에서 확인하세요.",
  ],
  [
    "면허·지역 제한 조회 실패",
    "나라장터에서 면허·지역 제한 정보를 받아 오지 못했습니다(조회 오류). 나라장터 공고 원문에서 확인하세요.",
  ],
]);
const AUX_LOOKUP_NAME = "면허·지역 제한";

const REASON_REWRITES: readonly (readonly [pattern: RegExp, replacement: string])[] = [
  [/공고에서 자격 요건을 꺼내지 못함\(UNKNOWN\)/g, "AI가 공고에서 자격 요건을 찾지 못함"],
  [
    /면허제한이 (\d+)행이라 AND\/OR 를 확인하지 못함/g,
    "면허제한이 $1개라 모두 필요한지 하나만 필요한지 확인하지 못함",
  ],
  // 규칙 버전 꼬리표 "(v0.1)"
  [/\(v\d+\.\d+\)/g, ""],
  // 자격 코드 꼬리표 "(SW_BUSINESS_REG)". 밑줄이 있는 대문자 코드만 뺀다(공고 원문의 "(ISMS)" 같은 이름은 남긴다).
  [/\([A-Z][A-Z0-9]*_[A-Z0-9_]+\)/g, ""],
];

export function readableCheck(
  check: Pick<QualificationCheckView, "requirementName" | "reason" | "basis">,
): { name: string; reason: string } {
  const auxReason =
    check.basis === "API_FIELD" ? AUX_LOOKUP_REASON.get(check.requirementName) : undefined;
  if (auxReason !== undefined) return { name: AUX_LOOKUP_NAME, reason: auxReason };
  const reason = REASON_REWRITES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    check.reason,
  );
  return { name: check.requirementName, reason };
}
