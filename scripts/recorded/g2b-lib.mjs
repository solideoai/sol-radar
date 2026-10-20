// 나라장터 입찰공고정보서비스(15129394) 녹음 스크립트의 순수 도우미.
//
// scripts/ 는 `import "server-only"` 가 붙은 web/server/ingestion 의 TS 를 바로 부를 수 없어서,
// 녹음에 필요한 규칙만 여기로 옮겼다. 출처는 함수마다 주석에 적는다. 규칙이 바뀌면 원본을 먼저 고치고 여기를 맞춘다.
//   - 창 분할 1일·KST 벽시계 포맷:    web/server/ingestion/g2b-request.ts (splitG2bWindow·formatG2bDateTime)
//   - 상수(999행·20MB·15s·호스트):     web/server/ingestion/g2b.model.ts, connector.model.ts
//   - 응답 봉투 해석:                   web/server/ingestion/g2b.model.ts (parseG2bEnvelope)
//   - 재시도 대기(1·2·4s + jitter<250): web/server/ingestion/retry.ts (retryDelayMs·RETRY_MAX_RETRIES)
//   - 정보화 필터(broad):               web/server/ingestion/g2b-filter.ts (isInfoBizNoticeBroad)
//   - env 로딩(infra/.env 를 parseEnv):  scripts/check-env.mjs (readEnvFile)
// 네트워크·파일 쓰기는 하지 않는다. 그것은 record-g2b.mjs 몫이다.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";

export const G2B_SERVICE_ID = "15129394";
export const G2B_ENDPOINT = "https://apis.data.go.kr/1230000/ad/BidPublicInfoService";
export const G2B_API_HOST = "apis.data.go.kr";
export const G2B_MAX_ROWS = 999;
export const G2B_RESPONSE_MAX_BYTES = 20 * 1024 * 1024;
export const CONNECTOR_TIMEOUT_MS = 15_000;
// 07 §2.2: 요청 한 번의 조회 기간은 최대 1일(g2b.model.ts G2B_WINDOW_MAX_MS).
export const G2B_WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
export const KST_OFFSET_MS = 540 * 60_000;
export const SERVICE_KEY_ENV = "G2B_BID_NOTICE_SERVICE_KEY";

export const LIST_OPERATION = "getBidPblancListInfoServc";
/** 보조 조회 3종. registryKey 는 infra/sources/registry.yaml 의 key 다. 이름 접두어는 녹음 파일 tag 에 쓴다. */
export const AUX_OPERATIONS = [
  {
    operation: "getBidPblancListInfoLicenseLimit",
    registryKey: "g2b-bid-license-limit",
    tagPrefix: "lic",
  },
  {
    operation: "getBidPblancListInfoPrtcptPsblRgn",
    registryKey: "g2b-bid-region",
    tagPrefix: "rgn",
  },
  {
    operation: "getBidPblancListInfoEorderAtchFileInfo",
    registryKey: "g2b-bid-eorder-attach",
    tagPrefix: "eorder",
  },
];
export const LIST_REGISTRY_KEY = "g2b-bid-notice";

// retry.ts 와 같은 값.
export const RETRY_BASE_DELAY_MS = 1000;
export const RETRY_MAX_RETRIES = 3;
export const RETRY_JITTER_MAX_MS = 250;

// quota.ts·g2b.model.ts: 22 일일 한도, 30·31 키 오류. 23 은 초당 한도(data.go.kr 공통 코드). 하나라도 오면 즉시 멈춘다.
export const STOP_RESULT_CODES = ["22", "23", "30", "31"];

const RESPONSE_ENVELOPE = "response";
const ERROR_ENVELOPE = "nkoneps.com.response.ResponseError";
const SUCCESS_RESULT_CODE = "00";
const PERCENT_ENCODED = /%[0-9A-Fa-f]{2}/;

const pad2 = (value) => String(value).padStart(2, "0");
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// ── 시각 (g2b-request.ts formatG2bDateTime) ──
export function formatG2bDateTime(at) {
  const kst = new Date(at.getTime() + KST_OFFSET_MS);
  return [
    String(kst.getUTCFullYear()),
    pad2(kst.getUTCMonth() + 1),
    pad2(kst.getUTCDate()),
    pad2(kst.getUTCHours()),
    pad2(kst.getUTCMinutes()),
  ].join("");
}

