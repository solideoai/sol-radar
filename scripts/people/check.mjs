import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  isTeamDepartment,
  validateDepartmentHierarchy,
  matchesSourceHierarchy,
} from "./departments.mjs";
import { allocatePeople } from "./allocation.mjs";
import { generatePeople, projectSignupOptions } from "./generate.mjs";
import { generateCapabilities } from "./capabilities.mjs";
import { assignEmails } from "./emails.mjs";
import { normalizeSourceName } from "./names.mjs";
import { readOrganizationWorkbook } from "./workbook.mjs";
import { validatePortraitAssets } from "./portraits.mjs";

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
        (key === "departments"
          ? [1, 2].includes(value.schemaVersion)
          : value.schemaVersion === schemaVersion) &&
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
  const departments = catalog.departments.filter(isTeamDepartment);
  const titles = titleCatalog.jobTitles;
  if (validateDepartmentHierarchy(catalog.departments, fixtures.people.people).errors.length)
    add("HIERARCHY_INVALID");
  if (
    catalog.sourceSha256 !== SOURCE_SHA256 ||
    catalog.sourceRowCount !== 250 ||
    catalog.excludedRowCount !== 75 ||
    !Array.isArray(catalog.excludedSourceRanges) ||
    departments.length !== 38 ||
    createHash("sha256")
      .update(
        JSON.stringify(
          departments.map(({ id, name, sourceCount, targetCount, sourceRanges, titleCounts }) => ({
            id,
            name,
            sourceCount,
            targetCount,
            sourceRanges,
            titleCounts,
          })),
        ),
      )
      .digest("hex") !== "77c2c9a91aec5d95b68822cc2fa667f54eac77524177ed4d5b7a6ef368eaf4a1" ||
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
  const departments = new Set(
    fixtures.departments.departments.filter(isTeamDepartment).map((department) => department.id),
  );
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
  try {
    const expected = assignEmails(people);
    for (const [index, person] of people.entries())
      if (person.email !== expected[index].email) add("EMAIL_INVALID", person.personId);
  } catch {
    add("EMAIL_INVALID");
  }
  for (const person of people) {
    try {
      const expected = generateCapabilities(person.personId, person.jobTitleId);
      if (Object.entries(expected).some(([key, value]) => !isDeepStrictEqual(person[key], value)))
        add("SCORING_INVALID", person.personId);
    } catch {
      add("SCORING_INVALID", person.personId);
    }
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
  if (fixtures.portraits.portraits.length !== 200) {
    add("PORTRAIT_MANIFEST_INVALID");
    if (requirePortraits) add("PORTRAITS_INCOMPLETE");
  }
  const errors = await validatePortraitAssets(fixtures.people.people, fixtures.portraits, {
    requireReady: requirePortraits,
    checkFiles: requirePortraits,
  });
  for (const { code, personId } of errors) {
    add(code, personId);
    if (["INVALID_PATH", "GENDER_MISMATCH", "INVALID_PERSON_ID"].includes(code))
      add("PORTRAIT_MANIFEST_INVALID", personId);
    if (code === "DUPLICATE_IMAGE") add("PORTRAITS_NOT_UNIQUE");
    if (code === "HASH_MISMATCH") add("PORTRAIT_FILE_INVALID", personId);
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
      !isDeepStrictEqual(source.departments, catalog.departments.filter(isTeamDepartment)) ||
      !matchesSourceHierarchy(catalog, source.hierarchy)
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
