#!/usr/bin/env node
// record-datagokr.mjs — data.go.kr 외부 서비스(K-water·LH 사전규격·조달요청) 응답을 한 번 불러 가려 저장한다. 첫 실호출 검증용.
//
//   node scripts/recorded/record-datagokr.mjs --target <대상> (--month YYYYMM | --from YYYYMMDD --to YYYYMMDD) [--rows 10] [--out <폴더>]
//   --dry-run 은 부르지 않고 할 일만 출력한다(키가 있는지만 본다). 대상 목록은 아래 TARGETS.
//
// 지키는 것(record-lh-bid-notice.mjs 와 같은 규칙)
//   - 한 번 실행에 정확히 1회만 부른다. 재시도하지 않는다. 결과 코드가 오류여도 그 응답을 가려 남기고 멈춘다.
//   - 부르기 전에 저장 폴더에 대상별 시도 표식(<대상>.attempt.json)을 남긴다. 표식이 있으면 기간이 달라도 부르지 않는다.
//   - 키는 대상의 env 이름으로만 받는다. 이 스크립트는 .env 파일을 읽지 않는다.
//   - 키·요청 URL 은 출력하지 않는다. 출력은 결과 코드·건수·필드 이름·값 모양과 상태류 값 목록뿐이다.
//   - 대상의 고정 주소만 부른다. 리다이렉트는 따르지 않는다. 2 MiB·10초 상한.
//   - 응답에 키가 되돌아오면 어떤 형태든 *** 로 지운다. 공식 명세(data.go.kr Swagger, 2026-10-28 열람)의 응답 칸과
//     결과 껍데기 칸의 값만 남기고 나머지(담당자 이름·사번·전화·이메일 칸 포함)는 *** 로, 남긴 글자의
//     이메일·전화는 같은 길이 * 로 가린다. 저장 전·뒤 흔적 0건을 확인한다.
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { NAME_MASK } from "./masking.mjs";
import {
  hasProgramLeak,
  maskContactPatterns,
  scanProgramLeaks,
  secretForms,
  sha256Hex,
} from "./program-notices-lib.mjs";

export const RECORDED_SCHEMA_VERSION = "sol-external-recorded/v0.1";
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

const monthParams = (window, rows) => ({
  pageNo: "1",
  numOfRows: String(rows),
  _type: "json",
  searchDt: window.month,
});
/**
 * 대상별 고정 주소·키 env·요청 변수와 공식 명세의 응답 칸. 명세에 있어도 담당자 칸은 fields 에 넣지 않는다(가려진다).
 * required 는 정규화가 행을 식별하는 데 쓸 칸, enums 는 값 목록을 보여 줄 상태·분류 칸이다.
 */
