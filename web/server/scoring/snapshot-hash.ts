import "server-only";
import { createHash } from "node:crypto";

// input_snapshot_hash = sha256(canonical JSON). canonical = 객체 키를 재귀적으로 정렬, 공백 없음, undefined 생략(08 §7, 15 §3).
// 같은 입력이면 같은 문자열·같은 해시다. 배열 순서는 입력 순서를 보존한다(순서도 입력의 일부다).

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return Object.fromEntries(entries.map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function snapshotHash(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
