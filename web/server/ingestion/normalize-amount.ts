import "server-only";

// ── 07 §3 금액: 원문 표기를 KRW 정수 문자열로. 큰 금액·소수 단위가 있어 BigInt 로만 계산한다 ──
export type BudgetParse = { ok: true; value: string } | { ok: false };

const PLAIN_INTEGER = /^(?:\d+|\d{1,3}(?:,\d{3})+)원?$/;
// 긴 단위를 먼저 맞춰야 '3천만' 이 '3천' + '만' 으로 쪼개지지 않는다.
const UNIT_PIECE = /^(\d+(?:,\d{3})*)(?:\.(\d+))?(조|억|천만|백만|만|천)/;
const UNIT_EXPONENT: Readonly<Record<string, number>> = {
  조: 12,
  억: 8,
  천만: 7,
  백만: 6,
  만: 4,
  천: 3,
};

type UnitPiece = { digits: string; fractionLength: number; exponent: number };

// tsconfig target 이 ES2017 이라 BigInt 리터럴(10n) 대신 생성자를 쓴다.
const ZERO = BigInt(0);
const TEN = BigInt(10);

const failure = (): BudgetParse => ({ ok: false });
const success = (value: bigint): BudgetParse => ({ ok: true, value: value.toString() });

function parseUnitPieces(body: string): UnitPiece[] | null {
  const pieces: UnitPiece[] = [];
  let rest = body;
  while (rest.length > 0) {
    const match = UNIT_PIECE.exec(rest);
    if (!match) return null;
    const [whole, integerPart, fraction = "", unit] = match;
    const exponent = UNIT_EXPONENT[unit];
    if (exponent === undefined) return null;
    // 단위는 조각마다 엄격히 작아져야 한다('5만억'·'5억5억' 은 표기 오류다).
    const previous = pieces.at(-1);
    if (previous && previous.exponent <= exponent) return null;
    pieces.push({
      digits: `${integerPart.replaceAll(",", "")}${fraction}`,
      fractionLength: fraction.length,
      exponent,
    });
    rest = rest.slice(whole.length);
  }
  return pieces.length > 0 ? pieces : null;
}

// 조각마다 소수 자릿수가 달라서, 가장 긴 소수 자릿수만큼 키운 정수로 더한 뒤 나눠떨어지는지 본다.
function sumUnitPieces(pieces: readonly UnitPiece[]): bigint | null {
  const scale = Math.max(...pieces.map(({ fractionLength }) => fractionLength));
  const scaledTotal = pieces.reduce(
    (total, { digits, fractionLength, exponent }) =>
      total + BigInt(digits) * TEN ** BigInt(exponent + scale - fractionLength),
    ZERO,
  );
  const divisor = TEN ** BigInt(scale);
  return scaledTotal % divisor === ZERO ? scaledTotal / divisor : null;
}

function parseBudgetText(raw: string): BudgetParse {
  const compact = raw.replace(/\s+/g, "");
  if (PLAIN_INTEGER.test(compact)) {
    return success(BigInt(compact.replace(/[,원]/g, "")));
  }
  const body = compact.endsWith("원") ? compact.slice(0, -1) : compact;
  const pieces = parseUnitPieces(body);
  if (!pieces) return failure();
  const total = sumUnitPieces(pieces);
  return total === null ? failure() : success(total);
}

export function parseBudgetKrw(raw: string | number): BudgetParse {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw >= 0 ? success(BigInt(raw)) : failure();
  }
  return parseBudgetText(raw);
}
