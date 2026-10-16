import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import { readOrganizationWorkbook } from "./workbook.mjs";

const titles = [
  "CFO",
  "사장",
  "부사장",
  "이사",
  "본부장",
  "그룹장",
  "팀장",
  "소장",
  "수석",
  "책임",
  "담당",
  "인턴",
];
const range = (headerCell, nameRange, titleColumn = "B") => ({
  sheet: "people",
  headerCell,
  nameRange,
  titleColumn,
});
const department = (name, sourceRanges, id = "SOL-D001") => ({ id, name, sourceRanges });

async function withWorkbook(run, edit = () => {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "sol-radar-workbook-test-"));
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("people");
    sheet.mergeCells("A1:D1");
    sheet.getCell("A1").value = " 개발팀 ";
    sheet.getCell("A2").value = "가 나다 (메모)";
    sheet.getCell("B2").value = "팀장";
    sheet.getCell("E1").value = "개발팀";
    sheet.getCell("E2").value = "라마바";
    sheet.getCell("F2").value = "책임";
    sheet.mergeCells("I1:L1");
    sheet.getCell("I1").value = " AX  지원팀 ";
    sheet.getCell("I2").value = "사아자";
    sheet.getCell("J2").value = "담당";
    sheet.getCell("M1").value = "식의약팀AX팀";
    sheet.getCell("M2").value = "차카타";
    sheet.getCell("N2").value = "인턴";
    sheet.getCell("A3").value = "02-0000-0000";
    sheet.getCell("A4").value = "합성 주소 1층";
    sheet.getCell("A5").value = "사업본부";
    titles.forEach((title, index) => {
      sheet.getCell(`A${index + 6}`).value = `합성인물${index}`;
      sheet.getCell(`B${index + 6}`).value = title;
    });
    await edit(workbook, sheet);
    const filename = path.join(directory, "synthetic.xlsx");
    await workbook.xlsx.writeFile(filename);
    await run(filename);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function teams() {
  return [
    department(" 개발팀 ", [range("A1", "A2:A2")]),
    department("개발팀", [range("E1", "E2:E2", "F")]),
    department(" AX  지원팀 ", [range("I1", "I2:I2", "J")], "SOL-D002"),
    department("식의약팀AX팀", [range("M1", "M2:M2", "N")], "SOL-D003"),
  ];
}
const exclusions = () => [range("A5", "A6:A17")];

test("combines exact repeated teams across four pairs and keeps every original name in memory", async () => {
  await withWorkbook(async (filename) => {
    const result = await readOrganizationWorkbook(filename, teams(), exclusions());
    assert.equal(result.departments.filter((entry) => entry.name === "개발팀").length, 1);
    assert.equal(result.recognizedRows, 4);
    assert.equal(result.excludedRowCount, 12);
    assert.equal(result.departments[0].sourceCount, 2);
    assert.equal(result.departments[1].name, "AX  지원팀");
    assert.equal(result.departments[2].name, "식의약팀AX팀");
    assert.equal(result.excludedNames.size, 17);
    assert.equal(result.excludedNames.has("가나다"), true);
    assert.equal(result.excludedNames.has("합성인물11"), true);
    assert.deepEqual(result.unmappedCells, []);
    const expectedHash = createHash("sha256")
      .update(await readFile(filename))
      .digest("hex");
    assert.equal(result.sourceSha256, expectedHash);
    assert.equal(
      Object.values(result.departments[0].titleCounts).reduce((sum, count) => sum + count, 0),
      2,
    );
  });
});

test("reports unclassified personnel only as cell addresses while retaining their names privately", async () => {
  await withWorkbook(async (filename) => {
    const result = await readOrganizationWorkbook(filename, teams());
    assert.equal(result.recognizedRows, 4);
    assert.equal(result.excludedRowCount, 0);
    assert.deepEqual(
      result.unmappedCells,
      Array.from({ length: 12 }, (_, index) => `A${index + 6}`),
    );
    assert.equal(result.excludedNames.has("합성인물11"), true);
  });
});