/** `YYYY-MM-DD` + KST 시·분을 UTC 순간으로. 기기 시간대와 무관하다. */
export function kstInstant(date, hour = 0, minute = 0) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`날짜는 YYYY-MM-DD 여야 한다: ${date}`);
  const [, year, month, day] = match;
  return new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day), hour, minute) - KST_OFFSET_MS,
  );
}

/** 나라장터 응답의 `YYYY-MM-DD HH:mm:ss`(KST 벽시계)를 UTC 순간으로. 형식이 다르면 null. */
export function parseG2bLocalDateTime(raw) {
  if (typeof raw !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
  if (!match) return null;
  const [, year, month, day, hour = "0", minute = "0", second = "0"] = match;
  const instant = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    ) - KST_OFFSET_MS,
  );
  return Number.isNaN(instant.getTime()) ? null : instant;
}

// ── 창 분할 (g2b-request.ts splitG2bWindow): 1일 이하 조각, 틈 없이 이어진다 ──
export function splitG2bWindow(from, to) {
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

// ── 요청 URL. 키는 디코딩된 값을 받아 URLSearchParams 가 한 번만 인코딩한다(g2b-request.ts buildG2bListUrl) ──
/** 녹음 파일의 params 에 그대로 적는 값(serviceKey 없음). 순서도 이 순서로 기록한다. */
export function listParams({ pageNo, numOfRows, slice }) {
  return {
    type: "json",
    pageNo: String(pageNo),
    numOfRows: String(numOfRows),
    inqryDiv: "1",
    inqryBgnDt: formatG2bDateTime(slice.from),
    inqryEndDt: formatG2bDateTime(slice.to),
  };
}

/**
 * 보조 조회(면허제한·참가가능지역·e발주 첨부)는 `inqryDiv=2` + `bidNtceNo`·`bidNtceOrd` 로 공고 1건을 받는다
 * (external-deps-api-20261019.md §10-3, 33번 호출). 기간도 함께 넣는다 — 33번이 기간을 넣고 성공했고
 * 기간 없이 되는지는 미검증이다. 기간은 공고 등록일 -1일 00:00 ~ +6일 23:59(총 8일, 실측 상한).
 */
export function auxParams({ numOfRows, bidNtceNo, bidNtceOrd, rgstAt }) {
  const dayStart = Date.UTC(
    new Date(rgstAt.getTime() + KST_OFFSET_MS).getUTCFullYear(),
    new Date(rgstAt.getTime() + KST_OFFSET_MS).getUTCMonth(),
    new Date(rgstAt.getTime() + KST_OFFSET_MS).getUTCDate(),
  );
  const from = new Date(dayStart - KST_OFFSET_MS - G2B_WINDOW_MAX_MS);
  const to = new Date(dayStart - KST_OFFSET_MS + 7 * G2B_WINDOW_MAX_MS - 60_000);
  return {
    type: "json",
    pageNo: "1",
    numOfRows: String(numOfRows),
    inqryDiv: "2",
    inqryBgnDt: formatG2bDateTime(from),
    inqryEndDt: formatG2bDateTime(to),
    bidNtceNo,
    bidNtceOrd,
  };
}

export function buildG2bUrl({ operation, serviceKey, params }) {
  if (Object.keys(params).some((key) => key.toLowerCase() === "servicekey")) {
    throw new Error("params 에 serviceKey 를 넣지 않는다");
  }
  const query = new URLSearchParams([["serviceKey", serviceKey], ...Object.entries(params)]);
  return `${G2B_ENDPOINT}/${operation}?${query.toString()}`;
}

// ── 서비스키 로딩: check-env.mjs 와 같은 방식(infra/.env 를 node:util parseEnv). 값은 돌려주되 호출자가 출력하지 않는다 ──
export async function loadServiceKey(envRoot, envName = SERVICE_KEY_ENV) {
  const file = path.join(envRoot, "infra", ".env");
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `env 파일이 없다: ${path.relative(envRoot, file)} (--env-root 로 저장소 루트를 준다)`,
      );
    }
    throw error;
  }
  const raw = parseEnv(text)[envName];
  if (raw === undefined || raw.trim() === "") throw new Error(`${envName} 가 env 파일에 없다`);
  // 2f 실측(§1): 값은 data.go.kr Encoding 키(%XX 포함)다. 1회 디코드 뒤 URLSearchParams 가 1회 인코딩한다.
  const isEncoded = PERCENT_ENCODED.test(raw);
  const serviceKey = isEncoded ? decodeURIComponent(raw) : raw;
  return {
    serviceKey,
    // 보고용. 값은 없고 길이·형식만 있다.
    shape: { envName, length: raw.length, isEncoded, decodedLength: serviceKey.length },
    // 저장 파일에서 찾아낼 때 쓰는 형태들(원문·디코드·1회 인코딩·2회 인코딩).
    forms: [...new Set([raw, serviceKey, encodeURIComponent(serviceKey), encodeURIComponent(raw)])],
  };
}

