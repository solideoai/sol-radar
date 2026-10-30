import "server-only";

// 자격 코드 사전(08 §5.1·§6.1). 정본은 gateway 의 services/ai/dictionaries/qualification-codes.yaml 이지만
// 런타임 파일 읽기를 피하려고 TS 상수로 둔다. 두 파일이 같은지는 gateway 쪽 시험이 대조한다.
// fixtures/extractions 의 qualifications[].code 는 지금 전부 null 이라(2026-10-19 확인) 이름 별칭으로도 코드를 찾는다.
// 별칭에 없는 이름(사전 밖) → code null → NEEDS_REVIEW(AMBIGUOUS_MATCH).
//
// > 미검증 가정: 코드 이름과 별칭은 v0.1 가정이다. 나라장터 업종 마스터·실제 공고 표기로 확인하면 고친다.

export type QualificationCode =
  | "SW_BUSINESS_REG"
  | "DIRECT_PRODUCTION"
  | "SME_CONFIRMATION"
  | "ICT_CONSTRUCTION"
  | "DEFENSE_CONTRACTOR"
  | "ISMS_P"
  | "CSAP"
  | "ISO_27001"
  | "CMMI_L3";

export const QUALIFICATION_CODES: Record<QualificationCode, { name: string; aliases: string[] }> = {
  SW_BUSINESS_REG: {
    name: "소프트웨어사업자 신고확인서",
    aliases: ["소프트웨어사업자", "SW사업자 신고확인서", "소프트웨어사업자 신고"],
  },
  DIRECT_PRODUCTION: {
    name: "직접생산확인증명서",
    aliases: [
      "소프트웨어 직접생산확인증명서",
      "직접생산확인",
      "직접생산확인증명서(소프트웨어개발)",
      "직접생산증명서",
    ],
  },
  SME_CONFIRMATION: {
    name: "중소기업확인서",
    // 운영 공고 표기(2026-10-30 실측). "중소기업·소상공인"은 중기업도 낼 수 있는 확인서다.
    // "소기업·소상공인"만 적은 공고는 중기업이 못 낼 수 있어 별칭에 넣지 않는다(사람이 본다).
    aliases: [
      "중소기업 확인서",
      "중소기업확인서(중기업)",
      "중소기업확인서(소기업)",
      "중소기업 확인",
      "중소기업자",
      "중소기업·소상공인 확인서",
      "중소기업\u119e소상공인 확인서",
      "중소기업/소상공인 확인서",
      "중소기업(소상공인) 확인서",
      "중소기업 또는 소상공인 확인서",
      "중·소기업·소상공인 확인서",
      "중·소기업 또는 소상공인",
    ],
  },
  ICT_CONSTRUCTION: {
    name: "정보통신공사업 등록",
    aliases: ["정보통신공사업", "정보통신공사업등록증", "정보통신공사업 등록업체"],
  },
  DEFENSE_CONTRACTOR: {
    name: "방산업체 지정",
    aliases: ["방산업체", "방위산업체 지정", "방위산업체"],
  },
  ISMS_P: { name: "ISMS-P 인증", aliases: ["ISMS-P"] },
  CSAP: { name: "CSAP 인증", aliases: ["CSAP", "클라우드 보안인증"] },
  ISO_27001: { name: "ISO 27001 인증", aliases: ["ISO 27001", "ISO27001"] },
  CMMI_L3: { name: "CMMI Level 3", aliases: ["CMMI L3", "CMMI 레벨3", "CMMI 레벨 3"] },
};

const CODE_LIST = Object.keys(QUALIFICATION_CODES) as QualificationCode[];

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

export function isQualificationCode(code: string | null | undefined): code is QualificationCode {
  // in 은 프로토타입("toString"·"constructor")도 참이라 자기 키만 본다.
  return typeof code === "string" && Object.hasOwn(QUALIFICATION_CODES, code);
}

// 코드가 사전에 있으면 그 코드. 없으면 이름(정확 일치 → 가장 긴 별칭 포함)으로 찾는다. 못 찾으면 null.
export function resolveQualificationCode(
  code: string | null | undefined,
  name: string | null | undefined,
): QualificationCode | null {
  if (isQualificationCode(code)) return code;
  if (!name) return null;
  const target = normalizeName(name);
  const entries = CODE_LIST.flatMap((key) =>
    [QUALIFICATION_CODES[key].name, ...QUALIFICATION_CODES[key].aliases].map((alias) => ({
      key,
      alias: normalizeName(alias),
    })),
  );
  const exact = entries.find((entry) => entry.alias === target);
  if (exact) return exact.key;
  const contained = entries
    .filter((entry) => entry.alias.length >= 4 && target.includes(entry.alias))
    .toSorted((left, right) => right.alias.length - left.alias.length);
  return contained[0]?.key ?? null;
}
