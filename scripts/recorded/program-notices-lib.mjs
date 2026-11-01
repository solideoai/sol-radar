// 부처 지원사업 공고 녹음(ADR-040)의 순수 규칙: 요청 URL·가림·녹음 형식·흔적 검사.
// 형식의 정본은 web/server/program-notices/recording.ts 의 recordingSchema(`sol-program-recorded/v0.1`)다.
// 여기서는 같은 키 집합을 strict 로 검사해 worker 의 mock·fixture 모드가 그대로 재생하게 한다.
// 주소·호스트 규칙은 web/server/program-notices/http.ts 와 infra/sources/program-notices.yaml 과 같다(.mjs 라 TS 를 불러올 수 없어 옮겨 적는다).
import { createHash } from "node:crypto";
import {
  EMAIL_PATTERN,
  NAME_MASK,
  PHONE_PATTERN,
  PATTERN_SUFFIX,
  sameLengthStars,
} from "./masking.mjs";

export const PROGRAM_RECORDED_SCHEMA_VERSION = "sol-program-recorded/v0.1";
export const PROGRAM_NOTICE_HOSTS = ["www.bizinfo.go.kr", "mss.go.kr", "apis.data.go.kr"];
export const BIZINFO_BASE_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
export const MSS_RSS_URL = "https://mss.go.kr/rss/smba/board/310.do";
// 과학기술정보통신부 사업공고(공공데이터포털 15074634). 공고번호·신청기간은 응답에 없다.
export const MSIT_BASE_URL =
  "https://apis.data.go.kr/1721000/msitannouncementinfo/businessAnnouncMentList";
export const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
export const REQUEST_TIMEOUT_MS = 10_000;

const FILE_STEMS = { bizinfo: "api", mss: "rss-310", msit: "api" };
// 기업마당 문의처, 과기정통부 담당자 이름·전화는 통째로 가린다(화면·DB 에도 넣지 않는다).
const CONTACT_FIELDS = new Set(["refrncNm", "managerName", "managerTel"]);
const BODY_FIELD = "(body)";
// 대표번호 1588-1234 같은 15xx·16xx·18xx(web/server/program-notices/text.ts 와 같은 규칙).
export const REPRESENTATIVE_PATTERN =
  /(?<![\d,.-])1[568]\d{2}-\d{4}(?![\d\-만천억원년명개곳회건])/g;
// 인증키 파라미터 이름(기업마당 crtfcKey, 공공데이터포털 ServiceKey). 녹음 params 에 있으면 형식 오류다.
const KEY_PARAMS = ["crtfckey", "servicekey"];
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** 이메일·전화·대표번호를 같은 길이의 * 로 바꾼다. */
export function maskContactPatterns(text) {
  let changed = false;
  const hit = (match) => {
    changed = true;
    return sameLengthStars(match);
  };
  const masked = text
    .replace(EMAIL_PATTERN, hit)
    .replace(PHONE_PATTERN, hit)
    .replace(REPRESENTATIVE_PATTERN, hit);
  return { text: masked, changed };
}

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON 값을 훑어 문의처는 ***, 나머지 문자열은 패턴만 가린다. 바꾼 필드 이름을 모은다. */
function maskJsonValue(value, key, touched) {
  if (typeof value === "string") {
    if (key !== null && CONTACT_FIELDS.has(key) && value !== "") {
      touched.add(key);
      return NAME_MASK;
    }
    const { text, changed } = maskContactPatterns(value);
    if (changed) touched.add(`${key ?? BODY_FIELD}${PATTERN_SUFFIX}`);
    return text;
  }
  if (Array.isArray(value)) return value.map((item) => maskJsonValue(item, key, touched));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, maskJsonValue(item, name, touched)]),
    );
  }
  return value;
}

/** JSON 본문(기업마당·과기정통부) 가리기. JSON 이 아니면 본문 글자에서 패턴만 가린다. */
export function maskJsonBody(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return maskMssBody(raw);
  }
  const touched = new Set();
  const masked = maskJsonValue(parsed, null, touched);
  return { body: JSON.stringify(masked), maskedFields: [...touched].sort() };
}

/** 중기부 RSS 본문 가리기(원문 글자 그대로, 패턴만). */
export function maskMssBody(raw) {
  const { text, changed } = maskContactPatterns(raw);
  return { body: text, maskedFields: changed ? [`${BODY_FIELD}${PATTERN_SUFFIX}`] : [] };
}

/** 기업마당 요청 파라미터(키 없음). infra/sources/program-notices.yaml 의 categories·maxItems 를 받는다. */
export const bizinfoParams = ({ categories, maxItems }) => ({
  dataType: "json",
  searchCnt: String(maxItems),
  searchLclasId: categories.join(","),
});