export const TARGETS = {
  // K-water 전자조달 입찰공고 — 용역. 명세 담당자 칸: intnChargerNm
  "kwater-bid-servc": {
    serviceId: "15101635",
    keyEnv: "KWATER_BID_NOTICE_SERVICE_KEY",
    url: "https://apis.data.go.kr/B500001/ebid/tndr3/servcList",
    window: "month",
    params: monthParams,
    fields: [
      "cntrctDivNm",
      "tndrPblancDe",
      "tndrPblancEnddt",
      "tndrPartcptEntrpsCo",
      "tndrPrqudoCo",
      "tndrPlnprc",
      "cntrctDeptNm",
      "tndrPbanno",
      "tndrPblancNm",
      "ctrmthdCdNm",
      "tndrStat",
    ],
    required: ["tndrPbanno", "tndrPblancNm", "tndrPblancDe"],
    enums: ["cntrctDivNm", "ctrmthdCdNm", "tndrStat"],
  },
  // K-water 전자조달 발주계획 — 용역. 명세 담당자 칸: chargerEmpno·chargerTelno
  "kwater-plan-servc": {
    serviceId: "15102588",
    keyEnv: "KWATER_PROCUREMENT_PLAN_SERVICE_KEY",
    url: "https://apis.data.go.kr/B500001/ebid/ordg2/servc",
    window: "month",
    params: monthParams,
    fields: [
      "cntrctDivNm",
      "ordgYearMonth",
      "requstDeptNm",
      "tndrPblancNm",
      "prcureCtrpd",
      "cntrwkam",
      "ctrmthdNm",
    ],
    required: ["tndrPblancNm", "ordgYearMonth"],
    enums: ["cntrctDivNm", "ctrmthdNm"],
  },
  // LH 사전규격공개정보 — 의견 등록 마감일 기간. XML 만 낸다. 명세 담당자 칸: chpsnEmail·chpsnTelNum
  "lh-pre-spec": {
    serviceId: "15159011",
    keyEnv: "LH_PRE_SPECIFICATION_SERVICE_KEY",
    url: "https://apis.data.go.kr/B552555/OpenAdvcinfoReqList/getOpenAdvcinfoReqList",
    window: "range",
    params: (window, rows) => ({
      pageNo: "1",
      numOfRows: String(rows),
      opinionRegEndDtmStart: window.from,
      opinionRegEndDtmEnd: window.to,
    }),
    fields: [
      "gdsnm",
      "dlvgdsTmlmt",
      "dlvgdsSpot",
      "deliveryCdtn",
      "assignBudgetAmt",
      "opinionRegEndDtm",
      "cstrtnJobGbNm",
      "inadvcStddztNm",
      "revertDeptNm",
    ],
    required: ["inadvcStddztNm", "opinionRegEndDtm"],
    enums: ["cstrtnJobGbNm"],
  },
  // 나라장터 조달요청 — 일반용역 목록(조회구분 1 + 기간). 명세 담당자 칸: prcrmntReqOfclEmpNo·prcrmntReqOfclNm
  "g2b-procurement-request-gnrl": {
    serviceId: "15129468",
    keyEnv: "G2B_PROCUREMENT_REQUEST_SERVICE_KEY",
    url: "https://apis.data.go.kr/1230000/ao/PrcrmntReqInfoService/getPrcrmntReqInfoListGnrlServc",
    window: "range",
    params: (window, rows) => ({
      pageNo: "1",
      numOfRows: String(rows),
      type: "json",
      inqryDiv: "1",
      inqryBgnDt: `${window.from}0000`,
      inqryEndDt: `${window.to}2359`,
    }),
    fields: [
      "bsnsDivNm",
      "prcrmntReqNo",
      "cntrctCnclsStleNm",
      "rprsntDlvrPlce",
      "orderInsttCd",
      "orderInsttNm",
      "leaseYn",
      "rcptDt",
      "prcrmntReqNm",
      "rprsntPrdctClsfcNoNm",
      "rprsntUprc",
      "rprsntQty",
      "rprsntAmt",
      "bdgtAmt",
      "prcrmntReqInfoUrl",
      "rprsntUnit",
      "rprsntSpecDtlsCntnts",
      "rprsntDedtDate",
      "rprsntDlvrDaynum",
      "rprsntPrdctidntno",
      "frstyearUntyCntrctIdntNo",
      "inptDt",
    ],
    required: ["prcrmntReqNo", "prcrmntReqNm"],
    enums: ["bsnsDivNm", "cntrctCnclsStleNm"],
  },
};

// 응답 껍데기에서 값을 남길 칸. data.go.kr 게이트웨이 오류(OpenAPI_ServiceResponse)의 칸도 넣는다.
const ENVELOPE_FIELDS = [
  "resultCode",
  "resultMsg",
  "totalCount",
  "pageNo",
  "numOfRows",
  "errMsg",
  "returnAuthMsg",
  "returnReasonCode",
];
// 껍데기 태그·객체. 값을 담지 않으므로 바로 아래 글자는 가린다.
const CONTAINERS = new Set([
  "response",
  "header",
  "body",
  "items",
  "item",
  "OpenAPI_ServiceResponse",
  "cmmMsgHeader",
]);
// 다시 불러도 같은 결과라 바로 멈출 결과 코드(data.go.kr 게이트웨이 returnReasonCode 포함)
const STOP_CODES = {
  12: "서비스 없음·폐기",
  20: "활용신청 미승인·접근 거부",
  22: "하루 한도 초과",
  23: "초당 호출 한도 초과",
  30: "등록되지 않은 키",
  31: "기한이 지난 키",
  32: "등록되지 않은 IP",
};

const lower = (name) => name.toLowerCase();
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const keeperOf = (target) => {
  const keep = new Set([...target.fields, ...ENVELOPE_FIELDS].map(lower));
  return (name) => name !== null && name !== undefined && keep.has(lower(name));
};

