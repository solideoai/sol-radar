import assert from "node:assert/strict";
import test from "node:test";
import {
  G2B_BID_NOTICE_MASK_TARGETS,
  hasLeak,
  maskItem,
  maskItems,
  maskPatterns,
  scanLeaks,
} from "./masking.mjs";
import { assertRecordedShape, buildRecording } from "./recording-file.mjs";

// 값은 전부 가짜다(실제 사람·전화·이메일이 아니다).
const ITEM = {
  bidNtceNo: "R26BK00000001",
  bidNtceNm: "테스트 공고 문의 02-123-4567 또는 ask@example.test",
  ntceInsttOfclNm: "홍길동",
  ntceInsttOfclTelNo: "031-123-4567",
  ntceInsttOfclEmailAdrs: "a@b.test",
  dminsttOfclEmailAdrs: "",
  exctvNm: "김철수",
  crdtrNm: "조달청장",
  rgstDt: "2026-10-12 09:00:22",
  asignBdgtAmt: "157308182",
  bidNtceDtlUrl:
    "https://www.g2b.go.kr/link/PNPE027_01/single/?bidPbancNo=R26BK00000001&bidPbancOrd=000",
};

test("maskItem: 이름 필드는 ***, 연락처 필드는 같은 길이의 *", () => {
  const { item, maskedFields } = maskItem(ITEM);
  assert.equal(item.ntceInsttOfclNm, "***");
  assert.equal(item.exctvNm, "***");
  assert.equal(item.crdtrNm, "***");
  assert.equal(item.ntceInsttOfclTelNo, "************");
  assert.equal(item.ntceInsttOfclTelNo.length, ITEM.ntceInsttOfclTelNo.length);
  assert.equal(item.ntceInsttOfclEmailAdrs, "********");
  assert.equal(item.dminsttOfclEmailAdrs, "");
  assert.deepEqual([...maskedFields].sort(), [
    "bidNtceNm(pattern)",
    "crdtrNm",
    "exctvNm",
    "ntceInsttOfclEmailAdrs",
    "ntceInsttOfclNm",
    "ntceInsttOfclTelNo",
  ]);
});

test("maskItem: 본문 전화·이메일 패턴은 같은 길이로 가리고 날짜·URL·번호는 그대로다", () => {
  const { item } = maskItem(ITEM);
  assert.equal(item.bidNtceNm, "테스트 공고 문의 *********** 또는 ****************");
  assert.equal(item.bidNtceNm.length, ITEM.bidNtceNm.length);
  assert.equal(item.rgstDt, ITEM.rgstDt);
  assert.equal(item.bidNtceDtlUrl, ITEM.bidNtceDtlUrl);
  assert.equal(item.asignBdgtAmt, ITEM.asignBdgtAmt);
  assert.equal(item.bidNtceNo, ITEM.bidNtceNo);
});

test("maskItem: 입력을 바꾸지 않는다", () => {
  const copy = structuredClone(ITEM);
  maskItem(ITEM);
  assert.deepEqual(ITEM, copy);
});

test("maskItem: 목록에 없는 담당자 필드도 이름 규칙으로 잡는다(Ofcl·TelNo·FaxNo·HpNo)", () => {
  const { item, maskedFields } = maskItem({
    dminsttOfclNm: "이영희",
    dminsttOfclHpNo: "010-1234-5678",
    bidFaxNo: "02-999-8888",
    someOfclCode: "ABC",
  });
  assert.equal(item.dminsttOfclNm, "***");
  assert.equal(item.dminsttOfclHpNo, "*************");
  assert.equal(item.bidFaxNo, "***********");
  assert.equal(item.someOfclCode, "***");
  assert.equal(maskedFields.size, 4);
});

test("maskPatterns: 패턴이 없으면 changed=false 이고 문자열이 그대로다", () => {
  assert.deepEqual(maskPatterns("2027년 시스템 유지관리 2026-10-12"), {
    masked: "2027년 시스템 유지관리 2026-10-12",
    changed: false,
  });
});

test("maskItems: 가린 필드의 합집합을 정렬해 돌려준다", () => {
  const { items, maskedFields } = maskItems([
    { ntceInsttOfclNm: "a", x: "1" },
    { ntceInsttOfclTelNo: "02-111-2222", x: "2" },
    { x: "3" },
  ]);
  assert.equal(items.length, 3);
  assert.deepEqual(maskedFields, ["ntceInsttOfclNm", "ntceInsttOfclTelNo"]);
});

