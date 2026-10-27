import "server-only";
import { parseKstDateTime } from "./normalize-date";
import type { SourceMetadata } from "./normalized-bid.model";

export type ExternalDate = SourceMetadata["dates"][string];

/** 외부 공고의 날짜 원문 하나를 정밀도와 함께 남긴다. 읽지 못한 값도 원문은 남기고 utc 만 null 이다 */
export function dateMetadata(raw: string | null, fetchedAt: Date): ExternalDate | null {
  if (raw === null) return null;
  const precision = /^\d{4}(?:[-.]?\d{2}){2}$/.test(raw)
    ? "DATE"
    : /^\d{12}$|[ T]\d{2}:\d{2}$/.test(raw)
      ? "MINUTE"
      : /[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(raw)
        ? "SECOND"
        : "UNKNOWN";
  const parsed = parseKstDateTime(raw, fetchedAt);
  return { raw, precision, utc: parsed.ok ? parsed.value : null };
}

/** 시각까지 있는 날짜만 순간으로 쓴다. 날짜만 있는 값(DATE)은 몇 시인지 몰라 null 이다 */
export const exactInstant = (date: ExternalDate | undefined): string | null =>
  date !== undefined && date.precision !== "DATE" ? date.utc : null;
