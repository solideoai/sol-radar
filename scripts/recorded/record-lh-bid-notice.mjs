#!/usr/bin/env node
// record-lh-bid-notice.mjs — LH 입찰공고(15159012 getOpenBidInfo) 응답을 한 번 불러 가려 저장한다. 첫 실호출 검증용.
//
//   node --env-file=<키가 든 env 파일> scripts/recorded/record-lh-bid-notice.mjs --date 20261026 [--page 1] [--rows 10]
//   --dry-run 은 부르지 않고 할 일만 출력한다(키가 있는지만 본다).
//
// 지키는 것
//   - 한 번 실행에 정확히 1회만 부른다. 재시도하지 않는다. 결과 코드가 오류여도 그 응답을 가려 남기고 멈춘다.
//   - 부르기 전에 저장 폴더에 시도 표식(getOpenBidInfo.attempt.json)을 남긴다. 표식이 있으면 날짜·쪽이 달라도
//     부르지 않는다. 다시 부르려면 사람이 승인을 받고 표식을 지운다(실패·재실행·컨테이너 재시작에도 추가 호출 없음).
//   - 키는 process.env.LH_BID_NOTICE_SERVICE_KEY 로만 받는다. 이 스크립트는 .env 파일을 읽지 않는다.
//   - 키·요청 URL 은 출력하지 않는다. 출력은 상태·결과 코드·건수·필드 이름·값 모양(자릿수)과 상태류 값 목록뿐이다.
//   - https://apis.data.go.kr/B552555/OpenBidInfoList/getOpenBidInfo 만 부른다. 리다이렉트는 따르지 않는다. 2 MiB·10초 상한.
//   - 응답에 키가 되돌아오면 어떤 형태든 *** 로 지운다. 공개 명세의 값 칸이 아닌 곳의 글자(담당자 태그·명세 밖 태그·
//     CDATA·속성·주석 포함)는 *** 로, 본문의 이메일·전화는 같은 길이 * 로 가린다. 저장 전·뒤 흔적 0건을 확인한다.
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

export const LH_ENDPOINT = "https://apis.data.go.kr/B552555/OpenBidInfoList/getOpenBidInfo";
export const LH_KEY_ENV = "LH_BID_NOTICE_SERVICE_KEY";
export const LH_RECORDED_SCHEMA_VERSION = "sol-external-recorded/v0.1";
export const ATTEMPT_MARKER = "getOpenBidInfo.attempt.json";
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_OUT = path.join(ROOT, "fixtures", "recorded", "15159012");
// 담당자 계열 태그(web/server/ingestion/external-payload.ts privateField 와 같은 낱말)
const CONTACT_TAG = /(?:ofcl|charger|chpsn|email|telno|telnum|fax|phone|hpno|exctvnm|crdtrnm)/i;
// 껍데기 태그. 값을 담지 않으므로 바로 아래 글자는 가린다.
const CONTAINER_TAGS = new Set([
  "response",
  "header",
  "body",
  "items",
  "item",
  "OpenAPI_ServiceResponse",
  "cmmMsgHeader",
]);
// 공개 명세(15159012 Swagger, 2026-10-27 열람)의 응답 항목 태그. 명세에 담당자 칸은 없다.
// 정규화(web/server/ingestion/external-normalize-lh.ts FIELDS)가 읽는 칸과 같다.
const SPEC_ITEM_TAGS = [
  "bidNum",
  "bidDegree",
  "cstrtnJobGbNm",
  "bidKind",
  "bidnmKor",
  "bidnmEng",
  "zoneHqCd",
  "bidProgrsStatus",
  "tndrCtrctMedCd",
  "tndrbidRegDt",
  "presmtPrc",
  "addtTax",
  "designPrc",
  "fdmtlAmt",
  "prcscoreExclusAmt",
  "sunjungNm",
  "gongdongNm",
  "cooperdocAcptEndDtm",
  "tndrdocAcptBgninDtm",
  "tndrdocAcptEndDtm",
  "openDtm",
  "antbsncatRstrctFg",
];
// 위 목록 + 껍데기 + data.go.kr 게이트웨이 오류 태그. 이 밖의 태그는 값을 모르므로 *** 로 가리고 이름만 남긴다.
const KNOWN_TAGS = new Set([
  ...CONTAINER_TAGS,
  "resultCode",
  "resultMsg",
  "pageNo",
  "numOfRows",
  "totalCount",
  "errMsg",
  "returnAuthMsg",
  "returnReasonCode",
  ...SPEC_ITEM_TAGS,
]);
const KNOWN_TAG_PATTERN =
  /^(?:zoneRstrct[1-4]|vndrrstrctNm[1-4]|req(?:10|[1-9])(?:MvgbNm|Reqlic(?:10|[1-9])Nm|LicctNm|BsncatGrpNm|LicGbNm))$/;
