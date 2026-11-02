import "server-only";

// ── 규칙: 참고 낙찰가 범위의 계약 타입과 고정값(스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md) ──
// 지난 낙찰률(낙찰금액 ÷ 기준금액)의 사분위를 이번 공고 기준금액에 곱해 보여 준다. 확률·예측 값이 아니다(ADR-007).
// 쓰기 쪽(award-history, 운영자 CLI)과 읽기 쪽(이 도메인)이 같은 묶음·기준금액 규칙을 쓰도록 여기 한 곳에 둔다.

/** 낙찰 방식 묶음. 카드는 NEGOTIATION·LOWER_LIMIT 에만 그린다(스펙 §3). */
export type AwardMethodGroup = "NEGOTIATION" | "LOWER_LIMIT" | "OTHER";

export type CardMethodGroup = Exclude<AwardMethodGroup, "OTHER">;

/** 기준금액. 배정예산(부가세 포함)이 있으면 그것, 없으면 추정가격 + 부가세. */
export type BaseAmount = {
  amountKrw: number;
  kind: "ASSIGNED_BUDGET" | "ESTIMATED_PLUS_VAT";
};

export type Quartiles = { q1: number; median: number; q3: number };

/** 넓히기 단계. 1 같은 분류·0.5~2배, 2 같은 분류·1/3~3배, 3 같은 중분류·1/3~3배. */
export type WidenStep = 1 | 2 | 3;

/** 카드를 그릴 이번 공고. 원문(raw_payload)에서 읽은 값이다. */
export type AwardTarget = {
  bidNoticeNo: string;
  classNo: string;
  className: string;
  midClassName: string | null;
  group: CardMethodGroup;
  base: BaseAmount;
  /** 협상 계약의 가격 평가 비율(bidPrceEvlRt, 0~100). 없으면 null */
  priceWeight: number | null;
  /** 낙찰하한율(sucsfbidLwltRate, %). 없으면 null */
  lowerLimitRate: number | null;
};

/** 표본 후보 한 행(procurement_award_history). */
export type AwardSampleRow = {
  bidNoticeNo: string;
  classNo: string;
  midClassName: string | null;
  baseAmountKrw: number;
  awardRatio: number;
};

type AwardReferenceCommon = {
  group: CardMethodGroup;
  sampleSize: number;
  periodMonths: number;
  /** 기준 줄의 분류 이름. step 3 이면 중분류 이름 */
  scopeLabel: string;
  priceWeight: number | null;
  lowerLimitRate: number | null;
};

export type AwardReference =
  | (AwardReferenceCommon & {
      kind: "RANGE";
      step: WidenStep;
      /** 쓴 금액대 배수(예: 0.5~2) */
      amountBand: { min: number; max: number };
      base: BaseAmount;
      ratio: Quartiles;
      amountKrw: Quartiles;
      /** 저장된 낙찰 행의 가장 늦은 수집 시각(ISO) */
      dataAsOf: string;
    })
  | (AwardReferenceCommon & {
      kind: "TOO_FEW";
      dataAsOf: string | null;
    });

export const AWARD_MIN_SAMPLE = 5;
// 낙찰률이 이 범위 밖이면 자료 오류로 보고 수집에서 뺀다(스펙 §3).
export const AWARD_RATIO_MIN = 0.3;
export const AWARD_RATIO_MAX = 1.2;
export const AWARD_LOOKBACK_MONTHS = 12;

export const AWARD_WIDEN_STEPS: readonly {
  step: WidenStep;
  scope: "CLASS" | "MID_CLASS";
  min: number;
  max: number;
}[] = [
  { step: 1, scope: "CLASS", min: 0.5, max: 2 },
  { step: 2, scope: "CLASS", min: 1 / 3, max: 3 },
  { step: 3, scope: "MID_CLASS", min: 1 / 3, max: 3 },
];

