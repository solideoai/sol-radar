import { describe, expect, it } from "vitest";
import type { G2bItem } from "./connector.model";
import { G2B_CONTACT_FIELDS, parseG2bEnvelope, stripContactFields } from "./g2b.model";

// 나라장터 입찰공고 목록(15129394 getBidPblancListInfoServc) 응답 봉투의 작은 예시.
// 모양은 2026-10-19 실측 응답을 본떴고, 값은 모두 가상이다.
const ITEM_A: G2bItem = {
  bidNtceNo: "R26BK00000001",
  bidNtceOrd: "000",
  bidNtceNm: "가상 정보시스템 유지관리 용역",
  infoBizYn: "Y",
};
const ITEM_B: G2bItem = {
  bidNtceNo: "R26BK00000002",
  bidNtceOrd: "000",
  bidNtceNm: "가상 홈페이지 개선 용역",
  infoBizYn: "",
};

const okEnvelope = (body: Record<string, unknown>) => ({
  response: { header: { resultCode: "00", resultMsg: "정상" }, body },
});

// HTTP 200 으로 오는 오류 봉투(실측: inqryDiv=9 → 07 "입력범위값 초과 에러").
const errorEnvelope = (resultCode: string, resultMsg: string) => ({
  "nkoneps.com.response.ResponseError": { header: { resultCode, resultMsg } },
});

// 담당자 필드마다 눈에 띄는 가짜 값을 둔다(결과에 0회인지 찾기 쉽게).
const CONTACT: G2bItem = {
  ntceInsttOfclNm: "가짜담당자-1",
  ntceInsttOfclTelNo: "000-0000-0001",
  ntceInsttOfclEmailAdrs: "fake1@contact.invalid",
  exctvNm: "가짜집행관-1",
  crdtrNm: "가짜채권자-1",
  dminsttOfclEmailAdrs: "fake2@contact.invalid",
  ofclNm: "가짜담당자-2",
  ofclTelNo: "000-0000-0002",
  telNo: "000-0000-0003",
};

const PUBLIC_FIELDS: G2bItem = {
  bidNtceNo: "R26BK00000001",
  bidNtceNm: "가상 정보시스템 유지관리 용역",
  ntceInsttNm: "가상공고기관",
  dminsttNm: "가상수요기관",
  infoBizYn: "Y",
  bidClseDt: "",
};

describe("parseG2bEnvelope", () => {
  it("정상 봉투는 items 와 totalCount 를 돌려준다", () => {
    const body = okEnvelope({ items: [ITEM_A, ITEM_B], numOfRows: 10, pageNo: 1, totalCount: 84 });

    expect(parseG2bEnvelope(body)).toEqual({ ok: true, items: [ITEM_A, ITEM_B], totalCount: 84 });
  });

  it("items 가 빈 배열이면 빈 목록과 totalCount 0 을 돌려준다", () => {
    const body = okEnvelope({ items: [], numOfRows: 100, pageNo: 1, totalCount: 0 });

    expect(parseG2bEnvelope(body)).toEqual({ ok: true, items: [], totalCount: 0 });
  });

  it("숫자 문자열 totalCount 는 number 로 바꾼다", () => {
    const body = okEnvelope({ items: [ITEM_A], numOfRows: 10, pageNo: 1, totalCount: "84" });

    expect(parseG2bEnvelope(body)).toEqual({ ok: true, items: [ITEM_A], totalCount: 84 });
  });

  it("오류 봉투 07 은 RESULT_CODE 와 resultCode·resultMsg 를 돌려준다", () => {
    expect(parseG2bEnvelope(errorEnvelope("07", "입력범위값 초과 에러"))).toEqual({
      ok: false,
      kind: "RESULT_CODE",
      resultCode: "07",
      resultMsg: "입력범위값 초과 에러",
    });
  });

  it("오류 봉투 08 도 RESULT_CODE 로 돌려준다", () => {
    expect(parseG2bEnvelope(errorEnvelope("08", "필수값 입력 에러"))).toEqual({
      ok: false,
      kind: "RESULT_CODE",
      resultCode: "08",
      resultMsg: "필수값 입력 에러",
    });
  });

  it("response 봉투의 header.resultCode 가 00 이 아니면 body 가 없어도 RESULT_CODE 다", () => {
    const body = { response: { header: { resultCode: "03", resultMsg: "데이터 없음 에러" } } };

    expect(parseG2bEnvelope(body)).toEqual({
      ok: false,
      kind: "RESULT_CODE",
      resultCode: "03",
      resultMsg: "데이터 없음 에러",
    });
  });

  it("response 봉투의 header.resultCode 가 00 이 아니면 body 가 정상 모양이어도 RESULT_CODE 다", () => {
    const body = {
      response: {
        header: { resultCode: "22", resultMsg: "서비스 요청제한횟수 초과에러" },
        body: { items: [ITEM_A], numOfRows: 10, pageNo: 1, totalCount: 1 },
      },
    };

    expect(parseG2bEnvelope(body)).toEqual({
      ok: false,
      kind: "RESULT_CODE",
      resultCode: "22",
      resultMsg: "서비스 요청제한횟수 초과에러",
    });
  });

  it.each([
    ["null", null],
    ["문자열(XML 본문)", "<OpenAPI_ServiceResponse></OpenAPI_ServiceResponse>"],
    ["배열", []],
    ["빈 객체", {}],
    ["header 없는 response", { response: { body: { items: [], totalCount: 0 } } }],
    ["정상 header 에 body 없음", { response: { header: { resultCode: "00", resultMsg: "정상" } } }],
    [
      "items 가 배열이 아니라 { item: [...] } 모양",
      okEnvelope({ items: { item: [ITEM_A] }, totalCount: 1 }),
    ],
    ["items 에 문자열 원소", okEnvelope({ items: [ITEM_A, "x"], totalCount: 2 })],
    ["items 에 null 원소", okEnvelope({ items: [null], totalCount: 1 })],
    ["totalCount 없음", okEnvelope({ items: [ITEM_A] })],
    ["totalCount 가 숫자 아닌 문자열", okEnvelope({ items: [ITEM_A], totalCount: "많음" })],
    ["totalCount 가 빈 문자열", okEnvelope({ items: [], totalCount: "" })],
    ["header 없는 오류 봉투", { "nkoneps.com.response.ResponseError": {} }],
  ])("모양이 다르면 MALFORMED 다: %s", (_label, body) => {
    expect(parseG2bEnvelope(body)).toEqual({ ok: false, kind: "MALFORMED" });
  });
});

