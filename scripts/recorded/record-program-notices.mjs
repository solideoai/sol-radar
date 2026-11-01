#!/usr/bin/env node
// record-program-notices.mjs — 부처 지원사업 공고 응답을 가려 녹음한다(ADR-040, 스펙 §7). 한 번 실행에 1회만 부른다.
//
//   pnpm record:program-notices -- --source mss        중기부 사업공고 RSS(키 없음)
//   pnpm record:program-notices -- --source bizinfo    기업마당 지원사업 API(BIZINFO_API_KEY 필요)
//   pnpm record:program-notices -- --source msit       과기정통부 사업공고 API(MSIT_ANNOUNCEMENT_API_KEY 필요, 포털 Encoding 키)
//   옵션: --out <폴더>(기본 fixtures/recorded/program-notices) --dry-run(부르지 않고 할 일만 출력)
//
// 지키는 것
//   - 키는 process.env.BIZINFO_API_KEY·MSIT_ANNOUNCEMENT_API_KEY 로만 받는다. 이 스크립트는 .env 파일을 읽지 않는다.
//     키를 넣으려면 사용자가 자기 터미널에서 Node 의 --env-file 로 돌린다(README "부처 공고 녹음").
//   - 키·요청 URL·응답 본문은 출력하지 않는다. 출력은 파일 경로·상태 코드·크기·항목 수·가린 필드뿐이다.
//   - 허용 호스트(www.bizinfo.go.kr·mss.go.kr·apis.data.go.kr)의 https 만, 리다이렉트는 따르지 않는다(3xx 는 멈춘다). 2 MiB·10초 상한.
//   - 저장 전 가림(program-notices-lib.mjs), 저장 전·뒤 두 번 이메일·전화·대표번호·crtfcKey·키 형태 0건(과기정통부 ServiceKey 는 params 검사와 키 값 검사로 막는다)을 확인한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MSS_RSS_URL,
  REQUEST_TIMEOUT_MS,
  RESPONSE_MAX_BYTES,
  assertProgramRecordingShape,
  bizinfoParams,
  bizinfoRequestUrl,
  buildProgramRecording,
  hasProgramLeak,
  isAllowedProgramUrl,
  maskJsonBody,
  maskMssBody,
  msitParams,
  msitRequestUrl,
  recordingFileName,
  scanProgramLeaks,
  secretForms,
  serializeProgramRecording,
} from "./program-notices-lib.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DEFAULT_OUT = path.join(ROOT, "fixtures", "recorded", "program-notices");
// infra/sources/program-notices.yaml 의 기본값과 같다(분야 02 기술, 최대 100건).
const BIZINFO_SETTINGS = { categories: ["02"], maxItems: 100 };
// infra/sources/program-notices.yaml 의 과기정통부 기본값과 같다(최신 50건, 1쪽).
const MSIT_SETTINGS = { maxItems: 50 };
const SOURCES = ["mss", "bizinfo", "msit"];

class StopRecording extends Error {}

export function parseArgs(argv) {
  const args = { source: null, out: DEFAULT_OUT, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--source") args.source = argv[++index] ?? null;
    else if (arg === "--out") args.out = path.resolve(argv[++index] ?? "");
    else throw new StopRecording(`모르는 인자: ${arg}`);
  }
  if (!SOURCES.includes(args.source))
    throw new StopRecording("--source mss|bizinfo|msit 가 필요하다");
  return args;
}

/** 과기정통부 요청. 키가 없거나 깨진 퍼센트 열이면 멈춘다. 가릴 키 형태는 env 값과 디코딩 값 양쪽에서 만든다. */
function planMsitRequest(env) {
  const key = env.MSIT_ANNOUNCEMENT_API_KEY?.trim() ?? "";
  if (key === "")
    throw new StopRecording("MSIT_ANNOUNCEMENT_API_KEY 가 없다(값은 출력하지 않는다)");
  const params = msitParams(MSIT_SETTINGS);
  let url;
  try {
    url = msitRequestUrl(key, params);
  } catch {
    throw new StopRecording("MSIT_ANNOUNCEMENT_API_KEY 형식 오류(값은 출력하지 않는다)");
  }
  const secrets = [...new Set([...secretForms(key), ...secretForms(decodeURIComponent(key))])];
  return { url, params, secrets };
}

