import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseMssRss } from "./mss-rss";

const FETCHED_AT = "2026-10-21T01:00:00.000Z";
const SAMPLE = readFileSync(join(__dirname, "test-data", "mss-sample.xml"), "utf8");

const parsedOk = (body: string) => {
  const result = parseMssRss(body, FETCHED_AT);
  if (!result.ok) throw new Error(`예상과 달리 실패: ${result.errorCode}`);
  return result;
};

const rssOf = (items: string): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;

describe("parseMssRss", () => {
  it("제목·링크·등록일을 정규화 행으로 바꾼다(id 는 링크의 bcIdx)", () => {
    const { notices } = parsedOk(SAMPLE);
    expect(notices[0]).toEqual({
      source: "mss",
      sourceNoticeId: "1065432",
      title: "[중기부] 2026년 스마트공장 구축 지원사업 공고",
      agency: "중소벤처기업부",
      sourceUrl:
        "https://mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1065432&parentSeq=1065432",
      publishedAt: "2026-10-21T00:30:00.000Z",
      applyStartOn: null,
      applyEndOn: null,
      summary: null,
      applyMethod: null,
      target: null,
      tags: [],
      dedupeKey: "2026년스마트공장구축지원사업공고|중소벤처기업부",
      fetchedAt: FETCHED_AT,
      isDemo: false,
    });
  });

  it("엔티티를 풀고, http 링크는 https 로, 상대 링크는 mss.go.kr 로 맞춘다", () => {
    const { notices } = parsedOk(SAMPLE);
    expect(notices[1]).toMatchObject({
      sourceNoticeId: "1065433",
      title: "2026년 소상공인 디지털 전환 & 판로 지원",
      sourceUrl: "https://mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1065433",
      publishedAt: "2026-10-19T15:00:00.000Z",
    });
    expect(notices[2]).toMatchObject({
      sourceNoticeId: "1065434",
      sourceUrl: "https://mss.go.kr/site/smba/ex/bbs/View.do?cbIdx=310&bcIdx=1065434",
    });
  });

  it("등록일이 깨지면 publishedAt 만 null 이고, 제목이 없거나 남의 호스트 링크면 버린다", () => {
    const result = parsedOk(SAMPLE);
    expect(result.notices[2]?.publishedAt).toBeNull();
    expect(result.notices).toHaveLength(3);
    expect(result.dropped).toBe(2);
  });

  it("bcIdx 가 없으면 링크의 sha256 앞 16자를 id 로 쓴다", () => {
    const { notices } = parsedOk(
      rssOf(
        "<item><title>가</title><link>https://mss.go.kr/x.do?a=1</link><pubDate>20261021093000</pubDate></item>",
      ),
    );
    expect(notices[0]?.sourceNoticeId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("DOCTYPE·ENTITY 가 있으면 통째로 거부한다(대소문자 무시)", () => {
    for (const body of [
      `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&x;</title><link>https://mss.go.kr/a?bcIdx=1</link></item></channel></rss>`,
      `<?xml version="1.0"?><!doctype rss><rss></rss>`,
      `<rss><channel><!ENTITY y "z"></channel></rss>`,
    ]) {
      expect(parseMssRss(body, FETCHED_AT)).toEqual({ ok: false, errorCode: "XML_DTD_REJECTED" });
    }
  });

  it("item 이 없으면 빈 목록이고, RSS 가 아니면 RESPONSE_SHAPE 다", () => {
    expect(parsedOk(rssOf(""))).toEqual({ ok: true, notices: [], dropped: 0 });
    for (const body of ["", "<html><body>점검 중</body></html>", JSON.stringify({ error: 1 })]) {
      expect(parseMssRss(body, FETCHED_AT)).toEqual({ ok: false, errorCode: "RESPONSE_SHAPE" });
    }
  });
});
