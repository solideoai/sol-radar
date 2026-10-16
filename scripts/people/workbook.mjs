import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";

const TITLE_LABELS = [
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
const TITLE_IDS = new Map(
  TITLE_LABELS.map((label, index) => [label, `SOL-J${String(index + 1).padStart(3, "0")}`]),
);
const COLUMN_PAIRS = new Map([
  ["A", "B"],
  ["E", "F"],
  ["I", "J"],
  ["M", "N"],
]);

function parseSourceRange(range) {
  const match = /^([AEIM])([1-9]\d*):\1([1-9]\d*)$/.exec(range.nameRange);
  const header = /^([AEIM])([1-9]\d*)$/.exec(range.headerCell);
  if (
    range.sheet !== "people" ||
    !match ||
    !header ||
    header[1] !== match[1] ||
    COLUMN_PAIRS.get(match[1]) !== range.titleColumn ||
    Number(header[2]) >= Number(match[2]) ||
    Number(match[2]) > Number(match[3])
  ) {
    throw new Error("Invalid source range");
  }
  return {
    ...range,
    column: match[1],
    start: Number(match[2]),
    end: Number(match[3]),
    headerRow: Number(header[2]),
  };
}

function ownText(cell) {
  return cell.isMerged && cell.master.address !== cell.address ? "" : cell.text.trim();
}

const AUDITED_WORKSITE_HEADINGS = new Set(["상암 사업단"]);

function isWorksite(text) {
  return AUDITED_WORKSITE_HEADINGS.has(text) || /주소|근무지|\d+층|청사|비즈니스센터/.test(text);
}

function isOrganizationHeading(cell) {
  const text = ownText(cell);
  if (!text || isWorksite(text)) return false;
  if (cell.isMerged && cell.font?.bold && cell.fill?.fgColor) return true;
  return /팀|본부|그룹|연구소|사업단|프로젝트|구축|유지|고도화/.test(text);
}

function buildAssignments(sheet, departments, excludedRanges) {
  const assignments = new Map();
  const mergedDepartments = new Map();
  const sourceEntries = [];
  for (const department of departments) {
    const name = department.name.trim();
    if (!mergedDepartments.has(name))
      mergedDepartments.set(name, {
        ...department,
        name,
        sourceCount: 0,
        sourceRanges: [],
        titleCounts: {},
      });
    const target = mergedDepartments.get(name);
    for (const sourceRange of department.sourceRanges) {
      const range = parseSourceRange(sourceRange);
      if (sheet.getCell(range.headerCell).text.trim() !== name || !name.includes("팀"))
        throw new Error(`Team header mismatch: ${range.headerCell}`);
      target.sourceRanges.push({ ...sourceRange });
      sourceEntries.push({ range, target });
    }
  }
  for (const sourceRange of excludedRanges)
    sourceEntries.push({ range: parseSourceRange(sourceRange), target: null });
  for (const { range, target } of sourceEntries) {
    for (let row = range.start; row <= range.end; row++) {
      const address = `${range.column}${row}`;
      if (assignments.has(address)) throw new Error(`Overlapping source ranges: ${address}`);
      assignments.set(address, target);
    }
    if (!ownText(sheet.getCell(range.headerCell)))
      throw new Error(`Missing source header: ${range.headerCell}`);
    if (target) {
      for (let row = range.headerRow + 1; row <= range.end; row++) {
        const cell = sheet.getCell(`${range.column}${row}`);
        if (isOrganizationHeading(cell))
          throw new Error(`Source range crosses an organization heading: ${cell.address}`);
      }
    }
  }
  return { assignments, departments: [...mergedDepartments.values()] };
}

function rememberName(excludedNames, name) {
  excludedNames.add(name);
  const normalized = name.replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, "").replace(/\s+/g, "");
  if (normalized) excludedNames.add(normalized);
}

/**
 * Source names stay solely in excludedNames; diagnostics contain cell addresses only.
 * Callers must reject nonempty unmappedCells before persisting derived catalogs.
 */
export async function readOrganizationWorkbook(filename, departments, excludedRanges = []) {
  const workbook = new ExcelJS.Workbook();
  let bytes;
  try {
    bytes = await readFile(filename);
    await workbook.xlsx.load(bytes);
  } catch {
    throw new Error("Unable to read organization workbook");
  }
  const sheet = workbook.getWorksheet("people");
  if (!sheet) throw new Error("Missing required worksheet: people");
  const result = buildAssignments(sheet, departments, excludedRanges);
  const excludedNames = new Set();
  const unmappedCells = [];
  let recognizedRows = 0;
  let excludedRowCount = 0;
  for (const [nameColumn, titleColumn] of COLUMN_PAIRS) {
    for (let row = 1; row <= sheet.rowCount; row++) {
      const nameCell = sheet.getCell(`${nameColumn}${row}`);
      const titleCell = sheet.getCell(`${titleColumn}${row}`);
      const name = ownText(nameCell);
      const title = ownText(titleCell);
      if (
        !name ||
        !title ||
        nameCell.isMerged ||
        titleCell.isMerged ||
        isWorksite(name) ||
        /\d{2,4}[-.)]\s*\d{3,4}[-.]\d{4}/.test(name)
      )
        continue;
      rememberName(excludedNames, name);
      const jobTitleId = TITLE_IDS.get(title);
      if (!jobTitleId || !result.assignments.has(nameCell.address)) {
        unmappedCells.push(nameCell.address);
        continue;
      }
      const target = result.assignments.get(nameCell.address);
      if (!target) {
        excludedRowCount++;
        continue;
      }
      target.sourceCount++;
      target.titleCounts[jobTitleId] = (target.titleCounts[jobTitleId] ?? 0) + 1;
      recognizedRows++;
    }
  }
  return {
    sourceSha256: createHash("sha256").update(bytes).digest("hex"),
    departments: result.departments,
    excludedNames,
    recognizedRows,
    excludedRowCount,
    unmappedCells,
  };
}
