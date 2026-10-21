import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROGRAM_RECORDED_SCHEMA_VERSION,
  assertProgramRecordingShape,
  bizinfoParams,
  bizinfoRequestUrl,
  buildProgramRecording,
  isAllowedProgramUrl,
  maskBizinfoBody,
  maskMssBody,
  recordingFileName,
  scanProgramLeaks,
  secretForms,
} from "./program-notices-lib.mjs";

const KEY = "ab+c/d=1";

describe("maskBizinfoBody", () => {
  it("문의처(refrncNm)는 *** 로, 다른 필드의 전화·이메일·대표번호는 같은 길이 * 로 바꾼다", () => {
    const raw = JSON.stringify({
      jsonArray: {
        item: [
          {
            pblancNm: "가상 공고",
            refrncNm: "담당 홍길동 02-111-2222",
            bsnsSumryCn: "문의 044-123-4567, a@b.go.kr, 1588-1234",
            reqstBeginEndDe: "20261001 ~ 20261031",
          },
        ],
      },
    });
    const { body, maskedFields } = maskBizinfoBody(raw);
    const [item] = JSON.parse(body).jsonArray.item;
    assert.equal(item.refrncNm, "***");
    assert.equal(item.bsnsSumryCn, "문의 ************, *********, *********");
    assert.equal(item.reqstBeginEndDe, "20261001 ~ 20261031");
    assert.deepEqual(maskedFields, ["bsnsSumryCn(pattern)", "refrncNm"]);
  });

  it("JSON 이 아니면 본문 글자에서 패턴만 가린다", () => {
    assert.deepEqual(maskBizinfoBody("<html>02-111-2222</html>"), {
      body: "<html>***********</html>",
      maskedFields: ["(body)(pattern)"],
    });
  });
});

describe("maskMssBody", () => {
  it("RSS 본문의 전화·이메일만 가리고 링크·날짜는 그대로 둔다", () => {
    const raw =
      "<item><title>문의 02-111-2222</title><link>https://mss.go.kr/a?bcIdx=1&amp;x=2</link><pubDate>20261021093000</pubDate></item>";
    const { body, maskedFields } = maskMssBody(raw);
    assert.equal(
      body,
      "<item><title>문의 ***********</title><link>https://mss.go.kr/a?bcIdx=1&amp;x=2</link><pubDate>20261021093000</pubDate></item>",
    );
    assert.deepEqual(maskedFields, ["(body)(pattern)"]);
    assert.deepEqual(maskMssBody("<rss></rss>").maskedFields, []);
  });
});

describe("요청·녹음", () => {
  it("기업마당 params 에는 키가 없고, 요청 URL 에만 crtfcKey 가 붙는다", () => {
    const params = bizinfoParams({ categories: ["02"], maxItems: 100 });
    assert.deepEqual(params, { dataType: "json", searchCnt: "100", searchLclasId: "02" });
    const url = new URL(bizinfoRequestUrl(KEY, params));
    assert.equal(url.origin + url.pathname, "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do");
    assert.equal(url.searchParams.get("crtfcKey"), KEY);
  });

  it("허용 호스트 두 곳의 https 만 받는다", () => {
    assert.equal(isAllowedProgramUrl("https://mss.go.kr/rss/smba/board/310.do"), true);
    assert.equal(isAllowedProgramUrl("https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do"), true);
    for (const url of [
      "http://mss.go.kr/x",
      "https://mss.go.kr.evil.example/x",
      "https://u@mss.go.kr/x",
    ])
      assert.equal(isAllowedProgramUrl(url), false, url);
  });

  it("녹음 객체는 정본 형식이고 rawSha256 은 가리기 전 원문의 해시다", () => {
    const recording = buildProgramRecording({
      source: "mss",
      params: {},
      fetchedAt: "2026-10-21T01:00:00.000Z",
      httpStatus: 200,
      contentType: "application/rss+xml",
      rawBody: "<rss>02-111-2222</rss>",
      maskedBody: "<rss>***********</rss>",
      maskedFields: ["(body)(pattern)"],
      note: "시험",
    });
    assert.equal(recording.schemaVersion, PROGRAM_RECORDED_SCHEMA_VERSION);
    assert.equal(recording.masked, true);
    assert.match(recording.rawSha256, /^[0-9a-f]{64}$/);
    assert.equal(recording.body, "<rss>***********</rss>");
    assert.doesNotThrow(() => assertProgramRecordingShape(recording));
  });

  it("params 에 crtfcKey(대소문자 무관)가 있거나 키가 더 있으면 형식 오류이고 메시지에 값이 없다", () => {
    const base = buildProgramRecording({
      source: "bizinfo",
      params: { dataType: "json" },
      fetchedAt: "2026-10-21T01:00:00.000Z",
      httpStatus: 200,
      contentType: "application/json",
      rawBody: "{}",
      maskedBody: "{}",
      maskedFields: [],
      note: "시험",
    });
    assert.throws(
      () => assertProgramRecordingShape({ ...base, params: { CrtfcKey: KEY } }),
      (error) => !String(error.message).includes(KEY),
    );
    assert.throws(() => assertProgramRecordingShape({ ...base, extra: 1 }));
    assert.throws(() => assertProgramRecordingShape({ ...base, masked: false }));
  });

  it("파일 이름은 소스별 이름 + KST 날짜다", () => {
    assert.equal(
      recordingFileName("mss", "2026-10-21T15:30:00.000Z"),
      "rss-310.20261022.masked.json",
    );
    assert.equal(
      recordingFileName("bizinfo", "2026-10-21T01:00:00.000Z"),
      "api.20261021.masked.json",
    );
  });
});

describe("scanProgramLeaks", () => {
  it("키의 네 형태(원문·1회·2회 인코딩·소문자 인코딩)와 crtfcKey·전화·이메일을 센다", () => {
    const forms = secretForms(KEY);
    assert.equal(forms.length, 4);
    for (const form of forms) assert.equal(scanProgramLeaks(`x ${form} y`, forms).secret, 1, form);
    assert.deepEqual(scanProgramLeaks("crtfcKey=1 02-111-2222 a@b.go.kr 1588-1234", forms), {
      email: 1,
      phone: 1,
      representative: 1,
      crtfcKey: 1,
      secret: 0,
    });
    assert.deepEqual(scanProgramLeaks("깨끗한 본문 2026-10-21", forms), {
      email: 0,
      phone: 0,
      representative: 0,
      crtfcKey: 0,
      secret: 0,
    });
  });
});
