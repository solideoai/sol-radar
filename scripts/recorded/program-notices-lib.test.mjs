import assert from "node:assert/strict";
import { it } from "node:test";
import {
  assertProgramRecordingShape,
  buildProgramRecording,
  isAllowedProgramUrl,
  maskJsonBody,
  msitParams,
  msitRequestUrl,
  scanProgramLeaks,
} from "./program-notices-lib.mjs";

// 과기정통부 사업공고(공공데이터포털 15074634) 녹음 규칙. 키·사람 값은 전부 가짜다.

const validRecording = buildProgramRecording({
  source: "msit",
  params: msitParams({ maxItems: 50 }),
  fetchedAt: "2026-11-02T01:00:00.000Z",
  httpStatus: 200,
  contentType: "application/json",
  rawBody: "{}",
  maskedBody: "{}",
  maskedFields: [],
  note: "시험",
});

it("msitRequestUrl decodes the portal Encoding key once", () => {
  const url = new URL(msitRequestUrl("ab%2Bc%3D%3D", msitParams({ maxItems: 50 })));
  assert.equal(url.hostname, "apis.data.go.kr");
  assert.equal(url.searchParams.get("ServiceKey"), "ab+c==");
  assert.match(url.search, /ServiceKey=ab%2Bc%3D%3D(&|$)/);
  assert.equal(url.searchParams.get("numOfRows"), "50");
  assert.equal(url.searchParams.get("returnType"), "json");
  assert.equal(isAllowedProgramUrl(url.toString()), true);
  assert.throws(() => msitRequestUrl("%E0%A4%A", msitParams({ maxItems: 50 })));
});

it("maskJsonBody hides MSIT manager name and phone", () => {
  const raw = JSON.stringify({
    items: [{ subject: "공모", managerName: "홍길동", managerTel: "044-202-4321" }],
  });
  const { body, maskedFields } = maskJsonBody(raw);
  assert.doesNotMatch(body, /홍길동|044-202-4321/);
  assert.deepEqual(maskedFields, ["managerName", "managerTel"]);
});

it("recording shape and leak scan reject a ServiceKey", () => {
  assert.doesNotThrow(() => assertProgramRecordingShape(validRecording));
  assert.throws(
    () => assertProgramRecordingShape({ ...validRecording, params: { ServiceKey: "x" } }),
    /인증키/,
  );
  // 키 값은 secrets 로 잡는다. ServiceKey 단어 자체는 공용 검사가 세지 않는다(LH 녹음은 가린 키 자리에 이름이 남는다).
  assert.equal(scanProgramLeaks("a?ServiceKey=zzz", ["zzz"]).secret, 1);
});
