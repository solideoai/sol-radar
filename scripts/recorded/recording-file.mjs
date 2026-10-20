// 녹음 파일(`sol-recorded/v0.1`) 만들기·검사·읽기.
// 형식의 정본은 web/server/ingestion/recorded-api.ts 의 recordedResponseSchema 다. 여기서는 같은 키 집합을 strict 로 검사해
// RecordedApiConnector 가 그대로 재생할 수 있게 한다. 키를 더하거나 빼면 정본 zod 스키마(strictObject)가 거부한다.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { G2B_BID_NOTICE_MASK_TARGETS, maskItems } from "./masking.mjs";

export const RECORDED_SCHEMA_VERSION = "sol-recorded/v0.1";
export const RESPONSE_ENVELOPE = "response";
export const ERROR_ENVELOPE = "nkoneps.com.response.ResponseError";

const REQUIRED_KEYS = [
  "schemaVersion",
  "serviceId",
  "registryKey",
  "operation",
  "params",
  "fetchedAt",
  "httpStatus",
  "envelope",
  "resultCode",
  "resultMsg",
  "totalCount",
  "items",
  "masked",
  "maskedFields",
  "maskedFieldsNote",
  "rawSha256",
  "note",
];
const SHA256_HEX = /^[0-9a-f]{64}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** 정본 스키마와 같은 조건을 확인한다. 어긋나면 경로를 담아 던진다(값은 넣지 않는다). */
export function assertRecordedShape(recorded) {
  const problems = [];
  if (!isRecord(recorded)) throw new Error("녹음은 객체여야 한다");
  const keys = Object.keys(recorded);
  for (const key of REQUIRED_KEYS) if (!keys.includes(key)) problems.push(`${key}: 없음`);
  for (const key of keys)
    if (!REQUIRED_KEYS.includes(key)) problems.push(`${key}: 허용되지 않는 키`);
  if (recorded.schemaVersion !== RECORDED_SCHEMA_VERSION) problems.push("schemaVersion");
  for (const key of ["serviceId", "registryKey", "operation"]) {
    if (typeof recorded[key] !== "string" || recorded[key] === "") problems.push(key);
  }
  if (!isRecord(recorded.params)) problems.push("params");
  else {
    for (const [key, value] of Object.entries(recorded.params)) {
      if (typeof value !== "string") problems.push(`params.${key}: 문자열이 아니다`);
      if (key.toLowerCase() === "servicekey") problems.push("params: 서비스키 파라미터가 있다");
    }
  }
  if (typeof recorded.fetchedAt !== "string" || !ISO_DATETIME.test(recorded.fetchedAt))
    problems.push("fetchedAt");
  if (
    !Number.isInteger(recorded.httpStatus) ||
    recorded.httpStatus < 200 ||
    recorded.httpStatus > 599
  )
    problems.push("httpStatus");
  if (recorded.envelope !== RESPONSE_ENVELOPE && recorded.envelope !== ERROR_ENVELOPE)
    problems.push("envelope");
  if (typeof recorded.resultCode !== "string") problems.push("resultCode");
  if (typeof recorded.resultMsg !== "string") problems.push("resultMsg");
  const total = recorded.totalCount;
  if (!(total === null || (Number.isInteger(total) && total >= 0))) problems.push("totalCount");
  if (recorded.envelope === RESPONSE_ENVELOPE && total === null)
    problems.push("totalCount: response 봉투는 숫자다");
  if (!Array.isArray(recorded.items) || !recorded.items.every(isRecord)) problems.push("items");
  if (recorded.masked !== true) problems.push("masked");
  if (
    !Array.isArray(recorded.maskedFields) ||
    !recorded.maskedFields.every((field) => typeof field === "string")
  )
    problems.push("maskedFields");
  if (typeof recorded.maskedFieldsNote !== "string") problems.push("maskedFieldsNote");
  if (typeof recorded.rawSha256 !== "string" || !SHA256_HEX.test(recorded.rawSha256))
    problems.push("rawSha256");
  if (typeof recorded.note !== "string") problems.push("note");
  if (problems.length > 0) throw new Error(`녹음 형식이 잘못됐다: ${problems.join(", ")}`);
  return recorded;
}

export const sha256Of = (text) => createHash("sha256").update(text).digest("hex");

/**
 * 원본 응답 텍스트와 푼 봉투로 마스킹한 녹음 객체를 만든다. 원본 텍스트는 해시만 남긴다.
 * envelope 는 g2b-lib parseG2bEnvelope 의 결과({envelope, resultCode, resultMsg, totalCount, items}).
 */
export function buildRecording({
  serviceId,
  registryKey,
  operation,
  params,
  fetchedAt,
  httpStatus,
  rawText,
  envelope,
  note,
}) {
  const { items, maskedFields } = maskItems(envelope.items);
  const hasMasked = maskedFields.length > 0;
  return assertRecordedShape({
    schemaVersion: RECORDED_SCHEMA_VERSION,
    serviceId,
    registryKey,
    operation,
    params: { ...params },
    fetchedAt,
    httpStatus,
    envelope: envelope.envelope,
    resultCode: envelope.resultCode,
    resultMsg: envelope.resultMsg,
    totalCount: envelope.totalCount,
    items,
    masked: true,
    // C1 관례: 값이 있어 가린 필드가 있으면 그 목록, 없으면 서비스 기준 마스킹 대상 목록과 구분 메모.
    maskedFields: hasMasked ? maskedFields : [...G2B_BID_NOTICE_MASK_TARGETS],
    maskedFieldsNote: hasMasked
      ? "실제로 값이 있어 가린 필드"
      : "이 응답에는 담당자 필드가 없거나 비어 있음. 목록은 서비스 기준 마스킹 대상",
    rawSha256: sha256Of(rawText),
    note,
  });
}

export const serializeRecording = (recorded) => `${JSON.stringify(recorded, null, 2)}\n`;

/** 폴더의 녹음 파일(*.masked.json)을 오퍼레이션으로 걸러 읽는다. 형식이 틀린 파일은 조용히 건너뛰지 않고 던진다. */
export async function loadRecordings(dir, operation) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const prefix = `${operation}.`;
  const files = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".masked.json"))
    .sort();
  const recordings = [];
  for (const name of files) {
    const file = path.join(dir, name);
    const recorded = assertRecordedShape(JSON.parse(await readFile(file, "utf8")));
    if (recorded.operation !== operation)
      throw new Error(`파일 이름과 operation 이 다르다: ${name}`);
    recordings.push({ file: name, recorded });
  }
  return recordings;
}
