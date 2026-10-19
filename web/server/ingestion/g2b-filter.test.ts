import { describe, expect, it } from "vitest";
import type { G2bItem } from "./connector.model";
import { DEFAULT_INFO_BIZ_FILTER, isInfoBizNoticeBroad, isInfoBizNoticeStrict } from "./g2b-filter";

// 정보화사업이 아닌 공고(실측 형태를 본뜬 가상 값). 시험마다 필요한 필드만 바꿔 쓴다.
const NOT_INFO_BIZ: G2bItem = {
  bidNtceNo: "R26BK00000001",
  infoBizYn: "",
  sucsfbidMthdNm: "협상에의한계약-협상에 의한 낙찰자 결정",
  pubPrcrmntClsfcNm: "과학기술연구조사서비스",
};
const notice = (overrides: G2bItem): G2bItem => ({ ...NOT_INFO_BIZ, ...overrides });

const SW_MARKED = "협상에의한계약-협상에 의한 낙찰자 결정(SW사업)";

describe("isInfoBizNoticeStrict", () => {
  it("infoBizYn 이 Y 면 정보화사업이다", () => {
    expect(isInfoBizNoticeStrict(notice({ infoBizYn: "Y" }))).toBe(true);
  });

  it("infoBizYn 이 N 이면 정보화사업이 아니다", () => {
    expect(isInfoBizNoticeStrict(notice({ infoBizYn: "N" }))).toBe(false);
  });

  it("infoBizYn 이 빈 문자열이면 정보화사업이 아니다", () => {
    expect(isInfoBizNoticeStrict(NOT_INFO_BIZ)).toBe(false);
  });

  it("infoBizYn 키가 없으면 정보화사업이 아니다", () => {
    expect(isInfoBizNoticeStrict({ bidNtceNo: "R26BK00000001" })).toBe(false);
  });

  it("SW사업 표기·정보시스템 분류가 있어도 infoBizYn 이 Y 가 아니면 정보화사업이 아니다", () => {
    const item = notice({
      sucsfbidMthdNm: SW_MARKED,
      pubPrcrmntClsfcNm: "정보시스템유지관리서비스",
    });

    expect(isInfoBizNoticeStrict(item)).toBe(false);
  });

  it.each([
    ["boolean true", true],
    ["배열 ['Y']", ["Y"]],
    ["숫자 1", 1],
  ])("infoBizYn 이 문자열이 아니면(%s) 정보화사업이 아니다", (_label, value) => {
    expect(isInfoBizNoticeStrict(notice({ infoBizYn: value }))).toBe(false);
  });
});

describe("isInfoBizNoticeBroad", () => {
  it("infoBizYn 이 Y 면 다른 조건 없이도 정보화사업이다", () => {
    expect(isInfoBizNoticeBroad(notice({ infoBizYn: "Y" }))).toBe(true);
  });

  it("infoBizYn 이 빈 문자열이어도 낙찰방법에 SW사업 표기가 있으면 정보화사업이다", () => {
    expect(isInfoBizNoticeBroad(notice({ sucsfbidMthdNm: SW_MARKED }))).toBe(true);
  });

  it("infoBizYn 이 빈 문자열이어도 분류명에 정보시스템이 들어 있으면 정보화사업이다", () => {
    expect(isInfoBizNoticeBroad(notice({ pubPrcrmntClsfcNm: "정보시스템유지관리서비스" }))).toBe(
      true,
    );
  });

  it("infoBizYn 이 빈 문자열이어도 분류명에 소프트웨어가 들어 있으면 정보화사업이다", () => {
    expect(
      isInfoBizNoticeBroad(notice({ pubPrcrmntClsfcNm: "패키지소프트웨어개발및도입서비스" })),
    ).toBe(true);
  });

  it("infoBizYn 이 N 이어도 분류명 조건으로 정보화사업이다", () => {
    const item = notice({ infoBizYn: "N", pubPrcrmntClsfcNm: "소프트웨어유지및지원서비스" });

    expect(isInfoBizNoticeBroad(item)).toBe(true);
  });

  it("세 조건이 모두 아니면 정보화사업이 아니다", () => {
    expect(isInfoBizNoticeBroad(NOT_INFO_BIZ)).toBe(false);
  });

  it("세 필드가 모두 없으면 정보화사업이 아니다", () => {
    expect(isInfoBizNoticeBroad({ bidNtceNo: "R26BK00000001" })).toBe(false);
  });

  it.each([
    ["infoBizYn 이 배열 ['Y']", { infoBizYn: ["Y"] }],
    ["sucsfbidMthdNm 이 배열 ['SW사업']", { sucsfbidMthdNm: ["SW사업"] }],
    ["pubPrcrmntClsfcNm 이 배열 ['정보시스템']", { pubPrcrmntClsfcNm: ["정보시스템"] }],
    ["pubPrcrmntClsfcNm 이 배열 ['소프트웨어']", { pubPrcrmntClsfcNm: ["소프트웨어"] }],
  ])("값이 문자열이 아니면 그 조건은 거짓이다: %s", (_label, overrides) => {
    expect(isInfoBizNoticeBroad(notice(overrides))).toBe(false);
  });
});

describe("DEFAULT_INFO_BIZ_FILTER", () => {
  it("기본 필터는 broad 규칙이다(결정 C3-1)", () => {
    expect(DEFAULT_INFO_BIZ_FILTER).toBe(isInfoBizNoticeBroad);
  });

  it("기본 필터는 infoBizYn 이 비어도 SW사업 표기만 있는 공고를 통과시킨다", () => {
    expect(DEFAULT_INFO_BIZ_FILTER(notice({ sucsfbidMthdNm: SW_MARKED }))).toBe(true);
  });

  it("기본 필터는 세 조건이 모두 아닌 공고를 거른다", () => {
    expect(DEFAULT_INFO_BIZ_FILTER(NOT_INFO_BIZ)).toBe(false);
  });
});
