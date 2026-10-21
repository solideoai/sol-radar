import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { checkPeople } from "./people/check.mjs";
import { projectSignupOptions } from "./people/generate.mjs";

const load = async (name) => JSON.parse(await readFile(new URL(name, import.meta.url), "utf8"));
const fixtures = {
  departments: await load("../fixtures/people/solideo.departments.json"),
  jobTitles: await load("../fixtures/people/solideo.job-titles.json"),
  people: await load("../fixtures/people/solideo.people.json"),
  portraits: await load("../fixtures/people/solideo.portraits.json"),
  signupOptions: await load("../web/server/profile/signup-options.generated.json"),
};
const copy = () => structuredClone(fixtures);
const codes = (result) => result.errors.map((error) => error.code);

// Adding any private root field or option metadata must break this public contract.
test("projects exactly the four public fields and only id/label options", () => {
  const options = projectSignupOptions(fixtures.departments, fixtures.jobTitles);
  assert.deepEqual(Object.keys(options), [
    "companyName",
    "catalogVersion",
    "departments",
    "jobTitles",
  ]);
  assert.equal(options.companyName, "솔리데오");
  assert.equal(options.catalogVersion, "solideo-organization/v1.0");
  assert.equal(options.departments.length, 38);
  assert.equal(options.jobTitles.length, 12);
  for (const option of [...options.departments, ...options.jobTitles])
    assert.deepEqual(Object.keys(option), ["id", "label"]);
  assert.deepEqual(options, fixtures.signupOptions);
});

test("saved data passes without claiming source comparison or requiring planned images", async () => {
  assert.deepEqual(await checkPeople({ fixtures, requirePortraits: false }), {
    ok: true,
    sourceComparison: "not-run",
    errors: [],
  });
  const people = fixtures.people.people;
  assert.deepEqual(
    people.map((person) => person.personId),
    Array.from({ length: 200 }, (_, index) => `SOL-P${String(index + 1).padStart(4, "0")}`),
  );
  const eligible = people.filter((person) => person.scoringEligible);
  assert.equal(eligible.length, 200);
  assert.equal(people.length - eligible.length, 0);
  assert.deepEqual(
    Object.fromEntries(
      [
        "PM",
        "PL",
        "DEVELOPER",
        "DATA_AI",
        "DEVOPS",
        "QA",
        "DESIGNER",
        "BUSINESS_ANALYST",
        "SECURITY",
        "DBA",
      ].map((role) => [role, eligible.filter((person) => person.role === role).length]),
    ),
    {
      PM: 19,
      PL: 21,
      DEVELOPER: 35,
      DATA_AI: 20,
      DEVOPS: 17,
      QA: 17,
      DESIGNER: 17,
      BUSINESS_ANALYST: 18,
      SECURITY: 18,
      DBA: 18,
    },
  );
  assert.equal(fixtures.people.assignments.length, 7);
  for (const person of eligible) {
    assert.ok(
      person.skills.length > 0 &&
        person.certifications.length > 0 &&
        person.pastProjects.length > 0,
    );
    assert.ok(person.availability.length > 0);
    assert.equal(person.capabilitySource, "SYNTHETIC");
  }
  assert.equal(new Set(fixtures.people.assignments.map((row) => row.personId)).size, 7);
  for (const assignment of fixtures.people.assignments) {
    assert.ok(eligible.some((person) => person.personId === assignment.personId));
    assert.deepEqual(assignment, {
      personId: assignment.personId,
      startsAt: "2026-12-01",
      endsAt: "2027-07-01",
      allocationPercent: 100,
    });
  }
});

