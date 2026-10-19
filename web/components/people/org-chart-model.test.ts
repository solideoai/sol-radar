import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Department, TeamMemberListItem } from "@/server/people";
import { buildOrgChart } from "./org-chart-model";
const fixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../../fixtures/people/solideo.${name}.json`, import.meta.url), "utf8"),
  );
const departments = fixture<{
  departments: {
    id: string;
    name: string;
    kind: Department["kind"];
    parentId: string | null;
    targetCount: number | null;
  }[];
}>("departments").departments.map((item) => ({ ...item, code: item.id, memberCount: 0 }));
const members = fixture<{
  people: {
    personId: string;
    name: string;
    departmentId: string;
    jobTitleId: string;
    portraitPath: string;
    scoringEligible: boolean;
  }[];
}>("people").people.map((item) => ({
  id: item.personId,
  personCode: item.personId,
  name: item.name,
  departmentId: item.departmentId,
  jobTitleId: item.jobTitleId,
  portraitUrl: item.portraitPath,
  scoringEligible: item.scoringEligible,
  isDemo: true as const,
}));
describe("organization display hierarchy", () => {
  it("keeps six natural divisions separate from four unknown groups and25 teams; derives81+119 people", () => {
    const tree = buildOrgChart(departments, members);
    expect(tree.divisions).toHaveLength(6);
    expect(tree.unassignedGroups).toHaveLength(4);
    expect(tree.unassignedTeams).toHaveLength(25);
    expect(tree.divisions.reduce((sum, node) => sum + node.memberCount, 0)).toBe(81);
    expect(tree.unassignedCount).toBe(119);
    expect(tree.totalCount).toBe(200);
    expect(tree.divisions[0].department.name).toBe("AX사업본부");
    expect(tree.divisions[0].children[0].department.name).toBe("AX사업본부 AI플랫폼운영팀");
    expect(tree.divisions[0].children[0].memberCount).toBe(14);
    expect(
      tree.unassignedGroups.every((node) => node.children.length === 0 && node.memberCount === 0),
    ).toBe(true);
    const allNodes = tree.divisions.flatMap((node) => node.children);
    expect(allNodes).toHaveLength(13);
    expect(allNodes.every((node) => node.department.kind === "TEAM")).toBe(true);
  });
  it("counts duplicate IDs once, follows direct and grouped parents without inventing links", () => {
    const dept = (id: string, kind: Department["kind"], parentId: string | null): Department => ({
      id,
      code: id,
      name: id,
      kind,
      parentId,
      targetCount: null,
      memberCount: 999,
    });
    const person = (id: string, departmentId: string): TeamMemberListItem => ({
      id,
      departmentId,
      personCode: id,
      name: id,
      jobTitleId: "j",
      portraitUrl: null,
      scoringEligible: false,
      isDemo: true,
    });
    const tree = buildOrgChart(
      [
        dept("division", "DIVISION", null),
        dept("zgroup", "GROUP", "division"),
        dept("direct", "TEAM", "division"),
        dept("nested", "TEAM", "zgroup"),
        dept("unknown", "TEAM", null),
      ],
      [person("a", "direct"), person("b", "nested"), person("b", "nested"), person("c", "unknown")],
    );
    expect(tree.totalCount).toBe(3);
    expect(tree.divisions[0].memberCount).toBe(2);
    expect(tree.divisions[0].children.map((node) => node.department.id)).toEqual([
      "direct",
      "zgroup",
    ]);
    expect(tree.divisions[0].children[1].children[0].members).toHaveLength(1);
    expect(tree.unassignedTeams[0].memberCount).toBe(1);
  });
});
