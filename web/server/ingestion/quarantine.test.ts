import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fixtureFileSchema, fixtureRecordSchema, type FixtureRecord } from "./fixture.model";
import { normalizeFixtureRecord, type NormalizeContext, type NormalizeOutcome } from "./normalize";
import {
  ENCODING_DEGRADED_RATIO,
  QUARANTINE_CODES,
  REQUIRED_FIELDS,
  WARNING_CODES,
  replacementCharRatio,
  sourceKeyOf,
} from "./validation";

// 15 §6 검증·격리, 11 §3.1 FX-12.
const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const CONTEXT: NormalizeContext = {
  fetchedAt: new Date("2026-10-19T03:05:00.000Z"),
  anchor: new Date("2026-10-19T03:00:00.000Z"),
};
const FX01_KEY = "fixture:DEMO-2026-0001";
// 37자 + 치환 문자 3자 = 7.5%
const DEGRADED_CONTENT = `${"가".repeat(37)}${"�".repeat(3)}`;

const firstRecord = (id: string): FixtureRecord =>
  fixtureFileSchema.parse(
    JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", `${id}.json`), "utf8")),
  ).records[0];
const withRecord = (patch: Record<string, unknown>, drop: readonly string[] = []): FixtureRecord =>
  fixtureRecordSchema.parse(
    Object.fromEntries(
      Object.entries({ ...firstRecord("FX-01"), ...patch }).filter(([key]) => !drop.includes(key)),
    ),
  );
const normalize = (record: FixtureRecord): NormalizeOutcome =>
  normalizeFixtureRecord(record, CONTEXT);
const issueOf = (record: FixtureRecord) => {
  const outcome = normalize(record);
  if (outcome.ok) throw new Error("격리되어야 할 레코드가 정규화됐다");
  return outcome.issue;
};
const loaded = (record: FixtureRecord) => {
  const outcome = normalize(record);
  if (!outcome.ok) throw new Error(`적재되어야 할 레코드가 격리됐다: ${outcome.issue.code}`);
  return outcome;
};

describe("검증 상수", () => {
  it("격리 코드는 MISSING_REQUIRED_FIELD·SCHEMA_INVALID 다", () => {
    expect(QUARANTINE_CODES).toEqual(["MISSING_REQUIRED_FIELD", "SCHEMA_INVALID"]);
  });

  it("경고 코드는 BUDGET_UNPARSED·DATE_UNPARSED·DATE_ORDER·ENCODING_DEGRADED·ATTACHMENT_URL_BLOCKED 순서다", () => {
    expect(WARNING_CODES).toEqual([
      "BUDGET_UNPARSED",
      "DATE_UNPARSED",
      "DATE_ORDER",
      "ENCODING_DEGRADED",
      // C8 L2: 허용 목록 밖 첨부 URL 을 뺀 공고(09 SSRF). 적재는 한다
      "ATTACHMENT_URL_BLOCKED",
    ]);
  });

  it("필수 필드는 15 §3 의 6개다", () => {
    expect(REQUIRED_FIELDS).toEqual([
      "source",
      "noticeId",
      "title",
      "sourceUrl",
      "stage",
      "fetchedAt",
    ]);
  });

  it("인코딩 깨짐 기준은 치환 문자 5% 다", () => {
    expect(ENCODING_DEGRADED_RATIO).toBe(0.05);
  });
});

describe("FX-12 — 제목 누락 격리", () => {
  it("MISSING_REQUIRED_FIELD 로 격리한다", () => {
    expect(issueOf(firstRecord("FX-12")).code).toBe("MISSING_REQUIRED_FIELD");
  });

  it("sourceKey 는 fixture:DEMO-2026-0012 다", () => {
    expect(issueOf(firstRecord("FX-12")).sourceKey).toBe("fixture:DEMO-2026-0012");
  });

  it("detail 은 빠진 필드 이름만 담는다", () => {
    expect(issueOf(firstRecord("FX-12")).detail).toBe("missing: title");
  });

  it("detail 에 본문·기관 원문이 들어가지 않는다", () => {
    const { detail } = issueOf(firstRecord("FX-12"));
    expect([detail.includes("경상북도"), detail.includes("지역 정보화")]).toEqual([false, false]);
  });
});

