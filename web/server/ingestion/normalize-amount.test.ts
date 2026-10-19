import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBudgetKrw } from "./normalize-amount";

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const FAIL = { ok: false };

// 07 §3 금액: 원문 표기를 KRW 정수 문자열로. 계산은 BigInt 라 부동소수 오차가 없어야 한다.
describe("parseBudgetKrw — 문자열", () => {
  it.each([
    ["12억", "1200000000"],
    ["12억원", "1200000000"],
    ["1,500백만원", "1500000000"],
    ["9억5천만원", "950000000"],
    ["1억 5,000만원", "150000000"],
    ["1.5억", "150000000"],
    ["1200000000", "1200000000"],
    ["0", "0"],
    ["900,000,000원", "900000000"],
  ])("계약 예 %j 를 %j 로 바꾼다", (raw, value) => {
    expect(parseBudgetKrw(raw)).toStrictEqual({ ok: true, value });
  });

  it("숫자만 있는 문자열 뒤의 '원' 을 허용한다", () => {
    expect(parseBudgetKrw("1200000000원")).toStrictEqual({ ok: true, value: "1200000000" });
  });

  it("공백을 모두 지운 뒤 읽는다", () => {
    expect(parseBudgetKrw(" 12 억 원 ")).toStrictEqual({ ok: true, value: "1200000000" });
  });

  it("'천만' 을 '천' 과 '만' 으로 쪼개지 않고 긴 단위부터 맞춘다", () => {
    expect(parseBudgetKrw("3천만원")).toStrictEqual({ ok: true, value: "30000000" });
  });

  it("'백만' 단위를 읽는다", () => {
    expect(parseBudgetKrw("3백만")).toStrictEqual({ ok: true, value: "3000000" });
  });

  it("작아지는 단위 조각을 더한다", () => {
    expect(parseBudgetKrw("5만5천원")).toStrictEqual({ ok: true, value: "55000" });
  });

  it("조 단위와 쉼표 있는 억 조각을 더한다", () => {
    expect(parseBudgetKrw("1조 2,000억원")).toStrictEqual({ ok: true, value: "1200000000000" });
  });

  it("소수 조각을 부동소수 오차 없이 정확한 정수로 계산한다", () => {
    expect(parseBudgetKrw("1.23456789억")).toStrictEqual({ ok: true, value: "123456789" });
  });

  it("안전 정수 범위를 넘는 숫자 문자열도 자릿수를 잃지 않는다", () => {
    expect(parseBudgetKrw("9007199254740993")).toStrictEqual({
      ok: true,
      value: "9007199254740993",
    });
  });

  it("결과에서 앞자리 0 을 뺀다", () => {
    expect(parseBudgetKrw("00900")).toStrictEqual({ ok: true, value: "900" });
  });

  it.each(["", "미정", "-5억", "12달러", "5만억", "1.23456789원", "1,50억"])(
    "계약의 실패 예 %j 는 실패한다",
    (raw) => {
      expect(parseBudgetKrw(raw)).toStrictEqual(FAIL);
    },
  );

  it("단위가 작아지지 않고 커지면(5천5만) 실패한다", () => {
    expect(parseBudgetKrw("5천5만")).toStrictEqual(FAIL);
  });

  it("같은 단위가 두 번 나오면 실패한다", () => {
    expect(parseBudgetKrw("5억5억")).toStrictEqual(FAIL);
  });

  it("수 없이 단위만 있으면 실패한다", () => {
    expect(parseBudgetKrw("억원")).toStrictEqual(FAIL);
  });

  it("합이 정수가 아니면 실패한다", () => {
    expect(parseBudgetKrw("1.00001만")).toStrictEqual(FAIL);
  });

  it("세 자리씩 묶이지 않은 쉼표 숫자는 실패한다", () => {
    expect(parseBudgetKrw("9,00,000원")).toStrictEqual(FAIL);
  });

  it("'원' 이 두 번 붙으면 실패한다", () => {
    expect(parseBudgetKrw("12억원원")).toStrictEqual(FAIL);
  });

  it("단위 없는 소수는 실패한다", () => {
    expect(parseBudgetKrw("1.5")).toStrictEqual(FAIL);
  });
});

describe("parseBudgetKrw — 숫자", () => {
  it("0 이상 안전 정수는 문자열로 바꾼다", () => {
    expect(parseBudgetKrw(1200000000)).toStrictEqual({ ok: true, value: "1200000000" });
  });

  it("0 은 '0' 이다", () => {
    expect(parseBudgetKrw(0)).toStrictEqual({ ok: true, value: "0" });
  });

  it("가장 큰 안전 정수까지 받는다", () => {
    expect(parseBudgetKrw(Number.MAX_SAFE_INTEGER)).toStrictEqual({
      ok: true,
      value: "9007199254740991",
    });
  });

  it.each([
    ["음수", -1],
    ["소수", 1.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["안전 정수를 넘는 수", Number.MAX_SAFE_INTEGER + 1],
  ])("%s 는 실패한다", (_label, raw) => {
    expect(parseBudgetKrw(raw)).toStrictEqual(FAIL);
  });
});

describe("FX-13 금액 텍스트 (11 §3.1)", () => {
  it("fixture 원문 '1,500백만원' 을 '1500000000' 으로 정규화한다", () => {
    const file = JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", "FX-13.json"), "utf8")) as {
      records: { budgetKrw: string }[];
    };
    const raw = file.records[0].budgetKrw;

    expect(raw).toBe("1,500백만원");
    expect(parseBudgetKrw(raw)).toStrictEqual({ ok: true, value: "1500000000" });
  });
});