// 낙찰방법명(sucsfbidMthdNm)의 앞부분으로 묶는다. 하한율 묶음은 낙찰하한율로 가격 경쟁을 하는 방식이다.
const NEGOTIATION_PREFIXES = ["협상에의한계약"] as const;
const LOWER_LIMIT_PREFIXES = ["적격심사제", "제한적최저가", "소액수의견적"] as const;

export function methodGroupOf(methodName: string | null | undefined): AwardMethodGroup {
  const name = methodName?.trim() ?? "";
  if (NEGOTIATION_PREFIXES.some((prefix) => name.startsWith(prefix))) return "NEGOTIATION";
  if (LOWER_LIMIT_PREFIXES.some((prefix) => name.startsWith(prefix))) return "LOWER_LIMIT";
  return "OTHER";
}

// 원 단위 양의 정수만 받는다. 빈 값·0·숫자가 아닌 값은 없음으로 본다.
const positiveWon = (value: string | null | undefined): number | null => {
  const text = value?.trim() ?? "";
  if (!/^\d+$/.test(text)) return null;
  const amount = Number(text);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
};

export function baseAmountOf(raw: {
  asignBdgtAmt?: string | null;
  presmptPrce?: string | null;
  vat?: string | null;
}): BaseAmount | null {
  const assigned = positiveWon(raw.asignBdgtAmt);
  if (assigned !== null) return { amountKrw: assigned, kind: "ASSIGNED_BUDGET" };
  const estimated = positiveWon(raw.presmptPrce);
  if (estimated === null) return null;
  // 면세 공고는 부가세 칸이 비어 있다. 그때는 추정가격 그대로다.
  return { amountKrw: estimated + (positiveWon(raw.vat) ?? 0), kind: "ESTIMATED_PLUS_VAT" };
}

// ── 이번 공고 원문 → 카드 대상 ──
// bid_revisions.raw_payload(나라장터 입찰공고 원문)에서 읽는 키. 저장 쪽은 이 키만 골라 읽는다.
export const AWARD_TARGET_RAW_KEYS = [
  "bidNtceNo",
  "pubPrcrmntClsfcNo",
  "pubPrcrmntClsfcNm",
  "pubPrcrmntMidClsfcNm",
  "sucsfbidMthdNm",
  "asignBdgtAmt",
  "presmptPrce",
  "VAT",
  "bidPrceEvlRt",
  "sucsfbidLwltRate",
] as const;

export type AwardTargetRaw = Partial<Record<(typeof AWARD_TARGET_RAW_KEYS)[number], string | null>>;

// 카드는 실제 나라장터 입찰공고에만 그린다(스펙 §2). LH·K-water·KEPCO·부처·데모 공고는 대상이 아니다.
const G2B_BID_NOTICE_SOURCE = "g2b-bid-notice";

const textOf = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};

// 0 초과 100 이하 백분율만 받는다. 빈 값·0·숫자가 아닌 값은 없음으로 본다.
const percentOf = (value: string | null | undefined): number | null => {
  const text = textOf(value);
  if (text === null || !/^\d+(\.\d+)?$/.test(text)) return null;
  const percent = Number(text);
  return percent > 0 && percent <= 100 ? percent : null;
};

/** 카드를 그릴 공고면 대상, 아니면 null(나라장터 아님·데모·그 밖 방식·분류번호 없음·기준금액 없음). */
export function awardTargetOf(
  notice: { source: string; isDemo: boolean },
  raw: AwardTargetRaw | null,
): AwardTarget | null {
  if (notice.source !== G2B_BID_NOTICE_SOURCE || notice.isDemo || raw === null) return null;
  const group = methodGroupOf(raw.sucsfbidMthdNm);
  const bidNoticeNo = textOf(raw.bidNtceNo);
  const classNo = textOf(raw.pubPrcrmntClsfcNo);
  const base = baseAmountOf({
    asignBdgtAmt: raw.asignBdgtAmt,
    presmptPrce: raw.presmptPrce,
    vat: raw.VAT,
  });
  if (group === "OTHER" || bidNoticeNo === null || classNo === null || base === null) return null;
  return {
    bidNoticeNo,
    classNo,
    className: textOf(raw.pubPrcrmntClsfcNm) ?? classNo,
    midClassName: textOf(raw.pubPrcrmntMidClsfcNm),
    group,
    base,
    priceWeight: percentOf(raw.bidPrceEvlRt),
    lowerLimitRate: percentOf(raw.sucsfbidLwltRate),
  };
}

