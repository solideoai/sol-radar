import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkAttachmentUrl,
  checkDeclaredSize,
  checkRedirect,
  checkResolvedAddresses,
  classifyHttpStatus,
  exceedsMaxBytes,
  G2B_ATTACHMENT_HOSTS,
  G2B_ATTACHMENT_PATH_PREFIX,
  isPublicAddress,
} from "./attachment-allowlist";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_REDIRECTS,
  ATTACHMENT_TIMEOUT_MS,
  attachmentObjectKey,
  DOCUMENT_FORMAT_EXT,
  DOCUMENT_FORMAT_MIME,
  DOWNLOAD_ERROR_CODES,
  type AttachmentFetchResult,
  type AttachmentDownload,
  type DocumentFormat,
} from "./attachment.model";
import { detectDocumentFormat } from "./document-format";
import { createFixtureAttachmentFetcher } from "./fixture-attachment-fetcher";

// V2-12: 첨부 다운로드 allowlist(09 보안 SSRF, 07 §2.4). https://www.g2b.go.kr 의 /pn/ 아래만, 리다이렉트도 allowlist 안에서만,
// DNS 재확인 뒤 사설 IP 거부, timeout 30 s, 최대 50 MB, 형식은 매직 바이트로. 네트워크는 부르지 않는다.
// fixtures/docs/ 는 아직 없다(07 §6.5) — FixtureAttachmentFetcher 는 os.tmpdir 아래 임시 fixturesDir 로 시험하고 지운다.

const G2B_EXAMPLE =
  "https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile.do?bidPbancNo=R26BK01776253&bidPbancOrd=000&fileType=&fileSeq=1&prcmBsneSeCd=03";

const HOST_NOT_ALLOWED = { ok: false, errorCode: "HOST_NOT_ALLOWED" };
const REDIRECT_BLOCKED = { ok: false, errorCode: "REDIRECT_BLOCKED" };

const ascii = (text: string): number[] => Array.from(new TextEncoder().encode(text));
const zeros = (length: number): number[] => Array.from({ length }, () => 0);
const bytesOf = (...parts: number[][]): Uint8Array => Uint8Array.from(parts.flat());

const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PK = [0x50, 0x4b, 0x03, 0x04];

const PDF_BYTES = bytesOf(ascii("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n"));
const HWP_BYTES = bytesOf(OLE, zeros(56), ascii("HWP Document File"), zeros(16));
const OLE_DOC_BYTES = bytesOf(OLE, zeros(56), ascii("Microsoft Word-Dokument"), zeros(16));
const HWPX_BYTES = bytesOf(
  PK,
  zeros(26),
  ascii("mimetype"),
  ascii("application/hwp+zip"),
  zeros(8),
);
const XLSX_BYTES = bytesOf(
  PK,
  zeros(26),
  ascii("[Content_Types].xml"),
  zeros(8),
  PK,
  ascii("xl/workbook.xml"),
);
const DOCX_BYTES = bytesOf(
  PK,
  zeros(26),
  ascii("[Content_Types].xml"),
  zeros(8),
  PK,
  ascii("word/document.xml"),
);
const ZIP_BYTES = bytesOf(PK, zeros(26), ascii("readme.txt"), ascii("hello"));

const SHA = "a".repeat(64);

