import "server-only";
import { formatG2bDateTime, type G2bWindowSlice } from "./g2b-request";
import { G2B_ORDER_PLAN_LIST_OPERATION, G2B_PRE_SPEC_LIST_OPERATION } from "./g2b-stage.model";
import { kstCalendarDate } from "./normalize-date";

// ── 사전규격·발주계획 목록 요청 주소 (07 §2.2, C1 증거 §10 6번) ──
// 파라미터는 2026-10-19 실호출로 확인한 꼴이다. 사전규격 = inqryDiv=1 + inqryBgnDt/inqryEndDt(YYYYMMDDHHMM),
// 발주계획 = inqryDiv=1 + orderBgnYm/orderEndYm(YYYYMM). 발주계획에 inqryBgnDt/EndDt 만 주면 오류 08 이다.
// 아직 아무도 부르지 않는다(worker 연결은 후속 계획).

const urlOf = (endpoint: string, operation: string, query: [string, string][]): string =>
  `${endpoint.replace(/\/+$/, "")}/${operation}?${new URLSearchParams(query).toString()}`;

const commonQuery = (input: {
  serviceKey: string;
  pageNo: number;
  numOfRows: number;
}): [string, string][] => [
  ["serviceKey", input.serviceKey],
  ["type", "json"],
  ["pageNo", String(input.pageNo)],
  ["numOfRows", String(input.numOfRows)],
  ["inqryDiv", "1"],
];

/** 키는 디코딩된 값을 받는다. URLSearchParams 가 한 번만 인코딩한다(입찰공고 목록 요청과 같다). */
export function buildG2bPreSpecListUrl(input: {
  endpoint: string;
  serviceKey: string;
  pageNo: number;
  numOfRows: number;
  slice: G2bWindowSlice;
}): string {
  return urlOf(input.endpoint, G2B_PRE_SPEC_LIST_OPERATION, [
    ...commonQuery(input),
    ["inqryBgnDt", formatG2bDateTime(input.slice.from)],
    ["inqryEndDt", formatG2bDateTime(input.slice.to)],
  ]);
}

/** 그 시각이 KST 로 속한 달(YYYYMM). */
export function formatG2bYearMonth(at: Date): string {
  const { year, month } = kstCalendarDate(at);
  return `${String(year)}${String(month).padStart(2, "0")}`;
}

export function buildG2bOrderPlanListUrl(input: {
  endpoint: string;
  serviceKey: string;
  pageNo: number;
  numOfRows: number;
  from: Date;
  to: Date;
}): string {
  return urlOf(input.endpoint, G2B_ORDER_PLAN_LIST_OPERATION, [
    ...commonQuery(input),
    ["orderBgnYm", formatG2bYearMonth(input.from)],
    ["orderEndYm", formatG2bYearMonth(input.to)],
  ]);
}
