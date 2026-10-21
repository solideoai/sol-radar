import "server-only";
import { REDACTED, redactSecrets } from "@/server/ingestion";
import type { ProgramRunErrorCode } from "./program-notice.model";

// ── 부처 공고 HTTP: 허용 호스트 두 곳에만 https 로 묻고, 리다이렉트를 따르지 않고, 크기·시간을 묶는다 ──
// SSRF 방어(09 보안): 주소는 설정 파일에서 오지만 틀린 값이 들어와도 다른 호스트로는 나가지 않는다.
// 결과에는 오류 코드만 담는다. 예외 메시지에는 요청 URL(기업마당 crtfcKey 포함)이 실릴 수 있어 남기지 않는다.

export const PROGRAM_NOTICE_HOSTS = ["www.bizinfo.go.kr", "mss.go.kr"] as const;

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export type FetchProgramResult =
  | { ok: true; body: string; status: number }
  | { ok: false; errorCode: ProgramRunErrorCode; status?: number };

type FetchDeps = {
  fetch: FetchLike;
  secrets: readonly string[];
  timeoutMs?: number;
  maxBytes?: number;
};

const isAllowedRequestUrl = (raw: string): boolean => {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    (PROGRAM_NOTICE_HOSTS as readonly string[]).includes(url.hostname)
  );
};

const isTimeout = (error: unknown): boolean =>
  error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError");

class BodyTooLarge extends Error {}

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  chunks.reduce((offset, chunk) => {
    joined.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return new TextDecoder("utf-8").decode(joined);
}

/** 허용 호스트 GET. 3xx 는 따르지 않고 실패, 2xx 가 아니면 상태 코드와 함께 실패. 키는 결과에 남지 않는다. */
export async function fetchProgramSource(
  url: string,
  deps: FetchDeps,
): Promise<FetchProgramResult> {
  if (!isAllowedRequestUrl(url)) return { ok: false, errorCode: "HOST_NOT_ALLOWED" };
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await deps.fetch(url, { method: "GET", redirect: "manual", signal });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { ok: false, errorCode: "REDIRECT_BLOCKED", status: response.status };
    }
    if (!response.ok) {
      await response.body?.cancel();
      return { ok: false, errorCode: "HTTP_ERROR", status: response.status };
    }
    return { ok: true, body: await readBounded(response, maxBytes), status: response.status };
  } catch (error) {
    if (error instanceof BodyTooLarge) return { ok: false, errorCode: "TOO_LARGE" };
    if (isTimeout(error) || signal.aborted) return { ok: false, errorCode: "TIMEOUT" };
    return { ok: false, errorCode: "HTTP_ERROR" };
  }
}

const CRTFC_KEY_QUERY = /([?&]crtfcKey=)[^&#]*/gi;

/** 로그·증거에 남길 URL·문장에서 crtfcKey 값과 비밀 문자열을 가린다. */
export const redactProgramUrl = (text: string, secrets: readonly string[]): string =>
  redactSecrets(text.replace(CRTFC_KEY_QUERY, `$1${REDACTED}`), secrets);

type LinkSite = { origin: string; hosts: readonly string[] };

/**
 * 공고 원문 주소를 화면 링크로 쓸 수 있게 맞춘다. 상대 주소는 사이트 주소를 붙이고, 그 사이트의 http 는 https 로 올린다.
 * 그 사이트 밖·https 로 못 올리는 체계·포트·계정이 붙은 주소는 null 이다(피드가 오염돼도 남의 사이트로 보내지 않는다).
 */
export function toSourceLink(raw: string, site: LinkSite): string | null {
  const text = raw.trim();
  if (text === "" || text.startsWith("//") || !URL.canParse(text, site.origin)) return null;
  const url = new URL(text, site.origin);
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.port !== "" || url.username !== "" || url.password !== "") return null;
  if (!site.hosts.includes(url.hostname)) return null;
  url.protocol = "https:";
  return url.toString();
}