// ── 사분위·표본·카드 값 ──

// Postgres percentile_cont 와 같은 선형 보간이다. 정렬한 값에서 p × (n − 1) 자리를 앞뒤 값 사이로 잇는다.
const percentileOf = (sorted: readonly number[], p: number): number => {
  const position = p * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
};

/** 하위 4분의 1·중간값·상위 4분의 1. 빈 배열은 받지 않는다(표본이 5건 이상일 때만 부른다). */
export function quartilesOf(values: readonly number[]): Quartiles {
  if (values.length === 0) throw new RangeError("사분위를 계산할 값이 없습니다");
  const sorted = [...values].sort((a, b) => a - b);
  return {
    q1: percentileOf(sorted, 0.25),
    median: percentileOf(sorted, 0.5),
    q3: percentileOf(sorted, 0.75),
  };
}

type WidenSpec = (typeof AWARD_WIDEN_STEPS)[number];

// 한 단계의 표본. 이번 공고 번호는 어느 단계에서도 뺀다(재공고·다른 차수가 자기 값을 끌어오지 않게).
// 중분류 단계는 같은 분류 행도 포함한다. 넓히기는 앞 단계 표본을 줄이지 않는다.
const rowsAt = (
  target: AwardTarget,
  rows: readonly AwardSampleRow[],
  spec: WidenSpec,
): AwardSampleRow[] => {
  const min = target.base.amountKrw * spec.min;
  const max = target.base.amountKrw * spec.max;
  const inScope = (row: AwardSampleRow) =>
    row.classNo === target.classNo ||
    (spec.scope === "MID_CLASS" &&
      target.midClassName !== null &&
      row.midClassName === target.midClassName);
  return rows.filter(
    (row) =>
      row.bidNoticeNo !== target.bidNoticeNo &&
      inScope(row) &&
      row.baseAmountKrw >= min &&
      row.baseAmountKrw <= max,
  );
};

const firstEnoughStep = (
  target: AwardTarget,
  rows: readonly AwardSampleRow[],
): { spec: WidenSpec; rows: AwardSampleRow[] } | null => {
  for (const spec of AWARD_WIDEN_STEPS) {
    const sample = rowsAt(target, rows, spec);
    if (sample.length >= AWARD_MIN_SAMPLE) return { spec, rows: sample };
  }
  return null;
};

/** 같은 분류·0.5~2배부터 한 단계씩 넓혀 AWARD_MIN_SAMPLE 건 이상이 되는 첫 단계. 끝까지 모자라면 null. */
export function selectSample(
  target: AwardTarget,
  rows: readonly AwardSampleRow[],
): { step: WidenStep; rows: AwardSampleRow[] } | null {
  const sample = firstEnoughStep(target, rows);
  return sample === null ? null : { step: sample.spec.step, rows: sample.rows };
}

const scopeLabelOf = (target: AwardTarget, spec: WidenSpec): string =>
  spec.scope === "MID_CLASS" ? (target.midClassName ?? target.className) : target.className;

/**
 * 카드 값. 표본이 모자라면 TOO_FEW 이고, 건수·기준 이름은 가장 넓힌 단계의 것이다.
 * 금액은 낙찰률 사분위 × 이번 공고 기준금액을 원 단위로 반올림한다.
 */
