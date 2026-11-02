import { describe, expect, it } from "vitest";
import { baseAmountOf, methodGroupOf } from "./award-reference.model";

describe("methodGroupOf — 낙찰방법명으로 묶음 정하기", () => {
  it.each([
    ["협상에의한계약-협상에 의한 낙찰자 결정(SW사업)", "NEGOTIATION"],
    ["협상에의한계약-협상에 의한 낙찰자 결정", "NEGOTIATION"],
    ["적격심사제-추정가격이 고시금액 미만", "LOWER_LIMIT"],
    ["제한적최저가(낙찰하한율)", "LOWER_LIMIT"],
    ["소액수의견적", "LOWER_LIMIT"],
    ["수의시담", "OTHER"],
    ["최저가낙찰제", "OTHER"],
    ["", "OTHER"],
  ] as const)("%s → %s", (name, group) => {
    expect(methodGroupOf(name)).toBe(group);
  });

  it("값이 없으면 OTHER", () => {
    expect(methodGroupOf(null)).toBe("OTHER");
    expect(methodGroupOf(undefined)).toBe("OTHER");
  });
});

describe("baseAmountOf — 기준금액", () => {
  it("배정예산이 있으면 배정예산", () => {
    expect(baseAmountOf({ asignBdgtAmt: "796011720", presmptPrce: "717909091" })).toEqual({
      amountKrw: 796011720,
      kind: "ASSIGNED_BUDGET",
    });
  });

  it("배정예산이 비면 추정가격 + 부가세", () => {
    expect(baseAmountOf({ asignBdgtAmt: "", presmptPrce: "717909091", vat: "71790909" })).toEqual({
      amountKrw: 789700000,
      kind: "ESTIMATED_PLUS_VAT",
    });
  });

  it("배정예산이 0 이고 부가세가 빈 면세 공고는 추정가격 그대로", () => {
    expect(baseAmountOf({ asignBdgtAmt: "0", presmptPrce: "30000000", vat: "" })).toEqual({
      amountKrw: 30000000,
      kind: "ESTIMATED_PLUS_VAT",
    });
  });

  it("둘 다 없거나 숫자가 아니면 null", () => {
    expect(baseAmountOf({})).toBeNull();
    expect(baseAmountOf({ asignBdgtAmt: "", presmptPrce: "" })).toBeNull();
    expect(baseAmountOf({ asignBdgtAmt: "1,000", presmptPrce: "abc" })).toBeNull();
  });
});