describe("상수 (07 §2.4, 09 SSRF)", () => {
  it("허용 호스트는 www.g2b.go.kr 하나다", () => {
    expect(G2B_ATTACHMENT_HOSTS).toEqual(["www.g2b.go.kr"]);
  });

  it("허용 경로 접두사는 /pn/ 이다", () => {
    expect(G2B_ATTACHMENT_PATH_PREFIX).toBe("/pn/");
  });

  it("최대 크기는 50 MiB(52428800 바이트)다", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(52_428_800);
  });

  it("timeout 은 30초다", () => {
    expect(ATTACHMENT_TIMEOUT_MS).toBe(30_000);
  });

  it("리다이렉트는 최대 3번이다", () => {
    expect(ATTACHMENT_MAX_REDIRECTS).toBe(3);
  });

  it("다운로드 오류 코드는 계약의 8개다", () => {
    expect(DOWNLOAD_ERROR_CODES).toEqual([
      "AUTH_REQUIRED",
      "HTTP_4XX",
      "HTTP_5XX",
      "REDIRECT_BLOCKED",
      "HOST_NOT_ALLOWED",
      "TOO_LARGE",
      "TIMEOUT",
      "NOT_FOUND",
    ]);
  });

  it("형식별 MIME 은 계약 표와 같다", () => {
    expect(DOCUMENT_FORMAT_MIME).toEqual({
      PDF: "application/pdf",
      HWP: "application/x-hwp",
      HWPX: "application/hwp+zip",
      ZIP: "application/zip",
      XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      UNKNOWN: "application/octet-stream",
    });
  });

  it("형식별 확장자는 계약 표와 같다(UNKNOWN 은 bin)", () => {
    expect(DOCUMENT_FORMAT_EXT).toEqual({
      PDF: "pdf",
      HWP: "hwp",
      HWPX: "hwpx",
      ZIP: "zip",
      XLSX: "xlsx",
      UNKNOWN: "bin",
    });
  });
});

describe("checkAttachmentUrl — 허용", () => {
  it("실제 나라장터 첨부 다운로드 형태의 URL 은 허용한다", () => {
    const result = checkAttachmentUrl(G2B_EXAMPLE);
    if (!result.ok) throw new Error("허용돼야 한다");
    expect(result.url.href).toBe(G2B_EXAMPLE);
  });

  it("호스트 대소문자는 가리지 않는다: WWW.G2B.GO.KR 은 허용하고 소문자로 정규화한다", () => {
    const result = checkAttachmentUrl("https://WWW.G2B.GO.KR/pn/download.do?fileSeq=1");
    if (!result.ok) throw new Error("허용돼야 한다");
    expect(result.url.hostname).toBe("www.g2b.go.kr");
  });

  it("스킴 대소문자도 가리지 않는다: HTTPS:// 는 허용한다", () => {
    expect(checkAttachmentUrl("HTTPS://www.g2b.go.kr/pn/download.do").ok).toBe(true);
  });

  it("기본 포트 :443 은 URL 이 지워 port 가 비므로 허용한다", () => {
    expect(checkAttachmentUrl("https://www.g2b.go.kr:443/pn/download.do").ok).toBe(true);
  });
});

describe("checkAttachmentUrl — 거부(HOST_NOT_ALLOWED)", () => {
  it.each([
    ["http 스킴", "http://www.g2b.go.kr/pn/download.do"],
    ["ftp 스킴", "ftp://www.g2b.go.kr/pn/download.do"],
    ["file 스킴", "file:///pn/etc/passwd"],
    ["www 없는 호스트", "https://g2b.go.kr/pn/download.do"],
    ["다른 호스트", "https://evil.example/pn/download.do"],
    ["허용 호스트를 앞에 붙인 다른 호스트", "https://www.g2b.go.kr.evil.example/pn/download.do"],
    ["끝에 점이 붙은 호스트", "https://www.g2b.go.kr./pn/download.do"],
    ["userinfo(사용자·비밀번호)", "https://user:pass@www.g2b.go.kr/pn/download.do"],
    ["userinfo(사용자만)", "https://user@www.g2b.go.kr/pn/download.do"],
    ["허용 호스트를 userinfo 로 위장", "https://www.g2b.go.kr@evil.example/pn/download.do"],
    ["기본이 아닌 포트", "https://www.g2b.go.kr:8443/pn/download.do"],
    ["/pn/ 밖 경로", "https://www.g2b.go.kr/other/download.do"],
    ["루트 경로", "https://www.g2b.go.kr/"],
    ["슬래시 없는 /pn", "https://www.g2b.go.kr/pn"],
    ["/pn 으로 시작하는 다른 경로", "https://www.g2b.go.kr/pnx/download.do"],
    ["대문자 /PN/ 경로", "https://www.g2b.go.kr/PN/download.do"],
    ["/pn/../ 로 빠져나가는 경로(정규화 뒤 /x)", "https://www.g2b.go.kr/pn/../x"],
    ["%2e%2e 로 빠져나가는 경로(정규화 뒤 /x)", "https://www.g2b.go.kr/pn/%2e%2e/x"],
    ["IPv4 리터럴", "https://203.0.113.10/pn/download.do"],
    ["IPv6 리터럴", "https://[::1]/pn/download.do"],
    ["파싱되지 않는 문자열", "not a url"],
    ["빈 문자열", ""],
    ["상대 경로", "/pn/download.do"],
  ])("%s 는 거부한다", (_name, raw) => {
    expect(checkAttachmentUrl(raw)).toEqual(HOST_NOT_ALLOWED);
  });
});

