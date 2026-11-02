import { describe, expect, it } from "vitest";
import {
  awardTargetOf,
  baseAmountOf,
  buildAwardReference,
  methodGroupOf,
  quartilesOf,
  selectSample,
  type AwardSampleRow,
  type AwardTarget,
} from "./award-reference.model";

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

// ── 표본·사분위·카드 값 ──
const BASE = 796011720;
const TARGET: AwardTarget = {
  bidNoticeNo: "R26BK00000001",
  classNo: "81112299",
  className: "소프트웨어유지및지원서비스",
  midClassName: "SW 유지관리",
  group: "NEGOTIATION",
  base: { amountKrw: BASE, kind: "ASSIGNED_BUDGET" },
  priceWeight: 10,
  lowerLimitRate: null,
};

let serial = 0;
const row = (
  times: number,
  scope: "CLASS" | "MID_ONLY" = "CLASS",
  awardRatio = 0.9,
  bidNoticeNo = `R25BK${String((serial += 1)).padStart(8, "0")}`,
): AwardSampleRow => ({
  bidNoticeNo,
  classNo: scope === "CLASS" ? TARGET.classNo : "81111599",
  midClassName: TARGET.midClassName,
  baseAmountKrw: Math.round(BASE * times),
  awardRatio,
});
const rowsOf = (count: number, times: number, scope?: "CLASS" | "MID_ONLY") =>
  Array.from({ length: count }, () => row(times, scope));

describe("quartilesOf — 선형 보간 사분위(percentile_cont 와 같은 값)", () => {
  it("정렬 전 [3,1,4,2] → 1.75 · 2.5 · 3.25", () => {
    expect(quartilesOf([3, 1, 4, 2])).toEqual({ q1: 1.75, median: 2.5, q3: 3.25 });
  });

  it("값이 모두 같으면 셋 다 그 값", () => {
    expect(quartilesOf([0.9, 0.9, 0.9, 0.9, 0.9])).toEqual({ q1: 0.9, median: 0.9, q3: 0.9 });
  });
});

describe("selectSample — 5건이 될 때까지 한 단계씩 넓힌다", () => {
  it("같은 분류·0.5~2배(경계 포함) 6건 → 1단계", () => {
    const rows = [row(0.5), ...rowsOf(4, 1), row(2)];
    expect(selectSample(TARGET, rows)).toEqual({ step: 1, rows });
  });

  it("1단계 4건 + 같은 분류 2.5배 2건 → 2단계 6건", () => {
    const rows = [...rowsOf(4, 1), ...rowsOf(2, 2.5)];
    expect(selectSample(TARGET, rows)).toEqual({ step: 2, rows });
  });

  it("같은 분류 3건 + 같은 중분류 다른 분류 3건 → 3단계 6건", () => {
    const rows = [...rowsOf(3, 1), ...rowsOf(3, 1, "MID_ONLY")];
    expect(selectSample(TARGET, rows)).toEqual({ step: 3, rows });
  });

  it("세 단계를 다 넓혀도 4건이면 null, 3배를 넘는 행은 세지 않는다", () => {
    expect(
      selectSample(TARGET, [...rowsOf(2, 1), ...rowsOf(2, 1, "MID_ONLY"), row(3.5)]),
    ).toBeNull();
  });

  it("이번 공고와 같은 번호의 행(재공고·다른 차수)은 어느 단계에서도 세지 않는다", () => {
    const self = [
      row(1, "CLASS", 0.9, TARGET.bidNoticeNo),
      row(1, "MID_ONLY", 0.9, TARGET.bidNoticeNo),
    ];
    expect(selectSample(TARGET, [...rowsOf(4, 1), ...self])).toBeNull();
  });
});

