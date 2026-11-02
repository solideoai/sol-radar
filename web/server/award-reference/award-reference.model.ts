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
