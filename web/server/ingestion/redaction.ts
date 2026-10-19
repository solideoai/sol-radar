import "server-only";

// ── V2-11 서비스키 보호: 로그·오류·ingest_errors 에 서비스키가 어떤 형태로도 남지 않게 한다 ──
export const REDACTED = "[REDACTED]";

const SERVICE_KEY_PARAM_NAME = "servicekey";
const SERVICE_KEY_QUERY = /([?&]servicekey=)[^&#]*/gi;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

const escapeRegex = (text: string): string => text.replace(REGEX_SPECIAL, "\\$&");

// data.go.kr 키는 '+'·'/'·'=' 를 품어서 요청 URL 에는 1회 또는 2회 인코딩된 형태로 실린다.
function encodedForms(secret: string): string[] {
  try {
    const once = encodeURIComponent(secret);
    return [secret, once, encodeURIComponent(once)];
  } catch {
    // 짝이 없는 서로게이트는 인코딩할 수 없다. 그 형태는 URL 에도 실릴 수 없으니 원문만 가린다.
    return [secret];
  }
}

export function redactSecrets(text: string, secrets: readonly string[]): string {
  const forms = [
    ...new Set(secrets.filter((secret) => secret.trim() !== "").flatMap(encodedForms)),
  ].sort((left, right) => right.length - left.length);
  if (forms.length === 0) return text;
  // 한 번의 치환으로 가린다. 형태마다 따로 바꾸면 이미 넣은 [REDACTED] 안을 다시 건드릴 수 있다.
  // 7-6: 서버가 퍼센트 인코딩을 소문자 16진(%2b)으로 되돌려 줄 수 있어 대소문자를 가리지 않는다(과하게 가려도 해가 없다).
  const pattern = new RegExp(forms.map(escapeRegex).join("|"), "gi");
  return text.replace(pattern, REDACTED);
}

function isServiceKeyName(rawName: string): boolean {
  try {
    return (
      decodeURIComponent(rawName.replaceAll("+", " ")).toLowerCase() === SERVICE_KEY_PARAM_NAME
    );
  } catch {
    return rawName.toLowerCase() === SERVICE_KEY_PARAM_NAME;
  }
}

const redactQueryPart = (part: string): string => {
  const separator = part.indexOf("=");
  if (separator === -1) return part;
  const name = part.slice(0, separator);
  return isServiceKeyName(name) ? `${name}=${REDACTED}` : part;
};

// URL 을 다시 직렬화하면 다른 파라미터의 인코딩이 바뀔 수 있어서, 쿼리 문자열을 원문 그대로 잘라 값만 바꾼다.
export function redactUrl(url: string): string {
  if (!URL.canParse(url)) return url.replace(SERVICE_KEY_QUERY, `$1${REDACTED}`);
  const hashIndex = url.indexOf("#");
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  const queryIndex = beforeHash.indexOf("?");
  if (queryIndex === -1) return url;
  const query = beforeHash
    .slice(queryIndex + 1)
    .split("&")
    .map(redactQueryPart)
    .join("&");
  return `${beforeHash.slice(0, queryIndex + 1)}${query}${hash}`;
}
