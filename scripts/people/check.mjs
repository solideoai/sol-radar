import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { allocatePeople } from "./allocation.mjs";
import { generatePeople, projectSignupOptions } from "./generate.mjs";
import { normalizeSourceName } from "./names.mjs";
import { readOrganizationWorkbook } from "./workbook.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE_SHA256 = "d4febca8607f628d4fd405c5dac423d2eb0b7f6d4ab926f691ec45488b79a4c3";
const TITLES = [
  "CFO",
  "사장",
  "부사장",
  "이사",
  "본부장",
  "그룹장",
  "팀장",
  "소장",
  "수석",
  "책임",
  "담당",
  "인턴",
];
const STARTS_AT = "2026-12-01";
const ENDS_AT = "2027-07-01";
const idAt = (prefix, index, length) => `${prefix}${String(index + 1).padStart(length, "0")}`;
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const hashPattern = /^[a-f0-9]{64}$/;
const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const unique = (values) => new Set(values).size === values.length;

async function loadFixtures() {
  const json = async (filename) => JSON.parse(await readFile(path.join(ROOT, filename), "utf8"));
  const [departments, jobTitles, people, portraits, signupOptions] = await Promise.all([
    json("fixtures/people/solideo.departments.json"),
    json("fixtures/people/solideo.job-titles.json"),
    json("fixtures/people/solideo.people.json"),
    json("fixtures/people/solideo.portraits.json"),
    json("web/server/profile/signup-options.generated.json"),
  ]);
  return { departments, jobTitles, people, portraits, signupOptions };
}

function validEnvelopes(fixtures) {
  if (!isRecord(fixtures)) return false;
  return (
    [
      [fixtures.departments, 1, "departments"],
      [fixtures.jobTitles, 1, "jobTitles"],
      [fixtures.people, "solideo-people/v1.0", "people"],
      [fixtures.portraits, "solideo-portraits/v1.0", "portraits"],
    ].every(
      ([value, schemaVersion, key]) =>
        isRecord(value) &&
        value.companyName === "솔리데오" &&
        value.schemaVersion === schemaVersion &&
        Array.isArray(value[key]) &&
        value[key].every(isRecord),
    ) &&
    Array.isArray(fixtures.people.assignments) &&
    fixtures.people.assignments.every(isRecord) &&
    validTime(fixtures.people.asOf)
  );
}

function checkCatalogs(fixtures, add) {
  const { departments: catalog, jobTitles: titleCatalog } = fixtures;
  const departments = catalog.departments;
  const titles = titleCatalog.jobTitles;
  if (
    catalog.sourceSha256 !== SOURCE_SHA256 ||
    catalog.sourceRowCount !== 250 ||
    catalog.excludedRowCount !== 75 ||
    !Array.isArray(catalog.excludedSourceRanges) ||
    departments.length !== 38 ||
    titles.length !== 12 ||
    !unique(departments.map((department) => department.name)) ||
    departments.some(
      (department, index) =>
        department.id !== idAt("SOL-D", index, 3) ||
        typeof department.name !== "string" ||
        !department.name.trim() ||
        department.name !== department.name.trim() ||
        !Array.isArray(department.sourceRanges),
    ) ||
    titles.some(
      (title, index) =>
        title.id !== idAt("SOL-J", index, 3) ||
        title.label !== TITLES[index] ||
        title.sortOrder !== index + 1,
    ) ||
    departments.reduce((sum, department) => sum + department.sourceCount, 0) !== 175
  )
    add("CATALOG_INVALID");
  try {
    const allocations = allocatePeople(departments);
    for (const allocation of allocations) {
      const department = departments.find((entry) => entry.id === allocation.departmentId);
      const people = fixtures.people.people.filter(
        (person) => person.departmentId === department.id,
      );
      if (
        department.targetCount !== allocation.targetCount ||
        people.length !== allocation.targetCount ||
        people.filter((person) => person.gender === "MALE").length !== allocation.maleCount ||
        people.some((person) => !Object.hasOwn(allocation.titleCounts, person.jobTitleId)) ||
        Object.entries(allocation.titleCounts).some(
          ([id, count]) => people.filter((person) => person.jobTitleId === id).length !== count,
        )
      )
        add("ALLOCATION_MISMATCH");
    }
    const ids = new Set(titles.map((title) => title.id));
    if (
      departments.some((department) =>
        Object.keys(department.titleCounts).some((id) => !ids.has(id)),
      )
    )
      add("TITLE_COUNTS_INVALID");
    for (const title of titles)
      if (
        title.sourceCount !==
          departments.reduce(
            (sum, department) => sum + (department.titleCounts[title.id] ?? 0),
            0,
          ) ||
        title.targetCount !==
          fixtures.people.people.filter((person) => person.jobTitleId === title.id).length
      )
        add("TITLE_COUNTS_INVALID");
  } catch {
    add("ALLOCATION_MISMATCH");
  }
  if (!isDeepStrictEqual(projectSignupOptions(catalog, titleCatalog), fixtures.signupOptions))
    add("PUBLIC_PROJECTION_MISMATCH");
}