describe("checkRedirect — allowlist 안에서만 따른다", () => {
  const current = new URL(G2B_EXAMPLE);

  it("같은 호스트의 /pn/ 절대 경로는 따른다", () => {
    const result = checkRedirect(current, "/pn/other/downloadFile.do?fileSeq=2", 0);
    if (!result.ok) throw new Error("따라야 한다");
    expect(result.url.href).toBe("https://www.g2b.go.kr/pn/other/downloadFile.do?fileSeq=2");
  });

  it("상대 경로는 current 기준으로 푼다", () => {
    const result = checkRedirect(current, "downloadFile2.do", 0);
    if (!result.ok) throw new Error("따라야 한다");
    expect(result.url.href).toBe("https://www.g2b.go.kr/pn/pnp/pnpe/UntyAtchFile/downloadFile2.do");
  });

  it("허용 URL 로 가는 절대 URL 은 따른다", () => {
    expect(checkRedirect(current, "https://www.g2b.go.kr/pn/x.do", 2).ok).toBe(true);
  });

  it.each([
    ["다른 호스트", "https://evil.example/pn/x.do"],
    ["프로토콜 상대 다른 호스트", "//evil.example/pn/x.do"],
    ["http 로 내려가기", "http://www.g2b.go.kr/pn/x.do"],
    ["/pn/ 밖으로 빠지는 상대 경로", "../../../../x.do"],
    ["/pn/ 밖 절대 경로", "/login.do"],
    ["userinfo 를 단 같은 호스트", "https://user@www.g2b.go.kr/pn/x.do"],
    ["사설 IP 리터럴", "https://169.254.169.254/latest/meta-data/"],
  ])("%s 로의 리다이렉트는 REDIRECT_BLOCKED 다", (_name, location) => {
    expect(checkRedirect(current, location, 0)).toEqual(REDIRECT_BLOCKED);
  });

  it("Location 이 없으면 REDIRECT_BLOCKED 다", () => {
    expect(checkRedirect(current, null, 0)).toEqual(REDIRECT_BLOCKED);
  });

  it("Location 이 빈 문자열이면 REDIRECT_BLOCKED 다", () => {
    expect(checkRedirect(current, "", 0)).toEqual(REDIRECT_BLOCKED);
  });

  it("이미 2번 따랐으면(redirectCount 2) 한 번 더 따른다", () => {
    expect(checkRedirect(current, "/pn/x.do", 2).ok).toBe(true);
  });

  it("이미 3번 따랐으면(redirectCount 3) 허용 URL 이라도 REDIRECT_BLOCKED 다", () => {
    expect(checkRedirect(current, "/pn/x.do", 3)).toEqual(REDIRECT_BLOCKED);
  });
});

