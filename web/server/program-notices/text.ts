import "server-only";

// ── 부처 공고 글자 규칙: 원문 HTML 을 평문으로, 연락처를 가리고, 두 소스 사이 같은 공고를 묶는 키를 만든다 ──
// 원문은 화면에서 HTML 로 해석하지 않는다(스펙 §4). 그래서 저장 전에 평문으로 바꾼다.
// 사업개요·신청방법·지원대상에 담당자 전화·이메일이 섞여 오므로 저장 전에 같은 길이의 * 로 가린다(09 보안, 스펙 §5).

const DROP_WITH_CONTENT = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const LINE_BREAK_TAGS = /<br\s*\/?>|<\/(p|div|li|tr|h[1-6])\s*>/gi;
const ANY_TAG = /<[^>]*>/g;
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};
const ENTITY = /&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]+);/gi;
const MAX_CODE_POINT = 0x10ffff;

/** 숫자 참조와 이름 참조 6개(amp·lt·gt·quot·apos·nbsp)만 푼다. 모르는 참조는 그대로 둔다. */
export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (whole, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      return Number.isInteger(code) && code > 0 && code <= MAX_CODE_POINT
        ? String.fromCodePoint(code)
        : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** 태그를 걷고(script·style 은 내용째) 문단·줄바꿈 태그는 줄바꿈으로 바꾼 뒤 참조를 푼다. 빈 줄은 하나까지만 남긴다. */
export function htmlToPlainText(raw: string): string {
  const withoutTags = raw
    .replace(DROP_WITH_CONTENT, "")
    .replace(LINE_BREAK_TAGS, "\n")
    .replace(ANY_TAG, "");
  return decodeEntities(withoutTags)
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CONTACT_PATTERNS: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // 02-123-4567, 010-1234-5678, (02) 123-4567, 02.123.4567. 지역번호는 0 으로 시작한다(날짜·금액을 잡지 않게).
  /(?<![\d,])\(?0\d{1,2}\)?[ .)-]{0,2}\d{3,4}[-. ]\d{4}(?!\d)/g,
  // 대표번호 1588-1234 같은 15xx·16xx·18xx. 뒤에 단위(만원·년·명 등)가 붙으면 금액·연도 범위로 보고 두지 않는다.
  /(?<![\d,.-])1[568]\d{2}-\d{4}(?![\d\-만천억원년명개곳회건])/g,
];

/** 이메일·전화·대표번호를 같은 길이의 * 로 바꾼다(글자 위치를 지킨다). */
export function maskContacts(text: string): string {
  return CONTACT_PATTERNS.reduce(
    (masked, pattern) => masked.replace(pattern, (hit) => "*".repeat(hit.length)),
    text,
  );
}

/** 문자열이면 평문화·가림·trim 을 하고 상한을 넘으면 잘라 말줄임표를 붙인다. 빈 값·문자열이 아니면 null. */
export function cleanText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== "string") return null;
  const text = maskContacts(htmlToPlainText(raw));
  if (text === "") return null;
  const chars = [...text];
  return chars.length > maxLength ? `${chars.slice(0, maxLength).join("")}…` : text;
}

const LEADING_TAG = /^\s*(\[[^\]]{0,20}\]|\([^)]{0,20}\)|【[^】]{0,20}】)\s*/;
const NOT_WORD = /[\s\p{P}\p{S}]+/gu;

const normalizePart = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(NOT_WORD, "");

/** 정규화한 제목 + 소관기관. 앞머리 [..]·(..)·【..】 하나, 공백·구두점·기호, 전각·대소문자 차이를 무시한다. */
export function dedupeKeyOf(title: string, agency: string | null): string {
  const normalizedTitle = normalizePart(title.normalize("NFKC").replace(LEADING_TAG, ""));
  return `${normalizedTitle}|${normalizePart(agency ?? "")}`;
}