test("scanLeaks: 이메일·전화·servicekey·키 흔적을 센다", () => {
  const scan = scanLeaks('{"a":"x@y.test","b":"02-123-4567","serviceKey":"k"} SECRET-1', [
    "SECRET-1",
    "",
  ]);
  assert.deepEqual(scan, { email: 1, phone: 1, serviceKeyParam: 1, secret: 1 });
  assert.equal(hasLeak(scan), true);
  assert.equal(hasLeak(scanLeaks("clean", ["SECRET-1"])), false);
});

test("buildRecording: 정본 스키마 키 집합·마스킹·rawSha256 을 채우고 params 에 serviceKey 가 없다", () => {
  const recorded = buildRecording({
    serviceId: "15129394",
    registryKey: "g2b-bid-notice",
    operation: "getBidPblancListInfoServc",
    params: { type: "json", pageNo: "1", numOfRows: "999", inqryDiv: "1" },
    fetchedAt: "2026-10-20T01:00:00.000Z",
    httpStatus: 200,
    rawText: '{"response":{}}',
    envelope: {
      envelope: "response",
      resultCode: "00",
      resultMsg: "정상",
      totalCount: 1,
      items: [ITEM],
    },
    note: "시험",
  });
  assert.equal(recorded.masked, true);
  assert.match(recorded.rawSha256, /^[0-9a-f]{64}$/);
  assert.equal(recorded.items[0].ntceInsttOfclNm, "***");
  assert.equal(recorded.maskedFieldsNote, "실제로 값이 있어 가린 필드");
  assert.equal(hasLeak(scanLeaks(JSON.stringify(recorded))), false);
  assert.deepEqual(Object.keys(recorded), [
    "schemaVersion",
    "serviceId",
    "registryKey",
    "operation",
    "params",
    "fetchedAt",
    "httpStatus",
    "envelope",
    "resultCode",
    "resultMsg",
    "totalCount",
    "items",
    "masked",
    "maskedFields",
    "maskedFieldsNote",
    "rawSha256",
    "note",
  ]);
});

test("buildRecording: 담당자 필드가 없는 응답은 서비스 기준 마스킹 대상 목록과 구분 메모를 적는다", () => {
  const recorded = buildRecording({
    serviceId: "15129394",
    registryKey: "g2b-bid-license-limit",
    operation: "getBidPblancListInfoLicenseLimit",
    params: {
      type: "json",
      pageNo: "1",
      numOfRows: "999",
      inqryDiv: "2",
      bidNtceNo: "R26BK00000001",
      bidNtceOrd: "000",
    },
    fetchedAt: "2026-10-20T01:00:00.000Z",
    httpStatus: 200,
    rawText: "{}",
    envelope: {
      envelope: "response",
      resultCode: "00",
      resultMsg: "정상",
      totalCount: 0,
      items: [],
    },
    note: "시험",
  });
  assert.deepEqual(recorded.maskedFields, G2B_BID_NOTICE_MASK_TARGETS);
  assert.match(recorded.maskedFieldsNote, /서비스 기준 마스킹 대상/);
});

test("assertRecordedShape: serviceKey 파라미터·낯선 키·response 봉투의 totalCount null 을 거부한다", () => {
  const base = {
    schemaVersion: "sol-recorded/v0.1",
    serviceId: "15129394",
    registryKey: "g2b-bid-notice",
    operation: "getBidPblancListInfoServc",
    params: { type: "json", pageNo: "1", numOfRows: "10", inqryDiv: "1" },
    fetchedAt: "2026-10-20T01:00:00.000Z",
    httpStatus: 200,
    envelope: "response",
    resultCode: "00",
    resultMsg: "정상",
    totalCount: 0,
    items: [],
    masked: true,
    maskedFields: [],
    maskedFieldsNote: "",
    rawSha256: "a".repeat(64),
    note: "",
  };
  assert.doesNotThrow(() => assertRecordedShape(base));
  assert.throws(
    () => assertRecordedShape({ ...base, params: { ...base.params, serviceKey: "k" } }),
    /서비스키/,
  );
  assert.throws(() => assertRecordedShape({ ...base, extra: 1 }), /허용되지 않는 키/);
  assert.throws(() => assertRecordedShape({ ...base, totalCount: null }), /totalCount/);
  assert.throws(() => assertRecordedShape({ ...base, masked: false }), /masked/);
  assert.doesNotThrow(() =>
    assertRecordedShape({
      ...base,
      envelope: "nkoneps.com.response.ResponseError",
      resultCode: "07",
      totalCount: null,
    }),
  );
});
