import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { availableFte, toPeopleProfile, toScoringTeam, type ScoringPerson } from "./scoring.model";

const fixture = JSON.parse(
  readFileSync(new URL("../../../fixtures/people/solideo.people.json", import.meta.url), "utf8"),
) as {
  people: ScoringPerson[];
  assignments: { personId: string; startsAt: string; endsAt: string; allocationPercent: number }[];
  asOf: string;
};
const period = { startsAt: "2026-12-01", endsAt: "2027-07-01" };
const person: ScoringPerson = {
  personId: "synthetic",
  scoringEligible: true,
  role: "DEVELOPER",
  grade: "중급",
  skills: ["Java"],
  availability: [{ ...period, fte: 1 }],
};
const capacity = (windows = person.availability, assignments: typeof fixture.assignments = []) =>
  availableFte(
    toScoringTeam([{ ...person, availability: windows }], assignments, fixture.asOf),
    period,
  );

// A regression that counts every roster row, leaks identity fields, ignores intervals, or
// hardcodes 20 FTE must fail these independent input mutations.
describe("people scoring snapshot", () => {
  it("projects all 200 employees and their seven assignments into the scoring snapshot", () => {
    const profile = toPeopleProfile(fixture.people, fixture.assignments, fixture.asOf);
    expect(profile.financials.employeeCount).toBe(200);
    expect(profile.team.members).toHaveLength(200);
    expect(profile.team.assignments).toHaveLength(7);
    expect(profile.team.asOf).toBe("2026-10-16T00:00:00.000Z");
    expect(
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
        ].map((role) => [
          role,
          profile.team.members.filter((member) => member.role === role).length,
        ]),
      ),
    ).toEqual({
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
    });
    expect(Object.keys(profile.team.members[0]).sort()).toEqual([
      "availability",
      "grade",
      "personId",
      "role",
      "skills",
    ]);
    expect(availableFte(profile.team, period)).toBe(95.5);
    expect(
      toPeopleProfile(fixture.people.slice(1), fixture.assignments, fixture.asOf).financials
        .employeeCount,
    ).toBe(199);
  });
  it("excludes explicitly disabled people before validating capacity and removes identity fields", () => {
    const baseline = fixture.people.map((member, index) => ({
      ...member,
      scoringEligible: index >= 3,
    }));
    const changed = baseline.map((member) => ({
      ...member,
      name: "changed",
      gender: "changed",
      portraitPath: "/changed.png",
      departmentId: "changed",
      jobTitleId: "changed",
      ...(member.scoringEligible
        ? {}
        : {
            skills: ["changed"],
            availability: [{ startsAt: "invalid", endsAt: "invalid", fte: -9 }],
          }),
    }));
    const extraAssignment = {
      personId: baseline[0].personId,
      startsAt: "invalid",
      endsAt: "invalid",
      allocationPercent: -9,
    };
    const expected = toScoringTeam(baseline, fixture.assignments, fixture.asOf);
    expect(expected.members).toHaveLength(197);
    expect(toScoringTeam(changed, [...fixture.assignments, extraAssignment], fixture.asOf)).toEqual(
      expected,
    );
    expect(availableFte(toScoringTeam(changed, fixture.assignments, fixture.asOf), period)).toBe(
      availableFte(expected, period),
    );
  });
  it("copies calculation arrays so later source mutations cannot change a saved snapshot", () => {
    const source = structuredClone([person]);
    const assignments = [{ personId: person.personId, ...period, allocationPercent: 25 }];
    const team = toScoringTeam(source, assignments, fixture.asOf);
    source[0].skills.push("changed");
    source[0].availability[0].fte = 0;
    assignments[0].allocationPercent = 100;
    expect(team.members[0].skills).toEqual(["Java"]);
    expect(availableFte(team, period)).toBe(0.75);
  });
});