// ── 응답 봉투 (g2b.model.ts parseG2bEnvelope) ──
function headerOf(value) {
  if (!isRecord(value) || typeof value.resultCode !== "string") return null;
  return {
    resultCode: value.resultCode,
    resultMsg: typeof value.resultMsg === "string" ? value.resultMsg : "",
  };
}

function totalCountOf(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * 봉투를 녹음 필드로 푼다.
 * - 정상: { envelope:"response", resultCode, resultMsg, totalCount, items }
 * - 조달청 오류(HTTP 200): { envelope:"nkoneps.com.response.ResponseError", resultCode, resultMsg, totalCount:null, items:[] }
 * - 모양이 아니면 { malformed:true }
 */
export function parseG2bEnvelope(body) {
  if (!isRecord(body)) return { malformed: true };
  const errorEnvelope = body[ERROR_ENVELOPE];
  if (errorEnvelope !== undefined) {
    const header = isRecord(errorEnvelope) ? headerOf(errorEnvelope.header) : null;
    if (!header) return { malformed: true };
    return { envelope: ERROR_ENVELOPE, ...header, totalCount: null, items: [] };
  }
  if (!isRecord(body.response)) return { malformed: true };
  const header = headerOf(body.response.header);
  if (!header) return { malformed: true };
  if (header.resultCode.trim() !== SUCCESS_RESULT_CODE) {
    // 결과 코드가 정상이 아니면 body 를 믿지 않는다. 오류 봉투와 같은 모양으로 둔다.
    return { envelope: RESPONSE_ENVELOPE, ...header, totalCount: null, items: [] };
  }
  const responseBody = body.response.body;
  if (!isRecord(responseBody)) return { malformed: true };
  const totalCount = totalCountOf(responseBody.totalCount);
  if (totalCount === null) return { malformed: true };
  // 2026-10-20 실측: inqryDiv=2 보조 조회가 0건이면 body 에 items 키가 없다({numOfRows,pageNo,totalCount}).
  // 정본 g2b.model.ts parseG2bEnvelope 는 이것을 MALFORMED 로 본다(보고 대상). 녹음은 totalCount 0 일 때만 빈 배열로 받는다.
  const items = responseBody.items === undefined && totalCount === 0 ? [] : responseBody.items;
  if (!Array.isArray(items) || !items.every(isRecord)) return { malformed: true };
  return { envelope: RESPONSE_ENVELOPE, ...header, totalCount, items };
}

export const isSuccessResultCode = (code) => code.trim() === SUCCESS_RESULT_CODE;

// ── data.go.kr 게이트웨이 XML 오류(키 오류는 type=json 이어도 XML 로 온다, g2b.model.ts parseG2bGatewayError) ──
export function looksLikeXml(text) {
  return text.replace(/^[\s﻿]+/, "").startsWith("<");
}

export function parseG2bGatewayError(text) {
  if (!looksLikeXml(text)) return null;
  const code = /<returnReasonCode>([^<]*)<\/returnReasonCode>/.exec(text)?.[1]?.trim();
  if (code === undefined || !/^\d+$/.test(code)) return null;
  const authMsg = /<returnAuthMsg>([^<]*)<\/returnAuthMsg>/.exec(text)?.[1]?.trim();
  return {
    returnReasonCode: code,
    returnAuthMsg: authMsg !== undefined && /^[A-Z0-9_]+$/.test(authMsg) ? authMsg : null,
  };
}

// ── 재시도 대기 (retry.ts retryDelayMs). 429 는 이 스크립트에서 재시도하지 않고 멈추므로 backoff 만 옮겼다 ──
export function retryDelayMs(retryIndex, random = Math.random) {
  return RETRY_BASE_DELAY_MS * 2 ** retryIndex + Math.floor(random() * RETRY_JITTER_MAX_MS);
}

export const nonNegativeIntegerHeader = (value) =>
  value !== null && value !== undefined && /^\d+$/.test(value.trim()) ? Number(value) : null;

// ── 정보화 필터 (g2b-filter.ts isInfoBizNoticeBroad, 사용자 결정 C3-1·ADR-029 A4) ──
export const INFO_BIZ_SUCSFBID_MARKER = "SW사업";
export const INFO_BIZ_CLASSIFICATION_KEYWORDS = ["정보시스템", "소프트웨어"];

const isStringContaining = (value, needle) => typeof value === "string" && value.includes(needle);

export const isInfoBizNoticeStrict = (item) => item.infoBizYn === "Y";

export function isInfoBizNoticeBroad(item) {
  return (
    isInfoBizNoticeStrict(item) ||
    isStringContaining(item.sucsfbidMthdNm, INFO_BIZ_SUCSFBID_MARKER) ||
    INFO_BIZ_CLASSIFICATION_KEYWORDS.some((keyword) =>
      isStringContaining(item.pubPrcrmntClsfcNm, keyword),
    )
  );
}

// ── 표본 추출: 기관 종류·예산 구간·마감 구간 층을 돌며 하나씩 뽑는다(결정적 seed) ──
export const CANCELLED_NOTICE_KIND = "취소공고";

const present = (value) => (typeof value === "string" && value.trim() !== "" ? value.trim() : null);

/** 수요기관 코드 첫 글자. 공식 기관 분류가 아니라 분포를 고르게 하기 위한 대용 기준이다. */
export const agencyClassOf = (item) => present(item.dminsttCd)?.slice(0, 1) ?? "?";

export function budgetKrwOf(item) {
  const raw = present(item.asignBdgtAmt) ?? present(item.presmptPrce);
  return raw !== null && /^\d+$/.test(raw) ? Number(raw) : null;
}

export function budgetBucketOf(item) {
  const budget = budgetKrwOf(item);
  if (budget === null) return "unknown";
  if (budget < 1e8) return "lt-1e8";
  if (budget < 5e8) return "1e8-5e8";
  if (budget < 2e9) return "5e8-2e9";
  return "ge-2e9";
}

/** anchor(오늘 KST 00:00) 기준으로 마감이 없음·일찍 닫힘·최근 닫힘·열림. */
export function deadlineBucketOf(item, anchor) {
  const deadline = parseG2bLocalDateTime(item.bidClseDt);
  if (deadline === null) return "none";
  if (deadline.getTime() >= anchor.getTime()) return "open";
  const thirtyDaysMs = 30 * G2B_WINDOW_MAX_MS;
  return deadline.getTime() >= anchor.getTime() - thirtyDaysMs ? "closed-30d" : "closed-earlier";
}

export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

/** 공고번호마다 가장 큰 차수의 행 하나만 남긴다. 겹친 창에서 같은 행이 두 번 와도 하나다. */
export function latestByNotice(items) {
  const byNotice = new Map();
  for (const item of items) {
    const no = present(item.bidNtceNo);
    if (no === null) continue;
    const ord = present(item.bidNtceOrd) ?? "";
    const current = byNotice.get(no);
    if (current === undefined || ord > (present(current.bidNtceOrd) ?? "")) byNotice.set(no, item);
  }
  return [...byNotice.values()];
}

export function sampleStratified({ items, size, seed, anchor }) {
  const strata = new Map();
  for (const item of items) {
    const key = [agencyClassOf(item), budgetBucketOf(item), deadlineBucketOf(item, anchor)].join(
      "|",
    );
    if (!strata.has(key)) strata.set(key, []);
    strata.get(key).push(item);
  }
  const rank = (item) => sha256Hex(`${seed}:${item.bidNtceNo}`);
  const ordered = [...strata.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, members]) => ({
      key,
      members: members
        .map((item) => ({ item, rank: rank(item) }))
        .sort((left, right) => (left.rank < right.rank ? -1 : left.rank > right.rank ? 1 : 0))
        .map(({ item }) => item),
    }));
  const picked = [];
  for (let round = 0; picked.length < size; round += 1) {
    let took = false;
    for (const stratum of ordered) {
      if (picked.length >= size) break;
      const item = stratum.members[round];
      if (item === undefined) continue;
      picked.push({ item, stratum: stratum.key });
      took = true;
    }
    if (!took) break;
  }
  return { picked, strataCount: ordered.length };
}

export function distributionOf(items, keyOf) {
  const counts = new Map();
  for (const item of items) {
    const key = keyOf(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );
}
