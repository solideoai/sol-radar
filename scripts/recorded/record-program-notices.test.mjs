import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { parseArgs, recordOnce } from "./record-program-notices.mjs";
import { secretForms } from "./program-notices-lib.mjs";

const KEY = "test+key/123=";
const NOW = () => new Date("2026-10-21T01:00:00.000Z");
const sandboxes = [];
const outDir = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "program-recording-"));
  sandboxes.push(dir);
  return dir;
};
after(() => sandboxes.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const BIZINFO_BODY = JSON.stringify({
  jsonArray: [
    {
      pblancId: "PBLN_1",
      pblancNm: "가상 공고",
      pblancUrl: "/web/view.do?pblancId=PBLN_1",
      refrncNm: "담당 홍길동 02-111-2222",
      bsnsSumryCn: "문의 a@b.go.kr",
    },
  ],
});

const fakeFetch = (response) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return typeof response === "function" ? response() : response;
  };
  return { fetch, calls };
};

describe("parseArgs", () => {
  it("--source 가 mss·bizinfo 가 아니면 멈춘다", () => {
    assert.throws(() => parseArgs([]), /--source/);
    assert.throws(() => parseArgs(["--source", "g2b"]), /--source/);
    assert.equal(parseArgs(["--", "--source", "mss"]).source, "mss");
  });
});

describe("recordOnce", () => {
  it("기업마당은 키가 없으면 부르지 않고 멈춘다", async () => {
    const { fetch, calls } = fakeFetch(new Response(BIZINFO_BODY));
    await assert.rejects(
      recordOnce({ source: "bizinfo", out: outDir(), dryRun: false, env: {}, fetch, now: NOW }),
      /BIZINFO_API_KEY/,
    );
    assert.equal(calls.length, 0);
  });

  it("기업마당 녹음: 한 번 부르고, 파일·요약 어디에도 키·문의처·연락처가 없다", async () => {
    const out = outDir();
    const { fetch, calls } = fakeFetch(
      new Response(BIZINFO_BODY, { headers: { "content-type": "application/json" } }),
    );
    const summary = await recordOnce({
      source: "bizinfo",
      out,
      dryRun: false,
      env: { BIZINFO_API_KEY: KEY },
      fetch,
      now: NOW,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(new URL(calls[0].url).searchParams.get("crtfcKey"), KEY);
    const [name] = readdirSync(path.join(out, "bizinfo"));
    assert.equal(name, "api.20261021.masked.json");
    const text = readFileSync(path.join(out, "bizinfo", name), "utf8");
    for (const form of secretForms(KEY)) assert.equal(text.includes(form), false, form);
    assert.doesNotMatch(text, /crtfckey|홍길동|02-111-2222|a@b\.go\.kr/i);
    const recording = JSON.parse(text);
    assert.deepEqual(recording.params, { dataType: "json", searchCnt: "100", searchLclasId: "02" });
    assert.equal(JSON.parse(recording.body).jsonArray[0].refrncNm, "***");
    assert.equal(summary.items, 1);
    const printed = JSON.stringify(summary);
    for (const form of secretForms(KEY)) assert.equal(printed.includes(form), false, form);
  });

  it("중기부 녹음은 키 없이 RSS 를 저장한다", async () => {
    const out = outDir();
    const { fetch } = fakeFetch(
      new Response("<rss><channel><item><title>가</title></item></channel></rss>"),
    );
    const summary = await recordOnce({
      source: "mss",
      out,
      dryRun: false,
      env: {},
      fetch,
      now: NOW,
    });
    assert.equal(summary.file.endsWith(path.join("mss", "rss-310.20261021.masked.json")), true);
    assert.equal(summary.items, 1);
  });

  it("3xx 는 따르지 않고 멈추며 파일을 만들지 않는다", async () => {
    const out = outDir();
    const { fetch } = fakeFetch(
      new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    );
    await assert.rejects(
      recordOnce({ source: "mss", out, dryRun: false, env: {}, fetch, now: NOW }),
      /리다이렉트 302/,
    );
    assert.equal(existsSync(path.join(out, "mss")), false);
  });

  it("fetch 가 URL 이 든 메시지로 던져도 오류 메시지에 키가 없다", async () => {
    const fetch = async (url) => {
      throw new TypeError(`fetch failed ${url}`);
    };
    await assert.rejects(
      recordOnce({
        source: "bizinfo",
        out: outDir(),
        dryRun: false,
        env: { BIZINFO_API_KEY: KEY },
        fetch,
        now: NOW,
      }),
      (error) => /요청 실패: TypeError/.test(error.message) && !error.message.includes("crtfcKey"),
    );
  });

  it("--dry-run 은 부르지 않고 키 없는 params 만 돌려준다", async () => {
    const { fetch, calls } = fakeFetch(new Response(""));
    const summary = await recordOnce({
      source: "bizinfo",
      out: outDir(),
      dryRun: true,
      env: { BIZINFO_API_KEY: KEY },
      fetch,
      now: NOW,
    });
    assert.equal(calls.length, 0);
    assert.deepEqual(summary, {
      dryRun: true,
      source: "bizinfo",
      params: { dataType: "json", searchCnt: "100", searchLclasId: "02" },
    });
  });
});