describe("guaranteed full-period FTE, half-open intervals", () => {
  it("returns zero for no staff, a coverage gap or only a tiny overlap", () => {
    expect(availableFte(toScoringTeam([], [], fixture.asOf), period)).toBe(0);
    expect(capacity([{ startsAt: "2026-12-01", endsAt: "2026-12-02", fte: 1 }])).toBe(0);
    expect(
      capacity([
        { startsAt: "2026-12-01", endsAt: "2027-01-01", fte: 1 },
        { startsAt: "2027-02-01", endsAt: "2027-07-01", fte: 1 },
      ]),
    ).toBe(0);
  });
  it("joins adjacent coverage, uses the minimum capacity, and does not double-count overlapping windows", () => {
    expect(
      capacity([
        { startsAt: "2026-12-01", endsAt: "2027-01-01", fte: 1 },
        { startsAt: "2027-01-01", endsAt: "2027-07-01", fte: 0.5 },
      ]),
    ).toBe(0.5);
    expect(
      capacity([
        { ...period, fte: 0.5 },
        { ...period, fte: 0.75 },
      ]),
    ).toBe(0.75);
  });
  it("ignores assignments touching either boundary, excludes full allocations and reduces partial overlap", () => {
    const assignment = (startsAt: string, endsAt: string, allocationPercent = 100) => ({
      personId: person.personId,
      startsAt,
      endsAt,
      allocationPercent,
    });
    expect(
      capacity(undefined, [
        assignment("2026-11-01", period.startsAt),
        assignment(period.endsAt, "2027-08-01"),
      ]),
    ).toBe(1);
    expect(capacity(undefined, [assignment(period.startsAt, period.endsAt)])).toBe(0);
    expect(capacity(undefined, [assignment("2027-01-01", "2027-02-01", 25)])).toBe(0.75);
    expect(
      capacity(undefined, [
        assignment("2026-12-01", "2027-01-01", 25),
        assignment("2027-01-01", "2027-07-01", 50),
      ]),
    ).toBe(0.5);
    expect(
      capacity(undefined, [
        assignment("2026-12-01", "2027-03-01", 75),
        assignment("2027-02-01", "2027-07-01", 75),
      ]),
    ).toBe(0);
  });
  it("reflects eligible availability and assignment changes", () => {
    const team = toScoringTeam(fixture.people, fixture.assignments, fixture.asOf);
    expect(availableFte({ ...team, assignments: [] }, period)).toBe(102.5);
    const unassigned = team.members.find(
      (member) => !team.assignments.some((assignment) => assignment.personId === member.personId),
    )!;
    unassigned.availability = unassigned.availability.map((window) => ({ ...window, fte: 0 }));
    expect(availableFte(team, period)).toBe(95);
  });
  it("rejects invalid periods and capacity values instead of returning misleading FTE", () => {
    const team = toScoringTeam([person], [], fixture.asOf);
    for (const invalid of [
      { startsAt: "bad", endsAt: period.endsAt },
      { startsAt: period.endsAt, endsAt: period.startsAt },
      { startsAt: period.startsAt, endsAt: period.startsAt },
    ])
      expect(() => availableFte(team, invalid)).toThrow(RangeError);
    for (const fte of [-1, 1.1, Infinity, NaN])
      expect(() => capacity([{ ...period, fte }])).toThrow(RangeError);
    for (const allocationPercent of [-1, 101, Infinity, NaN])
      expect(() =>
        capacity(undefined, [{ personId: person.personId, ...period, allocationPercent }]),
      ).toThrow(RangeError);
    expect(() => capacity([{ startsAt: "bad", endsAt: period.endsAt, fte: 1 }])).toThrow(
      RangeError,
    );
    expect(() => toScoringTeam([person], [], "bad")).toThrow(RangeError);
  });
});

// docs/08 §6's other factor inputs are declared separately: this is NOT an
// extraction/score-engine integration golden or an 8/12-month bid-period test.
const workedExamples = [
  { id: "FX-01", requiredFte: 12, businessDays: 15, otherPoints: [24, 25, 15, 10] },
  { id: "FX-02", requiredFte: 20, businessDays: 7, otherPoints: [15, 18.3, 15, 10] },
  { id: "FX-03", requiredFte: 20, businessDays: 11, otherPoints: [20, 12.2, 9, 7] },
];
const workedTotals = (fte: number) =>
  workedExamples.map((example) =>
    Math.round(
      example.otherPoints.reduce((sum, points) => sum + points, 0) +
        20 *
          Math.min(1, fte / example.requiredFte) *
          (example.businessDays >= 10 ? 1 : example.businessDays >= 5 ? 0.7 : 0.4),
    ),
  );
describe("limited capacity plus separately declared worked-example factors", () => {
  it("preserves 94/72/68 using actually computed fixed-window FTE", () => {
    const fte = availableFte(
      toScoringTeam(fixture.people, fixture.assignments, fixture.asOf),
      period,
    );
    expect(workedTotals(fte)).toEqual([94, 72, 68]);
  });
  it("changes unsaturated staff factors and aggregates when computed capacity changes", () => {
    const changed = fixture.people.map((member) => ({
      ...member,
      availability: member.availability.map((window) => ({ ...window, fte: 0.05 })),
    }));
    const fte = availableFte(toScoringTeam(changed, fixture.assignments, fixture.asOf), period);
    expect(fte).toBeCloseTo(9.65);
    expect(workedTotals(fte)).toEqual([90, 65, 58]);
    expect(workedTotals(fte)).not.toEqual(workedTotals(95.5));
  });
});
