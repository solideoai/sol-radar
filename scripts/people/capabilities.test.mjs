import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assignmentsOf, foldAssignmentsIntoAvailability } from "./availability.mjs";
import { generateCapabilities, enrichPeople } from "./capabilities.mjs";
import { checkPeople } from "./check.mjs";

const roster = JSON.parse(
  await readFile(new URL("../../fixtures/people/solideo.people.json", import.meta.url), "utf8"),
);
// 운영 DB 에 이미 들어간 v1 값(20261021000600 이 적용한 200명).
const v1Rows = JSON.parse(
  (
    await readFile(
      new URL(
        "../../supabase/migrations/20261021000600_enrich_all_demo_people.sql",
        import.meta.url,
      ),
      "utf8",
    )
  ).match(/\$profiles\$(.*)\$profiles\$/s)[1],
);
const ROLES = new Set([
  "DEVELOPER",
  "DATA_AI",
  "DEVOPS",
  "QA",
  "DESIGNER",
  "BUSINESS_ANALYST",
  "SECURITY",
  "DBA",
  "PM",
  "PL",
]);
// 가상 지역·기관 이름으로만 시작한다. 실존 부처·지자체(행정안전부·서울특별시 등)는 여기에 걸린다.
const FICTIONAL_CLIENT = /^(한빛|새솔|가람|다온|하늬|라온|누리|윤슬)/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

test("all 200 synthetic employees have reproducible skills, certificates, projects and capacity", () => {
  const people = enrichPeople(roster.people);
  assert.equal(people.length, 200);
  assert.equal(people.filter((person) => person.scoringEligible).length, 200);
  for (const person of people) {
    assert.ok(person.skills.length >= 1);
    assert.ok(person.certifications.length >= 1);
    assert.ok(person.pastProjects.length >= 1);
    assert.equal(person.capabilitySource, "SYNTHETIC");
    assert.equal(person.capabilityVersion, "synthetic-people/v2");
    assert.ok(
      person.availability.every(
        (window) => window.startsAt < window.endsAt && window.fte >= 0 && window.fte <= 1,
      ),
    );
    assert.ok(
      person.certifications.every(
        (cert) => cert.isDemo === true && cert.evidenceRef.startsWith("synthetic:"),
      ),
    );
    assert.ok(
      person.pastProjects.every(
        (project) =>
          project.isDemo === true &&
          project.startsAt < project.endsAt &&
          project.endsAt <= "2026-09-01",
      ),
    );
  }
  assert.deepEqual(enrichPeople(people), people);
  const first = people[0];
  const changedIdentity = {
    ...first,
    name: "다른이름",
    gender: "OTHER",
    jobTitleId: "CHANGED",
    departmentId: "CHANGED",
  };
  assert.deepEqual(
    generateCapabilities(first.personId),
    generateCapabilities(changedIdentity.personId),
  );
});

test("each employee has 3-5 chronological projects with fictional clients, own skills and senior-only lead roles", () => {
  const people = enrichPeople(roster.people);
  const firstStarts = Object.fromEntries(
    ["초급", "중급", "고급", "특급"].map((grade) => [grade, []]),
  );
  for (const person of people) {
    const projects = person.pastProjects;
    assert.ok(projects.length >= 3 && projects.length <= 5, person.personId);
    assert.equal(new Set(projects.map((project) => project.name)).size, projects.length);
    firstStarts[person.grade].push(projects[0].startsAt);
    for (const [index, project] of projects.entries()) {
      assert.deepEqual(Object.keys(project), [
        "projectId",
        "name",
        "client",
        "domain",
        "role",
        "startsAt",
        "endsAt",
        "skills",
        "isDemo",
        "evidenceRef",
      ]);
      assert.equal(project.projectId, `SYN-${person.personId}-${index + 1}`);
      assert.equal(project.evidenceRef, `synthetic:${person.personId}:project:${index + 1}`);
      assert.equal(project.isDemo, true);
      assert.match(project.startsAt, ISO_DATE);
      assert.match(project.endsAt, ISO_DATE);
      assert.ok(project.startsAt < project.endsAt && project.endsAt <= "2026-09-01");
      if (index > 0) assert.ok(projects[index - 1].endsAt < project.startsAt, person.personId);
      assert.ok(project.skills.length > 0);
      assert.ok(project.skills.every((skill) => person.skills.includes(skill)));
      assert.ok(ROLES.has(project.role));
      if (project.role !== person.role)
        assert.ok(
          ["고급", "특급"].includes(person.grade) && ["PL", "PM"].includes(project.role),
          person.personId,
        );
      assert.match(project.client, FICTIONAL_CLIENT);
      assert.ok(project.name.startsWith(project.client.slice(0, 2)), project.name);
    }
  }
  assert.ok(people.some((person) => person.pastProjects.some((p) => p.role !== person.role)));
  // 등급이 높을수록 경력이 더 과거에서 시작한다.
  for (const [senior, junior] of [
    ["특급", "고급"],
    ["고급", "중급"],
    ["중급", "초급"],
  ])
    assert.ok(firstStarts[senior].toSorted().at(-1) < firstStarts[junior].toSorted()[0]);
});

test("v2 rewrites only project history: scoring inputs and certificates equal the cloud v1 rows", () => {
  const people = enrichPeople(roster.people);
  assert.equal(v1Rows.length, people.length);
  for (const [index, row] of v1Rows.entries()) {
    const person = people[index];
    assert.equal(row.person_code, person.personId);
    assert.equal(row.capability_version, "synthetic-people/v1");
    assert.deepEqual(
      {
        role: row.role,
        grade: row.grade,
        skills: row.skills,
        availability: row.availability,
        certifications: row.certifications,
        capabilitySource: row.capability_source,
      },
      {
        role: person.role,
        grade: person.grade,
        skills: person.skills,
        availability: foldAssignmentsIntoAvailability(
          person.availability,
          assignmentsOf(roster.assignments, person.personId),
        ),
        certifications: person.certifications,
        capabilitySource: person.capabilitySource,
      },
    );
  }
});

test("enrichment preserves every approved identity and original business assignment", () => {
  const enriched = enrichPeople(roster.people);
  for (const [index, person] of roster.people.entries()) {
    for (const key of [
      "personId",
      "name",
      "gender",
      "departmentId",
      "jobTitleId",
      "portraitPath",
      "isDemo",
    ])
      assert.deepEqual(enriched[index][key], person[key]);
  }
  assert.equal(roster.assignments.length, 7);
});

test("invalid person identifiers return structured validation errors without throwing", async () => {
  const files = {
    departments: "fixtures/people/solideo.departments.json",
    jobTitles: "fixtures/people/solideo.job-titles.json",
    people: "fixtures/people/solideo.people.json",
    portraits: "fixtures/people/solideo.portraits.json",
    signupOptions: "web/server/profile/signup-options.generated.json",
  };
  const fixtures = Object.fromEntries(
    await Promise.all(
      Object.entries(files).map(async ([key, path]) => [
        key,
        JSON.parse(await readFile(path, "utf8")),
      ]),
    ),
  );
  fixtures.people.people[0].personId = "SOL-P9999";
  const result = await checkPeople({ fixtures });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === "PERSON_INVALID"));
});
