import type { AwardReference, BaseAmount, CardMethodGroup } from "@/server/award-reference";

// 참고 낙찰가 범위 카드 문구(스펙 polaris/specs/in-progress/2026-11-02-award-reference-price.md §2 A안).
// 지난 낙찰값을 모은 참고 값이다. 확률·예측처럼 읽히는 말을 쓰지 않는다(ADR-007, docs/09-SECURITY.md 금지어).

export const AWARD_CARD_TITLE = "참고 낙찰가 범위";
export const AWARD_CARD_SUBTITLE = "지난 낙찰 기준";
export const AWARD_RANGE_NOTE = "비슷한 공고 가운데 절반이 이 사이에서 낙찰됐습니다";
export const AWARD_TOO_FEW = "비슷한 지난 낙찰이 적어 범위를 보여 주지 않습니다";
export const AWARD_DISCLAIMER =
  "지난 낙찰값을 모은 참고 값입니다. 최종 투찰가는 담당자가 정합니다.";
const SOURCE = "조달청 낙찰정보";
const WIDENED_TO_MID_CLASS = "중분류로 넓힘";

const GROUP_LABEL: Record<CardMethodGroup, string> = {
  NEGOTIATION: "협상 계약",
  LOWER_LIMIT: "낙찰하한율 방식",
};

export const BASE_LABEL: Record<BaseAmount["kind"], string> = {
  ASSIGNED_BUDGET: "배정예산",
  ESTIMATED_PLUS_VAT: "추정가격+부가세",
};

const groupDigits = new Intl.NumberFormat("ko-KR");
const upToOneDecimal = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const upToThreeDecimals = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 3 });
// en-CA 는 날짜를 YYYY-MM-DD 로 적는다. 기준일은 서울 날짜다.
const seoulDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const EOK = 100_000_000;
const MAN = 10_000;

/** 원 금액을 "6억 8,536만" 꼴로 적는다. 만 원 아래는 버린다. */
export function formatEokMan(krw: number): string {
  const eok = Math.floor(krw / EOK);
  const man = Math.floor((krw % EOK) / MAN);
  const parts: string[] = [];
  if (eok > 0) parts.push(`${groupDigits.format(eok)}억`);
  if (man > 0 || eok === 0) parts.push(`${groupDigits.format(man)}만`);
  return parts.join(" ");
}

/** 낙찰률(0~1.2)을 백분율 글자로. 소수 한 자리까지. */
export const formatRatioPercent = (ratio: number): string =>
  `${upToOneDecimal.format(ratio * 100)}%`;

// 금액대 배수. 1/3 은 "0.33" 으로 적는다.
const formatMultiplier = (value: number): string => String(Number(value.toFixed(2)));

export function sourceLine(dataAsOf: string | null): string {
  if (dataAsOf === null) return SOURCE;
  const at = new Date(dataAsOf);
  return Number.isNaN(at.getTime()) ? SOURCE : `${SOURCE} · ${seoulDate.format(at)} 기준`;
}

/** 중간값 줄의 금액·비율 두 덩어리. 좁은 화면에서 덩어리 사이에서만 줄을 바꾸려고 나눠 둔다. */
export function medianParts(reference: Extract<AwardReference, { kind: "RANGE" }>): {
  amount: string;
  share: string;
} {
  const { amountKrw, ratio, base } = reference;
  return {
    amount: `중간값 ${formatEokMan(amountKrw.median)} 원`,
    share: `(${BASE_LABEL[base.kind]}의 ${formatRatioPercent(ratio.median)})`,
  };
}

export function basisLine(reference: AwardReference): string {
  const parts = [`기준: ${reference.scopeLabel}`, GROUP_LABEL[reference.group]];
  if (reference.kind === "RANGE") {
    const { min, max } = reference.amountBand;
    parts.push(`금액 ${formatMultiplier(min)}~${formatMultiplier(max)}배`);
  }
  parts.push(`최근 ${reference.periodMonths}개월`, `${reference.sampleSize}건`);
  if (reference.kind === "RANGE" && reference.step === 3) parts.push(WIDENED_TO_MID_CLASS);
  return parts.join(" · ");
}

/** 이 공고의 가격 조건 한 줄. 원문에 값이 없으면 null. */
export function priceTermLine(reference: AwardReference): string | null {
  if (reference.group === "NEGOTIATION" && reference.priceWeight !== null) {
    const price = upToOneDecimal.format(reference.priceWeight);
    const technical = upToOneDecimal.format(100 - reference.priceWeight);
    return `이 공고는 기술 ${technical} : 가격 ${price}입니다. 가격 점수는 가장 낮은 투찰가와 견줘 매깁니다.`;
  }
  if (reference.group === "LOWER_LIMIT" && reference.lowerLimitRate !== null) {
    return `이 공고의 낙찰하한율은 ${upToThreeDecimals.format(reference.lowerLimitRate)}%입니다.`;
  }
  return null;
}

// 막대 축. 기본 80~100% 이고, 가운데 절반이 벗어난 쪽만 5%p 여유를 두고 5% 눈금으로 넓힌다.
const AXIS_DEFAULT = { min: 0.8, max: 1 } as const;
const AXIS_MARGIN = 0.05;
// 부동소수 오차로 눈금이 한 칸 밀리지 않게 천분율 정수로 바꿔 5% 눈금(50‰)에 맞춘다.
const PER_MILLE_STEP = 50;
const floorStep = (value: number) =>
  (Math.floor(Math.round(value * 1000) / PER_MILLE_STEP) * PER_MILLE_STEP) / 1000;
const ceilStep = (value: number) =>
  (Math.ceil(Math.round(value * 1000) / PER_MILLE_STEP) * PER_MILLE_STEP) / 1000;

export function barAxisOf(ratio: { q1: number; q3: number }): { min: number; max: number } {
  return {
    min: ratio.q1 < AXIS_DEFAULT.min ? floorStep(ratio.q1 - AXIS_MARGIN) : AXIS_DEFAULT.min,
    max: ratio.q3 > AXIS_DEFAULT.max ? ceilStep(ratio.q3 + AXIS_MARGIN) : AXIS_DEFAULT.max,
  };
}