/** 소스별 요청. 기업마당·과기정통부는 키가 없으면 멈춘다. */
export function planRequest(source, env) {
  if (source === "mss") return { url: MSS_RSS_URL, params: {}, secrets: [] };
  if (source === "msit") return planMsitRequest(env);
  const key = env.BIZINFO_API_KEY?.trim() ?? "";
  if (key === "") throw new StopRecording("BIZINFO_API_KEY 가 없다(값은 출력하지 않는다)");
  const params = bizinfoParams(BIZINFO_SETTINGS);
  return { url: bizinfoRequestUrl(key, params), params, secrets: secretForms(key) };
}

async function readBounded(response) {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > RESPONSE_MAX_BYTES)
    throw new StopRecording("응답이 2 MiB 를 넘는다");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > RESPONSE_MAX_BYTES) throw new StopRecording("응답이 2 MiB 를 넘는다");
  return buffer.toString("utf8");
}

const itemCountOf = (source, body) => {
  if (source === "mss") return (body.match(/<item\b/gi) ?? []).length;
  // 과기정통부는 봉투 모양이 명세에 없다. 항목마다 하나 있는 제목 칸(subject)을 센다.
  if (source === "msit") return (body.match(/"subject"\s*:/g) ?? []).length;
  try {
    const envelope = JSON.parse(body).jsonArray;
    if (Array.isArray(envelope)) return envelope.length;
    if (Array.isArray(envelope?.item)) return envelope.item.length;
    return envelope?.item ? 1 : 0;
  } catch {
    return 0;
  }
};

/** 한 번 부르고 가려 저장한다. 출력할 요약을 돌려준다(키·URL·본문 없음). */
export async function recordOnce({ source, out, dryRun, env, fetch, now }) {
  const request = planRequest(source, env);
  if (!isAllowedProgramUrl(request.url)) throw new StopRecording("허용 호스트가 아니다");
  if (dryRun) return { dryRun: true, source, params: request.params };

  const fetchedAt = now().toISOString();
  let response;
  try {
    response = await fetch(request.url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    // 예외 메시지에는 요청 URL(키 포함)이 실릴 수 있다. 이름만 남긴다.
    throw new StopRecording(`요청 실패: ${error?.name ?? "Error"}`);
  }
  if (response.status >= 300 && response.status < 400)
    throw new StopRecording(`리다이렉트 ${response.status} — 따르지 않고 멈춘다`);
  if (!response.ok) throw new StopRecording(`HTTP ${response.status}`);
  const rawBody = await readBounded(response);
  const { body, maskedFields } = source === "mss" ? maskMssBody(rawBody) : maskJsonBody(rawBody);
  const recording = buildProgramRecording({
    source,
    params: request.params,
    fetchedAt,
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    rawBody,
    maskedBody: body,
    maskedFields,
    note: "ADR-040 부처 공고 녹음. 전화·이메일·대표번호는 같은 길이 *, 기업마당 문의처(refrncNm)·과기정통부 담당자(managerName·managerTel)는 ***.",
  });
  assertProgramRecordingShape(recording);
  const text = serializeProgramRecording(recording);
  const before = scanProgramLeaks(text, request.secrets);
  if (hasProgramLeak(before))
    throw new StopRecording(`저장 전 흔적 검사 실패: ${JSON.stringify(before)}`);

  const folder = path.join(out, source);
  const file = path.join(folder, recordingFileName(source, fetchedAt));
  await mkdir(folder, { recursive: true });
  await writeFile(file, text);
  const after = scanProgramLeaks(await readFile(file, "utf8"), request.secrets);
  if (hasProgramLeak(after))
    throw new StopRecording(`저장 뒤 흔적 검사 실패(파일을 지우고 다시 돌린다): ${file}`);
  return {
    file: path.relative(ROOT, file),
    httpStatus: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes: Buffer.byteLength(body),
    items: itemCountOf(source, body),
    maskedFields,
    leaks: after,
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
    console.error(`record-program-notices: ${message}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
