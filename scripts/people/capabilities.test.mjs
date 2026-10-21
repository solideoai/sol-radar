import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { generateCapabilities, enrichPeople } from "./capabilities.mjs";
import { checkPeople } from "./check.mjs";

const roster = JSON.parse(
  await readFile(new URL("../../fixtures/people/solideo.people.json", import.meta.url), "utf8"),
);

test("all 200 synthetic employees have reproducible skills, certificates, projects and capacity", () => {
  const people = enrichPeople(roster.people);
  assert.equal(people.length, 200);
  assert.equal(people.filter((person) => person.scoringEligible).length, 200);
  for (const person of people) {
    assert.ok(person.skills.length >= 1);
    assert.ok(person.certifications.length >= 1);
    assert.ok(person.pastProjects.length >= 1);
    assert.equal(person.capabilitySource, "SYNTHETIC");
    assert.equal(person.capabilityVersion, "synthetic-people/v1");
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
          project.endsAt < "2026-10-16",
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