// Each mutation names a concrete corruption that must be detected with safe codes only.
for (const [name, mutate, expected] of [
  [
    "public projection leaks metadata",
    (value) => {
      value.signupOptions.departments[0].sourceCount = 1;
    },
    "PUBLIC_PROJECTION_MISMATCH",
  ],
  [
    "duplicate person IDs",
    (value) => {
      value.people.people[1].personId = value.people.people[0].personId;
    },
    "PERSON_INVALID",
  ],
  [
    "invalid name",
    (value) => {
      value.people.people[0].name = "합성 네 글자";
    },
    "PERSON_INVALID",
  ],
  [
    "duplicate name",
    (value) => {
      value.people.people[1].name = value.people.people[0].name;
    },
    "PERSON_INVALID",
  ],
  [
    "unknown department",
    (value) => {
      value.people.people[0].departmentId = "SOL-D999";
    },
    "PERSON_INVALID",
  ],
  [
    "unknown title",
    (value) => {
      value.people.people[0].jobTitleId = "SOL-J999";
    },
    "PERSON_INVALID",
  ],
  [
    "wrong gender totals",
    (value) => {
      value.people.people.find((person) => person.gender === "FEMALE").gender = "MALE";
    },
    "GENDER_COUNTS_INVALID",
  ],
  [
    "incorrect allocation target",
    (value) => {
      value.departments.departments[0].targetCount++;
    },
    "ALLOCATION_MISMATCH",
  ],
  [
    "incorrect source title weight",
    (value) => {
      value.jobTitles.jobTitles[0].sourceCount++;
    },
    "TITLE_COUNTS_INVALID",
  ],
  [
    "incorrect score role",
    (value) => {
      value.people.people.find((person) => person.role === "PM").role = "PL";
    },
    "SCORING_INVALID",
  ],
  [
    "excluded scoring member",
    (value) => {
      value.people.people[0].scoringEligible = false;
    },
    "SCORING_INVALID",
  ],
  [
    "wrong availability interval",
    (value) => {
      value.people.people.find((person) => person.scoringEligible).availability[0].endsAt =
        "2027-06-01";
    },
    "SCORING_INVALID",
  ],
  [
    "wrong assignment percentage",
    (value) => {
      value.people.assignments[0].allocationPercent = 50;
    },
    "ASSIGNMENTS_INVALID",
  ],
  [
    "duplicate assignment",
    (value) => {
      value.people.assignments[1] = value.people.assignments[0];
    },
    "ASSIGNMENTS_INVALID",
  ],
  [
    "portrait identity drift",
    (value) => {
      value.portraits.portraits[0].gender = "FEMALE";
    },
    "PORTRAIT_MANIFEST_INVALID",
  ],
  [
    "portrait path traversal",
    (value) => {
      value.portraits.portraits[0].path = "/../../private";
    },
    "PORTRAIT_MANIFEST_INVALID",
  ],
  [
    "wrong company",
    (value) => {
      value.people.companyName = "Other";
    },
    "FIXTURE_SCHEMA_INVALID",
  ],
  [
    "missing roster",
    (value) => {
      value.people = null;
    },
    "FIXTURE_SCHEMA_INVALID",
  ],
  [
    "unapproved source totals",
    (value) => {
      value.departments.sourceRowCount = 175;
    },
    "CATALOG_INVALID",
  ],
  [
    "invalid catalog ID",
    (value) => {
      value.departments.departments[0].id = "SOL-D999";
    },
    "CATALOG_INVALID",
  ],
]) {
  test(`rejects ${name}`, async () => {
    const value = copy();
    mutate(value);
    const result = await checkPeople({ fixtures: value, requirePortraits: false });
    assert.equal(result.ok, false);
    assert.ok(codes(result).includes(expected), JSON.stringify(result));
    for (const error of result.errors) {
      assert.ok(Object.keys(error).every((key) => ["code", "personId"].includes(key)));
      if (error.personId) assert.match(error.personId, /^SOL-P\d{4}$/);
    }
  });
}

test("release requires original source and rejects the planned manifest", async () => {
  const value = copy();
  value.portraits.portraits = value.portraits.portraits.map(
    ({ personId, gender, prompt, path }) => ({
      personId,
      gender,
      prompt,
      status: "PLANNED",
      path,
      sha256: null,
      generator: null,
      generatedAt: null,
    }),
  );
  const result = await checkPeople({ fixtures: value, requirePortraits: true });
  assert.equal(result.ok, false);
  assert.equal(result.sourceComparison, "not-run");
  assert.ok(codes(result).includes("SOURCE_REQUIRED"));
  assert.ok(codes(result).includes("PORTRAITS_INCOMPLETE"));
});

test("unreadable source fails safely without disclosing its path", async () => {
  const result = await checkPeople({
    fixtures,
    sourcePath: "/private/synthetic-missing.xlsx",
    requirePortraits: false,
  });
  assert.deepEqual(result, {
    ok: false,
    sourceComparison: "not-run",
    errors: [{ code: "SOURCE_INVALID" }],
  });
});

