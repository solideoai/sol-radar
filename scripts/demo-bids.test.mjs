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

// 추출 파일의 값 필드와 그 근거(인용). 03 §4.1 필드 이름은 검증기와 같다.
const FIELD_NAMES = [
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
const fieldsOf = (extraction) => FIELD_NAMES.map((name) => extraction[name]);
const evidenceOf = (extraction) => fieldsOf(extraction).flatMap((field) => field.evidence);
const quotesOf = (extraction) => evidenceOf(extraction).map((item) => item.quotedText);
const contentOf = (value, fixtureId) => lastRecord(value, fixtureId).content;
const mismatchesOf = (value, fixtureId) =>
  quotesOf(value.extractions[fixtureId]).filter(
    (quote) => !contentOf(value, fixtureId).includes(quote),
  );
const sumOf = (numbers) => numbers.reduce((total, number) => total + number, 0);

// 07 §6.3 Kev 고정값(BID/WATCH/NO_BID 확률, 위험, 검토, 표시 fit). wire fit 은 표시값 - 1.
const KEV_EXPECTED = {
  "FX-01": { probabilities: [0.71, 0.24, 0.05], risk: 0.05, review: 0.12, displayFit: 4.5 },
  "FX-02": { probabilities: [0.36, 0.52, 0.12], risk: 0.1, review: 0.74, displayFit: 3.2 },
  "FX-03": { probabilities: [0.55, 0.3, 0.15], risk: 0.85, review: 0.58, displayFit: 2.8 },
  "FX-16": { probabilities: [0.1, 0.2, 0.7], risk: 0.9, review: 0.3, displayFit: 1.6 },
};
// 08 §6.5 골든: 요소별 points(skillMatch, pastPerformance, staffAvailability, scaleFit, strategicPreference).
const GOLDEN_EXPECTED = {
  "FX-01": { points: [24, 25, 20, 15, 10], total: 94, score: 94, outcome: "BID", flags: [] },
  "FX-02": {
    points: [15, 18.3, 14, 15, 10],
    total: 72.3,
    score: 72,
    outcome: "WATCH",
    flags: ["KEV_NEEDS_REVIEW"],
  },
  "FX-03": {
    points: [20, 12.2, 20, 9, 7],
    total: 68.2,
    score: 68,
    outcome: "NO_BID",
    flags: ["MODEL_RULE_DISAGREEMENT"],
  },
};
const FACTOR_ORDER = [
  ["skillMatch", 30],
  ["pastPerformance", 25],
  ["staffAvailability", 20],
  ["scaleFit", 15],
  ["strategicPreference", 10],
];

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

test("mock extractions cover every non-quarantined fixture and nothing else", async () => {
  const value = await baseline();
  const expectedIds = value.manifest.fixtures
    .filter((entry) => entry.expected.outcome !== "QUARANTINED")
    .map((entry) => entry.id)
    .sort();
  assert.equal(expectedIds.length, 19);
  // 앞선 개정의 추출(FX-xx.rNN)은 마지막 개정 파일과 따로 센다.
  const mainKeys = Object.keys(value.extractions).filter((key) => !key.includes(".r"));
  assert.deepEqual(mainKeys.sort(), expectedIds);
  assert.equal(Object.hasOwn(value.extractions, "FX-12"), false);
});

test("FX-01 extraction: 5 required + 2 preferred skills, 3 qualifications, 12 staff, quotes in content", async () => {
  const { extractions } = await baseline();
  const extraction = extractions["FX-01"];
  assert.equal(extraction.requiredSkills.value.length, 5);
  assert.equal(extraction.preferredSkills.value.length, 2);
  assert.equal(extraction.qualifications.value.length, 3);
  assert.equal(extraction.qualifications.evidence.length, 3);
  assert.equal(sumOf(extraction.staffing.value.map((item) => item.minCount)), 12);
  assert.ok(quotesOf(extraction).length > 0);
  assert.deepEqual(mismatchesOf(await baseline(), "FX-01"), []);
});

test("FX-02 extraction: 6 required + 2 preferred skills, staffing UNKNOWN, quotes in content", async () => {
  const value = await baseline();
  const extraction = value.extractions["FX-02"];
  assert.equal(extraction.requiredSkills.value.length, 6);
  assert.equal(extraction.preferredSkills.value.length, 2);
  assert.equal(extraction.staffing.state, "UNKNOWN");
  assert.equal(extraction.qualifications.evidence.length, 2);
  assert.ok(quotesOf(extraction).length > 0);
  assert.deepEqual(mismatchesOf(value, "FX-02"), []);
});

test("FX-03 extraction quotes the mandatory 정보통신공사업 registration", async () => {
  const { extractions } = await baseline();
  assert.ok(
    quotesOf(extractions["FX-03"]).some((quote) =>
      quote.includes("정보통신공사업법에 따른 정보통신공사업 등록업체"),
    ),
  );
});

test("FX-04 extraction has no citations and every field UNKNOWN", async () => {
  const { extractions } = await baseline();
  assert.equal(quotesOf(extractions["FX-04"]).length, 0);
  assert.ok(fieldsOf(extractions["FX-04"]).every((field) => field.state === "UNKNOWN"));
});

test("FX-05 extraction records the attachment parse failure and quotes only the body", async () => {
  const value = await baseline();
  const extraction = value.extractions["FX-05"];
  assert.ok(extraction.warnings.some((warning) => /^ATTACHMENT_PARSE_FAILED:\S+/.test(warning)));
  assert.ok(evidenceOf(extraction).every((item) => item.documentId === null));
  assert.deepEqual(mismatchesOf(value, "FX-05"), []);
});

test("FX-13 extraction has exactly one quote that is not in the content", async () => {
  const value = await baseline();
  assert.equal(mismatchesOf(value, "FX-13").length, 1);
});

test("FX-11 extraction: staffing KNOWN, budget UNKNOWN", async () => {
  const { extractions } = await baseline();
  assert.equal(extractions["FX-11"].staffing.state, "KNOWN");
  assert.equal(extractions["FX-11"].budgetKrw.state, "UNKNOWN");
});

test("every extraction date stays UNKNOWN because content has no absolute dates", async () => {
  const { extractions } = await baseline();
  for (const extraction of Object.values(extractions))
    assert.deepEqual(extraction.deadlineAt, { value: null, state: "UNKNOWN", evidence: [] });
});

for (const [fixtureId, expected] of Object.entries(KEV_EXPECTED))
  test(`${fixtureId} Kev mock carries the fixed 07 §6.3 values`, async () => {
    const { kev } = await baseline();
    const { recommendation, mandatoryRisk, needsHumanReview, fit } = kev[fixtureId].responses;
    const { probabilities, risk, review, displayFit } = expected;
    assert.deepEqual(
      ["BID", "WATCH", "NO_BID"].map((key) => recommendation.probabilities[key]),
      probabilities,
    );
    assert.equal(mandatoryRisk.noul, risk);
    assert.equal(needsHumanReview.noul, review);
    assert.ok(Math.abs(fit.score - (displayFit - 1)) < 1e-9);
    assert.deepEqual(Object.keys(fit.legend), ["0", "1", "2", "3", "4"]);
  });

for (const [fixtureId, expected] of Object.entries(GOLDEN_EXPECTED))
  test(`${fixtureId} golden carries the fixed 08 §6.5 values`, async () => {
    const { goldens } = await baseline();
    const golden = goldens[fixtureId];
    assert.deepEqual(
      golden.factors.map((item) => [item.factor, item.maxPoints]),
      FACTOR_ORDER,
    );
    assert.deepEqual(
      golden.factors.map((item) => item.points),
      expected.points,
    );
    assert.equal(golden.total, expected.total);
    assert.equal(golden.score, expected.score);
    assert.equal(golden.recommendation, expected.outcome);
    assert.deepEqual(golden.reviewFlags, expected.flags);
    assert.equal(golden.calculationDate, "2026-10-16");
  });

test("FX-07 keeps an r01 extraction made from the first revision (no Kubernetes)", async () => {
  const value = await baseline();
  const extraction = value.extractions["FX-07.r01"];
  assert.ok(extraction, "fixtures/extractions/FX-07.r01.json is missing");
  assert.equal(extraction.revisionId, "FX-07#01");
  assert.equal(extraction.bidId, "FX-07");
  assert.equal(extraction.requiredSkills.state, "KNOWN");
  assert.ok(!extraction.requiredSkills.value.some((skill) => skill.includes("Kubernetes")));
  const first = value.bids["FX-07"].records.find((record) => record.amendmentNo === "01");
  const quotes = quotesOf(extraction);
  assert.ok(quotes.length > 0);
  assert.ok(quotes.every((quote) => first.content.includes(quote)));
});

test("a prototype-named key in a mock folder is rejected without throwing", async () => {
  const value = await copy();
  value.extractions.constructor = {};
  value.kev.toString = {};
  const result = validateBidFixtures(value);
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("EXTRACTION_UNEXPECTED"));
  assert.ok(codes(result).includes("KEV_SHAPE"));
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
  [
    "quote that is not in the content",
    (value) => {
      evidenceOf(value.extractions["FX-01"])[0].quotedText = "본문에는 없는 완전히 다른 문장입니다";
    },
    "CITATION_NOT_IN_CONTENT",
  ],
  [
    "FX-13 mismatching quote replaced by a content sentence",
    (value) => {
      const bad = mismatchesOf(value, "FX-13")[0];
      const item = evidenceOf(value.extractions["FX-13"]).find((entry) => entry.quotedText === bad);
      item.quotedText = contentOf(value, "FX-13").slice(0, 20);
    },
    "CITATION_MISMATCH_COUNT",
  ],
  [
    "FX-13 with two mismatching quotes",
    (value) => {
      const quoted = evidenceOf(value.extractions["FX-13"]);
      const good = quoted.find((entry) => contentOf(value, "FX-13").includes(entry.quotedText));
      good.quotedText = "본문에는 없는 두 번째 인용 문장";
    },
    "CITATION_MISMATCH_COUNT",
  ],
  [
    "extraction for the quarantined FX-12",
    (value) => {
      value.extractions["FX-12"] = {
        ...structuredClone(value.extractions["FX-01"]),
        bidId: "FX-12",
      };
    },
    "EXTRACTION_UNEXPECTED",
  ],
  [
    "FX-05 extraction removed",
    (value) => {
      delete value.extractions["FX-05"];
    },
    "EXTRACTION_MISSING",
  ],
  [
    "extraction bidId differs from its file name",
    (value) => {
      value.extractions["FX-02"].bidId = "FX-03";
    },
    "EXTRACTION_SHAPE",
  ],
  [
    "extraction revisionId is not the last amendment",
    (value) => {
      value.extractions["FX-06"].revisionId = "FX-06#00";
    },
    "EXTRACTION_SHAPE",
  ],
  [
    "extraction evidence with a document id",
    (value) => {
      evidenceOf(value.extractions["FX-01"])[0].documentId = "doc-1";
    },
    "EXTRACTION_SHAPE",
  ],
  [
    "KNOWN field with the value removed",
    (value) => {
      value.extractions["FX-01"].summary.value = null;
    },
    "EXTRACTION_SHAPE",
  ],
  [
    "KNOWN field with its evidence emptied",
    (value) => {
      fieldsOf(value.extractions["FX-01"]).find((field) => field.state === "KNOWN").evidence = [];
    },
    "KNOWN_WITHOUT_EVIDENCE",
  ],
  [
    "quote shorter than 5 characters",
    (value) => {
      evidenceOf(value.extractions["FX-01"])[0].quotedText = contentOf(value, "FX-01").slice(0, 4);
    },
    "QUOTE_LENGTH",
  ],
  [
    "quote longer than 300 characters",
    (value) => {
      evidenceOf(value.extractions["FX-01"])[0].quotedText = "가".repeat(301);
    },
    "QUOTE_LENGTH",
  ],
  [
    "r01 extraction for a revision the fixture does not have",
    (value) => {
      value.extractions["FX-01.r02"] = {
        ...structuredClone(value.extractions["FX-01"]),
        revisionId: "FX-01#02",
      };
    },
    "EXTRACTION_REVISION",
  ],
  [
    "rNN extraction for the last revision duplicates the main file",
    (value) => {
      value.extractions["FX-07.r02"] = {
        ...structuredClone(value.extractions["FX-07"]),
        revisionId: "FX-07#02",
      };
    },
    "EXTRACTION_REVISION",
  ],
  [
    "rNN extraction whose revisionId differs from its name",
    (value) => {
      value.extractions["FX-07.r01"].revisionId = "FX-07#02";
    },
    "EXTRACTION_SHAPE",
  ],
  [
    "rNN extraction quoting text only the later revision has",
    (value) => {
      evidenceOf(value.extractions["FX-07.r01"])[0].quotedText = contentOf(value, "FX-07").slice(
        -40,
      );
    },
    "CITATION_NOT_IN_CONTENT",
  ],
  [
    "malformed rNN file name",
    (value) => {
      value.extractions["FX-07.r1"] = structuredClone(value.extractions["FX-07.r01"]);
    },
    "EXTRACTION_UNEXPECTED",
  ],
  [
    "Kev FX-16 removed",
    (value) => {
      delete value.kev["FX-16"];
    },
    "KEV_MISSING",
  ],
  [
    "Kev recommendation probabilities sum to 0.9",
    (value) => {
      const { probabilities } = value.kev["FX-01"].responses.recommendation;
      for (const key of Object.keys(probabilities)) probabilities[key] *= 0.9;
    },
    "KEV_PROBABILITY_SUM",
  ],
  [
    "Kev fit probabilities do not sum to 1",
    (value) => {
      value.kev["FX-02"].responses.fit.probabilities["0"] += 0.2;
    },
    "KEV_PROBABILITY_SUM",
  ],
  [
    "Kev choice is not the top probability",
    (value) => {
      value.kev["FX-01"].responses.recommendation.choice = "WATCH";
    },
    "KEV_SHAPE",
  ],
  [
    "Kev noul outside 0..1",
    (value) => {
      value.kev["FX-03"].responses.mandatoryRisk.noul = 1.5;
    },
    "KEV_SHAPE",
  ],
  [
    "Kev fit legend renamed",
    (value) => {
      value.kev["FX-01"].responses.fit.legend["4"] = "Great";
    },
    "KEV_SHAPE",
  ],
  [
    "Kev fixtureId differs from its file name",
    (value) => {
      value.kev["FX-01"].fixtureId = "FX-02";
    },
    "KEV_SHAPE",
  ],
  [
    "Kev fit score is not the mean grade index",
    (value) => {
      value.kev["FX-01"].responses.fit.score = 3.0;
    },
    "KEV_FIT",
  ],
  [
    "Kev fit score above 4",
    (value) => {
      value.kev["FX-01"].responses.fit.score = 4.5;
    },
    "KEV_FIT",
  ],
  [
    "golden FX-03 removed",
    (value) => {
      delete value.goldens["FX-03"];
    },
    "GOLDEN_MISSING",
  ],
  [
    "golden points changed without total",
    (value) => {
      value.goldens["FX-01"].factors[1].points = 20;
    },
    "GOLDEN_TOTAL",
  ],
  [
    "golden score is not the rounded total",
    (value) => {
      value.goldens["FX-02"].score = 73;
    },
    "GOLDEN_TOTAL",
  ],
  [
    "golden score differs from the manifest design score",
    (value) => {
      manifestEntry(value, "FX-02").expected.designScore = 73;
    },
    "GOLDEN_MANIFEST",
  ],
  [
    "golden recommendation differs from the manifest outcome",
    (value) => {
      value.goldens["FX-03"].recommendation = "WATCH";
    },
    "GOLDEN_MANIFEST",
  ],
  [
    "golden calculation date differs from the manifest",
    (value) => {
      value.goldens["FX-01"].calculationDate = "2026-10-17";
    },
    "GOLDEN_MANIFEST",
  ],
  [
    "golden factors out of order",
    (value) => {
      value.goldens["FX-01"].factors.reverse();
    },
    "GOLDEN_SHAPE",
  ],
  [
    "golden maxPoints changed",
    (value) => {
      value.goldens["FX-01"].factors[0].maxPoints = 35;
    },
    "GOLDEN_SHAPE",
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
    assert.ok(!JSON.stringify(result).match(/kim@|010-1234|g2b\.go\.kr|본문에는 없는/));
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
