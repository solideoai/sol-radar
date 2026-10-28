// record-datagokr.mjs 시험. 실제 API 를 부르지 않는다(가짜 fetch). 응답은 아래 합성 본문이다.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  StopRecording,
  TARGETS,
  judge,
  maskBody,
  parseArgs,
  recordOnce,
  summarize,
} from "./record-datagokr.mjs";

// 가짜 키. Encoding 형태(%2B)로 넣어 디코드·재인코딩 흔적까지 찾게 한다.
const KEY = "synthetic%2Bdatagokr%2Fkey%3D%3D";
const now = () => new Date("2026-10-28T03:30:00.000Z");
const kwaterItem = (overrides) => ({
  cntrctDivNm: "용역",
  tndrPblancDe: "20261027",
  tndrPblancEnddt: "20261105",
  intnChargerNm: "김합성",
  tndrPlnprc: 150000000,
  cntrctDeptNm: "디지털혁신처",
  tndrPbanno: "2026-0001",
  tndrPblancNm: "합성 정보시스템 유지관리 용역 문의 042-629-0000",
  ctrmthdCdNm: "제한경쟁",
  tndrStat: "공고중",
  internalNote: "명세에 없는 합성칸",
  ...overrides,
});
const kwaterBody = (items, header = { resultCode: "00", resultMsg: "NORMAL SERVICE." }) =>
  JSON.stringify({
    response: { header, body: { items: { item: items }, totalCount: items.length, pageNo: 1 } },
  });
const lhPreSpecXml = `<?xml version="1.0" encoding="UTF-8"?>
<response><header><resultCode>00</resultCode><resultMsg>정상</resultMsg></header>
<body><totalCount>1</totalCount><pageNo>1</pageNo><numOfRows>10</numOfRows>
<item><inadvcStddztNm><![CDATA[합성 사전규격]]></inadvcStddztNm><opinionRegEndDtm>2026/11/02 18:00</opinionRegEndDtm>
<chpsnEmail>someone@example.com</chpsnEmail><chpsnTelNum>055-922-0000</chpsnTelNum><cstrtnJobGbNm>용역</cstrtnJobGbNm></item>
</body></response>`;
const gatewayError = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;