describe("isPublicAddress — 공인 주소만 true", () => {
  it.each([
    ["0.0.0.0", "0/8"],
    ["0.1.2.3", "0/8"],
    ["10.0.0.1", "10/8"],
    ["10.255.255.255", "10/8"],
    ["100.64.0.1", "100.64/10"],
    ["100.127.255.254", "100.64/10"],
    ["127.0.0.1", "127/8"],
    ["127.255.255.254", "127/8"],
    ["169.254.169.254", "169.254/16(클라우드 메타데이터)"],
    ["172.16.0.1", "172.16/12"],
    ["172.31.255.255", "172.16/12"],
    ["192.0.0.1", "192.0.0/24"],
    ["192.0.2.1", "192.0.2/24"],
    ["192.88.99.1", "192.88.99/24"],
    ["192.168.0.1", "192.168/16"],
    ["192.168.255.255", "192.168/16"],
    ["198.18.0.1", "198.18/15"],
    ["198.19.255.255", "198.18/15"],
    ["198.51.100.1", "198.51.100/24"],
    ["203.0.113.1", "203.0.113/24"],
    ["224.0.0.1", "224/4"],
    ["239.255.255.255", "224/4"],
    ["240.0.0.1", "240/4"],
    ["255.255.255.255", "240/4(브로드캐스트)"],
  ])("IPv4 %s (%s)는 공인이 아니다", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ["::", "미지정"],
    ["::1", "루프백"],
    ["0:0:0:0:0:0:0:1", "루프백(펼친 표기)"],
    ["fc00::1", "fc00::/7"],
    ["fd12:3456:789a::1", "fc00::/7"],
    ["fe80::1", "fe80::/10"],
    ["febf::1", "fe80::/10"],
    ["ff02::1", "ff00::/8"],
    ["2001:db8::1", "2001:db8::/32"],
    ["64:ff9b::808:808", "64:ff9b::/96"],
    ["100::1", "100::/64"],
  ])("IPv6 %s (%s)는 공인이 아니다", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ["::ffff:127.0.0.1", "점 표기"],
    ["::ffff:10.0.0.1", "점 표기"],
    ["::ffff:169.254.169.254", "점 표기"],
    ["::ffff:7f00:1", "16진 표기(127.0.0.1)"],
    ["::ffff:c0a8:1", "16진 표기(192.168.0.1)"],
    ["::FFFF:7F00:1", "16진 대문자 표기(127.0.0.1)"],
    ["0:0:0:0:0:ffff:7f00:1", "펼친 표기(127.0.0.1)"],
  ])("IPv4-mapped %s (%s)는 안의 사설 IPv4 로 판정해 공인이 아니다", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ["8.8.8.8"],
    ["1.1.1.1"],
    ["9.255.255.255"],
    ["11.0.0.1"],
    ["100.63.255.255"],
    ["100.128.0.1"],
    ["126.255.255.255"],
    ["128.0.0.1"],
    ["169.253.255.255"],
    ["169.255.0.1"],
    ["172.15.255.255"],
    ["172.32.0.1"],
    ["192.0.1.1"],
    ["192.0.3.1"],
    ["192.167.255.255"],
    ["192.169.0.1"],
    ["198.17.255.255"],
    ["198.20.0.1"],
    ["203.0.112.255"],
    ["203.0.114.1"],
    ["223.255.255.254"],
  ])("IPv4 %s 는 공인이다", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it.each([["2001:4860:4860::8888"], ["2606:4700:4700::1111"], ["2001:db9::1"]])(
    "IPv6 %s 는 공인이다",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );

  // 7-7(security-auditor 낮음): IPv6 터널 대역은 안에 IPv4(사설일 수 있다)를 싣고 다른 경로로 나간다. 통째로 비공인으로 본다.
  it.each([
    ["2002:7f00:1::", "2002::/16 6to4, 127.0.0.1 을 실음"],
    ["2002:c0a8:101::1", "2002::/16 6to4, 192.168.1.1 을 실음"],
    ["2002:808:808::1", "2002::/16 6to4, 공인 8.8.8.8 을 실어도 대역째"],
    ["2002::", "2002::/16 의 시작"],
    ["2002:ffff:ffff:ffff:ffff:ffff:ffff:ffff", "2002::/16 의 끝"],
    ["2001:0:4136:e378:8000:63bf:3fff:fdd2", "2001::/32 Teredo"],
    ["2001::1", "2001::/32 Teredo"],
    ["2001:0:ffff:ffff:ffff:ffff:ffff:ffff", "2001::/32 의 끝"],
    ["2001:0000:4136:E378:8000:63BF:3FFF:FDD2", "2001::/32 Teredo, 대문자·0 펼친 표기"],
  ])("IPv6 터널 %s (%s)는 공인이 아니다(C3 계약 7-7)", (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    ["2001:4860::1", "2001::/32 밖(두 번째 묶음이 0 이 아니다)"],
    ["2001:1::1", "2001::/32 바로 다음"],
    ["2003::1", "2002::/16 바로 다음"],
    ["2001:1fff::1", "2001::/32 밖"],
  ])("IPv6 %s (%s)는 터널 대역 밖이라 공인이다(C3 계약 7-7 경계)", (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });

  it("2001:db8:: 는 7-7 과 무관하게 문서용 대역이라 계속 공인이 아니다", () => {
    expect(isPublicAddress("2001:db8::")).toBe(false);
  });

  it.each([["::ffff:8.8.8.8"], ["::ffff:808:808"]])(
    "IPv4-mapped %s 는 안의 공인 IPv4(8.8.8.8)로 판정해 공인이다",
    (ip) => {
      expect(isPublicAddress(ip)).toBe(true);
    },
  );

  it.each([
    [""],
    ["localhost"],
    ["www.g2b.go.kr"],
    ["256.0.0.1"],
    ["1.2.3"],
    ["8.8.8.8/24"],
    ["2130706433"],
    ["0x7f000001"],
    ["not-an-ip"],
  ])("IP 형식이 아닌 %j 는 false 다", (value) => {
    expect(isPublicAddress(value)).toBe(false);
  });
});

