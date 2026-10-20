import "server-only";
import {
  G2B_BID_NOTICE_LIST_OPERATION,
  G2B_WINDOW_MAX_MS,
  type G2bAuxOperation,
} from "./g2b.model";
import { KST_OFFSET_MINUTES, kstCalendarDate } from "./normalize-date";

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

// 키는 디코딩된 값을 받아 URLSearchParams 가 한 번만 인코딩한다. 인코딩된 키를 받으면 두 번 인코딩되어 인증이 깨진다.
const urlOf = (endpoint: string, operation: string, query: [string, string][]): string => {
  const base = endpoint.replace(/\/+$/, "");
  return `${base}/${operation}?${new URLSearchParams(query).toString()}`;
};

export function buildG2bListUrl(input: {
  endpoint: string;
  serviceKey: string;
  pageNo: number;
  numOfRows: number;
  slice: G2bWindowSlice;
  inqryDiv?: "1";
}): string {
  return urlOf(input.endpoint, G2B_BID_NOTICE_LIST_OPERATION, [
    ["serviceKey", input.serviceKey],
    ["type", "json"],
    ["pageNo", String(input.pageNo)],
    ["numOfRows", String(input.numOfRows)],
    ["inqryDiv", input.inqryDiv ?? "1"],
    ["inqryBgnDt", formatG2bDateTime(input.slice.from)],
    ["inqryEndDt", formatG2bDateTime(input.slice.to)],
  ]);
}

// ── 보조 조회(면허제한·참가가능지역·e발주 첨부) 요청 ──
// 공고 1건은 inqryDiv=2 + bidNtceNo(+bidNtceOrd)로 받는다(C1 증거 §10-3, 33번 호출). 기간도 함께 넣는다 —
// 33번이 기간을 넣고 성공했고 기간 없이 되는지는 미검증이다. 기간은 공고 등록일 KST −1일 00:00 ~ +6일 23:59(총 8일).
export const G2B_AUX_INQRY_DIV = "2";
export const G2B_AUX_WINDOW_DAYS_BEFORE = 1;
export const G2B_AUX_WINDOW_DAYS_AFTER = 6;
const MINUTE_MS = 60_000;

/** 등록 시각이 KST 로 속한 날을 기준으로 보조 조회 기간을 만든다. */
export function auxWindowOf(registeredAt: Date): G2bWindowSlice {
  const { year, month, day } = kstCalendarDate(registeredAt);
  const kstDayStart = Date.UTC(year, month - 1, day) - KST_OFFSET_MS;
  return {
    from: new Date(kstDayStart - G2B_AUX_WINDOW_DAYS_BEFORE * G2B_WINDOW_MAX_MS),
    to: new Date(kstDayStart + (G2B_AUX_WINDOW_DAYS_AFTER + 1) * G2B_WINDOW_MAX_MS - MINUTE_MS),
  };
}

export function buildG2bAuxUrl(input: {
  endpoint: string;
  serviceKey: string;
  operation: G2bAuxOperation;
  noticeId: string;
  /** 차수(bidNtceOrd). 없으면 파라미터를 넣지 않는다 */
  amendmentNo: string | null;
  registeredAt: Date;
  pageNo: number;
  numOfRows: number;
}): string {
  const window = auxWindowOf(input.registeredAt);
  return urlOf(input.endpoint, input.operation, [
    ["serviceKey", input.serviceKey],
    ["type", "json"],
    ["pageNo", String(input.pageNo)],
    ["numOfRows", String(input.numOfRows)],
    ["inqryDiv", G2B_AUX_INQRY_DIV],
    ["inqryBgnDt", formatG2bDateTime(window.from)],
    ["inqryEndDt", formatG2bDateTime(window.to)],
    ["bidNtceNo", input.noticeId],
    ...(input.amendmentNo === null ? [] : [["bidNtceOrd", input.amendmentNo] as [string, string]]),
  ]);
}
