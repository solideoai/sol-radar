#!/usr/bin/env node
// record-kepco-contract.mjs — 한전 전자입찰계약(15148223, 전력데이터개방포털 electContract) 응답을 한 번 불러 가려 저장한다. 첫 실호출 검증용.
//
//   node scripts/recorded/record-kepco-contract.mjs --date 20261027 [--company COM01] [--out <폴더>]
//   --dry-run 은 부르지 않고 할 일만 출력한다(키가 있는지만 본다).
//
// 지키는 것(record-lh-bid-notice.mjs 와 같은 규칙)
//   - 한 번 실행에 정확히 1회만 부른다. 재시도하지 않는다. 오류 응답이어도 그 응답을 가려 남기고 멈춘다.
//   - 부르기 전에 저장 폴더에 시도 표식(electContract.attempt.json)을 남긴다. 표식이 있으면 날짜·회사가 달라도
//     부르지 않는다. 다시 부르려면 사람이 승인을 받고 표식을 지운다.
//   - 키는 process.env.KEPCO_EBID_CONTRACT_SERVICE_KEY 로만 받는다. 이 스크립트는 .env 파일을 읽지 않는다.
//     40자가 아니면 부르지 않는다(web/server/ingestion/external-request.ts API_KEY_LENGTH_INVALID 와 같은 규칙).
//   - 키·요청 URL 은 출력하지 않는다. 출력은 상태·결과 코드·건수·필드 이름·값 모양(자릿수)과 상태류 값 목록뿐이다.
//   - https://bigdata.kepco.co.kr/openapi/v1/electContract.do 만 부른다. 리다이렉트는 따르지 않는다. 2 MiB·10초 상한.
//   - 응답에 키가 되돌아오면 어떤 형태든 *** 로 지운다. JSON 이면 정규화가 읽는 칸·결과 껍데기 칸의 값만 남기고
//     나머지 값(담당자 칸 포함)은 *** 로, 남긴 글자의 이메일·전화는 같은 길이 * 로 가린다.
//     JSON 이 아니면 앞 2,000자만 남기고 이메일·전화를 가린다. 저장 전·뒤 흔적 0건을 확인한다.
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

export const KEPCO_ENDPOINT = "https://bigdata.kepco.co.kr/openapi/v1/electContract.do";
export const KEPCO_KEY_ENV = "KEPCO_EBID_CONTRACT_SERVICE_KEY";
export const KEPCO_RECORDED_SCHEMA_VERSION = "sol-external-recorded/v0.1";
export const ATTEMPT_MARKER = "electContract.attempt.json";
const KEY_LENGTH = 40;
const RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const NON_JSON_KEEP_CHARS = 2_000;
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_OUT = path.join(ROOT, "fixtures", "recorded", "15148223");
// 정규화(web/server/ingestion/external-normalize.ts KEPCO_ALIASES)가 읽는 칸. .mjs 라 TS 를 불러올 수 없어 옮겨 적는다.
export const SPEC_FIELDS = [
  "no",
  "name",
  "noticeDate",
  "progressState",
  "companyId",
  "bidAttendReqBeginDatetime",
  "bidAttendReqCloseDatetime",
  "beginDatetime",
  "endDatetime",
  "presumedPrice",
  "presumedAmount",
  "estimatedPriceBasicAmount",
  "etc",
  "bidAttendRestrict",
  "bidAttendDocument",
  "placeName",
  "competitionType",
  "bidType",
  "vendorAwardType",
  "jointSupplyDemandYn",
  ...[1, 2, 3, 4, 5].flatMap((slot) => [`filename${slot}`, `filenlink${slot}`]),
];
// 결과 껍데기에서 값을 남길 칸(결과 코드·메시지·건수). 명세를 열람하지 못해 흔한 이름을 모두 둔다.
const ENVELOPE_FIELDS = [
  "resultCode",
  "resultMsg",
  "code",
  "message",
  "msg",
  "errMsg",
  "totalCount",
  "count",
];
// 정규화가 아는 상태(external-normalize.ts STATES)와 회사 코드(external-connector.model.ts KEPCO_COMPANIES) 사본
const KNOWN_STATES = new Set([
  "PreAttendProgress",
  "AttendProgress",
  "Close",
  "Fail",
  "OpenTimed",
  "Final",
]);
export const KNOWN_COMPANIES = new Set(
  ["01", "02", "03", "04", "05", "06", "08", "09", "10", "11", "12", "14", "16", "19"].map(
    (code) => `COM${code}`,
  ),
);
// 값 목록을 보여 줄 칸. 상태·분류라 개인정보가 아니고, 정규화 표를 맞추는 데 쓴다.
const ENUM_FIELDS = [
  "progressState",
  "companyId",
  "competitionType",
  "bidType",
  "vendorAwardType",
  "jointSupplyDemandYn",
];
// 정규화가 없으면 격리하는 칸과, 매핑 확인에 쓰는 칸(공고일·마감·참가신청 마감·추정가격)
const REQUIRED_FIELDS = ["no", "name", "companyId", "progressState"];
const CHECKED_FIELDS = ["noticeDate", "endDatetime", "bidAttendReqCloseDatetime", "presumedPrice"];
// 공용 파서(web/server/ingestion/external-payload.ts)가 성공으로 보는 결과 코드
const SUCCESS_CODES = new Set(["00", "0000", "0", "200", "INFO-000"]);

