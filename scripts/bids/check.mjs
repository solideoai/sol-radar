import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { parse } from "yaml";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SCHEMA_VERSION = "sol-fixtures/v1.0";
const CALCULATION_DATE = "2026-10-16";
const IDS = Array.from({ length: 20 }, (_, index) => `FX-${String(index + 1).padStart(2, "0")}`);
const LIVE_IDS = ["FX-06", "FX-07", "FX-08", "FX-09", "FX-10"];
const STAGES = ["NOTICE", "PLAN", "PRE_SPEC"];
const BEHAVIORS = ["normal", "duplicate-delivery", "rate-limit-then-ok"];
const BATCHES = ["SEED", "LIVE"];
const STATUSES = ["OPEN", "AMENDED", "CANCELLED", "CLOSED"];
// 07 §6.2 분포 표(07:384). 최종 revision 기준 기대 결과다.
const STAGE_COUNTS = { NOTICE: 16, PLAN: 2, PRE_SPEC: 2 };
const OUTCOME_COUNTS = {
  BID: 4,
  WATCH: 10,
  NO_BID: 2,
  CANCELLED: 1,
  QUARANTINED: 1,
  EARLY_TRACK: 2,
};
// Task 7 검증 예외와 07:255 예산 텍스트가 읽는 태그라 빠지면 안 된다.
const REQUIRED_TAGS = {
  "FX-07": ["r1-WATCH-68"],
  "FX-13": ["citation-mismatch-1", "budget-text"],
};
const RELATIVE_DATE = /^[+-]\d+d$/;
const BUDGET_TEXT = /^[\d,]+(백만원|천원|억원|억|원)$/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /0\d{1,2}-\d{3,4}-\d{4}/;

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
const sameList = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((id, index) => id === expected[index]);
const sameSet = (left, right) =>
  left.size === right.size && [...left].every((value) => right.has(value));

// 키 이름은 보지 않고 값만 훑는다.
function* strings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (isRecord(value)) for (const item of Object.values(value)) yield* strings(item);
}

function checkPii(bids, add) {
  for (const [fixtureId, bid] of Object.entries(bids))
    for (const text of strings(bid)) {
      // 합성 주소는 `.invalid` 만 허용한다(RFC 2606, 실제로 배달되지 않는다).
      if ([...text.matchAll(EMAIL)].some(([email]) => !email.endsWith(".invalid")))
        add("PII_EMAIL", fixtureId);
      if (PHONE.test(text)) add("PII_PHONE", fixtureId);
    }
}

function checkManifest(manifest, add) {
  if (manifest.schemaVersion !== SCHEMA_VERSION || manifest.calculationDate !== CALCULATION_DATE)
    add("MANIFEST_SCHEMA");
  // 순서와 중복까지 본다: 정확히 FX-01~FX-20 한 번씩.
  const { batches } = manifest;
  if (
    !sameList(
      manifest.fixtures.map((entry) => entry.id),
      IDS,
    ) ||
    !isRecord(batches) ||
    !sameList(batches.SEED, IDS) ||
    !sameList(batches.LIVE, LIVE_IDS) ||
    Object.keys(batches).length !== BATCHES.length
  )
    add("MANIFEST_IDS");
  for (const { id, tags } of manifest.fixtures)
    if ((REQUIRED_TAGS[id] ?? []).some((tag) => !Array.isArray(tags) || !tags.includes(tag)))
      add("TAGS_REQUIRED", id);
}

function checkDistribution(entries, add) {
  const matches = (key, getValue) =>
    Object.entries(key).every(
      ([value, count]) => entries.filter((entry) => getValue(entry) === value).length === count,
    );
  if (
    !matches(STAGE_COUNTS, (entry) => entry.stage) ||
    !matches(OUTCOME_COUNTS, (entry) => entry.expected?.outcome)
  )
    add("DISTRIBUTION");
}

function checkRecord(record, context, add) {
  const { fixtureId, tags, isCancelledOutcome, isLast } = context;
  if (!isRecord(record)) return add("FIXTURE_SCHEMA_INVALID", fixtureId);
  const matches = (value, pattern) => typeof value === "string" && pattern.test(value);
  if (!matches(record.amendmentNo, /^\d{2}$/)) add("AMENDMENT_NO", fixtureId);
  if (!matches(record.noticeId, /^DEMO-2026-\d{4}$/)) add("NOTICE_ID", fixtureId);
  if (record.planRef !== null && !matches(record.planRef, /^DEMO-PLAN-\d{4}$/))
    add("PLAN_REF", fixtureId);
  for (const key of ["noticeDate", "deadlineAt"])
    if (record[key] !== null && !matches(record[key], RELATIVE_DATE))
      add("RELATIVE_DATE", fixtureId);
  const { budgetKrw } = record;
  if (
    budgetKrw !== null &&
    !matches(budgetKrw, /^\d+$/) &&
    !(tags.includes("budget-text") && matches(budgetKrw, BUDGET_TEXT))
  )
    add("BUDGET_FORMAT", fixtureId);
  if (record.sourceUrl !== `https://demo.sol-radar.invalid/notices/${fixtureId}`)
    add("SOURCE_URL", fixtureId);
  if (!STAGES.includes(record.stage)) add("STAGE", fixtureId);
  if (record.status !== undefined && !STATUSES.includes(record.status))
    add("STATUS_INVALID", fixtureId);
  // 취소 표시는 expected 가 CANCELLED 인 FX 의 마지막 개정에만 있다.
  if (record.status === "CANCELLED" && !(isCancelledOutcome && isLast))
    add("CANCEL_STATUS", fixtureId);
}

