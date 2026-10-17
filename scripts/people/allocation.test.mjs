import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { allocatePeople } from "./allocation.mjs";
import { readOrganizationWorkbook } from "./workbook.mjs";

const weight = (id, sourceCount, titleCounts = { "SOL-J010": sourceCount }) => ({
  id,
  sourceCount,
  titleCounts,
});

test("reserves one per team before proportional largest-remainder allocation", () => {
  const weights = [weight("C", 1), weight("A", 2), weight("B", 1)];
  const before = structuredClone(weights);
  const result = allocatePeople(weights);
  assert.deepEqual(
    result.map(({ departmentId, targetCount, maleCount }) => ({
      departmentId,
      targetCount,
      maleCount,
    })),
    [
      { departmentId: "A", targetCount: 100, maleCount: 50 },
      { departmentId: "B", targetCount: 50, maleCount: 25 },
      { departmentId: "C", targetCount: 50, maleCount: 25 },
    ],
  );
  assert.deepEqual(result, allocatePeople([...weights].reverse()));
  assert.deepEqual(weights, before);
});

test("breaks department, gender and title remainders by stable ID", () => {
  const result = allocatePeople([
    weight("C", 3, { Z: 1, A: 1, B: 1 }),
    weight("B", 3, { Z: 1, A: 1, B: 1 }),
    weight("A", 3, { Z: 1, A: 1, B: 1 }),
  ]);
  assert.deepEqual(
    result.map(({ targetCount, maleCount }) => [targetCount, maleCount]),
    [
      [67, 34],
      [67, 33],
      [66, 33],
    ],
  );
  assert.deepEqual(result[0].titleCounts, { A: 23, B: 22, Z: 22 });
  assert.equal(
    result.reduce((sum, entry) => sum + entry.targetCount, 0),
    200,
  );
  assert.equal(
    result.reduce((sum, entry) => sum + entry.maleCount, 0),
    100,
  );
});

test("allocates exactly one person to every team at the 200-team boundary", () => {
  const result = allocatePeople(
    Array.from({ length: 200 }, (_, index) =>
      weight(`D${String(index).padStart(3, "0")}`, index + 1),
    ),
  );
  assert.ok(result.every((entry) => entry.targetCount === 1));
  assert.equal(
    result.reduce((sum, entry) => sum + entry.maleCount, 0),
    100,
  );
});

for (const weights of [
  [],
  Array.from({ length: 201 }, (_, index) => weight(`D${index}`, 1)),
  [weight("A", 0)],
  [weight("A", -1)],
  [weight("A", NaN)],
  [weight("A", Infinity)],
  [weight("A", 1.5)],
  [weight("A", 1), weight("A", 1)],
  [weight("A", 2, { J: 1 })],
  [weight("A", 1, { J: -1 })],
]) {
  test(`rejects invalid allocation input (${JSON.stringify(weights).slice(0, 70)})`, () => {
    assert.throws(() => allocatePeople(weights), /Invalid allocation/);
  });
}

test("counts two synthetic same-name workbook rows as two weights", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sol-radar-weights-"));
  try {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("people");
    sheet.getCell("A1").value = "합성팀";
    for (const row of [2, 3]) {
      sheet.getCell(`A${row}`).value = "가나다";
      sheet.getCell(`B${row}`).value = "책임";
    }
    const filename = path.join(directory, "synthetic.xlsx");
    await book.xlsx.writeFile(filename);
    const source = await readOrganizationWorkbook(filename, [
      {
        id: "A",
        name: "합성팀",
        sourceRanges: [{ sheet: "people", headerCell: "A1", nameRange: "A2:A3", titleColumn: "B" }],
      },
    ]);
    assert.equal(source.recognizedRows, 2);
    assert.equal(source.departments[0].sourceCount, 2);
    assert.deepEqual(allocatePeople(source.departments), [
      { departmentId: "A", targetCount: 200, maleCount: 100, titleCounts: { "SOL-J010": 200 } },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("upper rows never receive reserved employees or source weights", () => {
  const teams = [weight("A", 2), { ...weight("B", 1), kind: "TEAM" }];
  assert.deepEqual(
    allocatePeople([...teams, { id: "C", kind: "DIVISION", sourceCount: null, targetCount: null }]),
    allocatePeople(teams),
  );
});