describe("buildAwardReference — 카드 값", () => {
  const META = { dataAsOf: "2026-11-02T09:00:00.000Z", periodMonths: 12 };

  it("1단계 5건 → 낙찰률 사분위와 기준금액에 곱한 금액(원 단위 반올림)", () => {
    const rows = [0.861, 0.894, 0.927, 0.88, 0.91].map((ratio) => row(1, "CLASS", ratio));
    expect(buildAwardReference(TARGET, rows, META)).toEqual({
      kind: "RANGE",
      group: "NEGOTIATION",
      step: 1,
      sampleSize: 5,
      periodMonths: 12,
      scopeLabel: "소프트웨어유지및지원서비스",
      amountBand: { min: 0.5, max: 2 },
      base: TARGET.base,
      ratio: { q1: 0.88, median: 0.894, q3: 0.91 },
      amountKrw: { q1: 700490314, median: 711634478, q3: 724370665 },
      priceWeight: 10,
      lowerLimitRate: null,
      dataAsOf: META.dataAsOf,
    });
  });

  it("3단계를 쓰면 기준 이름이 중분류명이고 금액대는 1/3~3배", () => {
    const reference = buildAwardReference(
      TARGET,
      [...rowsOf(3, 1), ...rowsOf(3, 1, "MID_ONLY")],
      META,
    );
    expect(reference).toMatchObject({
      kind: "RANGE",
      step: 3,
      sampleSize: 6,
      scopeLabel: "SW 유지관리",
      amountBand: { min: 1 / 3, max: 3 },
    });
  });

  it("5건 미만이면 TOO_FEW 이고 건수는 가장 넓힌 단계(중분류·1/3~3배)의 건수", () => {
    expect(buildAwardReference(TARGET, [...rowsOf(3, 1), row(2.5, "MID_ONLY")], META)).toEqual({
      kind: "TOO_FEW",
      group: "NEGOTIATION",
      sampleSize: 4,
      periodMonths: 12,
      scopeLabel: "SW 유지관리",
      priceWeight: 10,
      lowerLimitRate: null,
      dataAsOf: META.dataAsOf,
    });
  });
});

// ── 이번 공고 원문 → 카드 대상 ──
const RAW_NEGOTIATION = {
  bidNtceNo: "R26BK01776253",
  pubPrcrmntClsfcNo: "81112299",
  pubPrcrmntClsfcNm: "소프트웨어유지및지원서비스",
  pubPrcrmntMidClsfcNm: "SW 유지관리",
  sucsfbidMthdNm: "협상에의한계약-협상에 의한 낙찰자 결정(SW사업)",
  asignBdgtAmt: "796011720",
  presmptPrce: "723647018",
  VAT: "72364702",
  bidPrceEvlRt: "10",
  sucsfbidLwltRate: "",
};
const LIVE = { source: "g2b-bid-notice", isDemo: false };

describe("awardTargetOf — 카드를 그릴 공고만 대상이 된다", () => {
  it("나라장터 협상 공고 → 분류·기준금액·가격 배점", () => {
    expect(awardTargetOf(LIVE, RAW_NEGOTIATION)).toEqual({
      bidNoticeNo: "R26BK01776253",
      classNo: "81112299",
      className: "소프트웨어유지및지원서비스",
      midClassName: "SW 유지관리",
      group: "NEGOTIATION",
      base: { amountKrw: 796011720, kind: "ASSIGNED_BUDGET" },
      priceWeight: 10,
      lowerLimitRate: null,
    });
  });

  it("하한율 공고는 낙찰하한율을 숫자로 읽는다", () => {
    const raw = {
      ...RAW_NEGOTIATION,
      sucsfbidMthdNm: "적격심사제-추정가격이 고시금액 미만",
      bidPrceEvlRt: "",
      sucsfbidLwltRate: "87.745",
    };
    expect(awardTargetOf(LIVE, raw)).toMatchObject({
      group: "LOWER_LIMIT",
      priceWeight: null,
      lowerLimitRate: 87.745,
    });
  });

  it.each([
    ["나라장터가 아닌 출처", { source: "lh-bid-notice", isDemo: false }, RAW_NEGOTIATION],
    ["데모 공고", { source: "g2b-bid-notice", isDemo: true }, RAW_NEGOTIATION],
    ["그 밖 낙찰 방식", LIVE, { ...RAW_NEGOTIATION, sucsfbidMthdNm: "수의시담" }],
    ["분류번호 없음", LIVE, { ...RAW_NEGOTIATION, pubPrcrmntClsfcNo: "" }],
    ["기준금액 없음", LIVE, { ...RAW_NEGOTIATION, asignBdgtAmt: "", presmptPrce: "" }],
    ["원문 없음", LIVE, null],
  ] as const)("%s → null", (_, notice, raw) => {
    expect(awardTargetOf(notice, raw)).toBeNull();
  });
});