test("canonical strict CLI fails SOURCE_REQUIRED without --input", () => {
  const result = spawnSync(process.execPath, ["scripts/people/check.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.ok(codes(JSON.parse(result.stdout)).includes("SOURCE_REQUIRED"));
  assert.equal(result.stderr, "");
});

test("fixture CLI explicitly reports source comparison not-run", () => {
  const result = spawnSync(process.execPath, ["scripts/people/check.mjs", "--fixtures"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    ok: true,
    sourceComparison: "not-run",
    errors: [],
  });
});

test("READY flags cannot pass release without human approval, original source and actual files", async () => {
  const value = copy();
  for (const [index, portrait] of value.portraits.portraits.entries()) {
    portrait.status = "READY";
    portrait.prompt = "Synthetic adult portrait";
    portrait.generator = "imagegen";
    portrait.generatedAt = "2026-10-16T00:00:00.000Z";
    portrait.sha256 = index.toString(16).padStart(64, "0");
  }
  const result = await checkPeople({ fixtures: value, requirePortraits: true });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("SOURCE_REQUIRED"));
  assert.ok(codes(result).includes("PORTRAIT_FILE_INVALID"));
  assert.ok(codes(result).includes("PORTRAITS_INCOMPLETE"));
  assert.ok(codes(result).includes("HUMAN_REVIEW_REQUIRED"));
});

test("fixture mode rejects fabricated READY without documented human PASS", async () => {
  const value = copy();
  const portrait = value.portraits.portraits[0];
  Object.assign(portrait, {
    status: "READY",
    prompt: "Fictional adult in suit",
    generator: "imagegen",
    generatedAt: "2026-10-16T00:00:00.000Z",
    sha256: "a".repeat(64),
    review: {
      actor: "ai",
      reviewer: "AI inspection",
      reviewedAt: "2026-10-16T00:00:00.000Z",
      verdict: "PASS",
      sha256: "a".repeat(64),
      evidence: "AI inspection is not human approval",
    },
  });
  const result = await checkPeople({ fixtures: value });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("HUMAN_REVIEW_REQUIRED"));
});

test("malformed READY metadata returns safe errors instead of throwing", async () => {
  const value = copy();
  for (const portrait of value.portraits.portraits) portrait.status = "READY";
  value.portraits.portraits[0].prompt = null;
  value.portraits.portraits[1].generator = 123;
  const result = await checkPeople({ fixtures: value, requirePortraits: true });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes("PORTRAIT_MANIFEST_INVALID"));
  assert.ok(codes(result).includes("PORTRAIT_METADATA_INCOMPLETE"));
});

for (const [name, mutate] of [
  [
    "null entry",
    (value) => {
      value.people.people[0] = null;
    },
  ],
  [
    "array department entry",
    (value) => {
      value.departments.departments[0] = [];
    },
  ],
  [
    "missing assignments",
    (value) => {
      delete value.people.assignments;
    },
  ],
]) {
  test(`malformed ${name} fails closed`, async () => {
    const value = copy();
    mutate(value);
    const result = await checkPeople({ fixtures: value });
    assert.deepEqual(result, {
      ok: false,
      sourceComparison: "not-run",
      errors: [{ code: "FIXTURE_SCHEMA_INVALID" }],
    });
  });
}

test("strict CLI does not accept fixture mode mixed with release", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/people/check.mjs", "--release", "--fixtures"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).sourceComparison, "not-run");
});

test("v2 upper catalog preserves every public option and fixture validation; legacy v1 still works", async () => {
  const value = copy();
  value.departments.schemaVersion = 2;
  value.departments.departments.push({
    id: "SOL-D999",
    name: "합성본부",
    kind: "DIVISION",
    parentId: null,
    targetCount: null,
    sourceCount: null,
  });
  assert.deepEqual(
    projectSignupOptions(value.departments, value.jobTitles),
    fixtures.signupOptions,
  );
  assert.equal((await checkPeople({ fixtures: value })).ok, true);
  const legacy = copy();
  legacy.departments.schemaVersion = 1;
  legacy.departments.departments = legacy.departments.departments
    .filter((row) => row.kind == null || row.kind === "TEAM")
    .map(({ kind, parentId, parentReason, ...rest }) => rest);
  assert.equal((await checkPeople({ fixtures: legacy })).ok, true);
});

test("known-team names and allocation weights cannot drift even with a matching public projection", async () => {
  const value = copy();
  value.departments.departments[0].name = "합성 변경팀";
  value.signupOptions.departments[0].label = "합성 변경팀";
  assert.ok(codes(await checkPeople({ fixtures: value })).includes("CATALOG_INVALID"));
});
