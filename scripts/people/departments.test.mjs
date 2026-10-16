import assert from "node:assert/strict";
import test from "node:test";
import * as hierarchy from "./departments.mjs";

const row = (id, kind, parentId, extra = {}) => ({ id, kind, parentId, ...extra });
const team = (id = "SOL-D001", parentId) =>
  row(id, "TEAM", parentId, { targetCount: 2, sourceCount: 1 });
const validate = (departments, people = []) =>
  hierarchy.validateDepartmentHierarchy(departments, people);

test("legacy absent/null kinds remain TEAM and absent parents are allowed", () => {
  assert.equal(hierarchy.isTeamDepartment({}), true);
  assert.equal(hierarchy.isTeamDepartment({ kind: null }), true);
  assert.equal(hierarchy.isTeamDepartment({ kind: "GROUP" }), false);
  const result = validate([{ id: "SOL-D001", targetCount: 2 }, team("SOL-D002")]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.unresolvedParents, [
    { departmentId: "SOL-D001", reason: "PARENT_NOT_EVIDENCED" },
    { departmentId: "SOL-D002", reason: "PARENT_NOT_EVIDENCED" },
  ]);
});

test("counts descendant employees for DIVISION→GROUP→TEAM and DIVISION→TEAM", () => {
  const departments = [
    team("SOL-D001", "SOL-D040"),
    team("SOL-D002", "SOL-D039"),
    row("SOL-D039", "DIVISION", null),
    row("SOL-D040", "GROUP", "SOL-D039", { targetCount: null, sourceCount: null }),
  ];
  const people = [
    { personId: "SOL-P0001", departmentId: "SOL-D001" },
    { personId: "SOL-P0002", departmentId: "SOL-D002" },
  ];
  const result = validate(departments, people);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.teamCounts, [
    { departmentId: "SOL-D001", targetCount: 2, actualCount: 1, difference: -1 },
    { departmentId: "SOL-D002", targetCount: 2, actualCount: 1, difference: -1 },
  ]);
  assert.deepEqual(result.memberCounts, [
    { departmentId: "SOL-D001", memberCount: 1 },
    { departmentId: "SOL-D002", memberCount: 1 },
    { departmentId: "SOL-D039", memberCount: 2 },
    { departmentId: "SOL-D040", memberCount: 1 },
  ]);
});

for (const [reason, departments] of [
  ["PARENT_MISSING", [team("SOL-D001", "SOL-D999")]],
  ["PARENT_SELF", [team("SOL-D001", "SOL-D001")]],
  ["PARENT_KIND_INVALID", [team("SOL-D001", "SOL-D002"), team("SOL-D002")]],
  ["PARENT_CYCLE", [row("SOL-D039", "DIVISION", "SOL-D040"), row("SOL-D040", "GROUP", "SOL-D039")]],
  [
    "DEPTH_EXCEEDED",
    [
      team("SOL-D001", "SOL-D041"),
      row("SOL-D041", "GROUP", "SOL-D040"),
      row("SOL-D040", "GROUP", "SOL-D039"),
      row("SOL-D039", "DIVISION", null),
    ],
  ],
  ["UPPER_TARGET_INVALID", [row("SOL-D039", "DIVISION", null, { targetCount: 0 })]],
  ["UPPER_SOURCE_INVALID", [row("SOL-D039", "DIVISION", null, { sourceCount: 1 })]],
  ["KIND_INVALID", [row("SOL-D039", "PRIVATE_VALUE", null)]],
]) {
  test(`rejects ${reason} with safe stable diagnostics`, () => {
    const result = validate(departments);
    assert.ok(
      result.errors.some((error) => error.reason === reason),
      JSON.stringify(result),
    );
    assert.ok(!JSON.stringify(result).includes("PRIVATE_VALUE"));
    for (const error of result.errors) {
      assert.ok(
        Object.keys(error).every((key) => ["departmentId", "personId", "reason"].includes(key)),
      );
    }
  });
}

test("rejects upper employee affiliations without reflecting private identifiers", () => {
  const result = validate(
    [row("SOL-D039", "DIVISION", null)],
    [{ personId: "private-person", departmentId: "SOL-D039", name: "private-name" }],
  );
  assert.deepEqual(result.errors, [{ departmentId: "SOL-D039", reason: "EMPLOYEE_REQUIRES_TEAM" }]);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("v2 source hierarchy must match upper evidence and every TEAM parent; v1 is compatible", () => {
  const upper = row("SOL-D039", "DIVISION", null, {
    name: "합성본부",
    sourceCount: null,
    targetCount: null,
    sourceHeaders: [{ sheet: "people", headerCell: "A1" }],
  });
  const catalog = { schemaVersion: 2, departments: [team("SOL-D001", "SOL-D039"), upper] };
  const evidence = {
    upperDepartments: [upper],
    teamParents: [{ departmentId: "SOL-D001", parentId: "SOL-D039" }],
  };
  assert.equal(hierarchy.matchesSourceHierarchy(catalog, evidence), true);
  const changed = structuredClone(catalog);
  changed.departments[0].parentId = null;
  assert.equal(hierarchy.matchesSourceHierarchy(changed, evidence), false);
  const invented = structuredClone(catalog);
  invented.departments[1].sourceHeaders[0].headerCell = "A2";
  assert.equal(hierarchy.matchesSourceHierarchy(invented, evidence), false);
  assert.equal(
    hierarchy.matchesSourceHierarchy({ schemaVersion: 1, departments: [team()] }, evidence),
    true,
  );
});