async function withOut(run) {
  const out = await mkdtemp(path.join(tmpdir(), "datagokr-record-"));
  try {
    return await run(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
const fakeFetch = (text, init = {}) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(text, { headers: { "content-type": "application/json" }, ...init });
  };
  return { fetch, calls };
};
const kwaterArgs = (out) => ({
  target: "kwater-bid-servc",
  month: "202610",
  from: null,
  to: null,
  rows: 10,
  out,
  dryRun: false,
  env: { KWATER_BID_NOTICE_SERVICE_KEY: KEY },
  now,
});

describe("record-datagokr", () => {
  it("인자: 대상마다 월 또는 기간만 받는다", () => {
    assert.throws(() => parseArgs(["--target", "nope", "--month", "202610"]), StopRecording);
    assert.throws(
      () => parseArgs(["--target", "kwater-bid-servc", "--from", "20261001"]),
      StopRecording,
    );
    assert.throws(
      () => parseArgs(["--target", "lh-pre-spec", "--from", "20261105", "--to", "20261028"]),
      StopRecording,
    );
    assert.equal(parseArgs(["--target", "kwater-bid-servc", "--month", "202610"]).month, "202610");
    assert.equal(
      parseArgs(["--target", "lh-pre-spec", "--from", "20261028", "--to", "20261104"]).to,
      "20261104",
    );
  });

  it("키가 없으면 부르지 않고, --dry-run 도 부르지 않으며 표식을 남기지 않는다", async () => {
    await withOut(async (out) => {
      const { fetch, calls } = fakeFetch(kwaterBody([kwaterItem()]));
      await assert.rejects(recordOnce({ ...kwaterArgs(out), env: {}, fetch }), StopRecording);
      const dry = await recordOnce({ ...kwaterArgs(out), dryRun: true, fetch });
      assert.equal(dry.calls, 0);
      assert.equal(calls.length, 0);
      assert.deepEqual(await readdir(out), []);
    });
  });

  it("JSON: 1회 불러 명세 칸만 남기고 담당자·명세 밖 값·전화·키 흔적을 가린다", async () => {
    await withOut(async (out) => {
      const echoed = kwaterBody([
        kwaterItem({ cntrctDeptNm: `부서 ${decodeURIComponent(KEY)}` }),
        kwaterItem({ tndrPbanno: "2026-0002" }),
      ]);
      const { fetch, calls } = fakeFetch(echoed);
      const result = await recordOnce({ ...kwaterArgs(out), fetch });
      assert.equal(calls.length, 1);
      const url = new URL(calls[0].url);
      assert.equal(`${url.origin}${url.pathname}`, TARGETS["kwater-bid-servc"].url);
      assert.equal(url.searchParams.get("serviceKey"), decodeURIComponent(KEY));
      assert.equal(url.searchParams.get("searchDt"), "202610");
      assert.equal(url.searchParams.get("_type"), "json");
      assert.equal(calls[0].options.redirect, "manual");
      const saved = await readFile(path.join(out, "servcList.202610.masked.json"), "utf8");
      for (const leak of [
        "김합성",
        "042-629-0000",
        "명세에 없는 합성칸",
        "synthetic+datagokr",
        "synthetic%2Bdatagokr",
      ])
        assert.equal(saved.includes(leak), false, leak);
      assert.ok(result.maskedFields.includes("(secret)"));
      for (const field of ["intnChargerNm", "internalNote", "tndrPblancNm(pattern)"])
        assert.ok(result.maskedFields.includes(field), field);
      assert.equal(JSON.stringify(result).includes("synthetic"), false);
      assert.equal(result.verdict, "SUCCESS");
      assert.equal(result.identified, "2/2");
      assert.deepEqual(result.enumValues.tndrStat, ["공고중"]);
      assert.deepEqual(result.unknownFields, ["internalNote", "intnChargerNm"]);
    });
  });

  it("표식이 있으면 기간이 달라도 다시 부르지 않는다", async () => {
    await withOut(async (out) => {
      const first = fakeFetch(kwaterBody([kwaterItem()]));
      await recordOnce({ ...kwaterArgs(out), fetch: first.fetch });
      const second = fakeFetch(kwaterBody([kwaterItem()]));
      await assert.rejects(
        recordOnce({ ...kwaterArgs(out), month: "202609", fetch: second.fetch }),
        StopRecording,
      );
      assert.equal(second.calls.length, 0);
    });
  });

  it("XML: 명세 칸만 남기고 이메일·전화 칸은 가린다", () => {
    const target = TARGETS["lh-pre-spec"];
    const masked = maskBody(target, lhPreSpecXml);
    assert.equal(masked.format, "xml");
    for (const leak of ["someone@example.com", "055-922-0000"])
      assert.equal(masked.body.includes(leak), false, leak);
    assert.ok(masked.body.includes("합성 사전규격"));
    const summary = summarize(target, masked.format, masked.body);
    assert.equal(judge(summary, { httpStatus: 200, rows: 10 }).verdict, "SUCCESS");
    assert.deepEqual(summary.enumValues.cstrtnJobGbNm, ["용역"]);
  });

  it("판정: 게이트웨이 30·빈 결과·식별 칸 빠짐", () => {
    const target = TARGETS["kwater-bid-servc"];
    const verdictOf = (raw) => {
      const masked = maskBody(target, raw);
      return judge(summarize(target, masked.format, masked.body), { httpStatus: 200, rows: 10 });
    };
    const gateway = verdictOf(gatewayError);
    assert.equal(gateway.verdict, "FAILED");
    assert.match(gateway.reason, /30/);
    assert.equal(verdictOf(kwaterBody([])).verdict, "EMPTY");
    assert.equal(verdictOf(kwaterBody([kwaterItem({ tndrPbanno: "" })])).verdict, "FORMAT_ISSUE");
    assert.equal(
      verdictOf(kwaterBody([kwaterItem()], { resultCode: "99", resultMsg: "x" })).verdict,
      "FAILED",
    );
  });
});
