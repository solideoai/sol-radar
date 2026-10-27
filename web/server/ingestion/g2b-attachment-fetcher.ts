import "server-only";
import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns";
import { request } from "node:https";
import type { LookupFunction } from "node:net";
import {
  G2B_ATTACHMENT_HOSTS,
  checkAttachmentUrl,
  checkDeclaredSize,
  checkRedirect,
  checkResolvedAddresses,
  classifyHttpStatus,
  exceedsMaxBytes,
} from "./attachment-allowlist";
import {
  ATTACHMENT_TIMEOUT_MS,
  DOCUMENT_FORMAT_MIME,
  type AttachmentFetcher,
  type AttachmentFetchResult,
  type DownloadErrorCode,
} from "./attachment.model";
import { detectDocumentFormat } from "./document-format";

// ── G2bAttachmentFetcher(07 §2.4, 09 SSRF): 나라장터 첨부를 내려받는다. documents worker 만 부른다 ──
// 첨부 URL 은 공고 응답에서 오므로 공격자가 고를 수 있는 값으로 본다.
// - 허용 목록(https·www.g2b.go.kr·/pn/)을 통과한 URL 만 요청한다. 리다이렉트도 매번 같은 목록으로 다시 본다(최대 3회).
// - DNS 결과를 연결 전에 확인하고(사설·특수 대역 거부), 확인한 주소로만 연결한다(DNS rebinding 차단).
// - 리다이렉트를 포함한 전체 시간 30초, 본문 50 MiB. 넘으면 받는 도중에 연결을 끊는다.
// - 형식은 Content-Type·파일 이름이 아니라 매직 바이트로 판정한다.
// 세션·쿠키·로그인 정보를 보내지 않는다. 로그인 경로로 보내면 AUTH_REQUIRED 다(2026-10-19 실측 절차와 같다).

export type AttachmentResponse = {
  status: number;
  location: string | null;
  contentLength: string | null;
  body: AsyncIterable<Uint8Array>;
  /** 남은 본문을 버리고 연결을 닫는다 */
  close(): void;
};

/** URL 하나를 GET 한다. 리다이렉트는 따라가지 않는다(판정은 fetcher 몫) */
export type AttachmentTransport = (url: URL, signal: AbortSignal) => Promise<AttachmentResponse>;

/** DNS 결과에 공인 주소가 아닌 것이 섞였다. 연결 전에 끊는다 */
class BlockedAddressError extends Error {
  constructor() {
    super("attachment host resolved to a non-public address");
    this.name = "BlockedAddressError";
  }
}

const ALLOWED_HOSTS: ReadonlySet<string> = new Set(G2B_ATTACHMENT_HOSTS);
const LOGIN_PATH = /(login|sso)/i;
const REQUEST_HEADERS = { accept: "*/*", "user-agent": "node" } as const;

const failed = (errorCode: DownloadErrorCode): AttachmentFetchResult => ({
  status: "FAILED",
  errorCode,
});

/** 확인한 주소 목록을 그대로 연결에 쓴다. 두 번 묻지 않으므로 확인과 연결 사이에 주소가 바뀌지 않는다 */
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }
    if (!checkResolvedAddresses(addresses.map((entry) => entry.address)).ok) {
      callback(new BlockedAddressError(), "");
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};

const headerOf = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? null) : null;

/** node:https 전송. keep-alive 를 쓰지 않아 요청마다 위 DNS 확인을 거친다 */
export const httpsAttachmentTransport: AttachmentTransport = (url, signal) =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      url,
      { method: "GET", agent: false, lookup: guardedLookup, signal, headers: REQUEST_HEADERS },
      (incoming) =>
        resolve({
          status: incoming.statusCode ?? 0,
          location: headerOf(incoming.headers.location),
          contentLength: headerOf(incoming.headers["content-length"]),
          body: incoming,
          close: () => incoming.destroy(),
        }),
    );
    outgoing.on("error", reject);
    outgoing.end();
  });

const isSystemError = (error: unknown): boolean =>
  error instanceof Error && "code" in error && typeof error.code === "string";

/** 같은 허용 호스트의 로그인·SSO 경로로 보내면 로그인이 필요한 첨부다 */
function isLoginRedirect(current: URL, location: string | null): boolean {
  if (location === null || !URL.canParse(location, current)) return false;
  const target = new URL(location, current);
  return ALLOWED_HOSTS.has(target.hostname) && LOGIN_PATH.test(target.pathname);
}

type BodyResult = { ok: true; bytes: Buffer } | { ok: false; errorCode: "TOO_LARGE" };

/** 받은 양이 상한을 넘는 순간 연결을 끊는다(나머지는 받지 않는다) */
async function readCapped(response: AttachmentResponse): Promise<BodyResult> {
  const chunks: Uint8Array[] = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.byteLength;
    if (exceedsMaxBytes(received)) {
      response.close();
      return { ok: false, errorCode: "TOO_LARGE" };
    }
    chunks.push(chunk);
  }
  return { ok: true, bytes: Buffer.concat(chunks, received) };
}

function toDownload(bytes: Buffer): AttachmentFetchResult {
  const format = detectDocumentFormat(bytes);
  return {
    status: "OK",
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    format,
    mimeType: DOCUMENT_FORMAT_MIME[format],
  };
}

async function download(
  start: URL,
  transport: AttachmentTransport,
  signal: AbortSignal,
): Promise<AttachmentFetchResult> {
  let url = start;
  for (let redirects = 0; ; redirects += 1) {
    const response = await transport(url, signal);
    const kind = classifyHttpStatus(response.status);
    if (kind === "REDIRECT") {
      response.close();
      if (isLoginRedirect(url, response.location)) return failed("AUTH_REQUIRED");
      const next = checkRedirect(url, response.location, redirects);
      if (!next.ok) return failed(next.errorCode);
      url = next.url;
      continue;
    }
    if (kind !== "OK") {
      response.close();
      return failed(kind);
    }
    const declared = checkDeclaredSize(response.contentLength);
    if (!declared.ok) {
      response.close();
      return failed(declared.errorCode);
    }
    const body = await readCapped(response);
    if (!body.ok) return failed(body.errorCode);
    // 빈 200 은 첨부를 받지 못한 것이다(서버 쪽 실패로 묶어 다시 시도한다).
    return body.bytes.byteLength === 0 ? failed("HTTP_5XX") : toDownload(body.bytes);
  }
}

export function createG2bAttachmentFetcher(
  deps: { transport?: AttachmentTransport; timeoutMs?: number } = {},
): AttachmentFetcher {
  const transport = deps.transport ?? httpsAttachmentTransport;
  const timeoutMs = deps.timeoutMs ?? ATTACHMENT_TIMEOUT_MS;
  return {
    async fetch(ref) {
      const checked = checkAttachmentUrl(ref.url);
      if (!checked.ok) return failed(checked.errorCode);
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        return await download(checked.url, transport, signal);
      } catch (error) {
        if (error instanceof BlockedAddressError) return failed("HOST_NOT_ALLOWED");
        if (signal.aborted) return failed("TIMEOUT");
        // 연결 거부·DNS 실패·TLS·끊김은 상대 서버 쪽 일시 장애로 묶는다(07 재시도 대상)
        if (isSystemError(error)) return failed("HTTP_5XX");
        throw error;
      }
    },
  };
}
