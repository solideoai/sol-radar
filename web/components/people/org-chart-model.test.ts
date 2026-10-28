import { describe, expect, it } from "vitest";
import type { Department, TeamMemberListItem } from "@/server/people";
import { buildOrgChart } from "./org-chart-model";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const department = (
  n: number,
  kind: Department["kind"],
  parentId: string | null = null,
): Department => ({
  id: id(n),
  code: `D${n}`,
  name: `부서${n}`,
  kind,
  parentId,
  targetCount: kind === "TEAM" ? 1 : null,
  memberCount: 0,
});
const member = (n: number, departmentId: string): TeamMemberListItem => ({
  id: id(100 + n),
  personCode: `P${n}`,
  name: `직원${n}`,
  email: null,
  departmentId,
  jobTitleId: id(900),
  portraitUrl: null,
  scoringEligible: false,
  isDemo: true,
  hasUploadedPhoto: false,
});

describe("buildOrgChart", () => {
  it("본부·그룹 직속 직원을 그 부서 members 에 두고 하위 팀 인원과 함께 센다(ADR-063)", () => {
    const division = department(1, "DIVISION");
    const team = department(2, "TEAM", division.id);
    const group = department(3, "GROUP");
    const { roots } = buildOrgChart(
      [division, team, group],
      [member(1, division.id), member(2, team.id), member(3, team.id), member(4, group.id)],
    );
    const byId = new Map(roots.map((node) => [node.department.id, node]));
    const divisionNode = byId.get(division.id)!;
    expect(divisionNode.members.map((person) => person.personCode)).toEqual(["P1"]);
    expect(divisionNode.memberCount).toBe(3);
    expect(divisionNode.children[0].members.map((person) => person.personCode)).toEqual([
      "P2",
      "P3",
    ]);
    expect(byId.get(group.id)!.members.map((person) => person.personCode)).toEqual(["P4"]);
    expect(byId.get(group.id)!.memberCount).toBe(1);
  });
});
