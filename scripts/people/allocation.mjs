import { isTeamDepartment } from "./departments.mjs";

/** @typedef {{id:string, sourceCount:number, titleCounts:Record<string,number>}} DepartmentWeight */

const compareIds = (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

// Integer numerators preserve exact remainder ties even for large source weights.
function largestRemainders(entries, total) {
  const denominator = entries.reduce((sum, entry) => sum + BigInt(entry.weight), 0n);
  const quotas = entries.map((entry) => {
    const numerator = BigInt(total) * BigInt(entry.weight);
    return {
      id: entry.id,
      count: Number(numerator / denominator),
      remainder: numerator % denominator,
    };
  });
  const remaining = total - quotas.reduce((sum, entry) => sum + entry.count, 0);
  const ranked = [...quotas].sort((left, right) =>
    left.remainder === right.remainder
      ? compareIds(left, right)
      : left.remainder > right.remainder
        ? -1
        : 1,
  );
  for (const entry of ranked.slice(0, remaining)) entry.count++;
  return new Map(quotas.map((entry) => [entry.id, entry.count]));
}

/**
 * Reserve one person per team, then allocate people, titles and gender by spec §5.
 * @param {DepartmentWeight[]} departments
 * @returns {{departmentId:string,targetCount:number,maleCount:number,titleCounts:Record<string,number>}[]}
 */
export function allocatePeople(departments) {
  if (
    !Array.isArray(departments) ||
    !departments.some(isTeamDepartment) ||
    departments.filter(isTeamDepartment).length > 200
  )
    throw new Error("Invalid allocation input");
  const sorted = departments.filter(isTeamDepartment).sort(compareIds);
  const ids = new Set();
  for (const department of sorted) {
    if (
      typeof department.id !== "string" ||
      !department.id ||
      ids.has(department.id) ||
      !Number.isSafeInteger(department.sourceCount) ||
      department.sourceCount <= 0 ||
      !department.titleCounts ||
      typeof department.titleCounts !== "object" ||
      Array.isArray(department.titleCounts)
    )
      throw new Error("Invalid allocation input");
    ids.add(department.id);
    const counts = Object.entries(department.titleCounts);
    if (
      !counts.length ||
      counts.some(([id, count]) => !id || !Number.isSafeInteger(count) || count < 0) ||
      counts.reduce((sum, [, count]) => sum + BigInt(count), 0n) !== BigInt(department.sourceCount)
    )
      throw new Error("Invalid allocation title weights");
  }
  const extras = largestRemainders(
    sorted.map((department) => ({ id: department.id, weight: department.sourceCount })),
    200 - sorted.length,
  );
  const targets = sorted.map((department) => ({
    ...department,
    targetCount: 1 + extras.get(department.id),
  }));
  const maleCounts = largestRemainders(
    targets.map((department) => ({ id: department.id, weight: department.targetCount })),
    100,
  );
  return targets.map((department) => ({
    departmentId: department.id,
    targetCount: department.targetCount,
    maleCount: maleCounts.get(department.id),
    titleCounts: Object.fromEntries(
      largestRemainders(
        Object.entries(department.titleCounts)
          .sort(([left], [right]) => compareIds({ id: left }, { id: right }))
          .map(([id, weight]) => ({ id, weight })),
        department.targetCount,
      ),
    ),
  }));
}
