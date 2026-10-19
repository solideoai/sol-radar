import "server-only";
import { isIPv4, isIPv6 } from "node:net";
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_MAX_REDIRECTS } from "./attachment.model";

// ── G2bAttachmentFetcher 의 순수 부분(V2-12, 09 SSRF). 네트워크는 부르지 않는다 ──
// 첨부 URL 은 공고 응답에서 오므로 공격자가 고를 수 있는 값으로 본다. 허용 목록 밖은 모두 막는다.
export const G2B_ATTACHMENT_HOSTS = ["www.g2b.go.kr"] as const;
export const G2B_ATTACHMENT_PATH_PREFIX = "/pn/";

type HostCheck = { ok: true; url: URL } | { ok: false; errorCode: "HOST_NOT_ALLOWED" };
type RedirectCheck = { ok: true; url: URL } | { ok: false; errorCode: "REDIRECT_BLOCKED" };

const HOST_NOT_ALLOWED = { ok: false, errorCode: "HOST_NOT_ALLOWED" } as const;
const REDIRECT_BLOCKED = { ok: false, errorCode: "REDIRECT_BLOCKED" } as const;
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(G2B_ATTACHMENT_HOSTS);
const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const AUTH_STATUSES: ReadonlySet<number> = new Set([401, 403]);

export function checkAttachmentUrl(raw: string): HostCheck {
  if (!URL.canParse(raw)) return { ...HOST_NOT_ALLOWED };
  const url = new URL(raw);
  // pathname 은 URL 이 '..'·'%2e%2e' 를 푼 뒤의 값이라 /pn/ 밖으로 빠지는 경로도 여기서 걸린다.
  const isAllowed =
    url.protocol === "https:" &&
    ALLOWED_HOSTS.has(url.hostname) &&
    url.username === "" &&
    url.password === "" &&
    url.port === "" &&
    url.pathname.startsWith(G2B_ATTACHMENT_PATH_PREFIX);
  return isAllowed ? { ok: true, url } : { ...HOST_NOT_ALLOWED };
}

export function checkRedirect(
  current: URL,
  location: string | null,
  redirectCount: number,
): RedirectCheck {
  if (location === null || location.trim() === "") return { ...REDIRECT_BLOCKED };
  if (redirectCount >= ATTACHMENT_MAX_REDIRECTS) return { ...REDIRECT_BLOCKED };
  if (!URL.canParse(location, current)) return { ...REDIRECT_BLOCKED };
  const checked = checkAttachmentUrl(new URL(location, current).href);
  return checked.ok ? checked : { ...REDIRECT_BLOCKED };
}

// ── IP 판정 ──
type Cidr4 = readonly [base: string, prefix: number];

