import "server-only";
import type { G2bItem } from "./connector.model";

// ── 나라장터 입찰공고정보서비스(15129394) 목록 응답의 모양 (07 §2.2·§3.1) ──
export const G2B_BID_NOTICE_SERVICE_ID = "15129394";
export const G2B_BID_NOTICE_LIST_OPERATION = "getBidPblancListInfoServc";
// 보조 조회 3종(07 §2.2, 15 §8). 새 revision 마다 공고 1건 단위(inqryDiv=2 + bidNtceNo)로 부른다.
export const G2B_LICENSE_LIMIT_OPERATION = "getBidPblancListInfoLicenseLimit";
export const G2B_REGION_OPERATION = "getBidPblancListInfoPrtcptPsblRgn";
export const G2B_EORDER_ATTACH_OPERATION = "getBidPblancListInfoEorderAtchFileInfo";
/** registryKey 는 infra/sources/registry.yaml 의 key 이고 ingest_errors.source_key 에 쓴다(15 §8). */
export const G2B_AUX_OPERATIONS = [
  { operation: G2B_LICENSE_LIMIT_OPERATION, registryKey: "g2b-bid-license-limit" },
  { operation: G2B_REGION_OPERATION, registryKey: "g2b-bid-region" },
  { operation: G2B_EORDER_ATTACH_OPERATION, registryKey: "g2b-bid-eorder-attach" },
] as const;
export type G2bAuxOperation = (typeof G2B_AUX_OPERATIONS)[number]["operation"];
export type G2bAuxRegistryKey = (typeof G2B_AUX_OPERATIONS)[number]["registryKey"];
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

type EnvelopeOptions = {
  /** 2026-10-20 실측: inqryDiv=2 보조 조회가 0건이면 body 에 items 키가 없다({numOfRows,pageNo,totalCount}). */
  emptyWhenItemsMissing: boolean;
};

function bodyEnvelope(body: unknown, options: EnvelopeOptions): G2bEnvelope {
  if (!isRecord(body)) return { ...MALFORMED };
  const totalCount = totalCountOf(body.totalCount);
  if (totalCount === null) return { ...MALFORMED };
  const rawItems: unknown =
    body.items === undefined && options.emptyWhenItemsMissing && totalCount === 0 ? [] : body.items;
  if (!Array.isArray(rawItems)) return { ...MALFORMED };
  const items: unknown[] = rawItems;
  if (!items.every(isRecord)) return { ...MALFORMED };
  return { ok: true, items: items.filter(isRecord), totalCount };
}

function parseEnvelopeWith(body: unknown, options: EnvelopeOptions): G2bEnvelope {
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
  return bodyEnvelope(body.response.body, options);
}

/** 목록 응답 봉투. items 키가 없으면 MALFORMED 다(목록은 0건에도 빈 배열을 준다). */
export function parseG2bEnvelope(body: unknown): G2bEnvelope {
  return parseEnvelopeWith(body, { emptyWhenItemsMissing: false });
}

/** 보조 조회 응답 봉투. totalCount 0 에 items 키가 없는 실측 모양을 0건으로 읽는다. 그 밖은 목록과 같다. */
export function parseG2bAuxEnvelope(body: unknown): G2bEnvelope {
  return parseEnvelopeWith(body, { emptyWhenItemsMissing: true });
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

// 앞의 공백·XML 선언·주석을 건너뛴다. 세 갈래는 첫 글자가 달라 되돌아가며 다시 맞추지 않는다(본문은 상한 안).
const MARKUP_PREAMBLE = /^(?:[\s﻿]|<\?[^>]*\?>|<!--[\s\S]*?-->)*/;
const HTML_START = /^<(?:!doctype\s+html|html)\b/i;
const ROOT_TAG = /^<([A-Za-z_][\w.:-]{0,39})/;

/**
 * 해석하지 못한 마크업 본문의 모양(11-01 정기 수집 실패 조사). 점검 페이지(HTML)인지 다른 XML 인지 가리는 데 쓴다.
 * 본문 값은 싣지 않는다. 최상위 태그 이름만, 글자 모양을 제한해 돌려준다.
 */
export function markupShapeOf(text: string): string {
  const body = text.replace(MARKUP_PREAMBLE, "");
  if (HTML_START.test(body)) return "HTML";
  const tag = ROOT_TAG.exec(body)?.[1];
  return tag === undefined ? "알 수 없는 마크업" : `XML ${tag}`;
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
