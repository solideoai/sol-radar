// 자격 갭 레이더의 숫자 글자(디자인 스펙 §6.3). 서버 모듈을 부르지 않는다(클라이언트 부품에서도 쓴다).
// 합계 예산은 늘 "억" 단위로 쓴다. 조 단위로 바꾸지 않는다. 공고 한 건의 예산은 /bids 와 같은 formatKrwCompact 를 쓴다.

const EMPTY = "—";
const MINUS = "−";
/** 0.1억 = 1천만 원. 반올림 단위다. 대상 브라우저(ES2017)에 bigint 글자(10n)가 없어 BigInt() 로 만든다. */
const TENTH_EOK = BigInt(10_000_000);
const HALF_TENTH = BigInt(5_000_000);
const TEN = BigInt(10);
const ZERO = BigInt(0);

const grouped = new Intl.NumberFormat("ko-KR");

function parseWon(won: string | null): bigint | null {
  return won !== null && /^\d+$/.test(won) ? BigInt(won) : null;
}

function eokOf(value: bigint): string {
  if (value === ZERO) return "0억";
  // 소수 첫째 자리에서 사사오입(half-up). 정수로만 셈해 큰 금액도 어긋나지 않는다.
  const tenths = (value + HALF_TENTH) / TENTH_EOK;
  if (tenths === ZERO) return "0.1억 미만";
  const fraction = tenths % TEN;
  return `${grouped.format(tenths / TEN)}${fraction === ZERO ? "" : `.${fraction}`}억`;
}

/** 원 단위 정수 문자열 → "392.9억". 0원은 "0억", 500만 원 미만은 "0.1억 미만", 모르는 값은 "—". */
export function formatEok(won: string | null): string {
  const value = parseWon(won);
  return value === null ? EMPTY : eokOf(value);
}

/** 두 합계의 차이. 원 단위로 뺀 뒤 반올림한다. 같으면 "변화 없음", 줄면 빼기 기호(−)를 쓴다. */
export function formatEokDelta(before: string, after: string): string {
  const from = parseWon(before);
  const to = parseWon(after);
  if (from === null || to === null) return EMPTY;
  const delta = to - from;
  if (delta === ZERO) return "변화 없음";
  return delta > ZERO ? `+${eokOf(delta)}` : `${MINUS}${eokOf(-delta)}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("ko-KR");
}

/** 건수 차이. 같으면 "변화 없음". */
export function formatCountDelta(before: number, after: number): string {
  const delta = after - before;
  if (delta === 0) return "변화 없음";
  return delta > 0 ? `+${formatCount(delta)}건` : `${MINUS}${formatCount(-delta)}건`;
}