describe("checkResolvedAddresses — DNS 재확인 결과", () => {
  it("빈 목록은 HOST_NOT_ALLOWED 다", () => {
    expect(checkResolvedAddresses([])).toEqual(HOST_NOT_ALLOWED);
  });

  it("모두 공인이면 통과한다", () => {
    expect(checkResolvedAddresses(["8.8.8.8", "2001:4860:4860::8888"])).toEqual({ ok: true });
  });

  it("하나라도 사설이면 HOST_NOT_ALLOWED 다", () => {
    expect(checkResolvedAddresses(["8.8.8.8", "10.0.0.1"])).toEqual(HOST_NOT_ALLOWED);
  });

  it("IPv4-mapped 루프백이 섞여 있으면 HOST_NOT_ALLOWED 다", () => {
    expect(checkResolvedAddresses(["8.8.8.8", "::ffff:127.0.0.1"])).toEqual(HOST_NOT_ALLOWED);
  });

  it("IP 형식이 아닌 값이 섞여 있으면 HOST_NOT_ALLOWED 다", () => {
    expect(checkResolvedAddresses(["8.8.8.8", "localhost"])).toEqual(HOST_NOT_ALLOWED);
  });
});

describe("classifyHttpStatus", () => {
  it.each<[number, string]>([
    [200, "OK"],
    [301, "REDIRECT"],
    [302, "REDIRECT"],
    [303, "REDIRECT"],
    [307, "REDIRECT"],
    [308, "REDIRECT"],
    [401, "AUTH_REQUIRED"],
    [403, "AUTH_REQUIRED"],
    [400, "HTTP_4XX"],
    [404, "HTTP_4XX"],
    [429, "HTTP_4XX"],
    [499, "HTTP_4XX"],
    [500, "HTTP_5XX"],
    [503, "HTTP_5XX"],
    [599, "HTTP_5XX"],
    [204, "HTTP_5XX"],
    [206, "HTTP_5XX"],
    [300, "HTTP_5XX"],
    [304, "HTTP_5XX"],
  ])("%i → %s", (status, expected) => {
    expect(classifyHttpStatus(status)).toBe(expected);
  });
});