export class StopRecording extends Error {}

export function parseArgs(argv) {
  const args = { target: null, month: null, from: null, to: null, rows: 10, dryRun: false };
  let out = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--target") args.target = argv[++index] ?? null;
    else if (arg === "--month") args.month = argv[++index] ?? null;
    else if (arg === "--from") args.from = argv[++index] ?? null;
    else if (arg === "--to") args.to = argv[++index] ?? null;
    else if (arg === "--rows") args.rows = Number(argv[++index]);
    else if (arg === "--out") out = path.resolve(argv[++index] ?? "");
    else throw new StopRecording(`모르는 인자: ${arg}`);
  }
  const target = TARGETS[args.target ?? ""];
  if (target === undefined)
    throw new StopRecording(`--target 은 ${Object.keys(TARGETS).join("·")} 중 하나다`);
  if (target.window === "month") {
    if (!/^\d{6}$/.test(args.month ?? "") || args.from !== null || args.to !== null)
      throw new StopRecording("이 대상은 --month YYYYMM 만 받는다");
  } else if (
    args.month !== null ||
    !/^\d{8}$/.test(args.from ?? "") ||
    !/^\d{8}$/.test(args.to ?? "") ||
    args.from > args.to
  )
    throw new StopRecording("이 대상은 --from YYYYMMDD --to YYYYMMDD(from ≤ to)만 받는다");
  if (!Number.isInteger(args.rows) || args.rows < 1 || args.rows > 100)
    throw new StopRecording("--rows 는 1~100 이다");
  return { ...args, out: out ?? path.join(ROOT, "fixtures", "recorded", target.serviceId) };
}

/** 키는 Encoding·Decoding 어느 쪽이든 한 번 풀어 URLSearchParams 가 한 번만 인코딩하게 한다(worker/env.ts 와 같다) */
export function requestUrl(target, key, params) {
  let decoded;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    throw new StopRecording(`${target.keyEnv} 형식 오류(값은 출력하지 않는다)`);
  }
  return `${target.url}?${new URLSearchParams({ serviceKey: decoded, ...params }).toString()}`;
}

/** 키가 응답에 되돌아온 자리를 어떤 형태든 *** 로 지운다. 긴 형태부터 바꿔 일부만 남지 않게 한다 */
export function redactSecrets(raw, secrets) {
  const forms = [...new Set(secrets.filter((secret) => secret !== ""))].sort(
    (a, b) => b.length - a.length,
  );
  let text = raw;
  for (const form of forms) text = text.split(form).join(NAME_MASK);
  return { text, changed: text !== raw };
}

function maskJsonValue(value, name, keeps, touched) {
  if (Array.isArray(value)) return value.map((item) => maskJsonValue(item, name, keeps, touched));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, maskJsonValue(inner, key, keeps, touched)]),
    );
  if (value === null || value === "") return value;
  if (keeps(name) && !CONTAINERS.has(name)) {
    if (typeof value !== "string") return value;
    const { text, changed } = maskContactPatterns(value);
    if (changed) touched.add(`${name}(pattern)`);
    return text;
  }
  touched.add(name ?? "(top)");
  return NAME_MASK;
}

// 처리 지시·주석·CDATA·닫는 태그·여는 태그(속성·빈 태그 포함)·글자·짝 없는 "<"(record-lh-bid-notice.mjs 와 같다)
const XML_TOKEN =
  /<\?[\s\S]*?\?>|<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)(\s[^<>]*?)?(\/?)>|([^<]+)|</g;

function maskXml(raw, keeps) {
  const touched = new Set();
  const stack = [];
  const masked = raw.replace(
    XML_TOKEN,
    (token, comment, cdata, closing, opening, attributes, selfClosing, text) => {
      if (token.startsWith("<?")) return token;
      if (comment !== undefined) {
        if (comment.trim() === "") return token;
        touched.add("(comment)");
        return `<!--${NAME_MASK}-->`;
      }
      if (closing !== undefined) {
        if (stack.at(-1) === closing) stack.pop();
        else touched.add("(unbalanced)");
        return token;
      }
      if (opening !== undefined) {
        if (selfClosing === "") stack.push(opening);
        if (attributes === undefined || attributes.trim() === "") return token;
        touched.add(`${opening}(attribute)`);
        return `<${opening}${selfClosing}>`;
      }
      const value = cdata ?? text ?? token;
      if (value.trim() === "") return token;
      const parent = stack.at(-1);
      if (keeps(parent) && !CONTAINERS.has(parent)) return token;
      touched.add(parent ?? "(top)");
      return NAME_MASK;
    },
  );
  const { text, changed } = maskContactPatterns(masked);
  if (changed) touched.add("(pattern)");
  return { body: text, maskedFields: [...touched].sort() };
}

