import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { checkBidFixtures, loadBidFixtures, validateBidFixtures } from "./bids/check.mjs";

// 정상 데이터는 한 번만 읽는다. 읽기 실패는 시험마다 개별 실패로 드러나도록 늦게 평가한다.
let loaded;
const baseline = () => (loaded ??= loadBidFixtures());
const copy = async () => structuredClone(await baseline());
const codes = (result) => result.errors.map((error) => error.code);
const lastRecord = (value, fixtureId) => value.bids[fixtureId].records.at(-1);
const manifestEntry = (value, fixtureId) =>
  value.manifest.fixtures.find((entry) => entry.id === fixtureId);

test("saved fixtures pass every check", async () => {
  const result = validateBidFixtures(await baseline());
  assert.deepEqual(result, { ok: true, errors: [] });
  assert.deepEqual(await checkBidFixtures({}), { ok: true, errors: [] });
});

test("manifest carries the required scenario tags", async () => {
  const value = await baseline();
  assert.ok(manifestEntry(value, "FX-07").tags.includes("r1-WATCH-68"));
  for (const tag of ["citation-mismatch-1", "budget-text"])
    assert.ok(manifestEntry(value, "FX-13").tags.includes(tag));
});

// 변형마다 하나의 오염을 만들고, 정해진 code 로 잡히는지 본다.
for (const [name, mutate, expected] of [
  [
    "isDemo false",
    (value) => {
      value.bids["FX-01"].isDemo = false;
    },
    "NOT_DEMO",
  ],
  [
    "real source url",
    (value) => {
      lastRecord(value, "FX-01").sourceUrl = "https://www.g2b.go.kr/notices/FX-01";
    },
    "SOURCE_URL",
  ],
  [
    "real email address",
    (value) => {
      lastRecord(value, "FX-01").content = "문의 kim@example.com";
    },
    "PII_EMAIL",
  ],
  [
    "phone number",
    (value) => {
      lastRecord(value, "FX-01").content = "문의 010-1234-5678";
    },
    "PII_PHONE",
  ],
  [
    "absolute deadline",
    (value) => {
      lastRecord(value, "FX-01").deadlineAt = "2026-11-01";
    },
    "RELATIVE_DATE",
  ],
  [
    "missing title",
    (value) => {
      delete value.bids["FX-01"].records[0].title;
    },
    "TITLE_MISSING",
  ],
  [
    "blank title",
    (value) => {
      value.bids["FX-01"].records[0].title = "  ";
    },
    "TITLE_MISSING",
  ],
  [
    "fixture dropped from manifest",
    (value) => {
      value.manifest.fixtures = value.manifest.fixtures.filter((entry) => entry.id !== "FX-20");
      value.manifest.batches.SEED = value.manifest.batches.SEED.filter((id) => id !== "FX-20");
    },
    "MANIFEST_IDS",
  ],
  [
    "duplicate manifest id",
    (value) => {
      value.manifest.fixtures[1].id = "FX-01";
    },
    "MANIFEST_IDS",
  ],
  [
    "LIVE batch drift",
    (value) => {
      value.manifest.batches.LIVE.pop();
    },
    "MANIFEST_IDS",
  ],
  [
    "wrong schema version",
    (value) => {
      value.manifest.schemaVersion = "sol-fixtures/v0.9";
    },
    "MANIFEST_SCHEMA",
  ],
  [
    "outcome distribution drift",
    (value) => {
      manifestEntry(value, "FX-07").expected.outcome = "WATCH";
    },
    "DISTRIBUTION",
  ],
  [
    "stage distribution drift",
    (value) => {
      manifestEntry(value, "FX-01").stage = "PLAN";
    },
    "DISTRIBUTION",
  ],
  [
    "budget text without budget-text tag",
    (value) => {
      lastRecord(value, "FX-01").budgetKrw = "12억";
    },
    "BUDGET_FORMAT",
  ],
  [
    "budget-text tag does not allow arbitrary text",
    (value) => {
      lastRecord(value, "FX-13").budgetKrw = "많이";
    },
    "BUDGET_FORMAT",
  ],
  [
    "cancelled outcome without CANCELLED status",
    (value) => {
      delete lastRecord(value, "FX-08").status;
    },
    "CANCEL_STATUS",
  ],
  [
    "CANCELLED status on another fixture",
    (value) => {
      lastRecord(value, "FX-01").status = "CANCELLED";
    },
    "CANCEL_STATUS",
  ],
  [
    "unknown status",
    (value) => {
      lastRecord(value, "FX-01").status = "DELETED";
    },
    "STATUS_INVALID",
  ],
  [
    "fixtureId differs from file name",
    (value) => {
      value.bids["FX-02"].fixtureId = "FX-03";
    },
    "FIXTURE_ID",
  ],
  [
    "unknown stage",
    (value) => {
      value.bids["FX-01"].stage = "TENDER";
    },
    "STAGE",
  ],
  [
    "unknown connector behavior",
    (value) => {
      value.bids["FX-01"].connectorBehavior = "flaky";
    },
    "CONNECTOR_BEHAVIOR",
  ],
  [
    "one-digit amendment number",
    (value) => {
      value.bids["FX-01"].records[0].amendmentNo = "1";
    },
    "AMENDMENT_NO",
  ],
  [
    "ingest batch differs from manifest",
    (value) => {
      value.bids["FX-01"].records[0].ingestBatch = "LIVE";
    },
    "BATCH_MISMATCH",
  ],
  [
    "LIVE fixture missing its LIVE record",
    (value) => {
      value.bids["FX-06"].records = value.bids["FX-06"].records.filter(
        (record) => record.ingestBatch !== "LIVE",
      );
    },
    "BATCH_MISMATCH",
  ],
  [
    "real-looking notice id",
    (value) => {
      value.bids["FX-01"].records[0].noticeId = "20260101234-00";
    },
    "NOTICE_ID",
  ],
  [
    "malformed plan reference",
    (value) => {
      lastRecord(value, "FX-18").planRef = "PLAN-42";
    },
    "PLAN_REF",
  ],
  [
    "required tag removed",
    (value) => {
      manifestEntry(value, "FX-13").tags = manifestEntry(value, "FX-13").tags.filter(
        (tag) => tag !== "citation-mismatch-1",
      );
    },
    "TAGS_REQUIRED",
  ],
  [
    "malformed bids container",
    (value) => {
      value.bids = null;
    },
    "FIXTURE_SCHEMA_INVALID",
  ],
]) {
  test(`rejects ${name}`, async () => {
    const value = await copy();
    mutate(value);
    const result = validateBidFixtures(value);
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(expected), JSON.stringify(result));
    // 오류에는 code 와 FX-ID 만 담는다. 값 원문(이메일·전화번호 등)은 새지 않는다.
    for (const error of result.errors) {
      assert.ok(Object.keys(error).every((key) => ["code", "fixtureId"].includes(key)));
      if (error.fixtureId) assert.match(error.fixtureId, /^FX-\d{2}$/);
    }
    assert.ok(!JSON.stringify(result).match(/kim@|010-1234|g2b\.go\.kr/));
  });
}

test("unreadable root fails safely without disclosing its path", async () => {
  const result = await checkBidFixtures({ root: "/private/synthetic-missing-root" });
  assert.deepEqual(result, { ok: false, errors: [{ code: "FIXTURE_READ_FAILED" }] });
});

test("CLI exits 0 and prints one JSON line", () => {
  const result = spawnSync(process.execPath, ["scripts/bids/check.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).ok, true);
  assert.equal(result.stderr, "");
});
