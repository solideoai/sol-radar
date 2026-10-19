import "server-only";
import { G2B_BID_NOTICE_LIST_OPERATION, G2B_WINDOW_MAX_MS } from "./g2b.model";
import { KST_OFFSET_MINUTES } from "./normalize-date";

// ── 나라장터 목록 요청 만들기 (07 §2.2). 시각은 기기 시간대와 무관하게 KST 벽시계로 쓴다 ──
const KST_OFFSET_MS = KST_OFFSET_MINUTES * 60_000;

const pad2 = (value: number): string => String(value).padStart(2, "0");

export function formatG2bDateTime(at: Date): string {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  return [
    String(kst.getUTCFullYear()),
    pad2(kst.getUTCMonth() + 1),
    pad2(kst.getUTCDate()),
    pad2(kst.getUTCHours()),
    pad2(kst.getUTCMinutes()),
  ].join("");
}

export type G2bWindowSlice = { from: Date; to: Date };

/** 조회 창을 1일 이하 조각으로 나눈다. 조각은 틈 없이 잇고, 경계가 겹쳐 같은 공고가 두 번 와도 checksum 이 거른다. */
export function splitG2bWindow(from: Date, to: Date): G2bWindowSlice[] {
  const start = from.getTime();
  const end = to.getTime();
  if (!(start < end)) return [];
  const count = Math.ceil((end - start) / G2B_WINDOW_MAX_MS);
  return Array.from({ length: count }, (_, index) => {
    const sliceStart = start + index * G2B_WINDOW_MAX_MS;
    return {
      from: new Date(sliceStart),
      to: new Date(Math.min(sliceStart + G2B_WINDOW_MAX_MS, end)),
    };
  });
}

export function buildG2bListUrl(input: {
  endpoint: string;
  serviceKey: string;
  pageNo: number;
  numOfRows: number;
  slice: G2bWindowSlice;
  inqryDiv?: "1";
}): string {
  // 키는 디코딩된 값을 받아 URLSearchParams 가 한 번만 인코딩한다. 인코딩된 키를 받으면 두 번 인코딩되어 인증이 깨진다.
  const query = new URLSearchParams([
    ["serviceKey", input.serviceKey],
    ["type", "json"],
    ["pageNo", String(input.pageNo)],
    ["numOfRows", String(input.numOfRows)],
    ["inqryDiv", input.inqryDiv ?? "1"],
    ["inqryBgnDt", formatG2bDateTime(input.slice.from)],
    ["inqryEndDt", formatG2bDateTime(input.slice.to)],
  ]);
  const base = input.endpoint.replace(/\/+$/, "");
  return `${base}/${G2B_BID_NOTICE_LIST_OPERATION}?${query.toString()}`;
}
