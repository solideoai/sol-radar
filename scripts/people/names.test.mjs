import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { format, resolveConfig } from "prettier";
import { readOrganizationWorkbook } from "./workbook.mjs";
import { normalizeSourceName, selectNames } from "./names.mjs";
import { generatePeople } from "./generate.mjs";

const departments = [
  { id: "SOL-D001", sourceCount: 2, titleCounts: { "SOL-J010": 1, "SOL-J011": 1 } },
  { id: "SOL-D002", sourceCount: 1, titleCounts: { "SOL-J011": 1 } },
];
const jobTitles = [
  { id: "SOL-J010", label: "책임" },
  { id: "SOL-J011", label: "담당" },
];
const input = () => ({ departments, jobTitles, excludedNames: new Set() });

test("normalizes whitespace and ASCII, full-width and bracket annotations", () => {
  for (const value of [" 가 나 다 (합성 메모) ", "가\t나\n다（합성）", "가나다[합성]"]) {
    assert.equal(normalizeSourceName(value), "가나다");
  }
});

test("skips normalized source names and tracks uniqueness across genders", () => {
  const initial = selectNames({
    gender: "MALE",
    count: 4,
    excludedNames: new Set(),
    usedNames: new Set(),
  });
  const usedNames = new Set([initial[2]]);
  const excludedNames = new Set([
    `${initial[0].split("").join(" ")} (합성)`,
    `${initial[1]}（합성）`,
  ]);
  const male = selectNames({ gender: "MALE", count: 100, excludedNames, usedNames });
  const female = selectNames({ gender: "FEMALE", count: 100, excludedNames, usedNames });
  assert.ok(!male.some((name) => initial.slice(0, 3).includes(name)));
  const names = [...male, ...female];
  assert.equal(new Set(names).size, 200);
  assert.ok(names.every((name) => /^[가-힣]{3}$/.test(name)));
  assert.ok(names.every((name) => name[0] !== name[1]));
  assert.ok(new Set(names.map((name) => name[0])).size >= 15);
  assert.equal(usedNames.size, 201);
});

test("fails candidate exhaustion atomically without disclosing private input", () => {
  const usedNames = new Set();
  const excludedNames = new Set(["비밀 합성인 (메모)"]);
  assert.throws(
    () => selectNames({ gender: "MALE", count: 1001, excludedNames, usedNames }),
    /^Error: Name candidates exhausted$/,
  );
  assert.equal(usedNames.size, 0);
});

for (const options of [
  { gender: "UNKNOWN", count: 1 },
  { gender: "MALE", count: -1 },
  { gender: "FEMALE", count: 1.5 },
]) {
  test(`rejects invalid name request ${JSON.stringify(options)}`, () => {
    assert.throws(
      () => selectNames({ ...options, excludedNames: new Set(), usedNames: new Set() }),
      /Invalid name request/,
    );
  });
}

test("generates stable IDs, valid references and one planned portrait per unique person", () => {
  const result = generatePeople(input());
  assert.equal(result.people.length, 200);
  assert.equal(new Set(result.people.map((person) => person.name)).size, 200);
  assert.equal(result.people.filter((person) => person.gender === "MALE").length, 100);
  assert.equal(result.people[0].personId, "SOL-P0001");
  assert.equal(result.people.at(-1).personId, "SOL-P0200");
  for (const person of result.people) {
    assert.ok(departments.some((department) => department.id === person.departmentId));
    assert.ok(jobTitles.some((title) => title.id === person.jobTitleId));
    assert.equal(person.isDemo, true);
    assert.equal(person.portraitPath, `/demo/people/${person.personId}.png`);
  }
  assert.deepEqual(
    result.portraits,
    result.people.map((person) => ({
      personId: person.personId,
      gender: person.gender,
      prompt: "",
      status: "PLANNED",
      path: person.portraitPath,
      sha256: null,
      generator: null,
      generatedAt: null,
    })),
  );
  assert.deepEqual(
    result,
    generatePeople({
      ...input(),
      departments: [...departments].reverse(),
      jobTitles: [...jobTitles].reverse(),
    }),
  );
});

