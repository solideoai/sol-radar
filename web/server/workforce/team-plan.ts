import "server-only";
import { workRoleOf } from "@/server/shared";
import {
  UNASSIGNED_DEPARTMENT,
  type StaffingRequirement,
  type WorkforceBidResult,
  type WorkforceCandidate,
  type WorkforceRoleNeed,
  type WorkforceTeamPerson,
  type WorkforceTeamPlanRow,
  type WorkforceTeamSupply,
} from "./workforce.model";

// 역할별 필요·팀 묶음·팀×공고 표. 분석 스냅샷 후보만 쓰는 순수 계산이며 저장하지 않는다(ADR-021).
const round2 = (value: number) => Math.round(value * 100) / 100;
const byName = (a: string, b: string) => a.localeCompare(b, "ko");
const byPerson = (a: WorkforceTeamPerson, b: WorkforceTeamPerson) =>
  b.availableFte - a.availableFte || byName(a.name, b.name);
const toPerson = (candidate: WorkforceCandidate): WorkforceTeamPerson => ({
  personId: candidate.personId,
  name: candidate.name,
  jobTitle: candidate.jobTitle,
  role: candidate.role,
  grade: candidate.grade,
  isDemo: candidate.isDemo,
  availableFte: candidate.availableFte,
});

export function teamsOf(candidates: WorkforceCandidate[]): WorkforceTeamSupply[] {
  const groups = Map.groupBy(
    candidates,
    (candidate) => candidate.department ?? UNASSIGNED_DEPARTMENT,
  );
  return [...groups]
    .map(([department, members]) => {
      const people = members.map(toPerson).toSorted(byPerson);
      return {
        department,
        people,
        availableFte: round2(people.reduce((sum, p) => sum + p.availableFte, 0)),
      };
    })
    .toSorted(
      (a, b) =>
        b.people.length - a.people.length ||
        b.availableFte - a.availableFte ||
        byName(a.department, b.department),
    );
}

export function roleNeedsOf(
  staffing: StaffingRequirement[] | null,
  candidates: WorkforceCandidate[],
): WorkforceRoleNeed[] {
  return (staffing ?? []).map((requirement) => {
    const roleCode = workRoleOf(requirement.role);
    // 대응표에 없는 역할은 다른 직무로 짐작하지 않는다.
    const matched = roleCode ? candidates.filter((c) => c.role === roleCode) : [];
    const minCount = requirement.minCount ?? 1;
    const supplyCount = matched.filter((c) => c.availableFte > 0).length;
    return {
      role: requirement.role,
      roleCode,
      minCount,
      grade: requirement.grade ?? null,
      mandatory: requirement.mandatory,
      supplyCount,
      shortfall: Math.max(0, minCount - supplyCount),
      teams: teamsOf(matched),
    };
  });
}

// 역할·기술 요구조건이 없는 공고는 후보가 전 직원이라 지원 요청으로 채우지 않는다(그 열은 사람이 확인).
const supplyOf = (bid: Pick<WorkforceBidResult, "teams" | "candidateBasisMissing">) =>
  bid.candidateBasisMissing ? [] : bid.teams;

export function teamPlanOf(
  bids: Pick<WorkforceBidResult, "bidId" | "teams" | "roleNeeds" | "candidateBasisMissing">[],
): WorkforceTeamPlanRow[] {
  const departments = [...new Set(bids.flatMap((bid) => supplyOf(bid).map((t) => t.department)))];
  return departments
    .map((department) => {
      const cells = bids.map((bid) => {
        const people = supplyOf(bid).find((t) => t.department === department)?.people ?? [];
        const roles = [
          ...new Set(
            bid.roleNeeds
              .filter((need) => people.some((p) => p.role === need.roleCode))
              .map((need) => need.role),
          ),
        ];
        return { bidId: bid.bidId, people, roles };
      });
      const personCount = new Set(cells.flatMap((c) => c.people.map((p) => p.personId))).size;
      return { department, personCount, cells };
    })
    .toSorted((a, b) => b.personCount - a.personCount || byName(a.department, b.department));
}