describe("checkDeclaredSize·exceedsMaxBytes — 50 MiB 경계", () => {
  it("Content-Length 가 정확히 50 MiB 면 통과한다", () => {
    expect(checkDeclaredSize(String(ATTACHMENT_MAX_BYTES))).toEqual({ ok: true });
  });

  it("Content-Length 가 50 MiB + 1 이면 TOO_LARGE 다", () => {
    expect(checkDeclaredSize(String(ATTACHMENT_MAX_BYTES + 1))).toEqual({
      ok: false,
      errorCode: "TOO_LARGE",
    });
  });

  it("Content-Length 0 은 통과한다", () => {
    expect(checkDeclaredSize("0")).toEqual({ ok: true });
  });

  it("Content-Length 가 없으면 통과한다(받는 중에 다시 막는다)", () => {
    expect(checkDeclaredSize(null)).toEqual({ ok: true });
  });

  it.each([["abc"], [""]])("Content-Length 가 숫자가 아닌 %j 면 통과한다", (value) => {
    expect(checkDeclaredSize(value)).toEqual({ ok: true });
  });

  it("받은 바이트가 정확히 50 MiB 면 넘지 않았다", () => {
    expect(exceedsMaxBytes(ATTACHMENT_MAX_BYTES)).toBe(false);
  });

  it("받은 바이트가 50 MiB + 1 이면 넘었다", () => {
    expect(exceedsMaxBytes(ATTACHMENT_MAX_BYTES + 1)).toBe(true);
  });

  it("받은 바이트 0 은 넘지 않았다", () => {
    expect(exceedsMaxBytes(0)).toBe(false);
  });
});

describe("attachmentObjectKey — raw/bids/{bidId}/{revisionId}/{sha256}.{ext}", () => {
  it.each<[DocumentFormat, string]>([
    ["PDF", "pdf"],
    ["HWP", "hwp"],
    ["HWPX", "hwpx"],
    ["ZIP", "zip"],
    ["XLSX", "xlsx"],
    ["UNKNOWN", "bin"],
  ])("%s 는 .%s 로 끝나는 키를 만든다", (format, ext) => {
    expect(attachmentObjectKey({ bidId: "bid-1", revisionId: "rev-2", sha256: SHA, format })).toBe(
      `raw/bids/bid-1/rev-2/${SHA}.${ext}`,
    );
  });

  it("UUID 형태의 bidId·revisionId 를 받는다", () => {
    const bidId = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
    const revisionId = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
    expect(attachmentObjectKey({ bidId, revisionId, sha256: SHA, format: "PDF" })).toBe(
      `raw/bids/${bidId}/${revisionId}/${SHA}.pdf`,
    );
  });

  it.each([
    ["경로 구분자가 든 bidId", { bidId: "bid/1", revisionId: "rev-1", sha256: SHA }],
    ["상위 경로 bidId", { bidId: "..", revisionId: "rev-1", sha256: SHA }],
    ["빈 bidId", { bidId: "", revisionId: "rev-1", sha256: SHA }],
    ["공백이 든 revisionId", { bidId: "bid-1", revisionId: "rev 1", sha256: SHA }],
    ["경로 구분자가 든 revisionId", { bidId: "bid-1", revisionId: "rev/../x", sha256: SHA }],
    ["대문자 16진 sha256", { bidId: "bid-1", revisionId: "rev-1", sha256: "A".repeat(64) }],
    ["63자리 sha256", { bidId: "bid-1", revisionId: "rev-1", sha256: "a".repeat(63) }],
    ["65자리 sha256", { bidId: "bid-1", revisionId: "rev-1", sha256: "a".repeat(65) }],
    ["16진이 아닌 sha256", { bidId: "bid-1", revisionId: "rev-1", sha256: "g".repeat(64) }],
  ])("%s 는 던진다", (_name, input) => {
    expect(() => attachmentObjectKey({ ...input, format: "PDF" })).toThrow();
  });
});