test("keeps 27 independent scoring members and seven fake assignments leaving 20 FTE", () => {
  const result = generatePeople(input());
  const scoring = result.people.filter((person) => person.scoringEligible);
  assert.equal(scoring.length, 27);
  assert.deepEqual(
    Object.fromEntries(
      ["PM", "PL", "DEVELOPER", "DATA_AI"].map((role) => [
        role,
        scoring.filter((person) => person.role === role).length,
      ]),
    ),
    { PM: 2, PL: 4, DEVELOPER: 18, DATA_AI: 3 },
  );
  assert.ok(
    scoring.every(
      (person) =>
        person.availability.length === 1 &&
        person.availability[0].startsAt === "2026-12-01" &&
        person.availability[0].endsAt === "2027-07-01" &&
        person.availability[0].fte === 1,
    ),
  );
  assert.ok(
    result.people
      .filter((person) => !person.scoringEligible)
      .every((person) => person.role === "OTHER" && person.availability.length === 0),
  );
  assert.equal(result.assignments.length, 7);
  assert.equal(new Set(result.assignments.map((assignment) => assignment.personId)).size, 7);
  assert.ok(
    result.assignments.every(
      (assignment) =>
        scoring.some((person) => person.personId === assignment.personId) &&
        assignment.allocationPercent === 100 &&
        assignment.startsAt === "2026-12-01" &&
        assignment.endsAt === "2027-07-01",
    ),
  );
  assert.equal(
    scoring.reduce((sum, person) => sum + person.availability[0].fte, 0) -
      result.assignments.reduce((sum, assignment) => sum + assignment.allocationPercent / 100, 0),
    20,
  );
  const altered = generatePeople({
    ...input(),
    departments: [{ id: "SOL-D003", sourceCount: 1, titleCounts: { "SOL-J011": 1 } }],
  });
  assert.deepEqual(
    scoring.map(({ personId, role }) => ({ personId, role })),
    altered.people
      .filter((person) => person.scoringEligible)
      .map(({ personId, role }) => ({ personId, role })),
  );
});

test("preserves an existing roster and rejects mismatches without private diagnostics", () => {
  const result = generatePeople(input());
  assert.deepEqual(generatePeople({ ...input(), existingPeople: result.people }), result);
  for (const existingPeople of [
    result.people.slice(1),
    result.people.map((person, index) => (index ? person : { ...person, name: "가나다" })),
  ]) {
    assert.throws(
      () => generatePeople({ ...input(), existingPeople }),
      /^Error: Existing roster mismatch$/,
    );
  }
  assert.throws(
    () =>
      generatePeople({
        ...input(),
        existingPeople: result.people,
        excludedNames: new Set([result.people[0].name]),
      }),
    /^Error: Existing roster mismatch$/,
  );
});

test("rejects unknown title references before generating records", () => {
  assert.throws(() => generatePeople({ ...input(), jobTitles: [] }), /Invalid job title catalog/);
});