const lower = (name) => name.toLowerCase();
const SPEC_LOWER = new Set(SPEC_FIELDS.map(lower));
const ENVELOPE_LOWER = new Set(ENVELOPE_FIELDS.map(lower));
// 허용 목록(명세 칸·껍데기 칸)의 값만 남긴다. 담당자 칸은 명세에 없으므로 이름과 상관없이 가려진다.
const keepsValue = (name) =>
  name !== null && (SPEC_LOWER.has(lower(name)) || ENVELOPE_LOWER.has(lower(name)));
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

export class StopRecording extends Error {}

export function parseArgs(argv) {
  const args = { date: null, company: null, out: DEFAULT_OUT, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--date") args.date = argv[++index] ?? null;
    else if (arg === "--company") args.company = argv[++index] ?? null;
    else if (arg === "--out") args.out = path.resolve(argv[++index] ?? "");
    else throw new StopRecording(`모르는 인자: ${arg}`);
  }
  if (!/^\d{8}$/.test(args.date ?? ""))
    throw new StopRecording("--date YYYYMMDD(공고일 하루)가 필요하다");
  if (args.company !== null && !KNOWN_COMPANIES.has(args.company))
    throw new StopRecording("--company 는 COM01 처럼 확인된 회사 코드다");
  return args;
}

/** 요청 변수(키 없음). 정기 회차처럼 회사 코드 없이 부르는 것이 기본이다(worker/ingest-queue.ts partition "all") */
export const requestParams = ({ date, company }) => ({
  noticeBeginDate: date,
  noticeEndDate: date,
  returnType: "json",
  ...(company === null ? {} : { companyId: company }),
});

/** external-request.ts 와 같은 순서·이름으로 만든다(키는 apiKey) */
export const requestUrl = (key, params) =>
  `${KEPCO_ENDPOINT}?${new URLSearchParams({ apiKey: key, ...params }).toString()}`;

/** 키가 응답에 되돌아온 자리를 어떤 형태든 *** 로 지운다. 긴 형태부터 바꿔 일부만 남지 않게 한다 */
export function redactSecrets(raw, secrets) {
  const forms = [...new Set(secrets.filter((secret) => secret !== ""))].sort(
    (a, b) => b.length - a.length,
  );
  let text = raw;
  for (const form of forms) text = text.split(form).join(NAME_MASK);
  return { text, changed: text !== raw };
}

/** 칸 이름을 따라가며 값을 남길지 정한다. 배열 안 값은 배열을 담은 칸의 이름을 따른다 */
function maskValue(value, name, touched) {
  if (Array.isArray(value)) return value.map((item) => maskValue(item, name, touched));
  if (isRecord(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, maskValue(inner, key, touched)]),
    );
  if (value === null || value === "") return value;
  if (keepsValue(name)) {
    if (typeof value !== "string") return value;
    const { text, changed } = maskContactPatterns(value);
    if (changed) touched.add(`${name}(pattern)`);
    return text;
  }
  touched.add(name ?? "(top)");
  return NAME_MASK;
}