// 공인 인터넷에서 닿을 수 없거나 내부망·문서용·특수 용도인 대역(RFC 6890 등).
const NON_PUBLIC_IPV4: readonly Cidr4[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const ipv4ToInt = (ip: string): number =>
  ip.split(".").reduce((value, octet) => value * 256 + Number(octet), 0);

const prefixMask = (prefix: number): number =>
  prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;

const inCidr4 = (ip: number, [base, prefix]: Cidr4): boolean =>
  (ip & prefixMask(prefix)) >>> 0 === ipv4ToInt(base);

const isPublicIpv4 = (ip: string): boolean => {
  const value = ipv4ToInt(ip);
  return !NON_PUBLIC_IPV4.some((cidr) => inCidr4(value, cidr));
};

const HEXTET = /^[0-9a-f]{1,4}$/;

// 끝의 a.b.c.d(::ffff:127.0.0.1 등)를 16진 두 묶음으로 바꿔 모든 묶음을 같은 표기로 맞춘다.
function withHexTail(ip: string): string {
  const lastColon = ip.lastIndexOf(":");
  const tail = ip.slice(lastColon + 1);
  if (!tail.includes(".")) return ip;
  const value = ipv4ToInt(tail);
  const high = Math.floor(value / 0x10000).toString(16);
  const low = (value % 0x10000).toString(16);
  return `${ip.slice(0, lastColon + 1)}${high}:${low}`;
}

const groupsOf = (part: string): string[] => (part === "" ? [] : part.split(":"));

// '::' 를 펼쳐 16비트 여덟 묶음으로 만든다. 형식은 isIPv6 가 먼저 확인했다.
function ipv6Hextets(ip: string): number[] | null {
  const halves = withHexTail(ip).split("::");
  if (halves.length > 2) return null;
  const head = groupsOf(halves[0]);
  const rest = halves.length === 2 ? groupsOf(halves[1]) : [];
  const zeroGroups = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array.from({ length: Math.max(zeroGroups, 0) }, () => "0"), ...rest];
  if (groups.length !== 8 || !groups.every((group) => HEXTET.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

function isPublicIpv6(ip: string): boolean {
  // 영역 표기(fe80::1%eth0)는 링크 안에서만 쓰는 주소다.
  if (ip.includes("%")) return false;
  const h = ipv6Hextets(ip.toLowerCase());
  if (h === null) return false;
  const zeroUntil = (end: number): boolean => h.slice(0, end).every((group) => group === 0);
  // IPv4-mapped(::ffff:a.b.c.d)는 안의 IPv4 로 판정한다. 16진 표기도 같은 주소다.
  if (zeroUntil(5) && h[5] === 0xffff) {
    return isPublicIpv4(`${h[6] >> 8}.${h[6] & 0xff}.${h[7] >> 8}.${h[7] & 0xff}`);
  }
  const isNonPublic =
    // ::/96: 미지정(::)·루프백(::1)과 폐기된 IPv4-compatible 주소
    zeroUntil(6) ||
    (h[0] & 0xfe00) === 0xfc00 || // fc00::/7 고유 지역
    (h[0] & 0xffc0) === 0xfe80 || // fe80::/10 링크 로컬
    (h[0] & 0xff00) === 0xff00 || // ff00::/8 멀티캐스트
    (h[0] === 0x2001 && h[1] === 0x0db8) || // 2001:db8::/32 문서용
    (h[0] === 0x0064 && h[1] === 0xff9b && h.slice(2, 6).every((group) => group === 0)) || // 64:ff9b::/96
    (h[0] === 0x0100 && h.slice(1, 4).every((group) => group === 0)); // 100::/64 폐기용
  return !isNonPublic;
}

/** 공인 주소면 true. IP 형식이 아니면(호스트 이름·정수 표기 등) false 다. */
export function isPublicAddress(ip: string): boolean {
  if (isIPv4(ip)) return isPublicIpv4(ip);
  if (isIPv6(ip)) return isPublicIpv6(ip);
  return false;
}

/** DNS 재확인 결과. 하나라도 사설이면 DNS rebinding 으로 내부망에 닿을 수 있어 막는다. */
export function checkResolvedAddresses(
  addresses: readonly string[],
): { ok: true } | { ok: false; errorCode: "HOST_NOT_ALLOWED" } {
  return addresses.length > 0 && addresses.every(isPublicAddress)
    ? { ok: true }
    : { ...HOST_NOT_ALLOWED };
}

export function classifyHttpStatus(
  status: number,
): "OK" | "REDIRECT" | "AUTH_REQUIRED" | "HTTP_4XX" | "HTTP_5XX" {
  if (status === 200) return "OK";
  if (REDIRECT_STATUSES.has(status)) return "REDIRECT";
  if (AUTH_STATUSES.has(status)) return "AUTH_REQUIRED";
  if (status >= 400 && status <= 499) return "HTTP_4XX";
  // 200 이 아닌 2xx·3xx(204·206·304 등)는 첨부 본문을 받지 못한 것이라 서버 쪽 실패로 묶는다.
  return "HTTP_5XX";
}

/** 선언한 크기만 미리 본다. 없거나 이상한 값은 받으면서 exceedsMaxBytes 로 다시 막는다. */
export function checkDeclaredSize(
  contentLength: string | null,
): { ok: true } | { ok: false; errorCode: "TOO_LARGE" } {
  if (contentLength === null || !/^\d+$/.test(contentLength.trim())) return { ok: true };
  return Number(contentLength.trim()) > ATTACHMENT_MAX_BYTES
    ? { ok: false, errorCode: "TOO_LARGE" }
    : { ok: true };
}

export function exceedsMaxBytes(receivedBytes: number): boolean {
  return receivedBytes > ATTACHMENT_MAX_BYTES;
}
