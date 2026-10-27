// record-lh-bid-notice.mjs 시험. 실제 API 를 부르지 않는다(가짜 fetch). 응답은 fixtures/synthetic/15159012 합성 파일이다.
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ATTEMPT_MARKER,
  LH_ENDPOINT,
  StopRecording,
  judge,
  maskLhBody,
  parseArgs,
  recordOnce,
  requestUrl,
  summarize,
} from "./record-lh-bid-notice.mjs";

const SYNTHETIC = new URL("../../fixtures/synthetic/15159012/", import.meta.url);
const synthetic = (name) => readFile(new URL(name, SYNTHETIC), "utf8");
const page1 = await synthetic("getOpenBidInfo.page1.synthetic.xml");
// 가짜 키. Encoding 형태(%2B)로 넣어 디코드·재인코딩 흔적까지 찾게 한다.
const KEY = "synthetic%2Blh%2Fkey%3D%3D";
const KEY_FORMS = ["synthetic%2Blh", "synthetic+lh", "synthetic%252Blh"];
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
const verdictOf = (raw, httpStatus = 200) =>
  judge(summarize(maskLhBody(raw).body), { httpStatus, rows: 10 }).verdict;

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
    assert.deepEqual(summary.requiredFields, { bidNum: "2/2", bidDegree: "2/2", bidnmKor: "2/2" });
    assert.deepEqual(summary.checkedFields.presmtPrc, "2/2");
    assert.equal(summary.normalizable, "2/2");
    assert.deepEqual(summary.unknownTags, ["chpsnEmail", "rprsntvNm"]);
    assert.ok(summary.absentSpecTags.includes("designPrc"));
    assert.ok(!summary.absentSpecTags.includes("bidNum"));
    assert.deepEqual(summary.fieldShapes.tndrbidRegDt, ["digits:8"]);
    assert.deepEqual(summary.fieldShapes.tndrdocAcptEndDtm, ["digits:12"]);
    assert.deepEqual(summary.enumValues.bidProgrsStatus, ["공고중"]);
    assert.equal(summary.fieldShapes.bidnmKor.includes("text"), true);
  });

  it("CDATA·속성·주석·껍데기 안 글자도 명세 값 칸이 아니면 가린다", () => {
    const raw = page1
      .replace(
        "<bidnmKor>합성 데이터 설계 용역</bidnmKor>",
        "<bidnmKor><![CDATA[합성 데이터 설계 용역 <2차>]]></bidnmKor>" +
          "<rprsntvNm><![CDATA[합성대표]]></rprsntvNm>" +
          '<extraNm grade="합성속성">합성값</extraNm><!-- 합성주석 -->합성맨글자<emptyTag/>',
      )
      .replace("<item>", '<item seq="합성속성2">');
    const { body, maskedFields } = maskLhBody(raw);
    for (const leaked of ["합성대표", "합성속성", "합성값", "합성주석", "합성맨글자"])
      assert.ok(!body.includes(leaked), leaked);
    assert.ok(body.includes("<![CDATA[합성 데이터 설계 용역 <2차>]]>"));
    assert.deepEqual(maskedFields, [
      "(comment)",
      "chpsnEmail",
      "extraNm",
      "extraNm(attribute)",
      "item",
      "item(attribute)",
      "rprsntvNm",
    ]);
    const summary = summarize(body);
    assert.equal(summary.items, 2);
    assert.equal(summary.normalizable, "2/2");
    assert.deepEqual(summary.unknownTags, ["chpsnEmail", "extraNm", "rprsntvNm"]);
  });

  it("판정: 성공·빈 날·형식 이상·멈춤 코드를 가른다", async () => {
    assert.equal(verdictOf(page1), "SUCCESS");
    assert.equal(verdictOf(await synthetic("getOpenBidInfo.no-data.synthetic.xml")), "EMPTY");
    assert.equal(
      verdictOf(await synthetic("getOpenBidInfo.missing-fields.synthetic.xml")),
      "FORMAT_ISSUE",
    );
    for (const [name, code] of [
      ["gateway-denied", "20"],
      ["gateway-quota", "22"],
      ["gateway-auth", "30"],
    ]) {
      const result = judge(summarize(maskLhBody(await synthetic(`${name}.synthetic.xml`)).body), {
        httpStatus: 200,
        rows: 10,
      });
      assert.equal(result.verdict, "FAILED");
      assert.match(result.reason, new RegExp(`결과 코드 ${code}`));
      assert.match(result.next, /추가 호출은 결과 보고·승인 뒤에만/);
    }
    assert.equal(verdictOf("<html><body>점검 중</body></html>"), "FORMAT_ISSUE");
    assert.equal(verdictOf("<html><body>점검 중</body></html>", 500), "FAILED");
    assert.equal(verdictOf(page1.replace("<totalCount>3</totalCount>", "")), "FORMAT_ISSUE");
    // 차수가 숫자가 아니면 정규화가 격리한다
    assert.equal(
      verdictOf(page1.replace("<bidDegree>0</bidDegree>", "<bidDegree>1차</bidDegree>")),
      "FORMAT_ISSUE",
    );
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
      assert.equal(summary.verdict, "SUCCESS");
      assert.ok(Object.values(summary.leakScan).every((count) => count === 0));
      assert.ok(!JSON.stringify(summary).includes("synthetic"));
      assert.deepEqual((await readdir(out)).sort(), [
        "getOpenBidInfo.20261026.p1.masked.json",
        ATTEMPT_MARKER,
      ]);
      const saved = await readFile(
        path.join(out, "getOpenBidInfo.20261026.p1.masked.json"),
        "utf8",
      );
      for (const form of KEY_FORMS) assert.ok(!saved.includes(form));
      assert.ok(!saved.includes("synthetic-contact@example.test"));
      // 같은 녹음이든 다른 날짜·쪽이든, 시도 표식이 있으면 부르기 전에 멈춘다
      for (const again of [
        { date: "20261026", page: 1 },
        { date: "20261023", page: 2 },
      ])
        await assert.rejects(
          recordOnce({ ...again, rows: 10, out, dryRun: false, env, fetch, now }),
          StopRecording,
        );
      assert.equal(calls.length, 1);
    });
  });

  it("응답에 키가 되돌아오면 지우고 저장한다", async () => {
    await withOut(async (out) => {
      const echoed = page1
        .replace("NORMAL SERVICE.", "NORMAL SERVICE. serviceKey=synthetic+lh/key==")
        .replace(
          "<bidNum>2026100002</bidNum>",
          "<bidNum>2026100002</bidNum><echo>synthetic%2Blh%2Fkey%3D%3D</echo>",
        );
      const { fetch } = fakeFetch(echoed);
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
      assert.equal(summary.maskedFields[0], "(secret)");
      const saved = await readFile(
        path.join(out, "getOpenBidInfo.20261026.p1.masked.json"),
        "utf8",
      );
      for (const form of KEY_FORMS) assert.ok(!saved.includes(form));
      assert.ok(saved.includes("NORMAL SERVICE. serviceKey=***"));
    });
  });

  it("키가 없거나 --dry-run 이면 부르지 않고, 실패한 시도 뒤에도 다시 부르지 않는다", async () => {
    await withOut(async (out) => {
      const { fetch, calls } = fakeFetch(page1);
      const base = { date: "20261026", page: 1, rows: 10, out, fetch, now };
      await assert.rejects(recordOnce({ ...base, dryRun: false, env: {} }), StopRecording);
      const dry = await recordOnce({ ...base, dryRun: true, env });
      assert.equal(dry.dryRun, true);
      assert.equal(dry.calls, 0);
      assert.equal(dry.params.tndrbidRegDtEnd, "20261026");
      assert.equal(calls.length, 0);
      assert.deepEqual(await readdir(out), []);
      // content-length 없이 2 MiB 를 넘으면 읽던 중 끊고 저장하지 않는다. 표식은 남아 다음 실행이 부르지 않는다
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
      assert.deepEqual(await readdir(out), [ATTEMPT_MARKER]);
      await assert.rejects(recordOnce({ ...base, dryRun: false, env }), /이미 한 번 시도했다/);
      await assert.rejects(recordOnce({ ...base, dryRun: true, env }), /이미 한 번 시도했다/);
      assert.equal(calls.length, 0);
    });
    await withOut(async (out) => {
      const moved = fakeFetch("", { status: 302 });
      const base = { date: "20261026", page: 1, rows: 10, out, env, now };
      await assert.rejects(
        recordOnce({ ...base, dryRun: false, fetch: moved.fetch }),
        /리다이렉트/,
      );
      await assert.rejects(
        recordOnce({ ...base, dryRun: false, fetch: moved.fetch }),
        StopRecording,
      );
      assert.equal(moved.calls.length, 1);
      assert.deepEqual(await readdir(out), [ATTEMPT_MARKER]);
    });
  });

  it("표식은 부르기 전에 디스크에 있고, 키를 담지 않는다. 요청 예외 뒤에도 다시 부르지 않는다", async () => {
    await withOut(async (out) => {
      const marker = path.join(out, ATTEMPT_MARKER);
      const seen = [];
      const fetch = async (url) => {
        seen.push(JSON.parse(await readFile(marker, "utf8")));
        throw new TypeError(`fetch failed ${url}`);
      };
      const base = { date: "20261026", page: 1, rows: 10, out, env, fetch, now };
      const failure = await recordOnce({ ...base, dryRun: false }).catch((error) => error);
      assert.ok(failure instanceof StopRecording);
      assert.match(failure.message, /요청 실패: TypeError/);
      for (const form of KEY_FORMS) assert.ok(!failure.message.includes(form));
      assert.equal(seen.length, 1);
      assert.deepEqual(Object.keys(seen[0]), ["startedAt", "params"]);
      const markerText = await readFile(marker, "utf8");
      for (const form of [...KEY_FORMS, "serviceKey"]) assert.ok(!markerText.includes(form));
      await assert.rejects(recordOnce({ ...base, dryRun: false }), /이미 한 번 시도했다/);
      assert.equal(seen.length, 1);
    });
  });

  it("표식을 만들 수 없으면 부르지 않고, --dry-run 도 저장 폴더를 먼저 확인한다", async () => {
    await withOut(async (dir) => {
      // 일반 파일 아래 경로라 폴더를 만들 수 없다(root 로 돌려도 막힌다)
      const blocker = path.join(dir, "not-a-dir");
      await writeFile(blocker, "x");
      const out = path.join(blocker, "out");
      const { fetch, calls } = fakeFetch(page1);
      const base = { date: "20261026", page: 1, rows: 10, out, env, fetch, now };
      await assert.rejects(recordOnce({ ...base, dryRun: true }), /저장 폴더에 쓸 수 없다/);
      await assert.rejects(
        recordOnce({ ...base, dryRun: false }),
        /시도 표식을 남기지 못해 부르지 않았다: ENOTDIR/,
      );
      assert.equal(calls.length, 0);
    });
  });
});
