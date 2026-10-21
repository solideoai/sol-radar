import "server-only";
import {
  EXTERNAL_SERVICES,
  KEPCO_COMPANIES,
  type ExternalConnectorOptions,
  type ExternalFailure,
} from "./external-connector.model";
import type { FetchPageInput } from "./connector.model";
import { kstCalendarDate } from "./normalize-date";

const DAY_MS = 86_400_000;
const dateText = (time: number): string =>
  new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
function calendarDay(raw: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error("external date must be YYYY-MM-DD");
  const time = Date.parse(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== raw)
    throw new Error("external date is invalid");
  return time;
}
export function splitKepcoWindow(from: string, to: string): { from: string; to: string }[] {
  const start = calendarDay(from);
  const end = calendarDay(to);
  if (start > end) throw new Error("external window is reversed");
  const count = Math.ceil((end - start + DAY_MS) / (90 * DAY_MS));
  if (count > 1000) throw new Error("external window is too large");
  return Array.from({ length: count }, (_, index) => ({
    from: dateText(start + index * 90 * DAY_MS),
    to: dateText(Math.min(end, start + (index + 1) * 90 * DAY_MS - DAY_MS)),
  }));
}
function monthWindows(from: string, to: string): { from: string; to: string }[] {
  const start = calendarDay(from);
  const end = calendarDay(to);
  const windows: { from: string; to: string }[] = [];
  let at = start;
  while (at <= end) {
    if (windows.length >= 1200) throw new Error("external month window too large");
    const current = new Date(at);
    const next = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1);
    windows.push({ from: dateText(at), to: dateText(Math.min(end, next - DAY_MS)) });
    at = next;
  }
  return windows;
}
function kstDay(raw: string | null): string {
  if (
    raw === null ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ||
    !Number.isFinite(Date.parse(raw))
  )
    throw new Error("external window needs ISO instants");
  const { year, month, day } = kstCalendarDate(new Date(raw));
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export type ExternalRequest =
  | {
      ok: true;
      url: string;
      operation: string;
      partition: string;
      window: { from: string; to: string };
      sliceIndex: number;
      pageNo: number;
      sliceCount: number;
      numOfRows: number;
    }
  | { ok: false; failure: ExternalFailure };
const failure = (kind: "NOT_VERIFIED" | "INVALID_INPUT", detail: string): ExternalRequest => ({
  ok: false,
  failure: { kind, detail },
});
export function buildExternalRequest(
  options: ExternalConnectorOptions,
  input: FetchPageInput,
): ExternalRequest {
  const service = EXTERNAL_SERVICES[options.sourceKey];
  const operation = options.operation ?? service.operation;
  if (!(service.verifiedOperations as readonly string[]).includes(operation))
    return failure("NOT_VERIFIED", "OPERATION_INPUTS_NOT_VERIFIED");
  if (options.endpoint !== undefined && options.endpoint !== service.endpoint)
    return failure("INVALID_INPUT", "ENDPOINT_NOT_ALLOWED");
  if (options.serviceKey.trim() === "") return failure("INVALID_INPUT", "SERVICE_KEY_MISSING");
  const isKepco = options.sourceKey === "kepco-ebid-contract";
  if (isKepco && options.serviceKey.length !== 40)
    return failure("INVALID_INPUT", "API_KEY_LENGTH_INVALID");
  if (
    options.companyId !== undefined &&
    (!isKepco || !Object.hasOwn(KEPCO_COMPANIES, options.companyId))
  )
    return failure("INVALID_INPUT", "COMPANY_ID_INVALID");
  const numOfRows = options.numOfRows ?? 100;
  if (!Number.isSafeInteger(numOfRows) || numOfRows < 1 || numOfRows > 1000)
    return failure("INVALID_INPUT", "PAGE_SIZE_INVALID");
  try {
    const from = kstDay(input.from);
    const to = kstDay(input.to);
    if (from > to) return failure("INVALID_INPUT", "WINDOW_REVERSED");
    const slices = isKepco
      ? splitKepcoWindow(from, to)
      : options.sourceKey.startsWith("kwater-")
        ? monthWindows(from, to)
        : [{ from: from.replaceAll("-", ""), to: to.replaceAll("-", "") }];
    const match = input.cursor === null ? ["", "0", "1"] : /^(\d+):(\d+)$/.exec(input.cursor);
    if (!match) return failure("INVALID_INPUT", "CURSOR_INVALID");
    const sliceIndex = Number(match[1]);
    const pageNo = Number(match[2]);
    if (
      !Number.isSafeInteger(sliceIndex) ||
      !Number.isSafeInteger(pageNo) ||
      sliceIndex >= slices.length ||
      pageNo < 1 ||
      (isKepco && pageNo !== 1)
    )
      return failure("INVALID_INPUT", "CURSOR_INVALID");
    const slice = slices[sliceIndex];
    const query = new URLSearchParams(
      isKepco
        ? {
            apiKey: options.serviceKey,
            noticeBeginDate: slice.from,
            noticeEndDate: slice.to,
            returnType: "json",
          }
        : { serviceKey: options.serviceKey, pageNo: String(pageNo), numOfRows: String(numOfRows) },
    );
    if (isKepco && options.companyId) query.set("companyId", options.companyId);
    if (options.sourceKey.startsWith("kwater-")) {
      if (slice.from.slice(0, 6) !== slice.to.slice(0, 6))
        return failure("INVALID_INPUT", "MONTH_PARTITION_REQUIRED");
      query.set("searchDt", slice.from.slice(0, 6));
      query.set("_type", "json");
    }
    if (options.sourceKey === "lh-bid-notice") {
      query.set("tndrbidRegDtStart", slice.from);
      query.set("tndrbidRegDtEnd", slice.to);
    }
    if (options.sourceKey === "lh-pre-specification") {
      query.set("opinionRegEndDtmStart", slice.from);
      query.set("opinionRegEndDtmEnd", slice.to);
    }
    if (options.sourceKey === "g2b-procurement-request") {
      if (!options.requestId?.trim())
        return failure("NOT_VERIFIED", "LIST_INPUTS_NOT_VERIFIED_REQUEST_ID_REQUIRED");
      query.set("prcrmntReqNo", options.requestId);
      query.set("type", "json");
    }
    return {
      ok: true,
      url: `${service.endpoint}${isKepco ? "" : `/${operation}`}?${query.toString()}`,
      operation,
      partition: options.companyId ?? "all",
      window: { from: slice.from, to: slice.to },
      sliceIndex,
      pageNo,
      sliceCount: slices.length,
      numOfRows,
    };
  } catch {
    return failure("INVALID_INPUT", "WINDOW_INVALID");
  }
}
