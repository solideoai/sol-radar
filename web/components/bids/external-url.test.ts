import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./external-url";

// 원문 링크(sourceUrl)를 <a> 로 그려도 되는지. http·https 만 된다.
describe("isHttpUrl", () => {
  it("http·https 절대 주소면 true 다", () => {
    expect(isHttpUrl("https://www.g2b.go.kr/notice/1")).toBe(true);
    expect(isHttpUrl("http://example.test/bid")).toBe(true);
    expect(isHttpUrl("HTTPS://EXAMPLE.TEST/")).toBe(true);
  });

  it("다른 스킴·상대 주소·빈 값이면 false 다", () => {
    for (const value of [
      "javascript:alert(1)",
      " javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "mailto:a@example.test",
      "ftp://example.test/file",
      "/bids/1",
      "//evil.example/x",
      "example.test/bid",
      "",
    ]) {
      expect(isHttpUrl(value), value).toBe(false);
    }
  });
});