test("CLI regenerates safely, preserves reviewed/failed/candidate portrait state and refuses incompatible fixtures", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "sol-radar-generator-")));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  try {
    await mkdir(path.join(directory, "scripts/people"), { recursive: true });
    await mkdir(path.join(directory, "fixtures/people"), { recursive: true });
    for (const name of ["generate", "allocation", "departments", "names", "workbook", "portraits"])
      await cp(
        path.join(root, `scripts/people/${name}.mjs`),
        path.join(directory, `scripts/people/${name}.mjs`),
      );
    await cp(path.join(root, ".prettierrc.json"), path.join(directory, ".prettierrc.json"));
    await symlink(path.join(root, "node_modules"), path.join(directory, "node_modules"), "dir");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("people");
    sheet.getCell("A1").value = "합성팀";
    sheet.getCell("A2").value = "가 나다（합성）";
    sheet.getCell("B2").value = "책임";
    const sourcePath = path.join(directory, "synthetic.xlsx");
    await workbook.xlsx.writeFile(sourcePath);
    const source = await readOrganizationWorkbook(sourcePath, [
      {
        id: "SOL-D001",
        name: "합성팀",
        sourceRanges: [{ sheet: "people", headerCell: "A1", nameRange: "A2:A2", titleColumn: "B" }],
      },
    ]);
    const fixturePath = (name) => path.join(directory, `fixtures/people/solideo.${name}.json`);
    const save = (name, value) =>
      writeFile(fixturePath(name), JSON.stringify(value, null, 2) + "\n");
    const load = async (name) => JSON.parse(await readFile(fixturePath(name), "utf8"));
    await save("departments", {
      schemaVersion: 1,
      companyName: "솔리데오",
      sourceSha256: source.sourceSha256,
      sourceRowCount: 1,
      excludedRowCount: 0,
      excludedSourceRanges: [],
      departments: source.departments,
    });
    await save("job-titles", {
      schemaVersion: 1,
      companyName: "솔리데오",
      jobTitles: [jobTitles[0]],
    });
    const run = () =>
      execFileSync(
        process.execPath,
        [path.join(directory, "scripts/people/generate.mjs"), "--input", sourcePath],
        { encoding: "utf8", stdio: "pipe" },
      );
    assert.equal(JSON.parse(run()).totalSourceRows, 1);
    const roster = await readFile(fixturePath("people"), "utf8");
    assert.equal(
      roster,
      await format(roster, { ...(await resolveConfig(fixturePath("people"))), parser: "json" }),
    );
    const portraits = await load("portraits");
    portraits.portraits[0] = {
      ...portraits.portraits[0],
      prompt: "Synthetic adult portrait",
      status: "READY",
      sha256: "a".repeat(64),
      generator: "imagegen",
      generatedAt: "2026-10-16T00:00:00.000Z",
      review: {
        actor: "human",
        reviewer: "Synthetic test reviewer",
        reviewedAt: "2026-10-16T00:00:00.000Z",
        verdict: "PASS",
        sha256: "a".repeat(64),
        evidence: "Synthetic fixture human approval for this exact image hash",
      },
      candidate: {
        prompt: "Synthetic adult replacement portrait",
        status: "GENERATED",
        sha256: "b".repeat(64),
        generator: "imagegen",
        generatedAt: "2026-10-16T01:00:00.000Z",
      },
    };
    portraits.portraits[1] = {
      ...portraits.portraits[1],
      prompt: "Synthetic adult portrait awaiting retry",
      status: "FAILED",
      failure: "GENERATION_INTERRUPTED",
    };
    portraits.portraits[2] = {
      ...portraits.portraits[2],
      prompt: "Synthetic adult portrait awaiting human review",
      status: "GENERATED",
      sha256: "c".repeat(64),
      generator: "imagegen",
      generatedAt: "2026-10-16T00:00:00.000Z",
      review: {
        actor: "ai",
        reviewer: "Synthetic AI inspection",
        reviewedAt: "2026-10-16T00:00:00.000Z",
        verdict: "PASS",
        sha256: "c".repeat(64),
        evidence: "Synthetic AI review is not human approval",
      },
    };
    await save("portraits", portraits);
    run();
    assert.equal(await readFile(fixturePath("people"), "utf8"), roster);
    assert.deepEqual(await load("portraits"), portraits);
    for (const mutate of [
      (value) => {
        value.portraits[0].gender = "FEMALE";
      },
      (value) => {
        value.portraits[0].path = "/demo/people/../../private.png";
      },
      (value) => {
        value.portraits[0].review.actor = "ai";
      },
      (value) => {
        value.portraits[0].review.sha256 = "d".repeat(64);
      },
      (value) => {
        value.portraits[0].candidate.status = "READY";
      },
      (value) => {
        value.portraits[0].candidate.sha256 = "not-a-hash";
      },
      (value) => {
        value.portraits[0].unsupportedMetadata = "unsupported";
      },
    ]) {
      const incompatible = structuredClone(portraits);
      mutate(incompatible);
      await save("portraits", incompatible);
      assert.throws(
        run,
        (error) =>
          error.status === 1 && error.stderr.trim() === "Existing portrait manifest mismatch",
      );
      assert.deepEqual(await load("portraits"), incompatible);
      assert.equal(await readFile(fixturePath("people"), "utf8"), roster);
    }
    await save("portraits", portraits);
    portraits.portraits[0].personId = "INVALID";
    await save("portraits", portraits);
    assert.throws(
      run,
      (error) =>
        error.status === 1 && error.stderr.trim() === "Existing portrait manifest mismatch",
    );
    assert.equal(await readFile(fixturePath("people"), "utf8"), roster);
    portraits.portraits[0].personId = "SOL-P0001";
    await save("portraits", portraits);
    const changed = JSON.parse(roster);
    changed.people[0].name = "가나다";
    await save("people", changed);
    assert.throws(
      run,
      (error) => error.status === 1 && error.stderr.trim() === "Existing roster mismatch",
    );
    assert.deepEqual(await load("people"), changed);
    await save("people", null);
    assert.throws(
      run,
      (error) => error.status === 1 && error.stderr.trim() === "Existing roster mismatch",
    );
    assert.equal(await load("people"), null);
    await save("people", JSON.parse(roster));
    await save("portraits", null);
    assert.throws(
      run,
      (error) =>
        error.status === 1 && error.stderr.trim() === "Existing portrait manifest mismatch",
    );
    assert.equal(await load("portraits"), null);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
