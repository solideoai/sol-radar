import { expect, it } from "vitest";
import {
  checkAttachmentUrl,
  checkDeclaredSize,
  checkRedirect,
  checkResolvedAddresses,
  exceedsMaxBytes,
} from "./attachment-allowlist";
import { detectDocumentFormat } from "./document-format";

const allowed = "https://www.g2b.go.kr/pn/download.do?file=rfp";

it("공식 HTTPS 첨부 경로는 허용하고 외부 호스트는 거부한다", () => {
  expect(checkAttachmentUrl(allowed).ok).toBe(true);
  expect(checkAttachmentUrl("https://attacker.example/pn/rfp.pdf")).toEqual({
    ok: false,
    errorCode: "HOST_NOT_ALLOWED",
  });
});

it("허용 URL의 외부 리다이렉트도 차단한다", () => {
  expect(checkRedirect(new URL(allowed), "https://attacker.example/rfp.pdf", 0)).toEqual({
    ok: false,
    errorCode: "REDIRECT_BLOCKED",
  });
});

it("DNS 응답에 사설 주소가 섞이면 차단한다", () => {
  expect(checkResolvedAddresses(["8.8.8.8", "127.0.0.1"])).toEqual({
    ok: false,
    errorCode: "HOST_NOT_ALLOWED",
  });
});

it("선언 크기와 실제 수신 크기가 50 MiB를 넘으면 거부한다", () => {
  expect(checkDeclaredSize("52428801")).toEqual({ ok: false, errorCode: "TOO_LARGE" });
  expect(exceedsMaxBytes(52_428_800)).toBe(false);
  expect(exceedsMaxBytes(52_428_801)).toBe(true);
});

it("PDF 이름 대신 실제 본문으로 형식을 구분한다", () => {
  expect(detectDocumentFormat(new TextEncoder().encode("%PDF-1.7\n"))).toBe("PDF");
  expect(detectDocumentFormat(new TextEncoder().encode("rfp.pdf"))).toBe("UNKNOWN");
});