const knownTag = (tag) => KNOWN_TAGS.has(tag) || KNOWN_TAG_PATTERN.test(tag);
// 값을 그대로 남겨도 되는 칸: 명세에 있고, 껍데기가 아니고, 담당자 낱말이 없는 태그
const keepsValue = (tag) =>
  tag !== undefined && knownTag(tag) && !CONTAINER_TAGS.has(tag) && !CONTACT_TAG.test(tag);
// 값 목록을 보여 줄 칸. 상태·분류라 개인정보가 아니고, 정규화 표(external-normalize-lh.ts)를 맞추는 데 쓴다.
const ENUM_TAGS = ["bidKind", "bidProgrsStatus", "zoneHqCd", "cstrtnJobGbNm", "tndrCtrctMedCd"];
// 정규화가 없으면 격리하는 칸(공고번호·공고명·차수)과, 매핑 확인에 쓰는 칸(등록일·마감·추정가격)
const REQUIRED_TAGS = ["bidNum", "bidDegree", "bidnmKor"];
const CHECKED_TAGS = ["tndrbidRegDt", "tndrdocAcptEndDtm", "presmtPrc"];
// 다시 불러도 같은 결과라 바로 멈출 결과 코드(data.go.kr 게이트웨이 returnReasonCode 포함)
const STOP_CODES = {
  20: "활용신청 미승인·접근 거부",
  22: "하루 한도 초과",
  23: "초당 호출 한도 초과",
  30: "등록되지 않은 키",
  31: "기한이 지난 키",
  32: "등록되지 않은 IP",
};

export class StopRecording extends Error {}

export function parseArgs(argv) {
  const args = { date: null, page: 1, rows: 10, out: DEFAULT_OUT, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--date") args.date = argv[++index] ?? null;
    else if (arg === "--page") args.page = Number(argv[++index]);
    else if (arg === "--rows") args.rows = Number(argv[++index]);
    else if (arg === "--out") args.out = path.resolve(argv[++index] ?? "");
    else throw new StopRecording(`모르는 인자: ${arg}`);
  }
  if (!/^\d{8}$/.test(args.date ?? ""))
    throw new StopRecording("--date YYYYMMDD(KST 하루)가 필요하다");
  if (!Number.isInteger(args.page) || args.page < 1 || args.page > 5)
    throw new StopRecording("--page 는 1~5 다");
  if (!Number.isInteger(args.rows) || args.rows < 1 || args.rows > 100)
    throw new StopRecording("--rows 는 1~100 이다");
  return args;
}

/** 요청 변수(키 없음). 등록일 시작·끝을 같은 하루로 둔다 */
export const requestParams = ({ date, page, rows }) => ({
  pageNo: String(page),
  numOfRows: String(rows),
  tndrbidRegDtStart: date,
  tndrbidRegDtEnd: date,
});

/** 키는 Encoding·Decoding 어느 쪽이든 한 번 풀어 URLSearchParams 가 한 번만 인코딩하게 한다(worker/env.ts 와 같다) */
export function requestUrl(key, params) {
  let decoded;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    throw new StopRecording(`${LH_KEY_ENV} 형식 오류(값은 출력하지 않는다)`);
  }
  return `${LH_ENDPOINT}?${new URLSearchParams({ serviceKey: decoded, ...params }).toString()}`;
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

// 처리 지시·주석·CDATA·닫는 태그·여는 태그(속성·빈 태그 포함)·글자·짝 없는 "<"
const XML_TOKEN =
  /<\?[\s\S]*?\?>|<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)(\s[^<>]*?)?(\/?)>|([^<]+)|</g;

/**
 * 태그 이름을 따라가며 글자마다 남길지 정한다. 명세의 값 칸(keepsValue) 바로 아래 글자만 남기고, 나머지
 * 글자·CDATA·속성·주석은 *** 로 바꾼다. 그 뒤 이메일·전화 패턴을 같은 길이 * 로 가린다. 가린 태그 이름을 모은다.
 */
