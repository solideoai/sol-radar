import { expect, it } from "vitest";
import { roleNeedsOf, teamPlanOf, teamsOf } from "./team-plan";
import type { WorkforceCandidate } from "./workforce.model";

const person = (
  personId: string,
  role: string,
  department: string | null,
  availableFte: number,
): WorkforceCandidate => ({
  personId,
  name: `직원 ${personId}`,
  department,
  jobTitle: "선임",
  isDemo: true,
  role,
  grade: "중급",
  skills: [],
  availableFte,
  matchReason: "",
});
// DEVELOPER 개발1팀 2명(1, 0.5 FTE), DEVELOPER 부서 없음 1명(0 FTE), PM 사업팀 1명
const candidates = [
  person("dev-2", "DEVELOPER", "개발1팀", 0.5),
  person("dev-1", "DEVELOPER", "개발1팀", 1),
  person("dev-3", "DEVELOPER", null, 0),
  person("pm-1", "PM", "사업팀", 1),
];

it("원문 역할을 직무 코드로 바꿔 부서별로 묶고 부족 인원을 센다", () => {
  const needs = roleNeedsOf([{ role: "개발", minCount: 4, mandatory: true }], candidates);
  expect(needs[0]).toMatchObject({
    role: "개발",
    roleCode: "DEVELOPER",
    minCount: 4,
    supplyCount: 2,
    shortfall: 2,
  });
  expect(needs[0].teams.map((t) => t.department)).toEqual(["개발1팀", "부서 미지정"]);
  expect(needs[0].teams[0].availableFte).toBe(1.5);
  expect(needs[0].teams[0].people.map((p) => p.personId)).toEqual(["dev-1", "dev-2"]);
});

it("대응 없는 역할은 짐작하지 않는다", () => {
  expect(roleNeedsOf([{ role: "감리원", mandatory: false }], candidates)[0]).toMatchObject({
    roleCode: null,
    minCount: 1,
    supplyCount: 0,
    shortfall: 1,
    teams: [],
  });
});

it("staffing 이 없으면 역할 필요는 비어 있다", () =>
  expect(roleNeedsOf(null, candidates)).toEqual([]));

it("같은 사람이 두 공고 후보면 팀×공고 표의 두 칸에 모두 나온다", () => {
  const dev = [person("dev-1", "DEVELOPER", "개발1팀", 1)];
  const bidA = {
    bidId: "a",
    teams: teamsOf(dev),
    roleNeeds: roleNeedsOf([{ role: "개발", mandatory: true }], dev),
    candidateBasisMissing: false,
  };
  const bidB = { bidId: "b", teams: teamsOf(dev), roleNeeds: [], candidateBasisMissing: false };
  const plan = teamPlanOf([bidA, bidB]);
  const row = plan.find((r) => r.department === "개발1팀");
  expect(row?.cells.map((c) => c.people.map((p) => p.personId))).toEqual([["dev-1"], ["dev-1"]]);
  expect(row?.personCount).toBe(1);
  expect(row?.cells[0].roles).toEqual(["개발"]);
});

it("요구조건이 없는 공고는 팀×공고 표에 사람을 채우지 않는다", () => {
  const dev = [person("dev-1", "DEVELOPER", "개발1팀", 1)];
  const everyone = [...dev, person("pm-1", "PM", "사업팀", 1)];
  const plan = teamPlanOf([
    { bidId: "a", teams: teamsOf(dev), roleNeeds: [], candidateBasisMissing: false },
    { bidId: "b", teams: teamsOf(everyone), roleNeeds: [], candidateBasisMissing: true },
  ]);
  expect(plan.map((row) => row.department)).toEqual(["개발1팀"]);
  expect(plan[0]?.cells.map((c) => c.people.length)).toEqual([1, 0]);
});