/** 가린 본문(글자)과 가린 칸 이름. JSON 이 아니면 앞부분만 남긴다 */
export function maskKepcoBody(raw) {
  const touched = new Set();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    touched.add("(non-json)");
    if (raw.length > NON_JSON_KEEP_CHARS) touched.add("(truncated)");
    const { text, changed } = maskContactPatterns(raw.slice(0, NON_JSON_KEEP_CHARS));
    if (changed) touched.add("(pattern)");
    return { body: text, json: false, maskedFields: [...touched].sort() };
  }
  const masked = maskValue(parsed, null, touched);
  return { body: JSON.stringify(masked), json: true, maskedFields: [...touched].sort() };
}

/** 처음 만나는 객체 배열(빈 배열 포함)과 그 경로. 공용 파서가 같은 자리를 읽는지 녹음 뒤 따로 맞춘다 */
function findRows(value, at = "(root)") {
  if (Array.isArray(value)) return value.every(isRecord) ? { path: at, rows: value } : null;
  if (!isRecord(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    const found = findRows(inner, at === "(root)" ? key : `${at}.${key}`);
    if (found !== null) return found;
  }
  return null;
}
/** 껍데기 칸(행 밖)의 첫 원시 값. 이름은 대소문자를 가리지 않는다 */
function envelopeValue(value, names) {
  if (!isRecord(value)) return null;
  for (const [key, inner] of Object.entries(value)) {
    if (names.includes(lower(key)) && (typeof inner === "string" || typeof inner === "number"))
      return String(inner);
    const nested = isRecord(inner) ? envelopeValue(inner, names) : null;
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
// 정규화와 같은 기준으로 "없음"을 본다(빈 글자·"-")
const present = (value) =>
  typeof value === "string" ? !["", "-"].includes(value.trim()) : value != null;
// 정규화가 격리하지 않을 행: 확인된 회사 코드·번호·이름·아는 상태
const normalizable = (fields, company) =>
  KNOWN_COMPANIES.has(fields.companyid ?? company ?? "") &&
  present(fields.no) &&
  present(fields.name) &&
  KNOWN_STATES.has(fields.progressstate ?? "");

/** 가린 본문의 요약. 값은 상태류(ENUM_FIELDS)만 싣고 나머지는 모양만 싣는다 */
export function summarize(body, { company = null } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { json: false, rowsPath: null, items: 0 };
  }
  const found = findRows(parsed);
  const rows = (found?.rows ?? []).map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [lower(key), value])),
  );
  const names = new Map(
    (found?.rows ?? []).flatMap((row) => Object.keys(row).map((key) => [lower(key), key])),
  );
  const shapes = {};
  const enums = Object.fromEntries(ENUM_FIELDS.map((name) => [lower(name), new Set()]));
  for (const fields of rows)
    for (const [name, value] of Object.entries(fields)) {
      (shapes[names.get(name) ?? name] ??= new Set()).add(shapeOf(value));
      if (name in enums && present(value)) enums[name].add(String(value));
    }
  const count = (name) =>
    `${rows.filter((fields) => present(fields[lower(name)])).length}/${rows.length}`;
  const seen = new Set(rows.flatMap((fields) => Object.keys(fields)));
  return {
    json: true,
    topLevelKeys: isRecord(parsed) ? Object.keys(parsed) : [],
    rowsPath: found?.path ?? null,
    resultCode: envelopeValue(parsed, ["resultcode", "code"]),
    resultMsg: envelopeValue(parsed, ["resultmsg", "message", "msg", "errmsg"]),
    totalCount: envelopeValue(parsed, ["totalcount", "count"]),
    items: rows.length,
    requiredFields: Object.fromEntries(REQUIRED_FIELDS.map((name) => [name, count(name)])),
    checkedFields: Object.fromEntries(CHECKED_FIELDS.map((name) => [name, count(name)])),
    normalizable: `${rows.filter((fields) => normalizable(fields, company)).length}/${rows.length}`,
    // 매핑 비교: 명세 밖 칸(정규화가 읽지 않는다)과 정규화가 읽는데 어느 행에도 없던 칸
    unknownFields: [...seen]
      .filter((name) => !SPEC_LOWER.has(name))
      .map((name) => names.get(name) ?? name)
      .sort(),
    absentSpecFields: SPEC_FIELDS.filter((name) => !seen.has(lower(name))),
    fieldShapes: Object.fromEntries(
      Object.entries(shapes)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, set]) => [name, [...set].sort()]),
    ),
    enumValues: Object.fromEntries(
      ENUM_FIELDS.map((name) => [name, [...enums[lower(name)]].sort().slice(0, 30)]),
    ),
  };
}

