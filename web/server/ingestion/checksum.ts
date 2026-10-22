import "server-only";
import { createHash } from "node:crypto";
import {
  EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION,
  type NormalizedBid,
  type NormalizedBidDraft,
} from "./normalized-bid.model";

// ── 15 §3 checksum: 같은 공고를 다시 받았는지 판단하는 유일한 근거 ──
// 수집 시각은 같은 공고를 다시 받아도 매번 달라지므로 해시에서 뺀다. checksum 자신도 뺀다.
const UNHASHED_KEYS: ReadonlySet<string> = new Set(["fetchedAt", "checksum"]);

/** v0.3의 관측 시점 파생 상태만 제외한다. 공급자의 상태·날짜·금액·속성은 그대로 비교한다. */
export function revisionSourceMetadata(bid: NormalizedBidDraft): unknown {
  if (bid.sourceMetadata === undefined) return null;
  if (bid.schemaVersion !== EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION) return bid.sourceMetadata;
  return Object.fromEntries(
    Object.entries(bid.sourceMetadata).filter(([key]) => key !== "participationStatus"),
  );
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 키를 코드 유닛 순서로 정렬하고 공백 없이 쓴 JSON. 키 순서가 달라도 같은 문자열이 된다. */
export function canonicalJson(value: unknown): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    // JSON.stringify 와 같게 배열 속 undefined 는 null 로 쓴다(자리를 지우면 순서가 바뀐다).
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  if (isPlainObject(value)) {
    const members = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError(`canonicalJson 이 다룰 수 없는 값이다: ${typeof value}`);
}

export function computeBidChecksum(bid: Omit<NormalizedBid, "checksum">): string {
  const hashed: Record<string, unknown> = Object.fromEntries(
    Object.entries(bid).filter(([key]) => !UNHASHED_KEYS.has(key)),
  );
  // v0.2의 직렬화와 hash는 유지한다. 원본 스냅샷도 수정하지 않는다.
  if (
    bid.schemaVersion === EXTERNAL_NORMALIZED_BID_SCHEMA_VERSION &&
    bid.sourceMetadata !== undefined
  ) {
    hashed.sourceMetadata = revisionSourceMetadata(bid);
  }
  return createHash("sha256").update(canonicalJson(hashed), "utf8").digest("hex");
}

export function finalizeRevision(draft: NormalizedBidDraft, revision: number): NormalizedBid {
  if (!Number.isInteger(revision) || revision < 1) {
    throw new RangeError(`revision 은 1 이상의 정수다: ${revision}`);
  }
  const unsigned = { ...draft, revision };
  return { ...unsigned, checksum: computeBidChecksum(unsigned) };
}