/** 가린 본문과 가린 칸 이름. JSON 으로 읽히면 JSON, 아니면 XML 규칙으로 가린다 */
export function maskBody(target, raw) {
  const keeps = keeperOf(target);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { format: "xml", ...maskXml(raw, keeps) };
  }
  const touched = new Set();
  const masked = maskJsonValue(parsed, null, keeps, touched);
  return { format: "json", body: JSON.stringify(masked), maskedFields: [...touched].sort() };
}

// ── 요약 ──
const LEAF = /<([A-Za-z_][\w.-]*)>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*|([^<]*))<\/\1>/g;
function xmlRows(body) {
  return [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(LEAF)].map(([, tag, cdata, plain]) => [tag, (cdata ?? plain).trim()]),
    ),
  );
}
const xmlValue = (body, tag) => {
  for (const [, name, cdata, plain] of body.matchAll(LEAF))
    if (name === tag) return (cdata ?? plain).trim();
  return null;
};
/** JSON 의 body.items(.item) 또는 처음 만나는 객체 배열. 단건이면 배열로 감싼다 */
function jsonRows(parsed) {
  const root = isRecord(parsed) ? (parsed.response ?? parsed) : parsed;
  const body = isRecord(root) ? (root.body ?? root) : root;
  let rows = isRecord(body) ? (body.items ?? body.item) : undefined;
  if (isRecord(rows) && rows.item !== undefined) rows = rows.item;
  if (isRecord(rows)) rows = [rows];
  if (Array.isArray(rows)) return rows.filter(isRecord);
  return [];
}
function jsonValue(value, name) {
  if (!isRecord(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (lower(key) === lower(name) && (typeof inner === "string" || typeof inner === "number"))
      return String(inner);
    const nested = jsonValue(inner, name);
    if (nested !== null) return nested;
  }
  return null;
}
const shapeOf = (value) => {
  if (typeof value !== "string") return value === null ? "null" : typeof value;
  if (value === "") return "empty";
  if (value === NAME_MASK) return "masked";
  if (/^\d+$/.test(value)) return `digits:${value.length}`;
  if (/^\d{4}[-./]\d{2}[-./]\d{2}/.test(value)) return `date:${value.length}`;
  return "text";
};
const present = (value) =>
  typeof value === "string" ? !["", "-"].includes(value.trim()) : value != null;

/** 가린 본문의 요약. 값은 상태류(enums)만 싣고 나머지는 모양만 싣는다 */
export function summarize(target, format, body) {
  let rows;
  let value;
  if (format === "json") {
    const parsed = JSON.parse(body);
    rows = jsonRows(parsed);
    value = (name) => jsonValue(parsed, name);
  } else {
    rows = xmlRows(body);
    value = (name) => xmlValue(body, name);
  }
  const shapes = {};
  const enums = Object.fromEntries(target.enums.map((name) => [name, new Set()]));
  const seen = new Set();
  for (const fields of rows)
    for (const [name, inner] of Object.entries(fields)) {
      seen.add(name);
      (shapes[name] ??= new Set()).add(shapeOf(inner));
      if (name in enums && present(inner) && inner !== NAME_MASK) enums[name].add(String(inner));
    }
  const count = (name) => `${rows.filter((fields) => present(fields[name])).length}/${rows.length}`;
  const specLower = new Set(target.fields.map(lower));
  return {
    format,
    resultCode: value("resultCode") ?? value("returnReasonCode"),
    resultMsg: value("resultMsg") ?? value("returnAuthMsg") ?? value("errMsg"),
    totalCount: value("totalCount"),
    items: rows.length,
    requiredFields: Object.fromEntries(target.required.map((name) => [name, count(name)])),
    identified: `${rows.filter((fields) => target.required.every((name) => present(fields[name]))).length}/${rows.length}`,
    unknownFields: [...seen].filter((name) => !specLower.has(lower(name))).sort(),
    absentSpecFields: target.fields.filter((name) => !seen.has(name)),
    fieldShapes: Object.fromEntries(
      Object.entries(shapes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, set]) => [name, [...set].sort()]),
    ),
    enumValues: Object.fromEntries(
      Object.entries(enums).map(([name, set]) => [name, [...set].sort().slice(0, 30)]),
    ),
  };
}

