import { describe, expect, it } from "vitest";
import { COMPANY_TABS, companyTabHref, parseCompanyTab } from "./company-tabs";

describe("parseCompanyTab", () => {
  it("06 §5.6 탭 순서다(재무 뒤 변경 이력)", () => {
    expect(COMPANY_TABS.map((tab) => tab.label)).toEqual([
      "기술 스택",
      "보유 자격",
      "수행 실적",
      "인력",
      "선호 설정",
      "재무",
      "변경 이력",
    ]);
  });

  it.each(COMPANY_TABS.map((tab) => tab.id))("%s 는 그대로 받는다", (id) => {
    expect(parseCompanyTab(id)).toBe(id);
  });

  it.each([[undefined], [""], ["TECH"], ["unknown"], [["licenses", "projects"]]])(
    "모르는 값·반복 값(%j)은 첫 탭이다",
    (raw) => {
      expect(parseCompanyTab(raw)).toBe("tech");
    },
  );

  it("첫 탭 주소에는 쿼리를 붙이지 않는다", () => {
    expect(companyTabHref("tech")).toBe("/company");
    expect(companyTabHref("history")).toBe("/company?tab=history");
  });
});
