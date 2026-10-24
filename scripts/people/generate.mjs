import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { isTeamDepartment, matchesSourceHierarchy } from "./departments.mjs";
import { allocatePeople } from "./allocation.mjs";
import { selectNames } from "./names.mjs";
import { readOrganizationWorkbook } from "./workbook.mjs";
import { validatePortraitAssets } from "./portraits.mjs";
import { enrichPeople } from "./capabilities.mjs";
import { assignEmails } from "./emails.mjs";

const STARTS_AT = "2026-12-01";
const ENDS_AT = "2027-07-01";
// A fixed permutation spreads capacity roles through IDs without using gender or title.
const SCORING_ROLES = [
  "PM",
  "PM",
  ...Array(4).fill("PL"),
  ...Array(18).fill("DEVELOPER"),
  ...Array(3).fill("DATA_AI"),
];
const scoringByIndex = new Map(SCORING_ROLES.map((role, index) => [(index * 37 + 11) % 200, role]));
const personId = (index) => `SOL-P${String(index + 1).padStart(4, "0")}`;

/**
 * @param {{departments:import('./allocation.mjs').DepartmentWeight[],jobTitles:{id:string,label:string}[],excludedNames:Set<string>,existingPeople?:object[]}} options
 * @returns {{people:object[],portraits:object[],assignments:object[]}}
 */
export function generatePeople({ departments, jobTitles, excludedNames, existingPeople }) {
  const allocations = allocatePeople(departments);
  const titleIds = new Set(jobTitles.map((title) => title.id));
  if (
    !titleIds.size ||
    titleIds.size !== jobTitles.length ||
    jobTitles.some((title) => typeof title.id !== "string" || !title.id) ||
    allocations.some((department) =>
      Object.keys(department.titleCounts).some((id) => !titleIds.has(id)),
    )
  )
    throw new Error("Invalid job title catalog");
  const usedNames = new Set();
  const names = {
    MALE: selectNames({ gender: "MALE", count: 100, excludedNames, usedNames }),
    FEMALE: selectNames({ gender: "FEMALE", count: 100, excludedNames, usedNames }),
  };
  const nameOffsets = { MALE: 0, FEMALE: 0 };
  const people = [];
  for (const department of allocations) {
    const titles = Object.entries(department.titleCounts).flatMap(([id, count]) =>
      Array(count).fill(id),
    );
    for (let index = 0; index < department.targetCount; index++) {
      const gender = index < department.maleCount ? "MALE" : "FEMALE";
      const rosterIndex = people.length;
      const role = scoringByIndex.get(rosterIndex) ?? "OTHER";
      const id = personId(rosterIndex);
      people.push({
        personId: id,
        name: names[gender][nameOffsets[gender]++],
        gender,
        departmentId: department.departmentId,
        jobTitleId: titles[index],
        portraitPath: `/demo/people/${id}.png`,
        isDemo: true,
        scoringEligible: role !== "OTHER",
        role,
        grade: role === "OTHER" ? null : role === "DEVELOPER" ? "중급" : "고급",
        skills:
          role === "DEVELOPER"
            ? ["TypeScript", "Java"]
            : role === "DATA_AI"
              ? ["Python", "SQL"]
              : role === "OTHER"
                ? []
                : ["프로젝트 관리"],
        availability: role === "OTHER" ? [] : [{ startsAt: STARTS_AT, endsAt: ENDS_AT, fte: 1 }],
      });
    }
  }
  const enriched = assignEmails(enrichPeople(people));
  if (existingPeople !== undefined && !isDeepStrictEqual(existingPeople, enriched))
    throw new Error("Existing roster mismatch");
  const portraits = people.map((person) => ({
    personId: person.personId,
    gender: person.gender,
    prompt: "",
    status: "PLANNED",
    path: person.portraitPath,
    sha256: null,
    generator: null,
    generatedAt: null,
  }));
  const assignments = [...scoringByIndex.keys()].slice(0, 7).map((index) => ({
    personId: personId(index),
    startsAt: STARTS_AT,
    endsAt: ENDS_AT,
    allocationPercent: 100,
  }));
  return { people: enriched, portraits, assignments };
}

/** Public signup projection deliberately selects fields instead of spreading private catalogs. */
export function projectSignupOptions(departments, jobTitles) {
  return {
    companyName: "솔리데오",
    catalogVersion: "solideo-organization/v1.0",
    departments: departments.departments
      .filter(isTeamDepartment)
      .map(({ id, name }) => ({ id, label: name })),
    jobTitles: jobTitles.jobTitles.map(({ id, label }) => ({ id, label })),
  };
}

async function readJson(filename, optional = false) {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (optional && error.code === "ENOENT") return undefined;
    throw new Error("Unable to read fixture JSON");
  }
}