describe("필수 필드 누락 → MISSING_REQUIRED_FIELD", () => {
  it("빠진 필드를 REQUIRED_FIELDS 순서로 모두 적는다", () => {
    expect(issueOf(withRecord({}, ["sourceUrl", "title"])).detail).toBe(
      "missing: title, sourceUrl",
    );
  });

  it("detail 에 남아 있는 제목을 넣지 않는다", () => {
    const { detail } = issueOf(withRecord({}, ["sourceUrl"]));
    expect(detail).toBe("missing: sourceUrl");
  });

  it("noticeId 가 없으면 sourceKey 는 fixture:unknown 이다", () => {
    expect(issueOf(withRecord({}, ["noticeId"]))).toStrictEqual({
      code: "MISSING_REQUIRED_FIELD",
      sourceKey: "fixture:unknown",
      detail: "missing: noticeId",
    });
  });

  it("title 이 null 이면 누락이다", () => {
    expect(issueOf(withRecord({ title: null }))).toStrictEqual({
      code: "MISSING_REQUIRED_FIELD",
      sourceKey: FX01_KEY,
      detail: "missing: title",
    });
  });

  it("title 이 공백뿐이면 누락이다", () => {
    expect(issueOf(withRecord({ title: " \t " })).detail).toBe("missing: title");
  });

  it("sourceUrl 이 빈 문자열이면 누락이다", () => {
    expect(issueOf(withRecord({ sourceUrl: "" })).code).toBe("MISSING_REQUIRED_FIELD");
  });

  it("stage 가 없으면 누락이다", () => {
    expect(issueOf(withRecord({}, ["stage"])).detail).toBe("missing: stage");
  });

  it("레코드가 줄 수 있는 필수 필드가 모두 없으면 넷을 다 적는다", () => {
    expect(issueOf(withRecord({}, ["stage", "sourceUrl", "title", "noticeId"])).detail).toBe(
      "missing: noticeId, title, sourceUrl, stage",
    );
  });
});

describe("스키마 위반 → SCHEMA_INVALID", () => {
  it("목록에 없는 stage 는 SCHEMA_INVALID 다", () => {
    expect(issueOf(withRecord({ stage: "AWARD" })).code).toBe("SCHEMA_INVALID");
  });

  it("stage 오류 detail 에 필드 이름을 쓰고 원문 값은 넣지 않는다", () => {
    const { detail } = issueOf(withRecord({ stage: "AWARD" }));
    expect([detail.includes("stage"), detail.includes("AWARD")]).toEqual([true, false]);
  });

  it("목록에 없는 status 는 SCHEMA_INVALID 다", () => {
    expect(issueOf(withRecord({ status: "PENDING" })).code).toBe("SCHEMA_INVALID");
  });

  it("status 오류 detail 에 원문 값을 넣지 않는다", () => {
    expect(issueOf(withRecord({ status: "PENDING" })).detail.includes("PENDING")).toBe(false);
  });

  it.each(["ftp://demo.sol-radar.invalid/notices/FX-01", "/notices/FX-01", "javascript:alert(1)"])(
    "http(s) 절대 URL 이 아닌 sourceUrl %j 는 invalid: sourceUrl 로 격리한다",
    (sourceUrl) => {
      expect(issueOf(withRecord({ sourceUrl }))).toStrictEqual({
        code: "SCHEMA_INVALID",
        sourceKey: FX01_KEY,
        detail: "invalid: sourceUrl",
      });
    },
  );

  it("배열이 아닌 attachments 는 SCHEMA_INVALID 이고 detail 에 attachments 를 쓴다", () => {
    const issue = issueOf(withRecord({ attachments: "제안요청서.pdf" }));
    expect([issue.code, issue.detail.includes("attachments")]).toEqual(["SCHEMA_INVALID", true]);
  });

  it("이름 없는 첨부는 SCHEMA_INVALID 이고 detail 에 attachments 경로를 쓴다", () => {
    const issue = issueOf(
      withRecord({ attachments: [{ objectKey: "fixtures/docs/FX-01-rfp.pdf" }] }),
    );
    expect([issue.code, issue.detail.includes("attachments")]).toEqual(["SCHEMA_INVALID", true]);
  });

  it("문자열이 아닌 title 은 SCHEMA_INVALID 다", () => {
    expect(issueOf(withRecord({ title: 123 })).code).toBe("SCHEMA_INVALID");
  });

  it("문자열이 아닌 content 는 SCHEMA_INVALID 다", () => {
    expect(issueOf(withRecord({ content: 42 })).code).toBe("SCHEMA_INVALID");
  });

  it("SCHEMA_INVALID 의 sourceKey 는 source:noticeId 다", () => {
    expect(issueOf(withRecord({ stage: "AWARD" })).sourceKey).toBe(FX01_KEY);
  });
});