test("counts all 12 title labels verbatim without persisting personnel", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, [
        department("사업본부팀", [range("A5", "A6:A17")]),
      ]);
      assert.deepEqual(
        Object.keys(result.departments[0].titleCounts),
        Array.from({ length: 12 }, (_, index) => `SOL-J${String(index + 1).padStart(3, "0")}`),
      );
      assert.deepEqual(Object.values(result.departments[0].titleCounts), Array(12).fill(1));
      assert.equal(JSON.stringify(result.departments).includes("합성인물"), false);
    },
    (_workbook, sheet) => {
      sheet.getCell("A5").value = "사업본부팀";
    },
  );
});

test("does not merge visually similar team names", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, [
        department("식의약AX팀", [range("I1", "I2:I2", "J")]),
        department("식의약팀AX팀", [range("M1", "M2:M2", "N")], "SOL-D002"),
      ]);
      assert.equal(result.departments.length, 2);
    },
    (_workbook, sheet) => {
      sheet.getCell("I1").value = "식의약AX팀";
    },
  );
});

for (const [label, extraTeams, extraExclusions] of [
  ["team overlap", [department("개발팀", [range("A1", "A2:A2")])], []],
  ["team/exclusion overlap", [], [range("A1", "A2:A2")]],
  ["exclusion overlap", [], [range("A5", "A6:A7")]],
]) {
  test(`rejects ${label} using safe cell diagnostics`, async () => {
    await withWorkbook(async (filename) => {
      await assert.rejects(
        readOrganizationWorkbook(
          filename,
          [...teams(), ...extraTeams],
          [...exclusions(), ...extraExclusions],
        ),
        /Overlapping source ranges: A2|Overlapping source ranges: A6/,
      );
    });
  });
}

test("rejects ranges with mismatched columns before reading personnel", async () => {
  await withWorkbook(async (filename) => {
    await assert.rejects(
      readOrganizationWorkbook(filename, [department("개발팀", [range("A1", "A2:E2")])]),
      /Invalid source range/,
    );
  });
});

test("verifies a team's display label against the source header", async () => {
  await withWorkbook(async (filename) => {
    await assert.rejects(
      readOrganizationWorkbook(filename, [department("다른팀", [range("A1", "A2:A2")])]),
      /Team header mismatch: A1/,
    );
  });
});

test("does not inherit a team past a non-team heading but keeps worksite and address headings", async () => {
  await withWorkbook(async (filename) => {
    await assert.rejects(
      readOrganizationWorkbook(filename, [department("개발팀", [range("A1", "A2:A17")])]),
      /Source range crosses an organization heading: A5/,
    );
  });
});

test("rejects unsupported personnel titles with cell-only diagnostics", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, teams(), exclusions());
      assert.equal(result.unmappedCells.includes("E2"), true);
    },
    (_workbook, sheet) => {
      sheet.getCell("F2").value = "알수없는직책";
    },
  );
});

test("retains complete compound team headers without aliasing", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, [
        department("사업본부 공통지원팀", [range("A1", "A2:A2")]),
        department("공통지원팀", [range("E1", "E2:E2", "F")], "SOL-D002"),
      ]);
      assert.deepEqual(
        result.departments.map((entry) => entry.name),
        ["사업본부 공통지원팀", "공통지원팀"],
      );
    },
    (_workbook, sheet) => {
      sheet.getCell("A1").value = "사업본부 공통지원팀";
      sheet.getCell("E1").value = "공통지원팀";
    },
  );
});

test("keeps a team across a worksite heading and address", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, [
        department("개발팀", [range("A1", "A2:A6")]),
      ]);
      assert.equal(result.recognizedRows, 2);
    },
    (_workbook, sheet) => {
      sheet.getCell("A5").value = "근무지 2층";
    },
  );
});

test("sanitizes missing-file and missing-sheet errors", async () => {
  await assert.rejects(
    readOrganizationWorkbook("/nonexistent/private-input.xlsx", []),
    /^Error: Unable to read organization workbook$/,
  );
  await withWorkbook(
    async (filename) => {
      await assert.rejects(
        readOrganizationWorkbook(filename, []),
        /^Error: Missing required worksheet: people$/,
      );
    },
    (workbook, sheet) => {
      workbook.removeWorksheet(sheet.id);
      workbook.addWorksheet("other");
    },
  );
});