async function generateFromWorkbook(filename) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const fixturePath = (name) => path.join(root, "fixtures/people", `solideo.${name}.json`);
  const catalog = await readJson(fixturePath("departments"));
  const titleCatalog = await readJson(fixturePath("job-titles"));
  const source = await readOrganizationWorkbook(
    filename,
    catalog.departments,
    catalog.excludedSourceRanges,
  );
  if (
    source.unmappedCells.length ||
    source.sourceSha256 !== catalog.sourceSha256 ||
    source.recognizedRows + source.excludedRowCount !== catalog.sourceRowCount ||
    source.excludedRowCount !== catalog.excludedRowCount ||
    !isDeepStrictEqual(source.departments, catalog.departments.filter(isTeamDepartment)) ||
    !matchesSourceHierarchy(catalog, source.hierarchy)
  )
    throw new Error("Source catalog mismatch");
  const existing = await readJson(fixturePath("people"), true);
  const result = generatePeople({
    departments: source.departments,
    jobTitles: titleCatalog.jobTitles,
    excludedNames: source.excludedNames,
    existingPeople: existing?.people,
  });
  const roster = {
    schemaVersion: "solideo-people/v1.0",
    companyName: "솔리데오",
    asOf: "2026-10-16T00:00:00.000Z",
    assignments: result.assignments,
    people: result.people,
  };
  let portraitCatalog = {
    schemaVersion: "solideo-portraits/v1.0",
    companyName: "솔리데오",
    portraits: result.portraits,
  };
  if (existing !== undefined && !isDeepStrictEqual(existing, roster))
    throw new Error("Existing roster mismatch");
  const existingPortraits = await readJson(fixturePath("portraits"), true);
  if (existingPortraits !== undefined) {
    const valid =
      existingPortraits &&
      existingPortraits.schemaVersion === portraitCatalog.schemaVersion &&
      existingPortraits.companyName === portraitCatalog.companyName &&
      Array.isArray(existingPortraits.portraits) &&
      existingPortraits.portraits.length === result.portraits.length &&
      isDeepStrictEqual(
        Object.keys(existingPortraits).sort(),
        Object.keys(portraitCatalog).sort(),
      ) &&
      existingPortraits.portraits.every(
        (portrait) =>
          portrait &&
          typeof portrait === "object" &&
          !Array.isArray(portrait) &&
          Object.keys(portrait).every((key) =>
            [...Object.keys(result.portraits[0]), "review", "failure", "candidate"].includes(key),
          ),
      ) &&
      (
        await validatePortraitAssets(result.people, existingPortraits, {
          root,
          requireReady: false,
          checkFiles: false,
        })
      ).length === 0;
    if (!valid) throw new Error("Existing portrait manifest mismatch");
    portraitCatalog = existingPortraits;
  }
  const allocations = allocatePeople(source.departments);
  const departmentCatalog = {
    ...catalog,
    departments: catalog.departments.map((department) => ({
      ...department,
      targetCount: isTeamDepartment(department)
        ? allocations.find((entry) => entry.departmentId === department.id).targetCount
        : null,
    })),
  };
  const calculatedTitles = {
    ...titleCatalog,
    jobTitles: titleCatalog.jobTitles.map((title) => ({
      ...title,
      sourceCount: source.departments.reduce(
        (sum, department) => sum + (department.titleCounts[title.id] ?? 0),
        0,
      ),
      targetCount: result.people.filter((person) => person.jobTitleId === title.id).length,
    })),
  };
  const formatOptions = await resolveConfig(fixturePath("people"));
  for (const [name, value] of [
    ["departments", departmentCatalog],
    ["job-titles", calculatedTitles],
    ["people", roster],
    ["portraits", portraitCatalog],
  ])
    await writeFile(
      fixturePath(name),
      await format(JSON.stringify(value, null, 2), { ...formatOptions, parser: "json" }),
    );
  const publicPath = path.join(root, "web/server/profile/signup-options.generated.json");
  await mkdir(path.dirname(publicPath), { recursive: true });
  await writeFile(
    publicPath,
    await format(JSON.stringify(projectSignupOptions(departmentCatalog, calculatedTitles)), {
      ...formatOptions,
      parser: "json",
    }),
  );
  console.log(
    JSON.stringify({
      weightedRows: source.recognizedRows,
      excludedRows: source.excludedRowCount,
      totalSourceRows: source.recognizedRows + source.excludedRowCount,
      unmappedRows: source.unmappedCells.length,
      departments: source.departments.length,
      people: result.people.length,
      male: 100,
      female: 100,
      scoringMembers: result.people.filter((person) => person.scoringEligible).length,
    }),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 2 || args[0] !== "--input" || !args[1])
      throw new Error("Usage: node scripts/people/generate.mjs --input <external workbook>");
    await generateFromWorkbook(args[1]);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
