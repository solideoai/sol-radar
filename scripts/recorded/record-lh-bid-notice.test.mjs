// record-lh-bid-notice.mjs 시험. 실제 API 를 부르지 않는다(가짜 fetch). 응답은 fixtures/synthetic/15159012 합성 파일이다.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  LH_ENDPOINT,
  StopRecording,
  maskLhBody,
  parseArgs,
  recordOnce,
  requestUrl,
  summarize,
} from "./record-lh-bid-notice.mjs";

const SYNTHETIC = new URL("../../fixtures/synthetic/15159012/", import.meta.url);
const page1 = await readFile(new URL("getOpenBidInfo.page1.synthetic.xml", SYNTHETIC), "utf8");
// 가짜 키. Encoding 형태(%2B)로 넣어 디코드·재인코딩 흔적까지 찾게 한다.
const KEY = "synthetic%2Blh%2Fkey%3D%3D";
const env = { LH_BID_NOTICE_SERVICE_KEY: KEY };
const now = () => new Date("2026-10-27T03:30:00.000Z");

async function withOut(run) {
  const out = await mkdtemp(path.join(tmpdir(), "lh-record-"));
  try {
    return await run(out);
  } finally {
    await rm(out, { recursive: true, force: true });
  }
}
const fakeFetch = (body, init = {}) => {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(body, { headers: { "content-type": "application/xml" }, ...init });
  };
  return { fetch, calls };
};

describe("record-lh-bid-notice", () => {
  it("인자 범위를 지킨다(하루·1~5쪽·1~100행)", () => {
    assert.deepEqual(parseArgs(["--", "--date", "20261026"]).rows, 10);
    for (const argv of [
      [],
      ["--date", "2026-10-26"],
      ["--date", "20261026", "--page", "6"],
      ["--date", "20261026", "--rows", "101"],
      ["--date", "20261026", "--bogus"],
    ])
      assert.throws(() => parseArgs(argv), StopRecording);
  });

  it("키를 한 번만 인코딩하고 정해진 주소·변수만 쓴다", () => {
    const url = new URL(
      requestUrl(KEY, {
        pageNo: "1",
        numOfRows: "10",
        tndrbidRegDtStart: "20261026",
        tndrbidRegDtEnd: "20261026",
      }),
    );
    assert.equal(`${url.origin}${url.pathname}`, LH_ENDPOINT);
    assert.equal(url.searchParams.get("serviceKey"), "synthetic+lh/key==");
    assert.equal(url.searchParams.get("tndrbidRegDtStart"), "20261026");
    assert.throws(() => requestUrl("%E0%A4%A", {}), StopRecording);
  });

  it("담당자 태그·명세 밖 태그·본문 이메일·전화를 가리고, 값은 상태류만 요약한다", () => {
    const { body, maskedFields } = maskLhBody(
      page1
        .replace("<zoneRstrct1>", "<rprsntvNm>합성대표</rprsntvNm><zoneRstrct1>")
        .replace("<sunjungNm>협상에의한계약", "<sunjungNm>협상에의한계약 문의 02-123-4567"),
    );
    assert.ok(!body.includes("synthetic-contact@example.test"));
    assert.ok(!body.includes("합성대표"));
    assert.ok(!body.includes("02-123-4567"));
    assert.ok(body.includes("<rprsntvNm>***</rprsntvNm>"));
    assert.ok(body.includes("<bidnmKor>"));
    assert.deepEqual(maskedFields, ["(pattern)", "chpsnEmail", "rprsntvNm"]);
    const summary = summarize(body);
    assert.equal(summary.resultCode, "00");
    assert.equal(summary.totalCount, "3");
    assert.equal(summary.items, 2);
    assert.deepEqual(summary.fieldShapes.tndrbidRegDt, ["digits:8"]);
    assert.deepEqual(summary.fieldShapes.tndrdocAcptEndDtm, ["digits:12"]);
    assert.deepEqual(summary.enumValues.bidProgrsStatus, ["공고중"]);
    assert.equal(summary.fieldShapes.bidnmKor.includes("text"), true);
  });

  it("한 번 실행에 정확히 1회 부르고, 가린 녹음에는 키의 어떤 형태도 남지 않는다", async () => {
    await withOut(async (out) => {
      const { fetch, calls } = fakeFetch(page1);
      const summary = await recordOnce({
        date: "20261026",
        page: 1,
        rows: 10,
        out,
        dryRun: false,
        env,
        fetch,
        now,
      });
      assert.equal(calls.length, 1);
      assert.equal(calls[0].options.redirect, "manual");
      assert.equal(summary.calls, 1);
      assert.equal(summary.items, 2);
      assert.ok(!JSON.stringify(summary).includes("synthetic"));
      const [file] = await readdir(out);
      assert.equal(file, "getOpenBidInfo.20261026.p1.masked.json");
      const saved = await readFile(path.join(out, file), "utf8");
      for (const form of ["synthetic%2Blh", "synthetic+lh", "synthetic%252Blh"])
        assert.ok(!saved.includes(form));
      assert.ok(!saved.includes("synthetic-contact@example.test"));
      // 같은 녹음이 있으면 부르기 전에 멈춘다
      await assert.rejects(
        recordOnce({ date: "20261026", page: 1, rows: 10, out, dryRun: false, env, fetch, now }),
        StopRecording,
      );
      assert.equal(calls.length, 1);
    });
  });

  it("키가 없거나 --dry-run 이면 부르지 않고, 리다이렉트는 따르지 않는다", async () => {
    await withOut(async (out) => {
      const { fetch, calls } = fakeFetch(page1);
      const base = { date: "20261026", page: 1, rows: 10, out, fetch, now };
      await assert.rejects(recordOnce({ ...base, dryRun: false, env: {} }), StopRecording);
      const dry = await recordOnce({ ...base, dryRun: true, env });
      assert.equal(dry.dryRun, true);
      assert.equal(dry.calls, 0);
      assert.equal(dry.params.tndrbidRegDtEnd, "20261026");
      assert.equal(calls.length, 0);
      // content-length 없이 2 MiB 를 넘으면 읽던 중 끊고 저장하지 않는다
      const big = fakeFetch(
        new ReadableStream({
          start(controller) {
            for (let index = 0; index < 3; index += 1)
              controller.enqueue(new Uint8Array(1024 * 1024).fill(0x61));
            controller.close();
          },
        }),
      );
      await assert.rejects(recordOnce({ ...base, dryRun: false, env, fetch: big.fetch }), /2 MiB/);
      assert.equal(big.calls.length, 1);
      const moved = fakeFetch("", { status: 302 });
      await assert.rejects(
        recordOnce({ ...base, dryRun: false, env, fetch: moved.fetch }),
        StopRecording,
      );
      assert.equal(moved.calls.length, 1);
      assert.deepEqual(await readdir(out), []);
    });
  });
});