describe("detectDocumentFormat — 매직 바이트", () => {
  it("%PDF- 로 시작하면 PDF 다", () => {
    expect(detectDocumentFormat(PDF_BYTES)).toBe("PDF");
  });

  it("정확히 %PDF- 다섯 바이트만 있어도 PDF 다", () => {
    expect(detectDocumentFormat(bytesOf(ascii("%PDF-")))).toBe("PDF");
  });

  it("%PDF 뒤에 - 가 없으면 UNKNOWN 이다", () => {
    expect(detectDocumentFormat(bytesOf(ascii("%PDF1.7")))).toBe("UNKNOWN");
  });

  it("OLE 헤더 + HWP Document File 문자열이면 HWP 다", () => {
    expect(detectDocumentFormat(HWP_BYTES)).toBe("HWP");
  });

  it("OLE 헤더라도 HWP 문자열이 없으면(doc·xls 등) UNKNOWN 이다", () => {
    expect(detectDocumentFormat(OLE_DOC_BYTES)).toBe("UNKNOWN");
  });

  it("HWP 문자열만 있고 OLE 헤더가 없으면 UNKNOWN 이다", () => {
    expect(detectDocumentFormat(bytesOf(ascii("HWP Document File")))).toBe("UNKNOWN");
  });

  it("PK 헤더 + application/hwp+zip 이면 HWPX 다", () => {
    expect(detectDocumentFormat(HWPX_BYTES)).toBe("HWPX");
  });

  it("PK 헤더 + xl/ 이면 XLSX 다", () => {
    expect(detectDocumentFormat(XLSX_BYTES)).toBe("XLSX");
  });

  it("application/hwp+zip 과 xl/ 이 함께 있으면 HWPX 가 먼저다", () => {
    const both = bytesOf(Array.from(XLSX_BYTES), ascii("application/hwp+zip"));
    expect(detectDocumentFormat(both)).toBe("HWPX");
  });

  it("PK 헤더만 있고 hwp+zip·xl/ 이 없으면(docx 등) ZIP 이다", () => {
    expect(detectDocumentFormat(DOCX_BYTES)).toBe("ZIP");
  });

  it("평범한 zip 은 ZIP 이다", () => {
    expect(detectDocumentFormat(ZIP_BYTES)).toBe("ZIP");
  });

  it("PK\\x03\\x04 네 바이트만 있어도 ZIP 이다", () => {
    expect(detectDocumentFormat(bytesOf(PK))).toBe("ZIP");
  });

  it("빈 바이트는 UNKNOWN 이다", () => {
    expect(detectDocumentFormat(new Uint8Array())).toBe("UNKNOWN");
  });

  it("매직보다 짧은 바이트(%P)는 UNKNOWN 이다", () => {
    expect(detectDocumentFormat(bytesOf(ascii("%P")))).toBe("UNKNOWN");
  });

  it("평문은 UNKNOWN 이다", () => {
    expect(detectDocumentFormat(bytesOf(ascii("hello, world")))).toBe("UNKNOWN");
  });
});

