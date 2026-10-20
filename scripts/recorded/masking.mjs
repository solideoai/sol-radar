// 공공 API 응답의 담당자 개인정보 마스킹(09 보안, 21 §3.6, external-deps-api-20261019.md §6 확정 목록).
//
// 규칙
//   1. 이름 필드(ntceInsttOfclNm·exctvNm·crdtrNm·ofclNm)는 값이 있으면 "***".
//   2. 연락처 필드(ntceInsttOfclTelNo·ntceInsttOfclEmailAdrs·dminsttOfclEmailAdrs·ofclTelNo·telNo)는 같은 길이의 "*".
//   3. 목록에 없는 새 담당자 필드도 이름 규칙으로 잡는다(g2b.model.ts isContactField 와 같은 규칙:
//      "Ofcl" 포함, TelNo·FaxNo·EmailAdrs·HpNo 접미사). Nm 으로 끝나면 1, 아니면 2.
//   4. 나머지 모든 문자열 값에서 이메일·전화 패턴을 같은 길이의 "*" 로 바꾼다(인용 오프셋 보존).
//      바꾼 필드는 maskedFields 에 "<필드>(pattern)" 로 남긴다.
// 순수 함수다. 입력을 바꾸지 않고 새 객체를 돌려준다.

export const NAME_FIELDS = ["ntceInsttOfclNm", "exctvNm", "crdtrNm", "ofclNm"];
export const CONTACT_FIELDS = [
  "ntceInsttOfclTelNo",
  "ntceInsttOfclEmailAdrs",
  "dminsttOfclEmailAdrs",
  "ofclTelNo",
  "telNo",
];
/** 15129394 의 확정 마스킹 대상(§6). 담당자 필드가 없는 응답에도 이 목록을 maskedFields 에 적는다(C1 관례). */
export const G2B_BID_NOTICE_MASK_TARGETS = [
  "ntceInsttOfclNm",
  "exctvNm",
  "crdtrNm",
  "ntceInsttOfclTelNo",
  "ntceInsttOfclEmailAdrs",
  "dminsttOfclEmailAdrs",
];
export const NAME_MASK = "***";
export const PATTERN_SUFFIX = "(pattern)";

const CONTACT_NAME_PART = "Ofcl";
const CONTACT_NAME_SUFFIX = /(TelNo|FaxNo|EmailAdrs|HpNo)$/;
const NAME_SET = new Set(NAME_FIELDS);
const CONTACT_SET = new Set(CONTACT_FIELDS);

export const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 02-123-4567, 031-1234-5678, 010-1234-5678. 날짜(2026-10-12)는 가운데가 2자리라 잡히지 않는다.
export const PHONE_PATTERN = /(?<!\d)\d{2,4}-\d{3,4}-\d{4}(?!\d)/g;

const isNameField = (key) =>
  NAME_SET.has(key) || (key.includes(CONTACT_NAME_PART) && key.endsWith("Nm"));
const isContactField = (key) =>
  CONTACT_SET.has(key) ||
  (key.includes(CONTACT_NAME_PART) && !key.endsWith("Nm")) ||
  CONTACT_NAME_SUFFIX.test(key);

export const sameLengthStars = (value) => "*".repeat(value.length);

/** 문자열 안의 이메일·전화 패턴만 같은 길이의 * 로 바꾼다. 바뀐 것이 없으면 changed:false. */
export function maskPatterns(text) {
  let changed = false;
  const masked = text
    .replace(EMAIL_PATTERN, (hit) => {
      changed = true;
      return sameLengthStars(hit);
    })
    .replace(PHONE_PATTERN, (hit) => {
      changed = true;
      return sameLengthStars(hit);
    });
  return { masked, changed };
}

/** 행 하나를 마스킹한다. 돌려주는 maskedFields 는 실제로 값을 바꾼 필드 이름이다. */
export function maskItem(item) {
  const maskedFields = new Set();
  const out = {};
  for (const [key, value] of Object.entries(item)) {
    if (typeof value !== "string" || value === "") {
      out[key] = value;
      continue;
    }
    if (isNameField(key)) {
      out[key] = NAME_MASK;
      maskedFields.add(key);
    } else if (isContactField(key)) {
      out[key] = sameLengthStars(value);
      maskedFields.add(key);
    } else {
      const { masked, changed } = maskPatterns(value);
      out[key] = masked;
      if (changed) maskedFields.add(`${key}${PATTERN_SUFFIX}`);
    }
  }
  return { item: out, maskedFields };
}

/** 행 배열을 마스킹하고, 바꾼 필드 이름의 합집합을 정렬해 돌려준다. */
export function maskItems(items) {
  const union = new Set();
  const masked = items.map((item) => {
    const result = maskItem(item);
    for (const field of result.maskedFields) union.add(field);
    return result.item;
  });
  return { items: masked, maskedFields: [...union].sort() };
}

/**
 * 저장한 텍스트에 남은 개인정보·키 흔적을 센다. 전부 0 이어야 한다.
 * secrets 는 서비스키의 여러 형태(원문·디코드·인코딩)다. 값은 돌려주지 않고 개수만 돌려준다.
 */
export function scanLeaks(text, secrets = []) {
  const count = (pattern) => (text.match(pattern) ?? []).length;
  const secretHits = secrets.filter((secret) => secret !== "" && text.includes(secret)).length;
  return {
    email: count(EMAIL_PATTERN),
    phone: count(PHONE_PATTERN),
    serviceKeyParam: count(/servicekey/gi),
    secret: secretHits,
  };
}

export const hasLeak = (scan) => Object.values(scan).some((value) => value > 0);