function checkBid(fixtureId, bid, entry, manifestBatches, add) {
  if (!isRecord(bid) || !Array.isArray(bid.records) || !bid.records.length)
    return add("FIXTURE_SCHEMA_INVALID", fixtureId);
  if (bid.fixtureId !== fixtureId) add("FIXTURE_ID", fixtureId);
  if (bid.isDemo !== true) add("NOT_DEMO", fixtureId);
  if (!STAGES.includes(bid.stage) || bid.stage !== entry.stage) add("STAGE", fixtureId);
  if (!BEHAVIORS.includes(bid.connectorBehavior)) add("CONNECTOR_BEHAVIOR", fixtureId);
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  const isCancelledOutcome = entry.expected?.outcome === "CANCELLED";
  const lastIndex = bid.records.length - 1;
  bid.records.forEach((record, index) =>
    checkRecord(record, { fixtureId, tags, isCancelledOutcome, isLast: index === lastIndex }, add),
  );
  if (isCancelledOutcome && bid.records[lastIndex]?.status !== "CANCELLED")
    add("CANCEL_STATUS", fixtureId);
  // 레코드가 실린 배치 집합 = manifest 가 이 FX 를 넣은 배치 집합.
  if (!sameSet(new Set(bid.records.map((record) => record?.ingestBatch)), manifestBatches))
    add("BATCH_MISMATCH", fixtureId);
  // 제목 없음은 격리(QUARANTINED) 시나리오 전용이다.
  if (
    !bid.records.every((record) => isText(record?.title)) &&
    entry.expected?.outcome !== "QUARANTINED"
  )
    add("TITLE_MISSING", fixtureId);
}

/** 디스크를 모르는 순수 검사. `data` 는 `{ manifest, bids }`(bids 는 FX-ID → 공고 JSON). */
export function validateBidFixtures(data) {
  const errors = [];
  const add = (code, fixtureId) => {
    const safeId =
      typeof fixtureId === "string" && /^FX-\d{2}$/.test(fixtureId) ? fixtureId : undefined;
    if (!errors.some((error) => error.code === code && error.fixtureId === safeId))
      errors.push(safeId ? { code, fixtureId: safeId } : { code });
  };
  const manifest = data?.manifest;
  if (
    !isRecord(manifest) ||
    !Array.isArray(manifest.fixtures) ||
    !manifest.fixtures.every(isRecord) ||
    !isRecord(data.bids)
  ) {
    add("FIXTURE_SCHEMA_INVALID");
    return { ok: false, errors };
  }
  checkManifest(manifest, add);
  checkDistribution(manifest.fixtures, add);
  if (Object.keys(data.bids).some((key) => !IDS.includes(key))) add("MANIFEST_IDS");
  const batchesOf = (fixtureId) =>
    new Set(
      BATCHES.filter(
        (name) =>
          Array.isArray(manifest.batches?.[name]) && manifest.batches[name].includes(fixtureId),
      ),
    );
  for (const entry of manifest.fixtures) {
    if (!IDS.includes(entry.id)) continue;
    if (data.bids[entry.id] === undefined) add("FIXTURE_MISSING", entry.id);
    else checkBid(entry.id, data.bids[entry.id], entry, batchesOf(entry.id), add);
  }
  checkPii(data.bids, add);
  return { ok: errors.length === 0, errors };
}

/** manifest.yaml 과 bids/*.json 을 읽는다. 실패하면 던진다(경로는 호출자가 숨긴다). */
export async function loadBidFixtures({ root = ROOT } = {}) {
  const dir = path.join(root, "fixtures");
  const manifest = parse(await readFile(path.join(dir, "manifest.yaml"), "utf8"));
  const files = (await readdir(path.join(dir, "bids"))).filter((name) => name.endsWith(".json"));
  const bids = Object.fromEntries(
    await Promise.all(
      files.map(async (name) => [
        name.slice(0, -".json".length),
        JSON.parse(await readFile(path.join(dir, "bids", name), "utf8")),
      ]),
    ),
  );
  return { manifest, bids };
}

export async function checkBidFixtures({ root = ROOT } = {}) {
  try {
    return validateBidFixtures(await loadBidFixtures({ root }));
  } catch {
    return { ok: false, errors: [{ code: "FIXTURE_READ_FAILED" }] };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await checkBidFixtures();
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