export function buildAwardReference(
  target: AwardTarget,
  rows: readonly AwardSampleRow[],
  meta: { dataAsOf: string | null; periodMonths: number },
): AwardReference {
  const common = {
    group: target.group,
    periodMonths: meta.periodMonths,
    priceWeight: target.priceWeight,
    lowerLimitRate: target.lowerLimitRate,
  };
  const sample = firstEnoughStep(target, rows);
  // 수집 기준일이 없으면 출처를 적을 수 없으므로 범위를 보이지 않는다(서비스는 이때 카드 자체를 숨긴다).
  if (sample === null || meta.dataAsOf === null) {
    const widest = AWARD_WIDEN_STEPS[AWARD_WIDEN_STEPS.length - 1];
    return {
      kind: "TOO_FEW",
      ...common,
      sampleSize: rowsAt(target, rows, widest).length,
      scopeLabel: scopeLabelOf(target, widest),
      dataAsOf: meta.dataAsOf,
    };
  }
  const { spec } = sample;
  const ratio = quartilesOf(sample.rows.map((row) => row.awardRatio));
  const amountOf = (value: number) => Math.round(target.base.amountKrw * value);
  return {
    kind: "RANGE",
    ...common,
    step: spec.step,
    sampleSize: sample.rows.length,
    scopeLabel: scopeLabelOf(target, spec),
    amountBand: { min: spec.min, max: spec.max },
    base: target.base,
    ratio,
    amountKrw: { q1: amountOf(ratio.q1), median: amountOf(ratio.median), q3: amountOf(ratio.q3) },
    dataAsOf: meta.dataAsOf,
  };
}

// ── 기간 ──

/** 표본을 보는 시작 시각: 지금부터 AWARD_LOOKBACK_MONTHS 개월 전(ISO). */
export function lookbackStartOf(now: Date): string {
  const start = new Date(now);
  start.setUTCMonth(start.getUTCMonth() - AWARD_LOOKBACK_MONTHS);
  return start.toISOString();
}

/**
 * 카드에 적을 기간(개월). 저장된 가장 이른 개찰부터 지금까지를 올림하고 AWARD_LOOKBACK_MONTHS 를 넘지 않는다.
 * 한 번 채우기가 기간을 줄였으면 줄인 기간이 그대로 적힌다(스펙 §3 기간).
 */
export function periodMonthsOf(earliestOpenedAt: string, now: Date): number {
  const from = new Date(earliestOpenedAt);
  let months =
    (now.getUTCFullYear() - from.getUTCFullYear()) * 12 + (now.getUTCMonth() - from.getUTCMonth());
  const anchor = new Date(from);
  anchor.setUTCMonth(anchor.getUTCMonth() + months);
  if (anchor < now) months += 1;
  return Math.min(AWARD_LOOKBACK_MONTHS, Math.max(1, months));
}

// ── 저장 계약 ──

export type AwardCandidateQuery = {
  classNo: string;
  midClassName: string | null;
  group: CardMethodGroup;
  /** 기준금액 하한(원, 포함). 가장 넓은 금액대 */
  minBase: number;
  /** 기준금액 상한(원, 포함) */
  maxBase: number;
  /** 개찰일 하한(ISO, 포함) */
  openedSince: string;
};

export type AwardReferenceRepo = {
  /** 카드를 그릴 공고면 대상, 아니면 null(공고 없음·RLS 로 안 보임 포함) */
  loadTarget(bidId: string): Promise<AwardTarget | null>;
  /** 같은 분류 또는 같은 중분류, 같은 묶음, 금액대, 기간 안의 낙찰 행 */
  loadCandidates(query: AwardCandidateQuery): Promise<AwardSampleRow[]>;
  /** 표 전체의 가장 늦은 수집 시각과 가장 이른 개찰 시각. 표가 비면 둘 다 null */
  loadDatasetMeta(): Promise<{ dataAsOf: string | null; earliestOpenedAt: string | null }>;
};