describe("createFixtureAttachmentFetcher", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sol-radar-docs-"));
    await mkdir(join(dir, "docs"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const writeDoc = (name: string, bytes: Uint8Array) => writeFile(join(dir, "docs", name), bytes);

  const fetchDoc = (url: string): Promise<AttachmentFetchResult> =>
    createFixtureAttachmentFetcher({ fixturesDir: dir }).fetch({ name: "제안요청서", url });

  const okOf = (result: AttachmentFetchResult): AttachmentDownload => {
    if (result.status !== "OK") throw new Error(`OK 대신 ${result.errorCode}`);
    return result;
  };

  const sha256Of = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

  it("있는 파일은 OK 이고 내용 바이트를 그대로 돌려준다", async () => {
    await writeDoc("FX-01-rfp.pdf", PDF_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/FX-01-rfp.pdf"));
    expect(Buffer.compare(Buffer.from(download.bytes), Buffer.from(PDF_BYTES))).toBe(0);
  });

  it("sha256 은 내용의 소문자 16진 SHA-256 이다", async () => {
    await writeDoc("FX-01-rfp.pdf", PDF_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/FX-01-rfp.pdf"));
    expect(download.sha256).toBe(sha256Of(PDF_BYTES));
  });

  it("sizeBytes 는 내용의 바이트 수다", async () => {
    await writeDoc("FX-01-rfp.pdf", PDF_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/FX-01-rfp.pdf"));
    expect(download.sizeBytes).toBe(PDF_BYTES.length);
  });

  it("PDF 내용이면 format PDF, mimeType application/pdf 다", async () => {
    await writeDoc("FX-01-rfp.pdf", PDF_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/FX-01-rfp.pdf"));
    expect([download.format, download.mimeType]).toEqual(["PDF", "application/pdf"]);
  });

  it("확장자가 아니라 내용으로 판정한다: .pdf 이름에 HWPX 내용이면 HWPX 다", async () => {
    await writeDoc("disguised.pdf", HWPX_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/disguised.pdf"));
    expect([download.format, download.mimeType]).toEqual(["HWPX", "application/hwp+zip"]);
  });

  it("확장자가 없어도 내용으로 HWP 를 판정한다", async () => {
    await writeDoc("FX-05-rfp", HWP_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/FX-05-rfp"));
    expect([download.format, download.mimeType]).toEqual(["HWP", "application/x-hwp"]);
  });

  it("판정할 수 없는 내용은 UNKNOWN·application/octet-stream 으로 OK 다(파싱 여부는 뒤 단계)", async () => {
    await writeDoc("notes.txt", bytesOf(ascii("plain text")));
    const download = okOf(await fetchDoc("fixtures/docs/notes.txt"));
    expect([download.format, download.mimeType]).toEqual(["UNKNOWN", "application/octet-stream"]);
  });

  it("없는 파일은 NOT_FOUND 다", async () => {
    await expect(fetchDoc("fixtures/docs/FX-99-rfp.pdf")).resolves.toEqual({
      status: "FAILED",
      errorCode: "NOT_FOUND",
    });
  });

  it("fixturesDir 밖의 파일을 가리키는 ../ 경로는 HOST_NOT_ALLOWED 이고 그 파일을 읽지 않는다", async () => {
    await writeFile(join(dir, "secret.txt"), "비밀");
    await expect(fetchDoc("fixtures/docs/../secret.txt")).resolves.toEqual({
      status: "FAILED",
      errorCode: "HOST_NOT_ALLOWED",
    });
  });

  it.each([
    ["정규식에는 맞는 ..", "fixtures/docs/.."],
    ["이름 안의 ..", "fixtures/docs/a..b.pdf"],
    ["하위 폴더", "fixtures/docs/sub/a.pdf"],
    ["fixtures/docs/ 접두사 없음", "docs/a.pdf"],
    ["절대 경로", "/etc/passwd"],
    ["파일 이름 없음", "fixtures/docs/"],
    ["공백이 든 이름", "fixtures/docs/a b.pdf"],
    ["백슬래시", "fixtures/docs/..\\secret.txt"],
    ["http URL", "https://www.g2b.go.kr/pn/download.do"],
  ])("형식 밖 url(%s)은 HOST_NOT_ALLOWED 다", async (_name, url) => {
    await expect(fetchDoc(url)).resolves.toEqual({
      status: "FAILED",
      errorCode: "HOST_NOT_ALLOWED",
    });
  });

  it("정확히 50 MiB 파일은 OK 이고 sizeBytes 는 52428800 이다", async () => {
    const path = join(dir, "docs", "exact.bin");
    await writeFile(path, "");
    await truncate(path, ATTACHMENT_MAX_BYTES);
    const download = okOf(await fetchDoc("fixtures/docs/exact.bin"));
    expect(download.sizeBytes).toBe(ATTACHMENT_MAX_BYTES);
  });

  it("50 MiB + 1 바이트 파일은 TOO_LARGE 다", async () => {
    const path = join(dir, "docs", "huge.pdf");
    await writeFile(path, "");
    await truncate(path, ATTACHMENT_MAX_BYTES + 1);
    const result = await fetchDoc("fixtures/docs/huge.pdf");
    // 결과 전체를 비교하면 실패 때 50 MiB 바이트 배열을 diff 하다 worker 가 죽는다. 상태와 코드만 본다.
    expect(result.status === "FAILED" ? result.errorCode : `OK(${result.sizeBytes} bytes)`).toBe(
      "TOO_LARGE",
    );
  });
});
