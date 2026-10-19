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
/** 목록 응답 본문 상한(UTF-8 바이트, 7-3). 999행 페이지도 수 MB 라 넉넉하다 */
export const G2B_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;

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
// 7-8: 목록에 없는 새 담당자 필드도 이름 규칙으로 뺀다. 나라장터는 담당자(ofcl)·전화·팩스·메일·휴대폰을 이 접미사로 쓴다.
const CONTACT_NAME_PART = "Ofcl";
const CONTACT_NAME_SUFFIX = /(TelNo|FaxNo|EmailAdrs|HpNo)$/;

const isContactField = (key: string): boolean =>
  CONTACT_FIELD_SET.has(key) || key.includes(CONTACT_NAME_PART) || CONTACT_NAME_SUFFIX.test(key);

export function stripContactFields(item: G2bItem): G2bItem {
  return Object.fromEntries(Object.entries(item).filter(([key]) => !isContactField(key)));
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

// ── data.go.kr 공통 XML 오류 봉투(게이트웨이 오류, 5-A) ──
// 미검증 가정: 실측 표본이 없어 계약이 구성한 모양(<OpenAPI_ServiceResponse><cmmMsgHeader>…)을 따른다.
// 키 오류는 type=json 을 보내도 XML 로 오고 Content-Type 도 믿을 수 없어 본문 첫 글자로 판정한다.
export const G2B_GATEWAY_KEY_ERROR_CODES = ["30", "31"] as const; // 30 등록되지 않은 키, 31 기한 만료

export type G2bGatewayError = { returnReasonCode: string; returnAuthMsg: string | null };

const LEADING_WHITESPACE = /^[\s﻿]+/;
const REASON_CODE = /<returnReasonCode>([^<]*)<\/returnReasonCode>/;
const AUTH_MSG = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/;
// authMsg 는 고정된 오류 이름(SERVICE_KEY_IS_NOT_REGISTERED_ERROR 등)일 때만 쓴다. 되돌아온 키·URL 이 섞인 값은 버린다.
const AUTH_MSG_FORMAT = /^[A-Z0-9_]+$/;

export function looksLikeXml(text: string): boolean {
  return text.replace(LEADING_WHITESPACE, "").startsWith("<");
}

export function parseG2bGatewayError(text: string): G2bGatewayError | null {
  if (!looksLikeXml(text)) return null;
  const code = REASON_CODE.exec(text)?.[1]?.trim();
  if (code === undefined || !/^\d+$/.test(code)) return null;
  const authMsg = AUTH_MSG.exec(text)?.[1]?.trim();
  return {
    returnReasonCode: code,
    returnAuthMsg: authMsg !== undefined && AUTH_MSG_FORMAT.test(authMsg) ? authMsg : null,
  };
}