describe("경고 — 적재는 계속한다", () => {
  it("읽을 수 없는 예산은 null 로 두고 BUDGET_UNPARSED 경고를 낸다", () => {
    const { draft, warnings } = loaded(withRecord({ budgetKrw: "미정" }));
    expect([draft.budgetKrw, warnings]).toStrictEqual([
      null,
      [{ code: "BUDGET_UNPARSED", sourceKey: FX01_KEY, detail: "budget unparsed" }],
    ]);
  });

  it("읽을 수 없는 예산의 원문을 original.budget 에 보존한다", () => {
    expect(loaded(withRecord({ budgetKrw: "미정" })).draft.original.budget).toBe("미정");
  });

  it("읽을 수 없는 마감은 null 로 두고 DATE_UNPARSED 경고를 낸다", () => {
    const { draft, warnings } = loaded(withRecord({ deadlineAt: "추후 공지" }));
    expect([draft.deadlineAt, warnings]).toStrictEqual([
      null,
      [{ code: "DATE_UNPARSED", sourceKey: FX01_KEY, detail: "deadlineAt unparsed" }],
    ]);
  });

  it("읽을 수 없는 마감의 원문을 original.deadline 에 보존한다", () => {
    expect(loaded(withRecord({ deadlineAt: "추후 공지" })).draft.original.deadline).toBe(
      "추후 공지",
    );
  });

  it("읽을 수 없는 공고일은 null 로 두고 noticeDate 를 가리키는 DATE_UNPARSED 경고를 낸다", () => {
    const { draft, warnings } = loaded(withRecord({ noticeDate: "미정" }));
    expect([
      draft.noticeDate,
      warnings.map(({ code }) => code),
      warnings[0]?.detail.includes("noticeDate"),
    ]).toEqual([null, ["DATE_UNPARSED"], true]);
  });

  it("읽을 수 없는 공고일의 원문을 original.noticeDate 에 보존한다", () => {
    expect(loaded(withRecord({ noticeDate: "미정" })).draft.original.noticeDate).toBe("미정");
  });

  it("마감이 공고일보다 앞이면 DATE_ORDER 경고를 낸다", () => {
    expect(loaded(withRecord({ noticeDate: "+5d", deadlineAt: "+1d" })).warnings).toStrictEqual([
      { code: "DATE_ORDER", sourceKey: FX01_KEY, detail: "deadlineAt before noticeDate" },
    ]);
  });

  it("DATE_ORDER 여도 두 날짜와 status 를 그대로 둔다", () => {
    const { draft } = loaded(withRecord({ noticeDate: "+5d", deadlineAt: "+1d" }));
    expect([draft.noticeDate, draft.deadlineAt, draft.status]).toEqual([
      "2026-10-24T09:00:00.000Z",
      "2026-10-20T09:00:00.000Z",
      "OPEN",
    ]);
  });

  it("마감과 공고일이 같으면 DATE_ORDER 가 아니다", () => {
    expect(loaded(withRecord({ noticeDate: "+1d", deadlineAt: "+1d" })).warnings).toEqual([]);
  });

  it("치환 문자가 5% 를 넘으면 ENCODING_DEGRADED 경고를 낸다", () => {
    expect(loaded(withRecord({ content: DEGRADED_CONTENT })).warnings).toStrictEqual([
      { code: "ENCODING_DEGRADED", sourceKey: FX01_KEY, detail: "replacement chars 7.5%" },
    ]);
  });

  it("ENCODING_DEGRADED 여도 content 를 지우지 않고 보존한다", () => {
    expect(loaded(withRecord({ content: DEGRADED_CONTENT })).draft.content).toBe(DEGRADED_CONTENT);
  });

  it("치환 문자가 정확히 5% 면 경고하지 않는다", () => {
    const content = `${"가".repeat(19)}�`;
    expect(loaded(withRecord({ content })).warnings).toEqual([]);
  });

  it("경고는 BUDGET_UNPARSED → DATE_UNPARSED(noticeDate→deadlineAt) → ENCODING_DEGRADED 순서다", () => {
    const { warnings } = loaded(
      withRecord({
        budgetKrw: "미정",
        noticeDate: "미정",
        deadlineAt: "추후 공지",
        content: DEGRADED_CONTENT,
      }),
    );
    expect([
      warnings.map(({ code }) => code),
      warnings[1]?.detail.includes("noticeDate"),
      warnings[2]?.detail.includes("deadlineAt"),
    ]).toEqual([
      ["BUDGET_UNPARSED", "DATE_UNPARSED", "DATE_UNPARSED", "ENCODING_DEGRADED"],
      true,
      true,
    ]);
  });

  it("경고는 BUDGET_UNPARSED → DATE_ORDER → ENCODING_DEGRADED 순서다", () => {
    const { warnings } = loaded(
      withRecord({
        budgetKrw: "미정",
        noticeDate: "+5d",
        deadlineAt: "+1d",
        content: DEGRADED_CONTENT,
      }),
    );
    expect(warnings.map(({ code }) => code)).toEqual([
      "BUDGET_UNPARSED",
      "DATE_ORDER",
      "ENCODING_DEGRADED",
    ]);
  });

  it("모든 경고의 sourceKey 는 source:noticeId 다", () => {
    const { warnings } = loaded(
      withRecord({
        budgetKrw: "미정",
        noticeDate: "+5d",
        deadlineAt: "+1d",
        content: DEGRADED_CONTENT,
      }),
    );
    expect(new Set(warnings.map(({ sourceKey }) => sourceKey))).toEqual(new Set([FX01_KEY]));
  });
});