/** 첫 실호출 판정. 어느 판정이든 추가 호출은 하지 않는다 */
export function judge(summary, { httpStatus }) {
  const verdict = (result, reason) => ({
    verdict: result,
    reason,
    next: "멈춤. 추가 호출은 결과 보고·승인 뒤에만",
  });
  if (httpStatus === 401 || httpStatus === 403)
    return verdict("FAILED", `HTTP ${httpStatus}(인증·권한)`);
  if (!summary.json)
    return httpStatus === 200
      ? verdict("FORMAT_ISSUE", "JSON 이 아니다(returnType=json 무시 또는 오류 화면)")
      : verdict("FAILED", `HTTP ${httpStatus}, JSON 아님`);
  if (httpStatus !== 200) return verdict("FAILED", `HTTP ${httpStatus}`);
  if (summary.resultCode !== null && !SUCCESS_CODES.has(summary.resultCode))
    return verdict("FAILED", `결과 코드 ${summary.resultCode}`);
  if (summary.rowsPath === null) return verdict("FORMAT_ISSUE", "행 배열을 찾지 못했다");
  if (summary.items === 0) return verdict("EMPTY", `행 0건(${summary.rowsPath})`);
  const [ready] = summary.normalizable.split("/");
  if (Number(ready) !== summary.items)
    return verdict(
      "FORMAT_ISSUE",
      `회사 코드·번호·이름·상태가 맞는 행 ${summary.normalizable}(나머지는 정규화가 격리한다)`,
    );
  return verdict("SUCCESS", "필수 칸과 아는 상태가 모든 행에 있다");
}

// 헤더 charset 이 EUC-KR 계열이면 그대로 읽는다(record-lh-bid-notice.mjs 와 같은 규칙). 없으면 UTF-8.
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
export async function recordOnce({ date, company, out, dryRun, env, fetch, now }) {
  const key = env[KEPCO_KEY_ENV]?.trim() ?? "";
  if (key === "") throw new StopRecording(`${KEPCO_KEY_ENV} 가 없다(값은 출력하지 않는다)`);
  if (key.length !== KEY_LENGTH)
    throw new StopRecording(`${KEPCO_KEY_ENV} 가 ${KEY_LENGTH}자가 아니다(부르지 않았다)`);
  const params = requestParams({ date, company });
  const url = requestUrl(key, params);
  const file = path.join(
    out,
    `electContract.${date}${company === null ? "" : `.${company}`}.masked.json`,
  );
  const marker = path.join(out, ATTEMPT_MARKER);
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
  // 표식을 먼저 남긴다. 아래에서 무엇이 실패해도 다음 실행은 부르지 않는다.
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
  const secrets = secretForms(key);
  const redacted = redactSecrets(rawBody, secrets);
  const { body, maskedFields: fieldMasks } = maskKepcoBody(redacted.text);
  const maskedFields = redacted.changed ? ["(secret)", ...fieldMasks] : fieldMasks;
  const recording = {
    schemaVersion: KEPCO_RECORDED_SCHEMA_VERSION,
    serviceId: "15148223",
    operation: "electContract",
    params,
    fetchedAt,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    rawSha256: sha256Hex(rawBody),
    maskedFields,
    maskedBody: body,
    note: "KEPCO 첫 실호출 검증 녹음. 키 흔적·명세 밖 값·담당자 칸은 ***, 이메일·전화는 같은 길이 *.",
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
  const summary = summarize(body, { company });
  return {
    calls: 1,
    file: path.relative(ROOT, file),
    httpStatus: response.status,
    bytes: Buffer.byteLength(body),
    maskedFields,
    leakScan: after,
    ...judge(summary, { httpStatus: response.status }),
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
    console.error(`record-kepco-contract: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
