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
      : (childrenByParent.get(department.id) ?? []).map((child) =>
          build(child, new Set([...ancestors, department.id])),
        );
    const people = isTeam ? (membersByTeam.get(department.id) ?? []) : [];
    const ids = new Set(people.map((person) => person.id));
    const collect = (node: OrgNode) => {
      for (const person of node.members) ids.add(person.id);
      node.children.forEach(collect);
    };
    children.forEach(collect);
    return { department, children, members: people, memberCount: ids.size };
  };
  const roots = departments.filter((department) => department.parentId === null);
  const divisions = roots
    .filter((department) => department.kind === "DIVISION")
    .map((department) => build(department, new Set()));
  const unassignedGroups = roots
    .filter((department) => department.kind === "GROUP")
    .map((department) => build(department, new Set()));
  const unassignedTeams = roots
    .filter((department) => department.kind === "TEAM" || department.kind === null)
    .map((department) => build(department, new Set()));
  const unassignedIds = new Set<string>();
  const collectUnassigned = (node: OrgNode) => {
    node.members.forEach((person) => unassignedIds.add(person.id));
    node.children.forEach(collectUnassigned);
  };
  [...unassignedGroups, ...unassignedTeams].forEach(collectUnassigned);
  return {
    divisions,
    unassignedGroups,
    unassignedTeams,
    unassignedCount: unassignedIds.size,
    totalCount: uniqueMembers.length,
  };
}
