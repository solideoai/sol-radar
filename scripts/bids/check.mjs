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
// 예외 태그는 REQUIRED_TAGS 가 정한 FX 에만 허용한다.
const EXCEPTION_TAGS = ["citation-mismatch-1", "budget-text"];
// 앞선 개정이라 별도 추출 파일(FX-xx.rNN.json)이 반드시 있어야 하는 것(19:98 seed 가 미리 분석).
const REQUIRED_REVISION_EXTRACTIONS = ["FX-07.r01"];
const BUDGET_UNITS = { 백만원: 1e6, 천원: 1e3, 억원: 1e8, 억: 1e8, 원: 1 };
const URL_PATTERN = /https?:\/\/([^\s/:"'<>)]+)/g;
const RELATIVE_DATE = /^[+-]\d+d$/;
const BUDGET_TEXT = /^[\d,]+(백만원|천원|억원|억|원)$/;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /0\d{1,2}-\d{3,4}-\d{4}/;
// 03 §4.1 RequirementExtraction 의 값 필드. 배열 값을 갖는 것은 LIST_FIELDS 다.
const EXTRACTION_FIELDS = [
  "summary",
  "projectType",
  "domain",
  "requiredSkills",
  "preferredSkills",
  "qualifications",
  "pastPerformance",
  "staffing",
  "budgetKrw",
  "deadlineAt",
  "contractMethod",
  "restrictions",
  "submission",
];
const LIST_FIELDS = [
  "requiredSkills",
  "preferredSkills",
  "qualifications",
  "pastPerformance",
  "staffing",
  "restrictions",
];
const FIELD_STATES = ["KNOWN", "UNKNOWN", "NOT_APPLICABLE", "CONFLICTED"];
const QUOTE_MIN = 5;
const QUOTE_MAX = 300;
const MISMATCH_TAG = "citation-mismatch-1";
const CHOICES = ["BID", "WATCH", "NO_BID"];
const FIT_GRADES = { 0: "Very poor", 1: "Poor", 2: "Moderate", 3: "Good", 4: "Very good" };
const PROBABILITY_TOLERANCE = 1e-6;
// D10·D11: 추출은 QUARANTINED 를 뺀 전부, Kev·골든은 최소한 이 집합(07 §6.3, 08 §6.5).
const REQUIRED_KEV_IDS = ["FX-01", "FX-02", "FX-03", "FX-16"];
const REQUIRED_GOLDEN_IDS = ["FX-01", "FX-02", "FX-03"];
// 08 §6.5 요소 순서와 만점.
const GOLDEN_FACTORS = [
  ["skillMatch", 30],
  ["pastPerformance", 25],
  ["staffAvailability", 20],
  ["scaleFit", 15],
  ["strategicPreference", 10],
];

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.trim() !== "";
const sameList = (actual, expected) =>
  Array.isArray(actual) &&
  actual.length === expected.length &&
  actual.every((id, index) => id === expected[index]);
const isNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isUnit = (value) => isNumber(value) && value >= 0 && value <= 1;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const sameSet = (left, right) =>
  left.size === right.size && [...left].every((value) => right.has(value));

// 키 이름은 보지 않고 값만 훑는다.
function* strings(value) {
  if (typeof value === "string") yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (isRecord(value)) for (const item of Object.values(value)) yield* strings(item);
}

// 파일 이름 `FX-xx.rNN` 의 FX-ID.
const fixtureIdOf = (key) => key.match(/^(FX-\d{2})/)?.[1];

function checkPii(groups, add) {
  for (const [fixtureId, value] of groups)
    for (const text of strings(value)) {
      // 합성 주소는 `.invalid` 만 허용한다(RFC 2606, 실제로 배달되지 않는다).
      if ([...text.matchAll(EMAIL)].some(([email]) => !email.endsWith(".invalid")))
        add("PII_EMAIL", fixtureId);
      if (PHONE.test(text)) add("PII_PHONE", fixtureId);
      if ([...text.matchAll(URL_PATTERN)].some(([, host]) => !host.endsWith(".invalid")))
        add("PII_URL", fixtureId);
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
  for (const { id, tags } of manifest.fixtures) {
    const required = Object.hasOwn(REQUIRED_TAGS, id) ? REQUIRED_TAGS[id] : [];
    if (required.some((tag) => !Array.isArray(tags) || !tags.includes(tag)))
      add("TAGS_REQUIRED", id);
    if (
      Array.isArray(tags) &&
      tags.some((tag) => EXCEPTION_TAGS.includes(tag) && !required.includes(tag))
    )
      add("TAG_NOT_ALLOWED", id);
  }
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
  // 마지막 레코드가 마지막 개정이라는 전제(추출 대상): amendmentNo 는 줄지 않는다(같은 값 반복 허용).
  const numbers = bid.records.map((record) => record?.amendmentNo);
  if (numbers.some((no, index) => index > 0 && !(no >= numbers[index - 1])))
    add("RECORD_ORDER", fixtureId);
  if (bid.records.some((record) => record?.stage !== bid.stage)) add("RECORD_STAGE", fixtureId);
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

// 값 필드 하나의 모양: 03 §4.1 / 15 §2 상태 규칙(KNOWN 은 값, UNKNOWN 은 값·근거 없음).
function isValidField(name, field) {
  if (!isRecord(field) || !FIELD_STATES.includes(field.state) || !Array.isArray(field.evidence))
    return false;
  if (field.note !== undefined && (typeof field.note !== "string" || field.note.length > 200))
    return false;
  if (field.state !== "KNOWN")
    return field.value === null && (field.state !== "UNKNOWN" || !field.evidence.length);
  return LIST_FIELDS.includes(name) ? Array.isArray(field.value) : isText(field.value);
}

function isValidEvidence(item, revisionId) {
  return (
    isRecord(item) &&
    typeof item.quotedText === "string" &&
    item.documentId === null &&
    item.revisionId === revisionId &&
    isText(item.fetchedAt)
  );
}

function checkExtractionShape(fixtureId, extraction, record, add) {
  const revisionId = `${fixtureId}#${record.amendmentNo}`;
  const { model } = extraction;
  const isShapeOk =
    extraction.schemaVersion === "requirement-extraction/v0.1" &&
    extraction.bidId === fixtureId &&
    extraction.revisionId === revisionId &&
    isRecord(model) &&
    model.provider === "mock" &&
    model.promptVersion === "req-extract/v0.1" &&
    typeof extraction.injectionSuspected === "boolean" &&
    Array.isArray(extraction.warnings) &&
    extraction.warnings.every((warning) => typeof warning === "string") &&
    EXTRACTION_FIELDS.every((name) => isValidField(name, extraction[name])) &&
    EXTRACTION_FIELDS.every((name) =>
      extraction[name].evidence.every((item) => isValidEvidence(item, revisionId)),
    );
  if (!isShapeOk) add("EXTRACTION_SHAPE", fixtureId);
  return isShapeOk;
}

// 예산 문자열을 원 단위 정수 문자열로. 숫자 문자열은 그대로, 텍스트는 단위를 곱한다.
function normalizeBudget(value) {
  if (typeof value !== "string") return null;
  if (/^\d+$/.test(value)) return value;
  const matched = value.match(/^([\d,]+)(백만원|천원|억원|억|원)$/);
  return matched ? String(Number(matched[1].replaceAll(",", "")) * BUDGET_UNITS[matched[2]]) : null;
}

const quotesOf = (extraction) =>
  EXTRACTION_FIELDS.flatMap((name) => extraction[name].evidence.map((item) => item.quotedText));
const countMismatches = (extraction, record) =>
  quotesOf(extraction).filter(
    (quote) => typeof record.content !== "string" || !record.content.includes(quote),
  ).length;
// 태그가 있는 FX 는 본문에 없는 인용이 정확히 1건이어야 하고, 없는 FX 는 0건이다.
const isMismatchCountOk = (count, tags) =>
  tags.includes(MISMATCH_TAG) ? count === 1 : count === 0;
const isBudgetOk = (extraction, record) =>
  extraction.budgetKrw.state !== "KNOWN" ||
  (record.budgetKrw !== null &&
    normalizeBudget(record.budgetKrw) === normalizeBudget(extraction.budgetKrw.value));

// 인용 검사: 길이, KNOWN 의 근거, 본문 일치. 대상 레코드는 `FX-xx.json` 이면 마지막 개정,
// `FX-xx.rNN.json` 이면 amendmentNo NN 인 앞선 개정이다(마지막 개정의 rNN 은 중복이라 막는다).
function checkExtraction(fixtureId, extraction, bid, tags, add, revisionNo) {
  if (
    !isRecord(extraction) ||
    !isRecord(bid) ||
    !Array.isArray(bid.records) ||
    !bid.records.length
  ) {
    add("EXTRACTION_SHAPE", fixtureId);
    return false;
  }
  const last = bid.records.at(-1);
  const record =
    revisionNo === undefined
      ? last
      : revisionNo === last.amendmentNo
        ? undefined
        : bid.records.find((item) => item?.amendmentNo === revisionNo);
  if (!isRecord(record)) {
    add("EXTRACTION_REVISION", fixtureId);
    return false;
  }
  if (!checkExtractionShape(fixtureId, extraction, record, add)) return false;
  const fields = EXTRACTION_FIELDS.map((name) => extraction[name]);
  if (quotesOf(extraction).some((quote) => quote.length < QUOTE_MIN || quote.length > QUOTE_MAX))
    add("QUOTE_LENGTH", fixtureId);
  if (fields.some((field) => field.state === "KNOWN" && !field.evidence.length))
    add("KNOWN_WITHOUT_EVIDENCE", fixtureId);
  const mismatches = countMismatches(extraction, record);
  if (tags.includes(MISMATCH_TAG)) {
    if (mismatches !== 1) add("CITATION_MISMATCH_COUNT", fixtureId);
  } else if (mismatches > 0) add("CITATION_NOT_IN_CONTENT", fixtureId);
  if (!isBudgetOk(extraction, record)) add("BUDGET_MISMATCH", fixtureId);
  return true;
}

// rNN 파일이 없는 앞선 개정은 본파일이 대신 쓰인다(판정 19). 그 레코드와도 인용·예산이 맞아야 한다.
function checkFallbacks(fixtureId, extraction, bid, tags, revisionNos, add) {
  const last = bid.records.at(-1);
  const seen = new Set();
  for (const record of bid.records) {
    const no = record?.amendmentNo;
    if (!isRecord(record) || no === last.amendmentNo || revisionNos.includes(no) || seen.has(no))
      continue;
    seen.add(no);
    if (!isMismatchCountOk(countMismatches(extraction, record), tags))
      add("EXTRACTION_FALLBACK", fixtureId);
    if (!isBudgetOk(extraction, record)) add("BUDGET_MISMATCH", fixtureId);
  }
}

function checkProbabilities(probabilities, keys) {
  return (
    isRecord(probabilities) &&
    sameSet(new Set(Object.keys(probabilities)), new Set(keys)) &&
    keys.every((key) => isUnit(probabilities[key]))
  );
}
const sumsToOne = (probabilities, keys) =>
  Math.abs(sum(keys.map((key) => probabilities[key])) - 1) <= PROBABILITY_TOLERANCE;

function checkKevResponses(fixtureId, responses, add) {
  const { recommendation, mandatoryRisk, needsHumanReview, fit } = isRecord(responses)
    ? responses
    : {};
  const fitKeys = Object.keys(FIT_GRADES);
  const isShapeOk =
    isRecord(recommendation) &&
    CHOICES.includes(recommendation.choice) &&
    isUnit(recommendation.confidence) &&
    checkProbabilities(recommendation.probabilities, CHOICES) &&
    isRecord(mandatoryRisk) &&
    isUnit(mandatoryRisk.noul) &&
    isRecord(needsHumanReview) &&
    isUnit(needsHumanReview.noul) &&
    isRecord(fit) &&
    isUnit(fit.confidence) &&
    isRecord(fit.legend) &&
    fitKeys.every((key) => fit.legend[key] === FIT_GRADES[key]) &&
    Object.keys(fit.legend).length === fitKeys.length &&
    checkProbabilities(fit.probabilities, fitKeys);
  if (!isShapeOk) return add("KEV_SHAPE", fixtureId);
  // choice 는 확률 최댓값의 키다. 동률이면 그중 아무거나.
  const { probabilities } = recommendation;
  if (CHOICES.some((key) => probabilities[key] > probabilities[recommendation.choice]))
    add("KEV_SHAPE", fixtureId);
  if (!sumsToOne(probabilities, CHOICES) || !sumsToOne(fit.probabilities, fitKeys))
    add("KEV_PROBABILITY_SUM", fixtureId);
  // 03:491 wire score = 0 부터 센 평균 등급 index.
  const mean = sum(fitKeys.map((key) => Number(key) * fit.probabilities[key]));
  if (
    !isNumber(fit.score) ||
    fit.score < 0 ||
    fit.score > 4 ||
    Math.abs(fit.score - mean) > PROBABILITY_TOLERANCE
  )
    add("KEV_FIT", fixtureId);
}

// fileKey 는 파일 이름(`FX-xx` 또는 앞선 개정의 `FX-xx.rNN`)이고, envelope 의 fixtureId 는 그것과 같다.
function checkKev(fixtureId, kev, add, fileKey = fixtureId) {
  if (
    !isRecord(kev) ||
    kev.schemaVersion !== "kev-mock/v0.1" ||
    kev.fixtureId !== fileKey ||
    kev.provider !== "mock" ||
    kev.questionSetVersion !== "kev-qs/v0.1" ||
    !isRecord(kev.usage) ||
    !isNumber(kev.latency_ms)
  )
    return add("KEV_SHAPE", fixtureId);
  checkKevResponses(fixtureId, kev.responses, add);
}

function checkGolden(fixtureId, golden, entry, calculationDate, add) {
  const { factors } = isRecord(golden) ? golden : {};
  const isShapeOk =
    isRecord(golden) &&
    golden.schemaVersion === "sol-golden/v0.1" &&
    golden.fixtureId === fixtureId &&
    isText(golden.calculationDate) &&
    Array.isArray(factors) &&
    factors.length === GOLDEN_FACTORS.length &&
    GOLDEN_FACTORS.every(([factor, maxPoints], index) => {
      const item = factors[index];
      return (
        isRecord(item) &&
        item.factor === factor &&
        item.maxPoints === maxPoints &&
        isUnit(item.normalized) &&
        isNumber(item.points) &&
        item.points >= 0 &&
        item.points <= maxPoints
      );
    }) &&
    isNumber(golden.total) &&
    Number.isInteger(golden.score) &&
    CHOICES.includes(golden.recommendation) &&
    Array.isArray(golden.reviewFlags) &&
    golden.reviewFlags.every((flag) => typeof flag === "string");
  if (!isShapeOk) return add("GOLDEN_SHAPE", fixtureId);
  // total 은 points 합의 소수 첫째 자리 반올림, score 는 total 의 정수 반올림.
  const total = Math.round(sum(factors.map((item) => item.points)) * 10) / 10;
  if (golden.total !== total || Math.round(golden.total) !== golden.score)
    add("GOLDEN_TOTAL", fixtureId);
  if (
    golden.score !== entry.expected?.designScore ||
    golden.recommendation !== entry.expected?.outcome ||
    golden.calculationDate !== calculationDate
  )
    add("GOLDEN_MANIFEST", fixtureId);
}

// 파일 이름 `FX-xx.rNN` 은 그 FX 의 앞선 개정 NN 의 추출이다.
const REVISION_KEY = /^(FX-\d{2})\.r(\d{2})$/;
const revisionKeys = (extractions, id) =>
  Object.keys(extractions).flatMap((key) => {
    const [, keyId, revisionNo] = key.match(REVISION_KEY) ?? [];
    return keyId === id ? [[key, revisionNo]] : [];
  });

// 파일 집합 규칙: 있어야 할 것이 있는지, 없어야 할 것이 없는지, 모르는 이름이 없는지.
function checkMockData(data, manifest, add) {
  const { bids, extractions, kev, goldens } = data;
  const entries = new Map(manifest.fixtures.map((entry) => [entry.id, entry]));
  const isQuarantined = (id) => entries.get(id)?.expected?.outcome === "QUARANTINED";
  const has = (group, id) => Object.hasOwn(group, id);
  for (const id of IDS) {
    if (!entries.has(id)) continue;
    const tags = Array.isArray(entries.get(id).tags) ? entries.get(id).tags : [];
    if (isQuarantined(id)) {
      if (has(extractions, id)) add("EXTRACTION_UNEXPECTED", id);
    } else if (!has(extractions, id)) add("EXTRACTION_MISSING", id);
    else {
      const isMainOk = checkExtraction(id, extractions[id], bids[id], tags, add);
      const revisions = revisionKeys(extractions, id);
      if (isMainOk)
        checkFallbacks(
          id,
          extractions[id],
          bids[id],
          tags,
          revisions.map(([, no]) => no),
          add,
        );
      for (const [key, revisionNo] of revisions)
        checkExtraction(id, extractions[key], bids[id], [], add, revisionNo);
    }
    for (const key of REQUIRED_REVISION_EXTRACTIONS)
      if (fixtureIdOf(key) === id && !has(extractions, key)) add("EXTRACTION_MISSING", id);
    if (has(kev, id)) checkKev(id, kev[id], add);
    else if (REQUIRED_KEV_IDS.includes(id)) add("KEV_MISSING", id);
    if (has(goldens, id))
      checkGolden(id, goldens[id], entries.get(id), manifest.calculationDate, add);
    else if (REQUIRED_GOLDEN_IDS.includes(id)) add("GOLDEN_MISSING", id);
  }
  for (const key of Object.keys(extractions))
    if (!IDS.includes(key) && !REVISION_KEY.test(key)) add("EXTRACTION_UNEXPECTED", key);
  // 앞선 개정의 추출은 manifest 의 FX 이면서 격리가 아닌 것에만 있다.
  for (const key of Object.keys(extractions)) {
    const id = key.match(REVISION_KEY)?.[1];
    if (id !== undefined && (!entries.has(id) || isQuarantined(id)))
      add("EXTRACTION_UNEXPECTED", id);
  }
  // 앞선 개정의 Kev 응답 `FX-xx.rNN` 은 추출과 같은 규칙이다: manifest 의 격리 아닌 FX 이고,
  // 공고에 있는 마지막이 아닌 개정이며, 기본 파일 `FX-xx` 도 있어야 한다(mock 은 rNN 이 없으면 기본 파일을 쓴다).
  for (const key of Object.keys(kev)) {
    if (IDS.includes(key)) continue;
    const [, id, revisionNo] = key.match(REVISION_KEY) ?? [];
    if (id === undefined || !entries.has(id) || isQuarantined(id)) {
      add("KEV_SHAPE", id ?? key);
      continue;
    }
    const records = Array.isArray(bids[id]?.records) ? bids[id].records : [];
    if (
      revisionNo === records.at(-1)?.amendmentNo ||
      !records.some((item) => item?.amendmentNo === revisionNo)
    )
      add("KEV_REVISION", id);
    if (!has(kev, id)) add("KEV_MISSING", id);
    checkKev(id, kev[key], add, key);
  }
  for (const key of Object.keys(goldens)) if (!IDS.includes(key)) add("GOLDEN_SHAPE", key);
}

/** 디스크를 모르는 순수 검사. `data` 는 `{ manifest, bids, extractions, kev, goldens }`(각각 FX-ID → JSON). */
export function validateBidFixtures(data) {
  const errors = [];
  const add = (code, fixtureId) => {
    const safeId =
      typeof fixtureId === "string" && /^FX-\d{2}$/.test(fixtureId) ? fixtureId : undefined;
    if (!errors.some((error) => error.code === code && error.fixtureId === safeId))
      errors.push(safeId ? { code, fixtureId: safeId } : { code });
  };
  const manifest = data?.manifest;
  const { extractions = {}, kev = {}, goldens = {} } = data ?? {};
  if (
    !isRecord(manifest) ||
    !Array.isArray(manifest.fixtures) ||
    !manifest.fixtures.every(isRecord) ||
    !isRecord(data.bids) ||
    ![extractions, kev, goldens].every(isRecord)
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
  checkPii(
    [
      [undefined, manifest],
      ...Object.entries(data.bids),
      ...[extractions, kev, goldens].flatMap((group) =>
        Object.entries(group).map(([key, value]) => [fixtureIdOf(key), value]),
      ),
    ],
    add,
  );
  checkMockData({ bids: data.bids, extractions, kev, goldens }, manifest, add);
  return { ok: errors.length === 0, errors };
}

// 폴더 안 FX-xx.json 을 FX-ID → 내용으로 읽는다. optional 폴더가 없으면 빈 묶음이다
// (그러면 "있어야 할 파일이 없다"는 검사 오류로 드러난다).
async function readJsonDir(dir, { optional }) {
  let names;
  try {
    names = await readdir(dir);
  } catch (error) {
    if (optional && error?.code === "ENOENT") return {};
    throw error;
  }
  return Object.fromEntries(
    await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => [
          name.slice(0, -".json".length),
          JSON.parse(await readFile(path.join(dir, name), "utf8")),
        ]),
    ),
  );
}

/** manifest.yaml 과 bids·extractions·kev·goldens 의 *.json 을 읽는다. 실패하면 던진다(경로는 호출자가 숨긴다). */
export async function loadBidFixtures({ root = ROOT } = {}) {
  const dir = path.join(root, "fixtures");
  const manifest = parse(await readFile(path.join(dir, "manifest.yaml"), "utf8"));
  const [bids, extractions, kev, goldens] = await Promise.all([
    readJsonDir(path.join(dir, "bids"), { optional: false }),
    readJsonDir(path.join(dir, "extractions"), { optional: true }),
    readJsonDir(path.join(dir, "kev"), { optional: true }),
    readJsonDir(path.join(dir, "goldens"), { optional: true }),
  ]);
  return { manifest, bids, extractions, kev, goldens };
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
