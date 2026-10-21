import { describe, expect, it, vi } from "vitest";
import { fetchProgramSource, redactProgramUrl, toSourceLink, type FetchLike } from "./http";

const KEY = "s3cr3t+key/=";
const BIZINFO_URL = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${encodeURIComponent(KEY)}&dataType=json`;

const fetchReturning = (response: Response) => vi.fn<FetchLike>(async () => response);

describe("fetchProgramSource", () => {
  it("허용 호스트가 아니거나 https 가 아니면 fetch 를 부르지 않고 HOST_NOT_ALLOWED 다", async () => {
    for (const url of [
      "http://mss.go.kr/rss/smba/board/310.do",
      "https://evil.example/",
      "https://mss.go.kr.evil.example/rss",
      "https://user:pw@mss.go.kr/rss",
      "https://mss.go.kr:8443/rss",
      "file:///etc/passwd",
      "아무 글자",
    ]) {
      const fetch = fetchReturning(new Response("ok"));
      expect(await fetchProgramSource(url, { fetch, secrets: [] })).toEqual({
        ok: false,
        errorCode: "HOST_NOT_ALLOWED",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("리다이렉트를 따르지 않고 3xx 는 REDIRECT_BLOCKED 다", async () => {
    const fetch = fetchReturning(
      new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    expect(
      await fetchProgramSource("https://mss.go.kr/rss/smba/board/310.do", { fetch, secrets: [] }),
    ).toEqual({
      ok: false,
      errorCode: "REDIRECT_BLOCKED",
      status: 302,
    });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual", method: "GET" });
  });

  it("2xx 가 아니면 HTTP_ERROR 와 상태 코드다", async () => {
    const fetch = fetchReturning(new Response("oops", { status: 500 }));
    expect(
      await fetchProgramSource("https://mss.go.kr/rss/smba/board/310.do", { fetch, secrets: [] }),
    ).toEqual({
      ok: false,
      errorCode: "HTTP_ERROR",
      status: 500,
    });
  });

  it("시간 제한·중단은 TIMEOUT 이다", async () => {
    for (const name of ["AbortError", "TimeoutError"]) {
      const fetch = vi.fn<FetchLike>(async () => {
        throw new DOMException("stopped", name);
      });
      expect(
        await fetchProgramSource("https://mss.go.kr/rss", { fetch, secrets: [], timeoutMs: 5 }),
      ).toEqual({
        ok: false,
        errorCode: "TIMEOUT",
      });
    }
  });

  it("본문이 상한을 넘으면 TOO_LARGE 다(길이 머리가 없어도)", async () => {
    const fetch = fetchReturning(new Response("가".repeat(20)));
    expect(
      await fetchProgramSource("https://mss.go.kr/rss", { fetch, secrets: [], maxBytes: 10 }),
    ).toEqual({
      ok: false,
      errorCode: "TOO_LARGE",
    });
    const declared = fetchReturning(new Response("x", { headers: { "content-length": "999" } }));
    expect(
      await fetchProgramSource("https://mss.go.kr/rss", {
        fetch: declared,
        secrets: [],
        maxBytes: 10,
      }),
    ).toEqual({
      ok: false,
      errorCode: "TOO_LARGE",
    });
  });

  it("성공하면 UTF-8 본문과 상태를 돌려준다", async () => {
    const fetch = fetchReturning(new Response("<rss>공고</rss>", { status: 200 }));
    expect(
      await fetchProgramSource("https://mss.go.kr/rss/smba/board/310.do", { fetch, secrets: [] }),
    ).toEqual({
      ok: true,
      body: "<rss>공고</rss>",
      status: 200,
    });
  });

  it("fetch 가 키가 든 메시지로 던져도 결과에 키가 없다", async () => {
    const fetch = vi.fn<FetchLike>(async (url) => {
      throw new TypeError(`fetch failed: ${url} ${KEY}`);
    });
    const result = await fetchProgramSource(BIZINFO_URL, { fetch, secrets: [KEY] });
    expect(result).toEqual({ ok: false, errorCode: "HTTP_ERROR" });
    expect(JSON.stringify(result)).not.toContain("s3cr3t");
  });
});

describe("redactProgramUrl", () => {
  it("crtfcKey 값과 비밀 문자열을 가린다", () => {
    const redacted = redactProgramUrl(BIZINFO_URL, [KEY]);
    expect(redacted).toBe(
      "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=[REDACTED]&dataType=json",
    );
    expect(redactProgramUrl(`오류 ${KEY} 끝`, [KEY])).toBe("오류 [REDACTED] 끝");
  });
});

describe("toSourceLink", () => {
  const MSS = { origin: "https://mss.go.kr", hosts: ["mss.go.kr", "www.mss.go.kr"] } as const;

  it("상대 링크는 사이트 주소를 붙이고 http 는 https 로 올린다", () => {
    expect(toSourceLink("/a/View.do?bcIdx=1", MSS)).toBe("https://mss.go.kr/a/View.do?bcIdx=1");
    expect(toSourceLink(" http://www.mss.go.kr/a?b=1 ", MSS)).toBe("https://www.mss.go.kr/a?b=1");
  });

  it("남의 호스트·https 가 아닌 체계·포트·계정이 붙은 주소는 null 이다", () => {
    for (const raw of [
      "https://evil.example/a",
      "javascript:alert(1)",
      "ftp://mss.go.kr/a",
      "https://mss.go.kr:8443/a",
      "https://u:p@mss.go.kr/a",
      "//evil.example/a",
      "",
    ]) {
      expect(toSourceLink(raw, MSS)).toBeNull();
    }
  });
});
