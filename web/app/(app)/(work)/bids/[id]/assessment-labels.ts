// Kev 항목별 분포 표의 항목 문구(스펙 §5.4.7 v0.2 "문구는 BidDetail.extraction 에서 itemId 경로로").
// itemId 는 추출 필드 경로다(예 "requiredSkills[2]", C4 requirement-assessment). 추출 결과는 05 DTO 에서 unknown 이라
// 모양을 믿지 않고 한 단계씩 확인한다. 못 찾으면 경로 문자열을 그대로 보인다(빈칸보다 낫다).

type Segment = string | number;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// "a.b[2].c" → ["a", "b", 2, "c"]. 모양이 틀리면 null.
function segmentsOf(path: string): Segment[] | null {
  const segments: Segment[] = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (match === null) return null;
    segments.push(match[1]!);
    for (const index of match[2]!.matchAll(/\[(\d+)\]/g)) segments.push(Number(index[1]));
  }
  return segments;
}

const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.hasOwn(record, key) ? record[key] : undefined;

// 추출 필드는 {state, value, evidence} 로 감싸여 있다. 다음 단계가 감싸개 안에 있으면 value 로 들어간다.
function step(current: unknown, segment: Segment): unknown {
  if (typeof segment === "number") {
    if (Array.isArray(current)) return current[segment];
    if (isRecord(current)) {
      const inner = own(current, "value");
      if (Array.isArray(inner)) return inner[segment];
    }
    return undefined;
  }
  if (!isRecord(current)) return undefined;
  if (Object.hasOwn(current, segment)) return current[segment];
  const inner = own(current, "value");
  return isRecord(inner) ? own(inner, segment) : undefined;
}

// 항목 하나를 보일 글자로. 기술은 문자열, 감싼 값은 value, 자격·실적·인력은 이름·설명·역할이다.
const TEXT_KEYS = ["value", "name", "description", "role"] as const;

function textOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() === "" ? null : value;
  if (!isRecord(value)) return null;
  for (const key of TEXT_KEYS) {
    const text = own(value, key);
    if (typeof text === "string" && text.trim() !== "") return text;
  }
  return null;
}

export function assessmentLabel(extraction: unknown, itemId: string): string {
  const segments = segmentsOf(itemId);
  if (segments === null) return itemId;
  let current: unknown = extraction;
  for (const segment of segments) {
    current = step(current, segment);
    if (current === undefined) return itemId;
  }
  return textOf(current) ?? itemId;
}
