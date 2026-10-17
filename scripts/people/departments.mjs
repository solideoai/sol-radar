import { isDeepStrictEqual } from "node:util";

export const isTeamDepartment = (department) => (department.kind ?? "TEAM") === "TEAM";

const safeDepartmentId = (value) => typeof value === "string" && /^SOL-D\d{3}$/.test(value);
const safePersonId = (value) => typeof value === "string" && /^SOL-P\d{4}$/.test(value);
const PARENT_REASONS = new Set(["PARENT_NOT_EVIDENCED", "PARENT_CONFLICT"]);

/** Diagnostics contain identifiers and stable reasons, never source personnel fields. */
export function validateDepartmentHierarchy(departments, people = []) {
  const errors = [];
  const unresolvedParents = [];
  const byId = new Map(departments.map((department) => [department.id, department]));
  const add = (reason, departmentId, personId) => {
    const error = {
      ...(safeDepartmentId(departmentId) ? { departmentId } : {}),
      ...(safePersonId(personId) ? { personId } : {}),
      reason,
    };
    if (!errors.some((entry) => JSON.stringify(entry) === JSON.stringify(error)))
      errors.push(error);
  };
  for (const department of departments) {
    const kind = department.kind ?? "TEAM";
    if (!safeDepartmentId(department.id)) add("DEPARTMENT_ID_INVALID");
    if (departments.filter((entry) => entry.id === department.id).length !== 1)
      add("DEPARTMENT_ID_DUPLICATE", department.id);
    if (!["DIVISION", "GROUP", "TEAM"].includes(kind)) add("KIND_INVALID", department.id);
    if (isTeamDepartment(department)) {
      if (!Number.isSafeInteger(department.targetCount) || department.targetCount <= 0)
        add("TEAM_TARGET_INVALID", department.id);
    } else {
      if (department.targetCount != null) add("UPPER_TARGET_INVALID", department.id);
      if (department.sourceCount != null) add("UPPER_SOURCE_INVALID", department.id);
    }
    if (department.parentId == null) {
      if (kind !== "DIVISION" && safeDepartmentId(department.id))
        unresolvedParents.push({
          departmentId: department.id,
          reason: PARENT_REASONS.has(department.parentReason)
            ? department.parentReason
            : "PARENT_NOT_EVIDENCED",
        });
      continue;
    }
    const parent = byId.get(department.parentId);
    if (!parent) add("PARENT_MISSING", department.id);
    else if (department.id === parent.id) add("PARENT_SELF", department.id);
    else if (
      kind === "DIVISION" ||
      isTeamDepartment(parent) ||
      (kind === "GROUP" && parent.kind !== "DIVISION")
    )
      add("PARENT_KIND_INVALID", department.id);
    const visited = new Set([department.id]);
    let current = parent;
    let depth = 1;
    while (current) {
      if (visited.has(current.id)) {
        add("PARENT_CYCLE", department.id);
        break;
      }
      visited.add(current.id);
      if (++depth > 3) add("DEPTH_EXCEEDED", department.id);
      current = byId.get(current.parentId);
    }
  }
  const memberCounts = departments
    .filter((department) => safeDepartmentId(department.id))
    .map((department) => ({ departmentId: department.id, memberCount: 0 }));
  const counts = new Map(memberCounts.map((row) => [row.departmentId, row]));
  for (const person of people) {
    const department = byId.get(person.departmentId);
    if (!department || !isTeamDepartment(department)) {
      add("EMPLOYEE_REQUIRES_TEAM", person.departmentId, person.personId);
      continue;
    }
    const visited = new Set();
    let current = department;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      const count = counts.get(current.id);
      if (count) count.memberCount++;
      current = byId.get(current.parentId);
    }
  }
  const teamCounts = departments
    .filter((department) => isTeamDepartment(department) && safeDepartmentId(department.id))
    .map((department) => {
      const actualCount = people.filter((person) => person.departmentId === department.id).length;
      return {
        departmentId: department.id,
        targetCount: department.targetCount,
        actualCount,
        difference: actualCount - department.targetCount,
      };
    });
  return { errors, unresolvedParents, teamCounts, memberCounts };
}

export function matchesSourceHierarchy(catalog, hierarchy) {
  if (catalog.schemaVersion === 1) return true;
  return (
    isDeepStrictEqual(
      catalog.departments.filter((department) => !isTeamDepartment(department)),
      hierarchy.upperDepartments,
    ) &&
    isDeepStrictEqual(
      catalog.departments.filter(isTeamDepartment).map(({ id, parentId, parentReason }) => ({
        departmentId: id,
        parentId,
        ...(parentReason ? { parentReason } : {}),
      })),
      hierarchy.teamParents,
    )
  );
}