function checkRoster(fixtures, add) {
  const people = fixtures.people.people;
  if (people.length !== 200) add("PEOPLE_COUNT_INVALID");
  const names = new Set();
  const departments = new Set(fixtures.departments.departments.map((department) => department.id));
  const titles = new Set(fixtures.jobTitles.jobTitles.map((title) => title.id));
  for (const [index, person] of people.entries()) {
    if (
      person.personId !== idAt("SOL-P", index, 4) ||
      typeof person.name !== "string" ||
      !/^[가-힣]{3}$/.test(person.name) ||
      names.has(person.name) ||
      !["MALE", "FEMALE"].includes(person.gender) ||
      !departments.has(person.departmentId) ||
      !titles.has(person.jobTitleId) ||
      person.isDemo !== true ||
      person.portraitPath !== `/demo/people/${person.personId}.png`
    )
      add("PERSON_INVALID", person.personId);
    names.add(person.name);
  }
  if (
    people.filter((person) => person.gender === "MALE").length !== 100 ||
    people.filter((person) => person.gender === "FEMALE").length !== 100
  )
    add("GENDER_COUNTS_INVALID");
  const roleCounts = { PM: 2, PL: 4, DEVELOPER: 18, DATA_AI: 3 };
  if (
    people.filter((person) => person.scoringEligible === true).length !== 27 ||
    people.filter((person) => person.scoringEligible === false).length !== 173 ||
    Object.entries(roleCounts).some(
      ([role, count]) =>
        people.filter((person) => person.scoringEligible === true && person.role === role)
          .length !== count,
    )
  )
    add("SCORING_INVALID");
  for (const person of people) {
    const eligible = person.scoringEligible === true;
    const expectedAvailability = eligible ? [{ startsAt: STARTS_AT, endsAt: ENDS_AT, fte: 1 }] : [];
    if (
      !isDeepStrictEqual(person.availability, expectedAvailability) ||
      (eligible
        ? !Object.hasOwn(roleCounts, person.role) ||
          typeof person.grade !== "string" ||
          !person.grade ||
          !Array.isArray(person.skills) ||
          !person.skills.length ||
          person.skills.some((skill) => typeof skill !== "string" || !skill)
        : person.role !== "OTHER" || person.grade !== null || !isDeepStrictEqual(person.skills, []))
    )
      add("SCORING_INVALID", person.personId);
  }
  const expectedAssignments = Array.from({ length: 7 }, (_, index) => ({
    personId: idAt("SOL-P", (index * 37 + 11) % 200, 4),
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    allocationPercent: 100,
  }));
  if (
    !isDeepStrictEqual(fixtures.people.assignments, expectedAssignments) ||
    fixtures.people.assignments.some(
      (assignment) =>
        !people.some(
          (person) => person.personId === assignment.personId && person.scoringEligible === true,
        ),
    )
  )
    add("ASSIGNMENTS_INVALID");
}

async function checkPortraits(fixtures, requirePortraits, add) {
  const portraits = fixtures.portraits.portraits;
  const people = fixtures.people.people;
  if (portraits.length !== 200) add("PORTRAIT_MANIFEST_INVALID");
  for (const [index, portrait] of portraits.entries()) {
    const person = people[index];
    if (
      !person ||
      portrait.personId !== person.personId ||
      portrait.gender !== person.gender ||
      portrait.path !== person.portraitPath ||
      !["PLANNED", "GENERATED", "READY", "FAILED"].includes(portrait.status) ||
      typeof portrait.prompt !== "string" ||
      !(
        portrait.sha256 === null ||
        (typeof portrait.sha256 === "string" && hashPattern.test(portrait.sha256))
      ) ||
      !(portrait.generator === null || typeof portrait.generator === "string") ||
      !(portrait.generatedAt === null || validTime(portrait.generatedAt))
    )
      add("PORTRAIT_MANIFEST_INVALID", portrait.personId);
  }
  if (!requirePortraits) return;
  if (portraits.length !== 200 || portraits.some((portrait) => portrait.status !== "READY")) {
    add("PORTRAITS_INCOMPLETE");
    return;
  }
  if (
    !unique(portraits.map((portrait) => portrait.path)) ||
    !unique(portraits.map((portrait) => portrait.sha256))
  )
    add("PORTRAITS_NOT_UNIQUE");
  for (const portrait of portraits) {
    if (
      typeof portrait.personId !== "string" ||
      !/^SOL-P(?:00\d\d|01\d\d|0200)$/.test(portrait.personId) ||
      portrait.path !== `/demo/people/${portrait.personId}.png`
    )
      continue;
    if (
      typeof portrait.prompt !== "string" ||
      !portrait.prompt.trim() ||
      typeof portrait.generator !== "string" ||
      !portrait.generator.trim() ||
      !validTime(portrait.generatedAt) ||
      typeof portrait.sha256 !== "string" ||
      !hashPattern.test(portrait.sha256)
    )
      add("PORTRAIT_METADATA_INCOMPLETE", portrait.personId);
    try {
      const bytes = await readFile(path.join(ROOT, "web/public", portrait.path));
      if (
        bytes.length < 33 ||
        bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        bytes.subarray(12, 16).toString("ascii") !== "IHDR" ||
        bytes.readUInt32BE(16) <= 0 ||
        bytes.readUInt32BE(16) !== bytes.readUInt32BE(20) ||
        createHash("sha256").update(bytes).digest("hex") !== portrait.sha256
      )
        add("PORTRAIT_FILE_INVALID", portrait.personId);
    } catch {
      add("PORTRAIT_FILE_INVALID", portrait.personId);
    }
  }
}