test("does not classify adjacent phone numbers or address text as personnel", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, teams(), exclusions());
      assert.equal(result.recognizedRows, 4);
      assert.deepEqual(result.unmappedCells, []);
      assert.equal(result.excludedNames.has("02-0000-0000"), false);
    },
    (_workbook, sheet) => {
      sheet.getCell("B3").value = "010-0000-0000";
      sheet.getCell("B4").value = "연락처";
    },
  );
});

test("ends team inheritance at merged non-team headings even without font styling", async () => {
  await withWorkbook(
    async (filename) => {
      await assert.rejects(
        readOrganizationWorkbook(filename, [department("개발팀", [range("A1", "A2:A17")])]),
        /Source range crosses an organization heading: A5/,
      );
    },
    (_workbook, sheet) => {
      sheet.mergeCells("A5:D5");
    },
  );
});

for (const [heading, isStyled] of [
  ["신규프로젝트 사업단", false],
  ["신규프로젝트 사업단", true],
  ["신규 사업단", false],
]) {
  test(`ends team inheritance at a non-worksite business unit (${heading}, styled=${isStyled})`, async () => {
    await withWorkbook(
      async (filename) => {
        await assert.rejects(
          readOrganizationWorkbook(filename, [department("개발팀", [range("A1", "A2:A17")])]),
          /Source range crosses an organization heading: A5/,
        );
      },
      (_workbook, sheet) => {
        sheet.getCell("A5").value = heading;
        if (isStyled) {
          sheet.mergeCells("A5:D5");
          sheet.getCell("A5").font = { bold: true };
          sheet.getCell("A5").fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF777777" },
          };
        }
      },
    );
  });
}

test("retains team continuity across the audited worksite business-unit heading", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, [
        department("개발팀", [range("A1", "A2:A6")]),
      ]);
      assert.equal(result.recognizedRows, 2);
    },
    (_workbook, sheet) => {
      sheet.getCell("A5").value = "상암 사업단";
      sheet.mergeCells("A5:D5");
      sheet.getCell("A5").font = { bold: true };
      sheet.getCell("A5").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF777777" },
      };
    },
  );
});

for (const heading of ["주소정보팀", "청사관리팀", "청사관리팀 2층"]) {
  test(`ends team inheritance at an explicit organization heading containing location words (${heading})`, async () => {
    await withWorkbook(
      async (filename) => {
        await assert.rejects(
          readOrganizationWorkbook(filename, [department("개발팀", [range("A1", "A2:A17")])]),
          /Source range crosses an organization heading: A5/,
        );
      },
      (_workbook, sheet) => {
        sheet.getCell("A5").value = heading;
      },
    );
  });
}

for (const heading of [
  "근무지: 연구소 2층",
  "주소: 사업본부 3층",
  "근무지 연구소 2층",
  "주소 사업본부 3층",
]) {
  test(`preserves team continuity for explicit location declarations containing organization words (${heading})`, async () => {
    await withWorkbook(
      async (filename) => {
        const result = await readOrganizationWorkbook(filename, [
          department("개발팀", [range("A1", "A2:A6")]),
        ]);
        assert.equal(result.recognizedRows, 2);
        assert.equal(result.departments[0].sourceCount, 2);
      },
      (_workbook, sheet) => {
        sheet.getCell("A5").value = heading;
        sheet.mergeCells("A5:D5");
        sheet.getCell("A5").font = { bold: true };
        sheet.getCell("A5").fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF777777" },
        };
      },
    );
  });
}

test("augmented catalog keeps source comparison and personnel counts on TEAM rows", async () => {
  await withWorkbook(async (filename) => {
    const result = await readOrganizationWorkbook(
      filename,
      [
        ...teams(),
        {
          id: "SOL-D039",
          name: "사업본부",
          kind: "DIVISION",
          sourceCount: null,
          targetCount: null,
        },
      ],
      exclusions(),
    );
    assert.equal(result.departments.length, 3);
    assert.equal(result.recognizedRows, 4);
    assert.equal(result.excludedRowCount, 12);
  });
});

