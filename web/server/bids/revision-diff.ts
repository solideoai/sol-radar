import "server-only";
import {
  LIST_FIELDS,
  SCALAR_FIELDS,
  type RevisionFieldChange,
  type RevisionSnapshot,
  type TextSegment,
} from "./revision.model";

// 두 revision 의 바뀐 항목을 화면용 모양으로 만든다. 어떤 항목이 바뀌었는지는 저장된 changed_fields 를 믿고
// (ingestion 을 import 하지 않는다), 여기서는 값의 앞뒤만 꺼낸다. 순수 함수만 둔다.

// 글자 비교 표(토큰 수의 곱) 크기 상한. 넘으면 조각내지 않고 통째로 바꾼다.
export const DIFF_CELL_LIMIT = 1_000_000;

const DISPLAY_ORDER = [
  "budgetKrw",
  "deadlineAt",
  "structuredQualifications",
  "attachments",
  "content",
  "status",
  "title",
  "agency",
  "noticeDate",
  "stage",
  "sourceUrl",
  "planRef",
  "preSpecRef",
] as const;

// 공백 / 숫자로 시작하는 낱말(소수점·천 단위 쉼표 포함, 뒤 글자까지) / 글자·숫자 낱말 / 구두점 한 글자.
// 구두점을 떼어 "Spark" 와 "Spark," 가 다른 낱말로 겹쳐 보이지 않게 한다.
const TOKEN = /\s+|\d+(?:[.,]\d+)*\p{L}*|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu;
const tokensOf = (text: string): string[] => text.match(TOKEN) ?? [];

function pushSegment(segments: TextSegment[], op: TextSegment["op"], text: string): void {
  const last = segments.at(-1);
  if (last !== undefined && last.op === op) last.text += text;
  else segments.push({ op, text });
}

// 토큰 LCS 로 같은 곳·지워진 곳·더해진 곳을 나눈다. 같은 자리의 변경은 removed 가 added 앞이다.
export function diffText(before: string, after: string): TextSegment[] {
  if (before === after) return before === "" ? [] : [{ op: "same", text: before }];
  if (before === "") return [{ op: "added", text: after }];
  if (after === "") return [{ op: "removed", text: before }];

  const a = tokensOf(before);
  const b = tokensOf(after);
  if (a.length * b.length > DIFF_CELL_LIMIT) {
    return [
      { op: "removed", text: before },
      { op: "added", text: after },
    ];
  }

  const width = b.length + 1;
  // lcs[i * width + j] = a[i..] 와 b[j..] 의 가장 긴 공통 부분열 길이
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  // 앞에서부터 따라가며 조각을 모은다. 지워진 쪽을 먼저 내보내 removed 가 added 앞에 온다.
  const removedRun: string[] = [];
  const addedRun: string[] = [];
  const segments: TextSegment[] = [];
  const flush = (): void => {
    if (removedRun.length > 0) pushSegment(segments, "removed", removedRun.join(""));
    if (addedRun.length > 0) pushSegment(segments, "added", addedRun.join(""));
    removedRun.length = 0;
    addedRun.length = 0;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      pushSegment(segments, "same", a[i]);
      i += 1;
      j += 1;
    } else if (
      j >= b.length ||
      (i < a.length && lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])
    ) {
      removedRun.push(a[i]);
      i += 1;
    } else {
      addedRun.push(b[j]);
      j += 1;
    }
  }
  flush();
  return segments;
}

const isScalarField = (name: string): name is (typeof SCALAR_FIELDS)[number] =>
  (SCALAR_FIELDS as readonly string[]).includes(name);
const isListField = (name: string): name is (typeof LIST_FIELDS)[number] =>
  (LIST_FIELDS as readonly string[]).includes(name);

function listLabels(snapshot: RevisionSnapshot, field: (typeof LIST_FIELDS)[number]): string[] {
  if (field === "attachments") return (snapshot.attachments ?? []).map((item) => item.name);
  return (snapshot.structuredQualifications ?? []).map((item) => {
    const name = item.name ?? item.code ?? item.kind ?? "자격 요건";
    const value = typeof item.value === "string" ? item.value : JSON.stringify(item.value);
    return value === undefined || value === "null" || value === "" ? name : `${name} ${value}`;
  });
}

function changeOf(
  field: (typeof DISPLAY_ORDER)[number],
  before: RevisionSnapshot,
  after: RevisionSnapshot,
): RevisionFieldChange {
  if (field === "content") {
    return {
      field,
      kind: "text",
      segments: diffText(before.content ?? "", after.content ?? ""),
    };
  }
  if (isListField(field)) {
    const beforeLabels = listLabels(before, field);
    const afterLabels = listLabels(after, field);
    return {
      field,
      kind: "list",
      added: afterLabels.filter((label) => !beforeLabels.includes(label)),
      removed: beforeLabels.filter((label) => !afterLabels.includes(label)),
      kept: afterLabels.filter((label) => beforeLabels.includes(label)),
    };
  }
  return { field, kind: "scalar", before: before[field] ?? null, after: after[field] ?? null };
}

// changedFields 중 화면에 보일 항목만 DISPLAY_ORDER 순으로 낸다. 모르는 이름(amendmentNo 포함)은 버린다.
export function toRevisionChanges(
  changedFields: readonly string[],
  before: RevisionSnapshot,
  after: RevisionSnapshot,
): RevisionFieldChange[] {
  const known = (name: string): boolean =>
    name === "content" || isScalarField(name) || isListField(name);
  const wanted = new Set(changedFields.filter(known));
  return DISPLAY_ORDER.filter((field) => wanted.has(field)).map((field) =>
    changeOf(field, before, after),
  );
}
