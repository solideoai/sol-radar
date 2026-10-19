import "server-only";
import type { G2bItem } from "./connector.model";

// ── 나라장터 입찰공고정보서비스(15129394) 목록 응답의 모양 (07 §2.2·§3.1) ──
export const G2B_BID_NOTICE_SERVICE_ID = "15129394";
export const G2B_BID_NOTICE_LIST_OPERATION = "getBidPblancListInfoServc";
export const G2B_MAX_ROWS = 999;
export const G2B_DEFAULT_ROWS = 100;
// 07 §2.2: 요청 한 번의 조회 기간은 최대 1일이다.
export const G2B_WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
export const G2B_API_HOST = "apis.data.go.kr";

// 2f 실측 응답에서 마스킹한 담당자 필드. 공고 원본(rawPayload)에도 넣지 않는다(15 §3 개인정보).
export const G2B_CONTACT_FIELDS = [
  "ntceInsttOfclNm",
  "ntceInsttOfclTelNo",
  "ntceInsttOfclEmailAdrs",
  "exctvNm",
  "crdtrNm",
  "dminsttOfclEmailAdrs",
  "ofclNm",
  "ofclTelNo",
  "telNo",
] as const;

const CONTACT_FIELD_SET: ReadonlySet<string> = new Set(G2B_CONTACT_FIELDS);

export function stripContactFields(item: G2bItem): G2bItem {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !CONTACT_FIELD_SET.has(key)));
}

export type G2bEnvelope =
  | { ok: true; items: G2bItem[]; totalCount: number }
  | { ok: false; kind: "RESULT_CODE"; resultCode: string; resultMsg: string }
  | { ok: false; kind: "MALFORMED" };

const SUCCESS_RESULT_CODE = "00";
// 잘못된 요청(inqryDiv 범위 밖 등)에 HTTP 200 으로 오는 오류 봉투의 최상위 키(실측).
const ERROR_ENVELOPE_KEY = "nkoneps.com.response.ResponseError";

type ResultHeader = { resultCode: string; resultMsg: string };

const MALFORMED: G2bEnvelope = { ok: false, kind: "MALFORMED" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function headerOf(value: unknown): ResultHeader | null {
  if (!isRecord(value) || typeof value.resultCode !== "string") return null;
  return {
    resultCode: value.resultCode,
    resultMsg: typeof value.resultMsg === "string" ? value.resultMsg : "",
  };
}

const resultCodeEnvelope = ({ resultCode, resultMsg }: ResultHeader): G2bEnvelope => ({
  ok: false,
  kind: "RESULT_CODE",
  resultCode,
  resultMsg,
});

function totalCountOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function bodyEnvelope(body: unknown): G2bEnvelope {
  if (!isRecord(body) || !Array.isArray(body.items)) return { ...MALFORMED };
  const items: unknown[] = body.items;
  const totalCount = totalCountOf(body.totalCount);
  if (totalCount === null || !items.every(isRecord)) return { ...MALFORMED };
  return { ok: true, items: items.filter(isRecord), totalCount };
}

export function parseG2bEnvelope(body: unknown): G2bEnvelope {
  if (!isRecord(body)) return { ...MALFORMED };

  const errorEnvelope = body[ERROR_ENVELOPE_KEY];
  if (errorEnvelope !== undefined) {
    const header = isRecord(errorEnvelope) ? headerOf(errorEnvelope.header) : null;
    return header ? resultCodeEnvelope(header) : { ...MALFORMED };
  }

  if (!isRecord(body.response)) return { ...MALFORMED };
  const header = headerOf(body.response.header);
  if (!header) return { ...MALFORMED };
  // 결과 코드가 정상이 아니면 body 가 정상 모양이어도 믿지 않는다.
  if (header.resultCode.trim() !== SUCCESS_RESULT_CODE) return resultCodeEnvelope(header);
  return bodyEnvelope(body.response.body);
}