describe("replacementCharRatio", () => {
  it("빈 문자열은 0 이다", () => {
    expect(replacementCharRatio("")).toBe(0);
  });

  it("치환 문자가 없으면 0 이다", () => {
    expect(replacementCharRatio("정상 본문")).toBe(0);
  });

  it("치환 문자뿐이면 1 이다", () => {
    expect(replacementCharRatio("��")).toBe(1);
  });

  it("치환 문자 개수를 길이로 나눈다", () => {
    expect(replacementCharRatio("가�")).toBe(0.5);
  });

  it("40자 중 3자면 0.075 다", () => {
    expect(replacementCharRatio(DEGRADED_CONTENT)).toBeCloseTo(0.075, 12);
  });
});

describe("sourceKeyOf", () => {
  it("source 와 noticeId 를 콜론으로 잇는다", () => {
    expect(sourceKeyOf("fixture", "DEMO-2026-0012")).toBe("fixture:DEMO-2026-0012");
  });

  it("다른 source 도 같은 형식이다", () => {
    expect(sourceKeyOf("g2b-bid-notice", "R26BK00000001")).toBe("g2b-bid-notice:R26BK00000001");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["빈 문자열", ""],
  ])("noticeId 가 %s 면 unknown 을 쓴다", (_label, noticeId) => {
    expect(sourceKeyOf("fixture", noticeId)).toBe("fixture:unknown");
  });
});