describe("stripContactFields", () => {
  it("담당자 필드 목록은 실측 마스킹 대상 9개다", () => {
    expect([...G2B_CONTACT_FIELDS]).toEqual([
      "ntceInsttOfclNm",
      "ntceInsttOfclTelNo",
      "ntceInsttOfclEmailAdrs",
      "exctvNm",
      "crdtrNm",
      "dminsttOfclEmailAdrs",
      "ofclNm",
      "ofclTelNo",
      "telNo",
    ]);
  });

  it("담당자 필드 9개를 모두 뺀다", () => {
    const stripped = stripContactFields({ ...PUBLIC_FIELDS, ...CONTACT });

    expect(Object.keys(stripped).filter((key) => key in CONTACT)).toEqual([]);
  });

  it("담당자 필드가 아닌 키는 값까지 그대로 둔다", () => {
    expect(stripContactFields({ ...PUBLIC_FIELDS, ...CONTACT })).toEqual(PUBLIC_FIELDS);
  });

  it("인자를 바꾸지 않는다", () => {
    const item: G2bItem = { ...PUBLIC_FIELDS, ...CONTACT };
    const before = structuredClone(item);

    stripContactFields(item);

    expect(item).toEqual(before);
  });

  it("담당자 필드가 없는 행도 같은 내용의 새 객체를 돌려준다", () => {
    const item: G2bItem = { ...PUBLIC_FIELDS };

    const stripped = stripContactFields(item);

    expect(stripped).toEqual(PUBLIC_FIELDS);
    expect(stripped).not.toBe(item);
  });

  // 계약 7-8: 목록 9개에 더해, 키가 Ofcl 을 포함하거나 TelNo·FaxNo·EmailAdrs·HpNo 로 끝나면 뺀다(대소문자 그대로)
  it.each(["newOfclNm", "dminsttOfclTelNo", "ofclFaxNo", "xxxHpNo", "yyyEmailAdrs"])(
    "목록에 없어도 이름 규칙에 맞는 담당자 필드(%s)는 뺀다",
    (key) => {
      expect(stripContactFields({ ...PUBLIC_FIELDS, [key]: "가짜담당자-값" })).toEqual(
        PUBLIC_FIELDS,
      );
    },
  );

  it.each(["dminsttNm", "ntceInsttNm", "bidNtceNm", "rgnDutyJntcontrctRt"])(
    "이름 규칙에 걸리지 않는 공고 필드(%s)는 남긴다",
    (key) => {
      expect(stripContactFields({ [key]: "가상 값" })).toEqual({ [key]: "가상 값" });
    },
  );
});