/** 첫 실호출 판정. 어느 판정이든 추가 호출은 하지 않는다 */
export function judge(summary, { httpStatus, rows }) {
  const verdict = (result, reason) => ({
    verdict: result,
    reason,
    next: "멈춤. 추가 호출은 결과 보고·승인 뒤에만",
  });
  const code = summary.resultCode;
  if (code !== null && code in STOP_CODES)
    return verdict("FAILED", `결과 코드 ${code}: ${STOP_CODES[code]}`);
  if (code === null)
    return httpStatus === 200
      ? verdict("FORMAT_ISSUE", "결과 코드가 없다(구조가 다르다)")
      : verdict("FAILED", `HTTP ${httpStatus}, 결과 코드 없음`);
  if (code === "03") return verdict("EMPTY", "결과 코드 03(데이터 없음)");
  if (code !== "00") return verdict("FAILED", `모르는 결과 코드 ${code}`);
  if (httpStatus !== 200) return verdict("FORMAT_ISSUE", `결과 코드 00 인데 HTTP ${httpStatus}`);
  if (summary.items === 0)
    return summary.totalCount === "0"
      ? verdict("EMPTY", "결과 코드 00, totalCount 0")
      : verdict("FORMAT_ISSUE", `totalCount ${summary.totalCount} 인데 항목 0건`);
  if (summary.items > rows) return verdict("FORMAT_ISSUE", `요청 ${rows}건보다 많은 항목`);
  const [ready] = summary.identified.split("/");
  if (Number(ready) !== summary.items)
    return verdict("FORMAT_ISSUE", `식별 칸이 다 있는 행 ${summary.identified}`);
  return verdict("SUCCESS", "결과 코드 00, 식별 칸이 모든 행에 있다");
}

// 헤더 charset 이 EUC-KR 계열이면 그대로 읽는다(LH 는 EUC-KR). 없으면 UTF-8.
const EUC_KR_LABELS = new Set(["euc-kr", "ks_c_5601-1987", "windows-949"]);
const charsetOf = (contentType) => {
  const label = /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType ?? "")?.[1]?.toLowerCase();
  return label !== undefined && EUC_KR_LABELS.has(label) ? "euc-kr" : "utf-8";
};

