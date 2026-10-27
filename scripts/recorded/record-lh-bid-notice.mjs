#!/usr/bin/env node
// record-lh-bid-notice.mjs — LH 입찰공고(15159012 getOpenBidInfo) 응답을 한 번 불러 가려 저장한다. 첫 실호출 검증용.
//
//   node --env-file=<키가 든 env 파일> scripts/recorded/record-lh-bid-notice.mjs --date 20261026 [--page 1] [--rows 10]
//   --dry-run 은 부르지 않고 할 일만 출력한다(키가 있는지만 본다).
//
// 지키는 것
//   - 한 번 실행에 정확히 1회만 부른다. 재시도하지 않는다. 결과 코드가 오류여도 그 응답을 가려 남기고 멈춘다.
//   - 키는 process.env.LH_BID_NOTICE_SERVICE_KEY 로만 받는다. 이 스크립트는 .env 파일을 읽지 않는다.
//   - 키·요청 URL 은 출력하지 않는다. 출력은 상태·결과 코드·건수·필드 이름·값 모양(자릿수)과 상태류 값 목록뿐이다.
//   - https://apis.data.go.kr/B552555/OpenBidInfoList/getOpenBidInfo 만 부른다. 리다이렉트는 따르지 않는다. 2 MiB·10초 상한.
//   - 담당자 칸(이름·전화·이메일 계열 태그)과 공개 명세에 없는 태그는 *** 로, 본문의 이메일·전화는 같은 길이 * 로 가린다.
//     저장 전·뒤 흔적 0건을 확인한다.
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_OUT = path.join(ROOT, "fixtures", "recorded", "15159012");
// 담당자 계열 태그(web/server/ingestion/external-payload.ts privateField 와 같은 낱말)
const CONTACT_TAG = /(?:ofcl|charger|chpsn|email|telno|telnum|fax|phone|hpno|exctvnm|crdtrnm)/i;
// 공개 명세(15159012 Swagger, 2026-10-27 열람)의 응답 태그와 data.go.kr 게이트웨이 오류 태그. 명세에 담당자 칸은 없다.
// 이 목록 밖의 태그는 값을 모르므로 *** 로 가리고 이름만 남긴다(실응답에 이름·연락처 칸이 더 있어도 저장되지 않게).
const KNOWN_TAGS = new Set([
  "response",
  "header",
  "resultCode",
  "resultMsg",
  "body",
  "items",
  "item",
  "pageNo",
  "numOfRows",
  "totalCount",
  "OpenAPI_ServiceResponse",
  "cmmMsgHeader",
  "errMsg",
  "returnAuthMsg",
  "returnReasonCode",
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
]);
const KNOWN_TAG_PATTERN =
  /^(?:zoneRstrct[1-4]|vndrrstrctNm[1-4]|req(?:10|[1-9])(?:MvgbNm|Reqlic(?:10|[1-9])Nm|LicctNm|BsncatGrpNm|LicGbNm))$/;
const knownTag = (tag) => KNOWN_TAGS.has(tag) || KNOWN_TAG_PATTERN.test(tag);
// 값 목록을 보여 줄 칸. 상태·분류라 개인정보가 아니고, 정규화 표(external-normalize-lh.ts)를 맞추는 데 쓴다.
const ENUM_TAGS = ["bidKind", "bidProgrsStatus", "zoneHqCd", "cstrtnJobGbNm", "tndrCtrctMedCd"];

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

/** 담당자 태그와 명세 밖 태그의 값은 ***, 나머지 글자는 이메일·전화 패턴만 가린다. 가린 태그 이름을 모은다 */
export function maskLhBody(raw) {
  const touched = new Set();
  const tagged = raw.replace(/<([A-Za-z_][\w.-]*)>([^<]*)<\/\1>/g, (whole, tag, value) => {
    if (value.trim() === "" || (knownTag(tag) && !CONTACT_TAG.test(tag))) return whole;
    touched.add(tag);
    return `<${tag}>${NAME_MASK}</${tag}>`;
  });
  const { text, changed } = maskContactPatterns(tagged);
  if (changed) touched.add("(pattern)");
  return { body: text, maskedFields: [...touched].sort() };
}

