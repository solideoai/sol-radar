import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBizinfoUrl, parseBizinfoBody } from "./bizinfo";

const FETCHED_AT = "2026-10-21T01:00:00.000Z";
const SAMPLE = readFileSync(join(__dirname, "test-data", "bizinfo-sample.json"), "utf8");
const ITEMS = (JSON.parse(SAMPLE) as { jsonArray: Record<string, unknown>[] }).jsonArray;

const parsedOk = (body: string) => {
  const result = parseBizinfoBody(body, FETCHED_AT);
  if (!result.ok) throw new Error(`예상과 달리 실패: ${result.errorCode}`);
  return result;
};

describe("buildBizinfoUrl", () => {
  it("인증키·json·건수·분야를 쿼리에 싣는다", () => {
    const url = new URL(
      buildBizinfoUrl({
        baseUrl: "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do",
        key: "k+ey/1=",
        categories: ["02", "04"],
        maxItems: 100,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do");
    expect(url.searchParams.get("crtfcKey")).toBe("k+ey/1=");
    expect(url.searchParams.get("dataType")).toBe("json");
    expect(url.searchParams.get("searchCnt")).toBe("100");
    expect(url.searchParams.get("searchLclasId")).toBe("02,04");
  });
});

describe("parseBizinfoBody", () => {
  it("명세 필드를 정규화 행으로 바꾼다", () => {
    const { notices } = parsedOk(SAMPLE);
    expect(notices[0]).toEqual({
      source: "bizinfo",
      sourceNoticeId: "PBLN_000000000000101",
      title: "[서울] 2026년 스마트공장 구축 지원사업 공고",
      agency: "중소벤처기업부",
      sourceUrl:
        "https://www.bizinfo.go.kr/web/lay1/bbs/S1T122C128/AS/74/view.do?pblancId=PBLN_000000000000101",
      publishedAt: "2026-10-20T01:15:00.000Z",
      applyStartOn: "2026-10-20",
      applyEndOn: "2026-11-10",
      summary: "스마트공장 구축 비용을 지원합니다.\n문의: ************",
      applyMethod: "온라인 신청 & 서류 제출",
      target: "중소기업",
      tags: ["기술", "서울", "제조", "스마트공장"],
      dedupeKey: "2026년스마트공장구축지원사업공고|중소벤처기업부",
      fetchedAt: FETCHED_AT,
      isDemo: false,
    });
  });

  it("주 필드가 없으면 title·seq·author·link·pubDate·reqstDt·description·lcategory 로 채운다", () => {
    const { notices } = parsedOk(SAMPLE);
    expect(notices[1]).toMatchObject({
      sourceNoticeId: "PBLN_000000000000102",
      title: "2026년 수출바우처 사업 참여기업 모집",
      agency: "산업통상자원부",
      publishedAt: "2026-10-19T00:00:00.000Z",
      applyStartOn: null,
      applyEndOn: null,
      summary: "수출 지원. 담당 ****************",
      applyMethod: null,
      target: null,
      tags: ["수출"],
    });
  });

  it("문의처(refrncNm)는 결과 어디에도 없다", () => {
    const text = JSON.stringify(parsedOk(SAMPLE).notices);
    expect(text).not.toContain("담당자");
    expect(text).not.toContain("02-111-2222");
    expect(text).not.toContain("contact@example.test");
    expect(text).not.toContain("example.test/apply");
    const onlyContact = {
      pblancId: "PBLN_9",
      pblancNm: "문의처만 있는 공고",
      pblancUrl: "/view.do?pblancId=PBLN_9",
      refrncNm: "담당자 02-333-4444",
    };
    const parsed = parsedOk(JSON.stringify({ jsonArray: [onlyContact] }));
    expect(parsed.notices).toHaveLength(1);
    expect(JSON.stringify(parsed.notices)).not.toMatch(/담당자|333/);
  });

  it("제목이 없거나 원문 주소가 기업마당 https 가 아니면 버리고 센다", () => {
    const result = parsedOk(SAMPLE);
    expect(result.notices.map((notice) => notice.sourceNoticeId)).toEqual([
      "PBLN_000000000000101",
      "PBLN_000000000000102",
    ]);
    expect(result.dropped).toBe(2);
    const foreign = { ...ITEMS[1], link: "https://evil.example/view.do?pblancId=1" };
    expect(parsedOk(JSON.stringify({ jsonArray: [foreign] }))).toEqual({
      ok: true,
      notices: [],
      dropped: 1,
    });
  });

  it("jsonArray 가 배열·{item:[…]}·{item:{…}} 어느 모양이어도 같게 읽는다", () => {
    const asArray = parsedOk(JSON.stringify({ jsonArray: [ITEMS[0]] })).notices;
    const asItemArray = parsedOk(JSON.stringify({ jsonArray: { item: [ITEMS[0]] } })).notices;
    const asItemObject = parsedOk(JSON.stringify({ jsonArray: { item: ITEMS[0] } })).notices;
    expect(asArray).toHaveLength(1);
    expect(asItemArray).toEqual(asArray);
    expect(asItemObject).toEqual(asArray);
    expect(parsedOk(JSON.stringify({ jsonArray: [] }))).toEqual({
      ok: true,
      notices: [],
      dropped: 0,
    });
  });

  it("HTML 오류 쪽·빈 본문·오류 JSON·모르는 봉투는 RESPONSE_SHAPE 다", () => {
    for (const body of [
      "<html><body>error</body></html>",
      "",
      JSON.stringify({ error: "인증키 오류" }),
      JSON.stringify({ jsonArray: "x" }),
      JSON.stringify({ jsonArray: {} }),
      JSON.stringify([ITEMS[0]]),
    ]) {
      expect(parseBizinfoBody(body, FETCHED_AT)).toEqual({
        ok: false,
        errorCode: "RESPONSE_SHAPE",
      });
    }
  });

  it("항목이 객체가 아니면 버리고 센다", () => {
    expect(parsedOk(JSON.stringify({ jsonArray: [1, null, "x", ITEMS[0]] }))).toMatchObject({
      dropped: 3,
    });
  });
});