export function maskLhBody(raw) {
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
      if (keepsValue(parent)) return token;
      touched.add(parent ?? "(top)");
      return NAME_MASK;
    },
  );
  const { text, changed } = maskContactPatterns(masked);
  if (changed) touched.add("(pattern)");
  return { body: text, maskedFields: [...touched].sort() };
}

// 2026-10-27 실응답의 공고명은 "<bidnmKor><![CDATA[…]]> </bidnmKor>" 처럼 CDATA 앞뒤에 공백이 붙어 온다
const LEAF = /<([A-Za-z_][\w.-]*)>(?:\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*|([^<]*))<\/\1>/g;
const tagValue = (text, tag) => {
  for (const [, name, cdata, plain] of text.matchAll(LEAF))
    if (name === tag) return (cdata ?? plain).trim();
  return null;
};
const shapeOf = (value) =>
  value === "" ? "empty" : /^\d+$/.test(value) ? `digits:${value.length}` : "text";
// 정규화와 같은 기준으로 "없음"을 본다(빈 글자·"-")
const present = (value) => value !== undefined && !["", "-"].includes(value);
// 정규화가 격리하지 않을 행: 공고번호(공백 없는 1~64자)·공고명·차수(숫자 1~4자리)
const normalizable = (fields) =>
  /^\S{1,64}$/.test(fields.bidNum ?? "") &&
  present(fields.bidnmKor) &&
  /^\d{1,4}$/.test(fields.bidDegree ?? "");

/** 가린 본문의 요약. 값은 상태류(ENUM_TAGS)만 싣고 나머지는 모양만 싣는다 */
export function summarize(body) {
  const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) =>
    Object.fromEntries(
      [...match[1].matchAll(LEAF)].map(([, tag, cdata, plain]) => [tag, (cdata ?? plain).trim()]),
    ),
  );
  const shapes = {};
  const enums = Object.fromEntries(ENUM_TAGS.map((tag) => [tag, new Set()]));
  const seen = new Set();
  for (const fields of items)
    for (const [tag, value] of Object.entries(fields)) {
      seen.add(tag);
      (shapes[tag] ??= new Set()).add(shapeOf(value));
      if (tag in enums && value !== "") enums[tag].add(value);
    }
  const count = (tag) => `${items.filter((fields) => present(fields[tag])).length}/${items.length}`;
  return {
    resultCode: tagValue(body, "resultCode"),
    resultMsg: tagValue(body, "resultMsg"),
    gatewayReasonCode: tagValue(body, "returnReasonCode"),
    totalCount: tagValue(body, "totalCount"),
    items: items.length,
    requiredFields: Object.fromEntries(REQUIRED_TAGS.map((tag) => [tag, count(tag)])),
    checkedFields: Object.fromEntries(CHECKED_TAGS.map((tag) => [tag, count(tag)])),
    normalizable: `${items.filter(normalizable).length}/${items.length}`,
    // 매핑 비교: 명세 밖 태그(정규화가 읽지 않는다)와 정규화가 읽는데 어느 행에도 없던 명세 태그
    unknownTags: [...seen].filter((tag) => !knownTag(tag)).sort(),
    absentSpecTags: SPEC_ITEM_TAGS.filter((tag) => !seen.has(tag)),
    fieldShapes: Object.fromEntries(
      Object.entries(shapes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([tag, set]) => [tag, [...set].sort()]),
    ),
    enumValues: Object.fromEntries(
      Object.entries(enums).map(([tag, set]) => [tag, [...set].sort().slice(0, 30)]),
    ),
  };
}