test("extracts evidenced upper headings and rejects conflicting repeated-team parents", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(
        filename,
        [
          department("개발팀", [range("A1", "A2:A2"), range("E5", "E6:E6", "F")]),
          department("AX지원팀", [range("I5", "I6:I6", "J")], "SOL-D002"),
          department("식의약팀AX팀", [range("M1", "M2:M2", "N")], "SOL-D003"),
        ],
        exclusions(),
      );
      assert.deepEqual(
        result.hierarchy.upperDepartments.map(({ id, name, kind, parentId }) => ({
          id,
          name,
          kind,
          parentId,
        })),
        [
          { id: "SOL-D039", name: "다른본부", kind: "DIVISION", parentId: null },
          { id: "SOL-D040", name: "합성본부", kind: "DIVISION", parentId: null },
          { id: "SOL-D041", name: "합성그룹", kind: "GROUP", parentId: "SOL-D040" },
          { id: "SOL-D042", name: "사업본부", kind: "DIVISION", parentId: null },
        ],
      );
      assert.deepEqual(
        result.hierarchy.teamParents.find((row) => row.departmentId === "SOL-D001"),
        { departmentId: "SOL-D001", parentId: null, parentReason: "PARENT_CONFLICT" },
      );
      assert.deepEqual(
        result.hierarchy.teamParents.find((row) => row.departmentId === "SOL-D002"),
        { departmentId: "SOL-D002", parentId: "SOL-D041" },
      );
    },
    (_workbook, sheet) => {
      for (const address of ["E1", "E2", "F2", "I1", "I2", "J2"])
        sheet.getCell(address).value = null;
      sheet.getCell("E3").value = "다른본부";
      sheet.getCell("E5").value = "개발팀";
      sheet.getCell("E6").value = "라마바";
      sheet.getCell("F6").value = "책임";
      sheet.getCell("I3").value = "합성본부";
      sheet.getCell("I4").value = "합성그룹";
      sheet.getCell("I5").value = "AX지원팀";
      sheet.getCell("I6").value = "사아자";
      sheet.getCell("J6").value = "담당";
    },
  );
});

test("contact and phone headings containing organization words never become hierarchy evidence", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, teams(), exclusions());
      assert.deepEqual(
        result.hierarchy.upperDepartments.map(({ name }) => name),
        ["사업본부"],
      );
      const serialized = JSON.stringify(result.hierarchy);
      for (const privateFragment of ["0000", "연락처", "주소", "옆열본부"])
        assert.equal(serialized.includes(privateFragment), false);
    },
    (_workbook, sheet) => {
      sheet.getCell("E3").value = "연락처 합성본부";
      sheet.getCell("I3").value = "02-0000-0000 (본부)";
      sheet.getCell("M3").value = "010-0000-0000 그룹";
      sheet.getCell("E4").value = "주소: 합성그룹 3층";
      sheet.getCell("F4").value = "옆열본부";
    },
  );
});

test("a team-name prefix cannot replace conflicting accepted source-range parents", async () => {
  await withWorkbook(
    async (filename) => {
      const result = await readOrganizationWorkbook(filename, [
        department("합성본부 개발팀", [range("A2", "A3:A3"), range("E2", "E3:E3", "F")]),
      ]);
      assert.equal(result.recognizedRows, 2);
      assert.deepEqual(
        result.hierarchy.upperDepartments.map(({ id, name }) => ({ id, name })),
        [
          { id: "SOL-D039", name: "합성본부" },
          { id: "SOL-D040", name: "다른본부" },
        ],
      );
      assert.deepEqual(result.hierarchy.teamParents, [
        { departmentId: "SOL-D001", parentId: null, parentReason: "PARENT_CONFLICT" },
      ]);
    },
    (_workbook, sheet) => {
      sheet.eachRow((row) =>
        row.eachCell((cell) => {
          if (!cell.isMerged || cell.master.address === cell.address) cell.value = null;
        }),
      );
      sheet.getCell("A1").value = "합성본부";
      sheet.getCell("A2").value = "합성본부 개발팀";
      sheet.getCell("A3").value = "가나다";
      sheet.getCell("B3").value = "책임";
      sheet.getCell("E1").value = "다른본부";
      sheet.getCell("E2").value = "합성본부 개발팀";
      sheet.getCell("E3").value = "라마바";
      sheet.getCell("F3").value = "책임";
    },
  );
});
