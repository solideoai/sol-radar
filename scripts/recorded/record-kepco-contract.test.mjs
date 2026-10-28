// record-kepco-contract.mjs 시험. 실제 API 를 부르지 않는다(가짜 fetch). 응답은 아래 합성 JSON 이다.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ATTEMPT_MARKER,
  KEPCO_ENDPOINT,
  StopRecording,
  judge,
  maskKepcoBody,
  parseArgs,
  recordOnce,
  summarize,
} from "./record-kepco-contract.mjs";

// 가짜 키(40자)
const KEY = "syntheticKepcoKey0123456789abcdefghijklm";
const env = { KEPCO_EBID_CONTRACT_SERVICE_KEY: KEY };
const now = () => new Date("2026-10-28T03:30:00.000Z");
const row = (overrides) => ({
  no: "E012610001",
  name: "합성 배전 자재 구매",
  companyId: "COM01",
  progressState: "AttendProgress",
  noticeDate: "2026-10-27",
  endDatetime: "2026-11-05 10:00",
  bidAttendReqCloseDatetime: "2026-11-03 17:00",
  presumedPrice: "120000000",
  etc: "문의 02-123-4567",
  chargerName: "홍길동",
  managerTel: "061-345-6789",
  internalMemo: "내부 메모 합성값",
  ...overrides,
});
const body = (rows, envelope = { resultCode: "00", totalCount: rows.length }) =>
  JSON.stringify({ ...envelope, data: rows });

async function withOut(run) {
  const out = await mkdtemp(path.join(tmpdir(), "kepco-record-"));
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
    return new Response(text, {
      headers: { "content-type": "application/json;charset=UTF-8" },
      ...init,
    });
  };
  return { fetch, calls };
};
const base = (out) => ({ date: "20261027", company: null, out, dryRun: false, env, now });

describe("record-kepco-contract", () => {
  it("인자: 날짜는 YYYYMMDD, 회사 코드는 확인된 코드만", () => {
    assert.throws(() => parseArgs([]), StopRecording);
    assert.throws(() => parseArgs(["--date", "2026-10-27"]), StopRecording);
    assert.throws(() => parseArgs(["--date", "20261027", "--company", "COM99"]), StopRecording);
    assert.equal(parseArgs(["--date", "20261027", "--company", "COM05"]).company, "COM05");
    assert.equal(parseArgs(["--date", "20261027"]).company, null);
  });

  it("키가 없거나 40자가 아니면 부르지 않고 표식도 남기지 않는다", async () => {
    await withOut(async (out) => {
      for (const bad of [{}, { KEPCO_EBID_CONTRACT_SERVICE_KEY: "short" }]) {
        const { fetch, calls } = fakeFetch(body([row()]));
        await assert.rejects(recordOnce({ ...base(out), env: bad, fetch }), StopRecording);
        assert.equal(calls.length, 0);
      }
      assert.deepEqual(await readdir(out), []);
    });
  });

  it("--dry-run 은 부르지 않고 표식도 남기지 않는다", async () => {
    await withOut(async (out) => {
      const { fetch, calls } = fakeFetch(body([row()]));
      const result = await recordOnce({ ...base(out), dryRun: true, fetch });
      assert.equal(result.calls, 0);
      assert.equal(calls.length, 0);
      assert.deepEqual(await readdir(out), []);
    });
  });

  it("1회 불러 가려 저장한다: 키 흔적·담당자 칸·명세 밖 값·전화는 남지 않는다", async () => {
    await withOut(async (out) => {
      const echoed = body([row({ name: `합성 공고 ${KEY}` }), row({ no: "E012610002" })]);
      const { fetch, calls } = fakeFetch(echoed);
      const result = await recordOnce({ ...base(out), fetch });
      assert.equal(calls.length, 1);
      const url = new URL(calls[0].url);
      assert.equal(`${url.origin}${url.pathname}`, KEPCO_ENDPOINT);
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        apiKey: KEY,
        noticeBeginDate: "20261027",
        noticeEndDate: "20261027",
        returnType: "json",
      });
      assert.equal(calls[0].options.redirect, "manual");
      const saved = await readFile(path.join(out, "electContract.20261027.masked.json"), "utf8");
      for (const leak of [KEY, "홍길동", "061-345-6789", "02-123-4567", "내부 메모 합성값"])
        assert.equal(saved.includes(leak), false, leak);
      assert.ok(result.maskedFields.includes("(secret)"));
      for (const field of ["chargerName", "managerTel", "internalMemo", "etc(pattern)"])
        assert.ok(result.maskedFields.includes(field), field);
      assert.equal(JSON.stringify(result).includes(KEY), false);
      assert.equal(result.verdict, "SUCCESS");
      assert.equal(result.rowsPath, "data");
      assert.equal(result.normalizable, "2/2");
      assert.deepEqual(result.enumValues.progressState, ["AttendProgress"]);
      assert.deepEqual(result.unknownFields, ["chargerName", "internalMemo", "managerTel"]);
    });
  });

  it("시도 표식이 있으면 날짜가 달라도 다시 부르지 않는다", async () => {
    await withOut(async (out) => {
      const first = fakeFetch(body([row()]));
      await recordOnce({ ...base(out), fetch: first.fetch });
      const second = fakeFetch(body([row()]));
      await assert.rejects(
        recordOnce({ ...base(out), date: "20261026", fetch: second.fetch }),
        StopRecording,
      );
      assert.equal(second.calls.length, 0);
    });
  });

  it("리다이렉트는 따르지 않고 멈추며 표식은 남는다", async () => {
    await withOut(async (out) => {
      const { fetch, calls } = fakeFetch(null, {
        status: 302,
        headers: { location: "https://example.invalid/" },
      });
      await assert.rejects(recordOnce({ ...base(out), fetch }), /리다이렉트 302/);
      assert.equal(calls.length, 1);
      assert.deepEqual(await readdir(out), [ATTEMPT_MARKER]);
    });
  });

  it("JSON 이 아닌 응답은 앞 2,000자만 남기고 FORMAT_ISSUE 다", async () => {
    const masked = maskKepcoBody(`<html>오류 010-1234-5678${"x".repeat(3000)}</html>`);
    assert.equal(masked.json, false);
    assert.equal(masked.body.length, 2000);
    assert.equal(masked.body.includes("010-1234-5678"), false);
    assert.deepEqual(masked.maskedFields, ["(non-json)", "(pattern)", "(truncated)"]);
    assert.equal(judge(summarize(masked.body), { httpStatus: 200 }).verdict, "FORMAT_ISSUE");
  });

  it("판정: 오류 결과 코드·빈 행·모르는 상태·인증 거부", () => {
    const verdictOf = (text, httpStatus = 200) =>
      judge(summarize(maskKepcoBody(text).body), { httpStatus }).verdict;
    assert.equal(verdictOf(body([], { resultCode: "99", totalCount: 0 })), "FAILED");
    assert.equal(verdictOf(body([])), "EMPTY");
    assert.equal(verdictOf(body([row({ progressState: "Unknown" })])), "FORMAT_ISSUE");
    assert.equal(verdictOf(body([row({ companyId: "" })])), "FORMAT_ISSUE");
    assert.equal(verdictOf(body([row()]), 401), "FAILED");
    assert.equal(verdictOf(JSON.stringify({ resultCode: "00" })), "FORMAT_ISSUE");
  });
});