/** 첫 실호출 판정(docs/plans/2026-10-27-lh-bid-notice-activation.md §3 판정 기준). 어느 판정이든 추가 호출은 하지 않는다 */
export function judge(summary, { httpStatus, rows }) {
  const verdict = (result, reason) => ({
    verdict: result,
    reason,
    next: "멈춤. 추가 호출은 결과 보고·승인 뒤에만",
  });
  const code = summary.resultCode ?? summary.gatewayReasonCode;
  if (code !== null && code in STOP_CODES)
    return verdict("FAILED", `결과 코드 ${code}: ${STOP_CODES[code]}`);
  if (code === null)
    return httpStatus === 200
      ? verdict("FORMAT_ISSUE", "결과 코드가 없다(XML 이 아니거나 구조가 다르다)")
      : verdict("FAILED", `HTTP ${httpStatus}, 결과 코드 없음`);
  if (code === "03") return verdict("EMPTY", "결과 코드 03(데이터 없음)");
  if (code !== "00") return verdict("FAILED", `모르는 결과 코드 ${code}`);
  if (httpStatus !== 200) return verdict("FORMAT_ISSUE", `결과 코드 00 인데 HTTP ${httpStatus}`);
  if (!/^\d+$/.test(summary.totalCount ?? ""))
    return verdict("FORMAT_ISSUE", "totalCount 가 숫자가 아니다");
  if (summary.items === 0)
    return summary.totalCount === "0"
      ? verdict("EMPTY", "결과 코드 00, totalCount 0")
      : verdict("FORMAT_ISSUE", `totalCount ${summary.totalCount} 인데 항목 0건`);
  if (summary.items > rows) return verdict("FORMAT_ISSUE", `요청 ${rows}건보다 많은 항목`);
  const [ready] = summary.normalizable.split("/");
  if (Number(ready) !== summary.items)
    return verdict(
      "FORMAT_ISSUE",
      `공고번호·공고명·차수가 맞는 행 ${summary.normalizable}(나머지는 정규화가 격리한다)`,
    );
  return verdict("SUCCESS", "결과 코드 00, 필수 칸이 모든 행에 있다");
}

// LH 는 text/xml;charset=EUC-KR 로 답한다(2026-10-27 실응답). Worker(external-api-connector.ts)와 같은 규칙으로 읽는다.
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
    // 깨진 글자(U+FFFD)로 바꿔 저장하면 원문을 되살릴 수 없다. 저장하지 않고 멈춘다.
    throw new StopRecording(`응답을 ${charset} 로 읽지 못했다(저장하지 않았다, 호출 1회로 센다)`);
  }
}

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );
const failureCode = (error) => error?.code ?? error?.name ?? "Error";

/**
 * 시도 표식을 원자적으로 만든다. "wx"(O_CREAT|O_EXCL)라 동시에 두 실행이 와도 하나만 만든다. 내용을 디스크까지
 * 내린(fsync) 뒤에 돌아온다. 무엇이든 실패하면 부르지 않고 멈춘다. 만든 뒤 쓰기가 실패해 빈 표식이 남아도 다음 실행을 막는다.
 */
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
export async function recordOnce({ date, page, rows, out, dryRun, env, fetch, now }) {
  const key = env[LH_KEY_ENV]?.trim() ?? "";
  if (key === "") throw new StopRecording(`${LH_KEY_ENV} 가 없다(값은 출력하지 않는다)`);
  const params = requestParams({ date, page, rows });
  const url = requestUrl(key, params);
  const file = path.join(out, `getOpenBidInfo.${date}.p${page}.masked.json`);
  const marker = path.join(out, ATTEMPT_MARKER);
  // 같은 녹음이나 시도 표식이 있으면 부르기 전에 멈춘다(호출을 낭비하지 않는다)
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
      params,
      file: path.relative(ROOT, file),
      attemptMarker: path.relative(ROOT, marker),
      outWritable: true,
    };
  }

  const fetchedAt = now().toISOString();
  // 표식을 먼저 남긴다. 아래에서 무엇이 실패해도(시간 초과·리다이렉트·흔적 검사) 다음 실행은 부르지 않는다.
  await claimAttempt(marker, `${JSON.stringify({ startedAt: fetchedAt, params })}\n`);
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
  const { body, maskedFields: tagMasks } = maskLhBody(redacted.text);
  const maskedFields = redacted.changed ? ["(secret)", ...tagMasks] : tagMasks;
  const recording = {
    schemaVersion: LH_RECORDED_SCHEMA_VERSION,
    serviceId: "15159012",
    operation: "getOpenBidInfo",
    params,
    fetchedAt,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    rawSha256: sha256Hex(rawBody),
    maskedFields,
    maskedBody: body,
    note: "LH 첫 실호출 검증 녹음. 키 흔적·명세 밖 글자·담당자 태그는 ***, 이메일·전화는 같은 길이 *.",
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
  const summary = summarize(body);
  return {
    calls: 1,
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
    console.error(`record-lh-bid-notice: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