/** 실제 요청 URL. 키가 실리므로 출력·파일에 쓰지 않는다. */
export function bizinfoRequestUrl(key, params) {
  const url = new URL(BIZINFO_BASE_URL);
  url.searchParams.set("crtfcKey", key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/** 과기정통부 요청 파라미터(키 없음). infra/sources/program-notices.yaml 의 maxItems 를 받는다. 회차당 1쪽만 부른다. */
export const msitParams = ({ maxItems }) => ({
  pageNo: "1",
  numOfRows: String(maxItems),
  returnType: "json",
});

/**
 * 실제 요청 URL. env 값은 포털의 Encoding 키다. 한 번 풀어 URLSearchParams 가 한 번만 인코딩하게 한다
 * (web/worker/env.ts readG2bServiceKey 와 같다). 깨진 퍼센트 열이면 던진다. 키가 실리므로 출력·파일에 쓰지 않는다.
 */
export function msitRequestUrl(envValue, params) {
  const url = new URL(MSIT_BASE_URL);
  url.searchParams.set("ServiceKey", decodeURIComponent(envValue));
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

export function isAllowedProgramUrl(raw) {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return (
    url.protocol === "https:" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    PROGRAM_NOTICE_HOSTS.includes(url.hostname)
  );
}

export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

export function buildProgramRecording({
  source,
  params,
  fetchedAt,
  httpStatus,
  contentType,
  rawBody,
  maskedBody,
  maskedFields,
  note,
}) {
  return {
    schemaVersion: PROGRAM_RECORDED_SCHEMA_VERSION,
    source,
    params,
    fetchedAt,
    httpStatus,
    contentType,
    body: maskedBody,
    rawSha256: sha256Hex(rawBody),
    masked: true,
    maskedFields,
    note,
  };
}

const REQUIRED_KEYS = [
  "schemaVersion",
  "source",
  "params",
  "fetchedAt",
  "httpStatus",
  "contentType",
  "body",
  "rawSha256",
  "masked",
  "maskedFields",
  "note",
];

/** 정본 스키마와 같은 조건을 본다. 어긋나면 경로를 담아 던진다(값은 넣지 않는다). */
export function assertProgramRecordingShape(recording) {
  if (!isRecord(recording)) throw new Error("녹음은 객체여야 한다");
  const problems = [];
  const keys = Object.keys(recording);
  for (const key of REQUIRED_KEYS) if (!keys.includes(key)) problems.push(`${key}: 없음`);
  for (const key of keys)
    if (!REQUIRED_KEYS.includes(key)) problems.push(`${key}: 허용되지 않는 키`);
  if (recording.schemaVersion !== PROGRAM_RECORDED_SCHEMA_VERSION) problems.push("schemaVersion");
  if (!Object.hasOwn(FILE_STEMS, recording.source)) problems.push("source");
  if (!isRecord(recording.params)) problems.push("params");
  else
    for (const [name, value] of Object.entries(recording.params)) {
      if (typeof value !== "string") problems.push(`params.${name}: 문자열이 아니다`);
      if (KEY_PARAMS.includes(name.toLowerCase())) problems.push("params: 인증키 파라미터가 있다");
    }
  if (typeof recording.fetchedAt !== "string" || !ISO_DATETIME.test(recording.fetchedAt))
    problems.push("fetchedAt");
  if (
    !Number.isInteger(recording.httpStatus) ||
    recording.httpStatus < 200 ||
    recording.httpStatus > 599
  )
    problems.push("httpStatus");
  for (const key of ["contentType", "body", "note"])
    if (typeof recording[key] !== "string") problems.push(key);
  if (typeof recording.rawSha256 !== "string" || !SHA256_HEX.test(recording.rawSha256))
    problems.push("rawSha256");
  if (recording.masked !== true) problems.push("masked");
  if (
    !Array.isArray(recording.maskedFields) ||
    recording.maskedFields.some((item) => typeof item !== "string")
  )
    problems.push("maskedFields");
  if (problems.length > 0) throw new Error(`녹음 형식 오류: ${problems.join(", ")}`);
}

export const serializeProgramRecording = (recording) => `${JSON.stringify(recording, null, 2)}\n`;

/** <소스 이름>.<KST YYYYMMDD>.masked.json */
export function recordingFileName(source, fetchedAt) {
  const kstDate = new Date(Date.parse(fetchedAt) + KST_OFFSET_MS)
    .toISOString()
    .slice(0, 10)
    .replaceAll("-", "");
  return `${FILE_STEMS[source]}.${kstDate}.masked.json`;
}

/** 키가 파일에 실릴 수 있는 네 형태: 원문·1회 인코딩·2회 인코딩·소문자 16진 1회 인코딩. */
export function secretForms(key) {
  if (typeof key !== "string" || key.trim() === "") return [];
  const once = encodeURIComponent(key);
  return [...new Set([key, once, encodeURIComponent(once), once.toLowerCase()])];
}

/** 저장할 글자에 남은 개인정보·키 흔적을 센다. 전부 0 이어야 한다. 값은 돌려주지 않는다. */
export function scanProgramLeaks(text, secrets = []) {
  const count = (pattern) => (text.match(pattern) ?? []).length;
  return {
    email: count(EMAIL_PATTERN),
    phone: count(PHONE_PATTERN),
    representative: count(REPRESENTATIVE_PATTERN),
    crtfcKey: count(/crtfckey/gi),
    secret: secrets.filter((secret) => secret !== "" && text.includes(secret)).length,
  };
}

export const hasProgramLeak = (scan) => Object.values(scan).some((value) => value > 0);
