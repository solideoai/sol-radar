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
// 직급별 기대(fixtures/people/solideo.job-titles.json). 생성기 표를 그대로 옮기지 않고 사람이 읽는 규칙으로 적는다.
const SENIOR = { grades: ["고급", "특급"], counts: [4, 5], mustLead: true };
const TITLE_RULES = {
  "SOL-J005": { grades: ["특급"], counts: [5, 5], mustLead: true }, // 본부장
  "SOL-J007": SENIOR, // 팀장
  "SOL-J009": SENIOR, // 수석
  "SOL-J010": { grades: ["중급", "고급"], counts: [3, 4] }, // 책임
  "SOL-J011": { grades: ["초급"], counts: [2, 3], neverLead: true }, // 담당
  "SOL-J012": { grades: ["초급"], counts: [1, 1], neverLead: true }, // 인턴
};

test("all 200 synthetic employees have reproducible skills, certificates, projects and capacity", () => {
  const people = enrichPeople(roster.people);
  assert.equal(people.length, 200);
  assert.equal(people.filter((person) => person.scoringEligible).length, 200);
  for (const person of people) {
    assert.ok(person.skills.length >= 1);
    assert.ok(person.certifications.length >= 1);
    assert.ok(person.pastProjects.length >= 1);
    assert.equal(person.capabilitySource, "SYNTHETIC");
    assert.equal(person.capabilityVersion, "synthetic-people/v3");
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
  // 이름·성별·부서는 계산 속성에 들어가지 않는다. 직급은 등급·이력을 정하고(v3), 모르는 직급은 거절한다.
  assert.deepEqual(
    enrichPeople([{ ...first, name: "다른이름", gender: "OTHER", departmentId: "CHANGED" }])[0],
    { ...first, name: "다른이름", gender: "OTHER", departmentId: "CHANGED" },
  );
  assert.throws(
    () => generateCapabilities(first.personId, "CHANGED"),
    /Unknown synthetic job title/,
  );
  assert.throws(
    () => generateCapabilities(first.personId, "toString"),
    /Unknown synthetic job title/,
  );
});

test("each employee has chronological projects sized by job title, with fictional clients, own skills and senior-only lead roles", () => {
  const people = enrichPeople(roster.people);
  const firstStarts = Object.fromEntries(
    ["초급", "중급", "고급", "특급"].map((grade) => [grade, []]),
  );
  for (const person of people) {
    const projects = person.pastProjects;
    const [minCount, maxCount] = TITLE_RULES[person.jobTitleId].counts;
    assert.ok(projects.length >= minCount && projects.length <= maxCount, person.personId);
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

test("grade and lead roles follow the job title: no senior intern, no junior team lead, leads have led", () => {
  const people = enrichPeople(roster.people);
  for (const person of people) {
    const rule = TITLE_RULES[person.jobTitleId];
    assert.ok(rule.grades.includes(person.grade), `${person.personId} ${person.grade}`);
    const led = person.pastProjects.some((project) => ["PL", "PM"].includes(project.role));
    if (rule.mustLead) assert.ok(led, person.personId);
    if (rule.neverLead && !["PL", "PM"].includes(person.role)) assert.ok(!led, person.personId);
  }
  const titles = new Set(people.map((person) => person.jobTitleId));
  for (const id of ["SOL-J005", "SOL-J007", "SOL-J009", "SOL-J010", "SOL-J011", "SOL-J012"])
    assert.ok(titles.has(id), id);
});

test("v3 keeps every scoring computation input and certificate equal to the cloud v1 rows", () => {
  const people = enrichPeople(roster.people);
  assert.equal(v1Rows.length, people.length);
  for (const [index, row] of v1Rows.entries()) {
    const person = people[index];
    assert.equal(row.person_code, person.personId);
    assert.equal(row.capability_version, "synthetic-people/v1");
    assert.deepEqual(
      {
        role: row.role,
        skills: row.skills,
        availability: row.availability,
        certifications: row.certifications,
        capabilitySource: row.capability_source,
      },
      {
        role: person.role,
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