/** 받은 바이트를 세며 읽고, 상한을 넘으면 그 자리에서 끊는다(content-length 가 없거나 틀려도) */
async function readBounded(response) {
  const tooLarge = () =>
    new StopRecording("응답이 2 MiB 를 넘는다(저장하지 않았다, 호출 1회로 센다)");
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const charset = charsetOf(response.headers.get("content-type"));
  try {
    return new TextDecoder(charset, { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new StopRecording(`응답을 ${charset} 로 읽지 못했다(저장하지 않았다, 호출 1회로 센다)`);
  }
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const failureCode = (error) => error?.code ?? error?.name ?? "Error";

/** 시도 표식을 원자적으로 만든다("wx" + fsync). 무엇이든 실패하면 부르지 않고 멈춘다 */
async function claimAttempt(marker, content) {
  let handle;
  try {
    await mkdir(path.dirname(marker), { recursive: true });
    handle = await open(marker, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
  } catch (error) {
    throw new StopRecording(`시도 표식을 남기지 못해 부르지 않았다: ${failureCode(error)}`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/** --dry-run 용. 저장 폴더에 새 파일을 만들 수 있는지 임시 파일로 보고 지운다(표식은 만들지 않는다) */
async function probeWritable(out) {
  const probe = path.join(out, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    await mkdir(out, { recursive: true });
    const handle = await open(probe, "wx", 0o600);
    await handle.close();
    await rm(probe, { force: true });
  } catch (error) {
    throw new StopRecording(`저장 폴더에 쓸 수 없다(부르지 않는다): ${failureCode(error)}`);
  }
}

/** 한 번 부르고 가려 저장한다. 출력할 요약을 돌려준다(키·URL 없음) */
export async function recordOnce({
  target: name,
  month,
  from,
  to,
  rows,
  out,
  dryRun,
  env,
  fetch,
  now,
}) {
  const target = TARGETS[name];
  const key = env[target.keyEnv]?.trim() ?? "";
  if (key === "") throw new StopRecording(`${target.keyEnv} 가 없다(값은 출력하지 않는다)`);
  const params = target.params({ month, from, to }, rows);
  const url = requestUrl(target, key, params);
  const operation = new URL(target.url).pathname.split("/").at(-1);
  const period = target.window === "month" ? month : `${from}-${to}`;
  const file = path.join(out, `${operation}.${period}.masked.json`);
  const marker = path.join(out, `${name}.attempt.json`);
  if (await exists(file))
    throw new StopRecording(`이미 있는 녹음이다(부르지 않았다): ${path.relative(ROOT, file)}`);
  if (await exists(marker))
    throw new StopRecording(
      `이미 한 번 시도했다(부르지 않았다): ${path.relative(ROOT, marker)}. 추가 호출은 승인 뒤 사람이 표식을 지운다`,
    );
  if (dryRun) {
    await probeWritable(out);
    return {
      dryRun: true,
      calls: 0,
      target: name,
      params,
      file: path.relative(ROOT, file),
      attemptMarker: path.relative(ROOT, marker),
      outWritable: true,
    };
  }

  const fetchedAt = now().toISOString();
  // 표식을 먼저 남긴다. 아래에서 무엇이 실패해도 다음 실행은 부르지 않는다.
  await claimAttempt(marker, `${JSON.stringify({ startedAt: fetchedAt, target: name, params })}\n`);
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // 예외 메시지에는 요청 URL(키 포함)이 실릴 수 있다. 이름만 남긴다.
    throw new StopRecording(`요청 실패: ${error?.name ?? "Error"} (호출 1회로 센다)`);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    throw new StopRecording(`리다이렉트 ${response.status} — 따르지 않고 멈춘다(호출 1회로 센다)`);
  }
  const rawBody = await readBounded(response);
  const secrets = secretForms(key).concat(secretForms(decodeURIComponent(key)));
  const redacted = redactSecrets(rawBody, secrets);
  const { format, body, maskedFields: fieldMasks } = maskBody(target, redacted.text);
  const maskedFields = redacted.changed ? ["(secret)", ...fieldMasks] : fieldMasks;
  const recording = {
    schemaVersion: RECORDED_SCHEMA_VERSION,
    serviceId: target.serviceId,
    operation,
    params,
    fetchedAt,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    rawSha256: sha256Hex(rawBody),
    maskedFields,
    maskedBody: body,
    note: "첫 실호출 검증 녹음. 키 흔적·명세 밖 값·담당자 칸은 ***, 이메일·전화는 같은 길이 *.",
  };
  const text = `${JSON.stringify(recording, null, 2)}\n`;
  const before = scanProgramLeaks(text, secrets);
  if (hasProgramLeak(before))
    throw new StopRecording(`저장 전 흔적 검사 실패(저장하지 않았다): ${JSON.stringify(before)}`);
  await writeFile(file, text, { flag: "wx" });
  const after = scanProgramLeaks(await readFile(file, "utf8"), secrets);
  if (hasProgramLeak(after)) {
    await rm(file, { force: true });
    throw new StopRecording(
      `저장 뒤 흔적 검사 실패(파일을 지우고 멈췄다): ${JSON.stringify(after)}`,
    );
  }
  const summary = summarize(target, format, body);
  return {
    calls: 1,
    target: name,
    file: path.relative(ROOT, file),
    httpStatus: response.status,
    bytes: Buffer.byteLength(body),
    maskedFields,
    leakScan: after,
    ...judge(summary, { httpStatus: response.status, rows }),
    ...summary,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const summary = await recordOnce({ ...args, env: process.env, fetch, now: () => new Date() });
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    const message =
      error instanceof StopRecording ? error.message : `예상 못 한 오류: ${error?.name ?? "Error"}`;
    console.error(`record-datagokr: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