const tagValue = (text, tag) =>
  new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1]?.trim() ?? null;
const shapeOf = (value) =>
  value.trim() === "" ? "empty" : /^\d+$/.test(value) ? `digits:${value.length}` : "text";

/** 가린 본문의 요약. 값은 상태류(ENUM_TAGS)만 싣고 나머지는 모양만 싣는다 */
export function summarize(body) {
  const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => match[1]);
  const shapes = {};
  const enums = Object.fromEntries(ENUM_TAGS.map((tag) => [tag, new Set()]));
  for (const item of items) {
    for (const [, tag, value] of item.matchAll(/<([A-Za-z_][\w.-]*)>([^<]*)<\/\1>/g)) {
      (shapes[tag] ??= new Set()).add(shapeOf(value));
      if (tag in enums && value.trim() !== "") enums[tag].add(value.trim());
    }
  }
  return {
    resultCode: tagValue(body, "resultCode"),
    gatewayReasonCode: tagValue(body, "returnReasonCode"),
    totalCount: tagValue(body, "totalCount"),
    items: items.length,
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

/** 받은 바이트를 세며 읽고, 상한을 넘으면 그 자리에서 끊는다(content-length 가 없거나 틀려도) */
async function readBounded(response) {
  const tooLarge = () => new StopRecording("응답이 2 MiB 를 넘는다(저장하지 않았다)");
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
  return Buffer.concat(chunks).toString("utf8");
}

/** 한 번 부르고 가려 저장한다. 출력할 요약을 돌려준다(키·URL 없음) */
export async function recordOnce({ date, page, rows, out, dryRun, env, fetch, now }) {
  const key = env[LH_KEY_ENV]?.trim() ?? "";
  if (key === "") throw new StopRecording(`${LH_KEY_ENV} 가 없다(값은 출력하지 않는다)`);
  const params = requestParams({ date, page, rows });
  const url = requestUrl(key, params);
  const file = path.join(out, `getOpenBidInfo.${date}.p${page}.masked.json`);
  // 같은 녹음이 이미 있으면 부르기 전에 멈춘다(호출을 낭비하지 않는다)
  const exists = await access(file).then(
    () => true,
    () => false,
  );
  if (exists)
    throw new StopRecording(`이미 있는 녹음이다(부르지 않았다): ${path.relative(ROOT, file)}`);
  if (dryRun) return { dryRun: true, calls: 0, params, file: path.relative(ROOT, file) };

  const fetchedAt = now().toISOString();
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
  const { body, maskedFields } = maskLhBody(rawBody);
  const secrets = secretForms(key).concat(secretForms(decodeURIComponent(key)));
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
    note: "LH 첫 실호출 검증 녹음. 담당자 태그는 ***, 이메일·전화는 같은 길이 *.",
  };
  const text = `${JSON.stringify(recording, null, 2)}\n`;
  const before = scanProgramLeaks(text, secrets);
  if (hasProgramLeak(before))
    throw new StopRecording(`저장 전 흔적 검사 실패: ${JSON.stringify(before)}`);
  await mkdir(out, { recursive: true });
  await writeFile(file, text, { flag: "wx" });
  const after = scanProgramLeaks(await readFile(file, "utf8"), secrets);
  if (hasProgramLeak(after)) {
    await rm(file, { force: true });
    throw new StopRecording(
      `저장 뒤 흔적 검사 실패(파일을 지우고 멈췄다): ${JSON.stringify(after)}`,
    );
  }
  return {
    calls: 1,
    file: path.relative(ROOT, file),
    httpStatus: response.status,
    bytes: Buffer.byteLength(body),
    maskedFields,
    ...summarize(body),
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
