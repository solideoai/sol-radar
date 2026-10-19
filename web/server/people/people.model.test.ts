import "server-only";
import { describe, expect, it } from "vitest";
import {
  buildPeopleDirectory,
  filterTeamMembers,
  parsePeopleQuery,
  toTeamMemberDetail,
} from "./people.model";

import { rows } from "./people.test-data";

describe("safe full people directory", () => {
  it("preserves all 200 people, 27 eligible and 173 null details", () => {
    const directory = buildPeopleDirectory(rows);
    expect(directory.summary).toEqual({ totalCount: 200, scoringCount: 27 });
    expect(directory.members).toHaveLength(200);
    expect(directory.members.filter((p) => p.scoringEligible)).toHaveLength(27);
    expect(
      rows.members
        .map((p) => toTeamMemberDetail(p, rows.scoring.find((s) => s.member_id === p.id) ?? null))
        .filter((p) => p.scoring === null),
    ).toHaveLength(173);
    expect(directory.jobTitles).toEqual(rows.jobTitles);
    expect(Object.keys(directory.members[0]).sort()).toEqual([
      "departmentId",
      "id",
      "isDemo",
      "jobTitleId",
      "name",
      "personCode",
      "portraitUrl",
      "scoringEligible",
    ]);
  });
  it("keeps hierarchy 6/4/38, 13 confirmed links/81 people and 29 unknown/119", () => {
    const { departments } = buildPeopleDirectory(rows);
    expect(
      ["DIVISION", "GROUP", "TEAM"].map(
        (kind) => departments.filter((d) => d.kind === kind).length,
      ),
    ).toEqual([6, 4, 38]);
    const teams = departments.filter((d) => d.kind === "TEAM");
    expect(teams.reduce((sum, d) => sum + (d.targetCount ?? 0), 0)).toBe(200);
    expect(teams.filter((d) => d.parentId !== null)).toHaveLength(13);
    expect(
      teams.filter((d) => d.parentId !== null).reduce((sum, d) => sum + d.memberCount, 0),
    ).toBe(81);
    expect(
      teams.filter((d) => d.parentId === null).reduce((sum, d) => sum + d.memberCount, 0),
    ).toBe(119);
    expect(departments.filter((d) => d.kind !== "DIVISION" && d.parentId === null)).toHaveLength(
      29,
    );
    expect(departments.filter((d) => d.kind !== "TEAM").every((d) => d.targetCount === null)).toBe(
      true,
    );
    expect(departments.find((d) => d.code === "SOL-D044")?.memberCount).toBe(34);
  });
  it("deduplicates IDs in ancestor rollups and retains true roots", () => {
    const directory = buildPeopleDirectory({
      ...rows,
      members: [...rows.members, rows.members[0]],
    });
    expect(directory.summary.totalCount).toBe(200);
    expect(directory.departments.find((d) => d.code === "SOL-D001")?.memberCount).toBe(14);
    expect(directory.departments.find((d) => d.code === "SOL-D044")?.memberCount).toBe(34);
    expect(
      directory.departments.filter((d) => d.kind === "DIVISION").every((d) => d.parentId === null),
    ).toBe(true);
  });
  it("rolls direct and nested teams up without inventing missing parents", () => {
    const division = {
      ...rows.departments[0],
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "DIV",
      kind: "DIVISION",
      parent_id: null,
      target_count: null,
    };
    const group = {
      ...division,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      code: "GROUP",
      kind: "GROUP",
      parent_id: division.id,
    };
    const direct = { ...rows.departments[0], parent_id: division.id };
    const nested = { ...rows.departments[1], parent_id: group.id };
    const unassigned = { ...rows.departments[2], parent_id: null };
    const members = [
      rows.members[0],
      { ...rows.members[1], department_id: nested.id },
      { ...rows.members[2], department_id: unassigned.id },
    ];
    const directory = buildPeopleDirectory({
      ...rows,
      departments: [division, group, direct, nested, unassigned],
      members: [...members, members[0]],
    });
    expect(directory.departments.map((d) => [d.code, d.memberCount, d.parentId])).toEqual([
      ["DIV", 2, null],
      ["GROUP", 1, division.id],
      [direct.code, 1, division.id],
      [nested.code, 1, group.id],
      [unassigned.code, 1, null],
    ]);
    expect(directory.members).toHaveLength(3);
  });
  it.each([
    null,
    "",
    "https://evil.test/photo.png",
    "//evil.test/x",
    "/demo/people/../secret.png",
    "/demo/people/SOL-P0002.png",
    "/demo/people/SOL-P0001.png?x=1",
  ])("projects unsafe or absent portrait %s to null", (portrait_path) => {
    expect(toTeamMemberDetail({ ...rows.members[0], portrait_path }, null).portraitUrl).toBeNull();
  });
  it("validates scoring shape, dates and numeric capacity", () => {
    const scoring = rows.scoring[0];
    expect(
      toTeamMemberDetail(
        rows.members.find((m) => m.id === scoring.member_id)!,
        scoring,
      ).scoring,
    ).toEqual({
      role: scoring.role,
      grade: scoring.grade,
      skills: scoring.skills,
      availability: scoring.availability,
    });
    for (const invalid of [
      { ...scoring, skills: [7] },
      { ...scoring, availability: [{ startsAt: "bad", endsAt: "2027-07-01", fte: 1 }] },
      { ...scoring, availability: [{ startsAt: "2027-07-01", endsAt: "2026-12-01", fte: 2 }] },
    ])
      expect(() => toTeamMemberDetail(rows.members[0], invalid)).toThrow();
  });
});
describe("strict directory query", () => {
  it("normalizes search and filters with a stable personCode/id sort", () => {
    const query = parsePeopleQuery(new URLSearchParams("q=%20김%20&scoring=0&limit=100"));
    expect(query).toEqual({ q: "김", scoring: "0", limit: 100 });
    const members = buildPeopleDirectory(rows).members;
    const found = filterTeamMembers([...members].reverse(), query);
    expect(found.every((p) => p.name.includes("김") && !p.scoringEligible)).toBe(true);
    expect(found.map((p) => p.personCode)).toEqual(found.map((p) => p.personCode).toSorted());
    expect(parsePeopleQuery(new URLSearchParams())).toEqual({ limit: 20 });
    expect(
      filterTeamMembers(members, {
        limit: 20,
        departmentId: rows.departments[0].id,
        jobTitleId: rows.jobTitles[6].id,
      }),
    ).toHaveLength(1);
  });
  it.each([
    "orgId=x",
    "unknown=x",
    "q=a&q=b",
    "limit=0",
    "limit=101",
    "limit=1.2",
    "limit=01",
    "scoring=true",
    "departmentId=SOL-D001",
    "jobTitleId=SOL-J007",
    `q=${"a".repeat(41)}`,
    "cursor=",
  ])("rejects %s", (query) => {
    expect(() => parsePeopleQuery(new URLSearchParams(query))).toThrow();
  });
});
