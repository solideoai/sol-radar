import type { Department, TeamMemberListItem } from "@/server/people";
export type OrgNode = {
  department: Department;
  children: OrgNode[];
  members: TeamMemberListItem[];
  memberCount: number;
};
export function buildOrgChart(departments: Department[], members: TeamMemberListItem[]) {
  const uniqueMembers = [...new Map(members.map((member) => [member.id, member])).values()];
  const childrenByParent = new Map<string, Department[]>();
  for (const department of departments) {
    if (department.parentId) {
      const siblings = childrenByParent.get(department.parentId) ?? [];
      siblings.push(department);
      childrenByParent.set(department.parentId, siblings);
    }
  }
  const membersByTeam = new Map<string, TeamMemberListItem[]>();
  for (const member of uniqueMembers) {
    const team = membersByTeam.get(member.departmentId) ?? [];
    team.push(member);
    membersByTeam.set(member.departmentId, team);
  }
  const build = (department: Department, ancestors: Set<string>): OrgNode => {
    const isTeam = department.kind === "TEAM" || department.kind === null;
    const children = ancestors.has(department.id)
      ? []
      : [...(childrenByParent.get(department.id) ?? [])]
          .sort((a, b) => a.code.localeCompare(b.code))
          .map((child) => build(child, new Set([...ancestors, department.id])));
    const people = isTeam ? (membersByTeam.get(department.id) ?? []) : [];
    const ids = new Set(people.map((person) => person.id));
    const collect = (node: OrgNode) => {
      for (const person of node.members) ids.add(person.id);
      node.children.forEach(collect);
    };
    children.forEach(collect);
    return { department, children, members: people, memberCount: ids.size };
  };
  // 최상위 부서를 한 목록으로 놓는다: 본부(인원 많은 순) → 상위 없는 그룹·팀(코드 순) → 0명 부서.
  const isDivision = (node: OrgNode) => node.department.kind === "DIVISION";
  const roots = departments
    .filter((department) => department.parentId === null)
    .map((department) => build(department, new Set()))
    .sort(
      (a, b) =>
        Number(a.memberCount === 0) - Number(b.memberCount === 0) ||
        Number(isDivision(b)) - Number(isDivision(a)) ||
        (isDivision(a) && isDivision(b) ? b.memberCount - a.memberCount : 0) ||
        a.department.code.localeCompare(b.department.code),
    );
  return { roots, totalCount: uniqueMembers.length };
}