async function compareSource(fixtures, sourcePath, add) {
  try {
    const catalog = fixtures.departments;
    const source = await readOrganizationWorkbook(
      sourcePath,
      catalog.departments,
      catalog.excludedSourceRanges,
    );
    if (
      source.unmappedCells.length ||
      source.sourceSha256 !== SOURCE_SHA256 ||
      source.sourceSha256 !== catalog.sourceSha256 ||
      source.recognizedRows !== 175 ||
      source.excludedRowCount !== 75 ||
      source.recognizedRows + source.excludedRowCount !== 250 ||
      !isDeepStrictEqual(source.departments, catalog.departments)
    ) {
      add("SOURCE_MISMATCH");
      return false;
    }
    const exclusions = new Set([...source.excludedNames].map(normalizeSourceName));
    if (
      fixtures.people.people.some(
        (person) =>
          typeof person.name === "string" && exclusions.has(normalizeSourceName(person.name)),
      )
    ) {
      add("SOURCE_NAME_COLLISION");
      return false;
    }
    const expected = generatePeople({
      departments: source.departments,
      jobTitles: fixtures.jobTitles.jobTitles,
      excludedNames: source.excludedNames,
    });
    if (
      !isDeepStrictEqual(expected.people, fixtures.people.people) ||
      !isDeepStrictEqual(expected.assignments, fixtures.people.assignments)
    ) {
      add("ROSTER_STABILITY_MISMATCH");
      return false;
    }
    return true;
  } catch {
    add("SOURCE_INVALID");
    return false;
  }
}

/** Fixture-only checks never imply that the private original was available in CI. */
export async function checkPeople({ fixtures, sourcePath, requirePortraits = false } = {}) {
  const errors = [];
  const add = (code, personId) => {
    const safeId =
      typeof personId === "string" && /^SOL-P\d{4}$/.test(personId) ? personId : undefined;
    if (!errors.some((error) => error.code === code && error.personId === safeId))
      errors.push(safeId ? { code, personId: safeId } : { code });
  };
  let sourceComparison = "not-run";
  if (requirePortraits && !sourcePath) add("SOURCE_REQUIRED");
  try {
    fixtures ??= await loadFixtures();
  } catch {
    add("FIXTURE_READ_FAILED");
  }
  if (!validEnvelopes(fixtures)) add("FIXTURE_SCHEMA_INVALID");
  else {
    checkCatalogs(fixtures, add);
    checkRoster(fixtures, add);
    await checkPortraits(fixtures, requirePortraits, add);
    if (sourcePath && (await compareSource(fixtures, sourcePath, add))) sourceComparison = "passed";
  }
  return { ok: errors.length === 0, sourceComparison, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // pnpm forwards the user's separator for `pnpm people:check -- --input ...`.
  const args = process.argv.slice(2).filter((arg) => arg !== "--");
  const fixtureMode = args.length === 1 && args[0] === "--fixtures";
  const requirePortraits = args[0] === "--release";
  const inputArgs = requirePortraits ? args.slice(1) : args;
  const validInput = inputArgs.length === 2 && inputArgs[0] === "--input" && !!inputArgs[1];
  const result =
    !fixtureMode && !validInput
      ? {
          ok: false,
          sourceComparison: "not-run",
          errors: [
            { code: inputArgs.includes("--input") ? "INVALID_ARGUMENTS" : "SOURCE_REQUIRED" },
          ],
        }
      : await checkPeople({ sourcePath: fixtureMode ? undefined : inputArgs[1], requirePortraits });
  console.log(JSON.stringify(result));
  if (!result.ok) process.exitCode = 1;
}
