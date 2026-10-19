import { describe, expect, it } from "vitest";
import { DEMO_ORGS } from "@test-harness/demo-plan.mjs";
import * as analysisBarrel from "@/server/analysis";
import { analysisJobDataSchema, requestIdOf } from "./analysis-job.model";
import {
  DEMO_ORG_SLUG,
  PREANALYZE_EXCLUDED_FIXTURES,
  preanalyzeIdempotencyKey,
  selectPreanalyzeTargets,
  summarize,
  summaryLine,
  type DemoBidRow,
  type PreanalyzeTarget,
  type RunState,
} from "./preanalyze.model";
import {
  SEEDED_FIXTURE_IDS,
  seedDemoBidRow,
  seedDemoBidRows,
  seedTargets,
} from "./preanalyze.test-support";
import { ORG_ID, OTHER_ORG_ID } from "./store.test-support";

// 사전 분석(`pnpm demo:preanalyze`, C5-B)의 순수 규칙. 대상 공고 고르기·멱등 키·요약 줄.
// 입력 행은 데모 seed 의 행 계획 함수(scripts/demo/plan.mjs)가 만든 bid_notices·bid_revisions 를 이은 것이다.
// 대상 목록은 시험에 박지 않는다. seed 가 적재한 공고에서 FX-02 를 뺀 결과와 같은지로 본다.

// 19 §3 사전 준비 5번: "mock 모드에서 FX-02를 뺀 적재 공고 18건을 전부 미리 분석".
// FX-02 는 분석 없음(미분석)으로 남겨 S4 에서 라이브 분석한다. FX-12 는 격리라 적재 공고가 없다.
const LIVE_ANALYSIS_FIXTURE = "FX-02";
// 11 §5 6번: S2 대시보드의 BID 권고 3건(FX-01 94, FX-18 82, FX-06 78)이 사전 분석에 기댄다.
const S2_BID_FIXTURES = ["FX-01", "FX-18", "FX-06"];

const byFixtureId = (a: PreanalyzeTarget, b: PreanalyzeTarget) =>
  a.fixtureId < b.fixtureId ? -1 : a.fixtureId > b.fixtureId ? 1 : 0;

/** seed 적재 공고에서 FX-02 를 뺀 대상(fixtureId 순). */
const expectedTargets = (): PreanalyzeTarget[] =>
  seedTargets()
    .filter((target) => target.fixtureId !== LIVE_ANALYSIS_FIXTURE)
    .toSorted(byFixtureId);

const fixtureIds = (targets: PreanalyzeTarget[]) => targets.map((target) => target.fixtureId);

/** seed 행 하나의 raw_payload 를 바꾼 행. */
function withRawPayload(row: DemoBidRow, rawPayload: unknown): DemoBidRow {
  return { ...row, rawPayload };
}

/** seed 행 하나의 raw_payload.fixtureId 를 바꾼 행. */
function withRawFixtureId(row: DemoBidRow, fixtureId: unknown): DemoBidRow {
  const payload = row.rawPayload;
  const base = typeof payload === "object" && payload !== null ? payload : {};
  return withRawPayload(row, { ...base, fixtureId });
}

// S5 정정 뒤 모양: 같은 공고에 r2 가 생기고 latest_revision 이 2 다.
const FX06_R2_REVISION_ID = "7c6b5a49-3827-4615-8a4b-3c2d1e0f9a8b";
const FX02_R2_REVISION_ID = "8d7c6b5a-4938-4726-9b5c-4d3e2f1a0b9c";

// ── 상수 ──

describe("사전 분석 상수", () => {
  it("제외 fixture 는 FX-02 하나다(19 §3 5번: S4 라이브 분석)", () => {
    expect(PREANALYZE_EXCLUDED_FIXTURES).toEqual([LIVE_ANALYSIS_FIXTURE]);
  });

  it("데모 조직 slug 는 seed 의 솔리데오(org-01) slug 다(19 §1)", () => {
    const solideo = DEMO_ORGS.find((org: { code: string }) => org.code === "org-01");
    expect(DEMO_ORG_SLUG).toBe(solideo?.slug);
  });
});

// ── selectPreanalyzeTargets · seed ──

describe("selectPreanalyzeTargets · seed 데모 공고", () => {
  it("seed 적재 공고는 19건이다(전제: FX-01~20 가운데 FX-12 격리)", () => {
    expect(seedDemoBidRows()).toHaveLength(19);
    expect(SEEDED_FIXTURE_IDS).not.toContain("FX-12");
  });

  it("대상은 seed 적재 공고에서 FX-02 를 뺀 공고이고 r1 이다", () => {
    expect(selectPreanalyzeTargets(seedDemoBidRows())).toEqual(expectedTargets());
  });

  it("대상은 18건이다(19 §3 5번: FX-02 를 뺀 적재 공고 18건)", () => {
    expect(selectPreanalyzeTargets(seedDemoBidRows())).toHaveLength(18);
  });

  it("FX-02 는 대상이 아니다(19 §3 5번: 미분석으로 남겨 S4 에서 라이브 분석)", () => {
    expect(fixtureIds(selectPreanalyzeTargets(seedDemoBidRows()))).not.toContain(
      LIVE_ANALYSIS_FIXTURE,
    );
  });

  it.each(S2_BID_FIXTURES)("S2 BID 권고 공고 %s 는 대상이다(11 §5 6번)", (fixtureId) => {
    expect(fixtureIds(selectPreanalyzeTargets(seedDemoBidRows()))).toContain(fixtureId);
  });

  it("입력 순서와 상관없이 fixtureId 순으로 돌려준다", () => {
    const reversed = seedDemoBidRows().toReversed();
    expect(fixtureIds(selectPreanalyzeTargets(reversed))).toEqual(fixtureIds(expectedTargets()));
  });

  it("섞인 입력도 fixtureId 순으로 돌려준다", () => {
    const rows = seedDemoBidRows();
    const shuffled = [...rows.slice(7), ...rows.slice(0, 7).toReversed()];
    expect(fixtureIds(selectPreanalyzeTargets(shuffled))).toEqual(fixtureIds(expectedTargets()));
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const rows = seedDemoBidRows().toReversed();
    const before = structuredClone(rows);
    selectPreanalyzeTargets(rows);
    expect(rows).toEqual(before);
  });

  it("빈 목록이면 빈 목록이다", () => {
    expect(selectPreanalyzeTargets([])).toEqual([]);
  });
});

// ── selectPreanalyzeTargets · 제외 ──

describe("selectPreanalyzeTargets · 제외", () => {
  it("g2b 공고 행(raw_payload 에 fixtureId 가 없다)은 뺀다", () => {
    const g2b: DemoBidRow = {
      bidId: "1d2c3b4a-5968-4778-8a9b-0c1d2e3f4a5b",
      revisionId: "2e3d4c5b-6a79-4889-9bac-1d2e3f4a5b6c",
      revision: 1,
      rawPayload: { bidNtceNo: "R26BK90000001", bidNtceOrd: "000", bidNtceNm: "가상 g2b 공고" },
      latestRevision: 1,
    };
    expect(selectPreanalyzeTargets([...seedDemoBidRows(), g2b])).toEqual(expectedTargets());
  });

  it("raw_payload 에 fixtureId 키가 없는 fixture 행은 뺀다", () => {
    const rows = seedDemoBidRows().map((row) => {
      if (row.revisionId !== seedDemoBidRow("FX-07").revisionId) return row;
      const payload = row.rawPayload;
      const rest =
        typeof payload === "object" && payload !== null
          ? Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "fixtureId"))
          : {};
      return withRawPayload(row, rest);
    });
    expect(fixtureIds(selectPreanalyzeTargets(rows))).not.toContain("FX-07");
    expect(selectPreanalyzeTargets(rows)).toHaveLength(17);
  });

  it.each<[string, unknown]>([
    ["한 자리 번호", "FX-7"],
    ["세 자리 번호", "FX-007"],
    ["소문자", "fx-07"],
    ["revision 접미어", "FX-07.r01"],
    ["앞 공백", " FX-07"],
    ["뒤 공백", "FX-07 "],
    ["빈 문자열", ""],
    ["숫자", 7],
    ["null", null],
  ])("raw_payload.fixtureId 가 ^FX-\\d{2}$ 가 아니면(%s) 뺀다", (_label, fixtureId) => {
    const target = seedDemoBidRow("FX-07").revisionId;
    const rows = seedDemoBidRows().map((row) =>
      row.revisionId === target ? withRawFixtureId(row, fixtureId) : row,
    );
    const targets = selectPreanalyzeTargets(rows);
    expect(targets.map((entry) => entry.revisionId)).not.toContain(target);
    expect(targets).toHaveLength(17);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["배열", ["FX-07"]],
    ["문자열", "FX-07"],
  ])("raw_payload 가 객체가 아니면(%s) 던지지 않고 뺀다", (_label, rawPayload) => {
    const target = seedDemoBidRow("FX-07").revisionId;
    const rows = seedDemoBidRows().map((row) =>
      row.revisionId === target ? withRawPayload(row, rawPayload) : row,
    );
    expect(selectPreanalyzeTargets(rows)).toHaveLength(17);
  });

  it("fixtureId 는 raw_payload.fixtureId 에서만 읽는다(정규화 값·bidId 로 추측하지 않는다)", () => {
    const target = seedDemoBidRow("FX-07").revisionId;
    const rows = seedDemoBidRows().map((row) =>
      row.revisionId === target
        ? withRawPayload(row, { noticeId: "DEMO-2026-0007", title: "FX-07 같은 제목" })
        : row,
    );
    expect(fixtureIds(selectPreanalyzeTargets(rows))).not.toContain("FX-07");
  });

  it("옛 revision 행은 빼고 latestRevision 과 같은 revision 만 대상이다", () => {
    const r1 = seedDemoBidRow("FX-06");
    const rows = [
      ...seedDemoBidRows().filter((row) => row.revisionId !== r1.revisionId),
      { ...r1, latestRevision: 2 },
      { ...r1, revisionId: FX06_R2_REVISION_ID, revision: 2, latestRevision: 2 },
    ];
    const fx06 = selectPreanalyzeTargets(rows).filter((target) => target.fixtureId === "FX-06");
    expect(fx06).toEqual([
      { bidId: r1.bidId, revisionId: FX06_R2_REVISION_ID, fixtureId: "FX-06", revision: 2 },
    ]);
  });

  it("최신 revision 이 2 이면 대상의 revision 은 2 다(멱등 키도 r02 가 된다)", () => {
    const r1 = seedDemoBidRow("FX-06");
    const rows = [{ ...r1, revisionId: FX06_R2_REVISION_ID, revision: 2, latestRevision: 2 }];
    const [target] = selectPreanalyzeTargets(rows);
    expect(target?.revision).toBe(2);
  });

  it("latestRevision 과 다른 revision 행만 있으면 그 공고는 대상이 아니다", () => {
    const r1 = seedDemoBidRow("FX-06");
    const rows = seedDemoBidRows().map((row) =>
      row.revisionId === r1.revisionId ? { ...row, latestRevision: 2 } : row,
    );
    expect(fixtureIds(selectPreanalyzeTargets(rows))).not.toContain("FX-06");
  });

  it("FX-02 는 최신 revision 이 바뀌어도 뺀다", () => {
    const r1 = seedDemoBidRow(LIVE_ANALYSIS_FIXTURE);
    const rows = [{ ...r1, revisionId: FX02_R2_REVISION_ID, revision: 2, latestRevision: 2 }];
    expect(selectPreanalyzeTargets(rows)).toEqual([]);
  });

  it("FX-02 하나만 있으면 대상은 0건이다", () => {
    expect(selectPreanalyzeTargets([seedDemoBidRow(LIVE_ANALYSIS_FIXTURE)])).toEqual([]);
  });
});

// ── preanalyzeIdempotencyKey ──

describe("preanalyzeIdempotencyKey", () => {
  const fx01 = (revision = 1): PreanalyzeTarget => ({
    ...seedTargets().filter((target) => target.fixtureId === "FX-01")[0],
    revision,
  });

  it("`<orgId>:demo-pre-<fixtureId>-r<NN>` 형식이다", () => {
    expect(preanalyzeIdempotencyKey(ORG_ID, fx01())).toBe(`${ORG_ID}:demo-pre-FX-01-r01`);
  });

  it.each<[number, string]>([
    [1, "r01"],
    [2, "r02"],
    [9, "r09"],
    [12, "r12"],
  ])("revision %i 은 두 자리 %s 로 적는다", (revision, suffix) => {
    expect(preanalyzeIdempotencyKey(ORG_ID, fx01(revision))).toBe(
      `${ORG_ID}:demo-pre-FX-01-${suffix}`,
    );
  });

  it("job 계약의 requestIdOf 로 demo-pre-<fixtureId>-r<NN> 을 꺼낼 수 있다", () => {
    const idempotencyKey = preanalyzeIdempotencyKey(ORG_ID, fx01());
    expect(requestIdOf({ orgId: ORG_ID, idempotencyKey })).toBe("demo-pre-FX-01-r01");
  });

  it("analysis job 데이터 스키마(analysisJobDataSchema)를 통과한다", () => {
    const idempotencyKey = preanalyzeIdempotencyKey(ORG_ID, fx01());
    const parsed = analysisJobDataSchema.safeParse({
      orgId: ORG_ID,
      scoreRunId: "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d",
      idempotencyKey,
    });
    expect(parsed.success).toBe(true);
  });

  it("seed 대상 18건의 키는 서로 다르다", () => {
    const keys = selectPreanalyzeTargets(seedDemoBidRows()).map((target) =>
      preanalyzeIdempotencyKey(ORG_ID, target),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("같은 공고라도 revision 이 다르면 키가 다르다", () => {
    expect(preanalyzeIdempotencyKey(ORG_ID, fx01(1))).not.toBe(
      preanalyzeIdempotencyKey(ORG_ID, fx01(2)),
    );
  });

  it("조직이 다르면 키가 다르고 그 조직 접두어로 시작한다", () => {
    const other = preanalyzeIdempotencyKey(OTHER_ORG_ID, fx01());
    expect(other).not.toBe(preanalyzeIdempotencyKey(ORG_ID, fx01()));
    expect(other.startsWith(`${OTHER_ORG_ID}:`)).toBe(true);
  });

  it("같은 입력이면 늘 같은 키다", () => {
    expect(preanalyzeIdempotencyKey(ORG_ID, fx01())).toBe(preanalyzeIdempotencyKey(ORG_ID, fx01()));
  });
});

// ── summarize ──

describe("summarize", () => {
  it("18건 모두 COMPLETED 면 targets=18 completed=18 이고 나머지는 0 이다", () => {
    const states: RunState[] = Array.from({ length: 18 }, () => "COMPLETED");
    expect(summarize(states)).toEqual({
      targets: 18,
      completed: 18,
      partial: 0,
      failed: 0,
      pending: 0,
    });
  });

  it("PARTIAL·FAILED 는 따로 세고 QUEUED·RUNNING 은 pending 으로 센다", () => {
    const states: RunState[] = ["COMPLETED", "PARTIAL", "FAILED", "QUEUED", "RUNNING", "COMPLETED"];
    expect(summarize(states)).toEqual({
      targets: 6,
      completed: 2,
      partial: 1,
      failed: 1,
      pending: 2,
    });
  });

  it("빈 목록이면 모두 0 이다", () => {
    expect(summarize([])).toEqual({ targets: 0, completed: 0, partial: 0, failed: 0, pending: 0 });
  });

  it("targets 는 completed·partial·failed·pending 의 합이다", () => {
    const states: RunState[] = ["RUNNING", "FAILED", "FAILED", "COMPLETED", "QUEUED"];
    const summary = summarize(states);
    expect(summary.completed + summary.partial + summary.failed + summary.pending).toBe(
      summary.targets,
    );
  });
});

// ── summaryLine ──

describe("summaryLine", () => {
  it("18건 모두 완료면 'preanalyze: targets=18 completed=18 partial=0 failed=0' 이다(e8 마지막 줄)", () => {
    const states: RunState[] = Array.from({ length: 18 }, () => "COMPLETED");
    expect(summaryLine(summarize(states))).toBe(
      "preanalyze: targets=18 completed=18 partial=0 failed=0",
    );
  });

  it("값을 targets·completed·partial·failed 순서로 적는다", () => {
    expect(summaryLine({ targets: 7, completed: 3, partial: 2, failed: 1, pending: 1 })).toBe(
      "preanalyze: targets=7 completed=3 partial=2 failed=1",
    );
  });

  it("pending 은 줄에 적지 않는다(targets 와 completed 의 차이로 보인다)", () => {
    expect(summaryLine({ targets: 18, completed: 17, partial: 0, failed: 0, pending: 1 })).toBe(
      "preanalyze: targets=18 completed=17 partial=0 failed=0",
    );
  });
});

// ── 배럴 ──

describe("@/server/analysis 배럴 · 사전 분석", () => {
  // worker(demo-preanalyze)는 도메인 배럴만 부를 수 있다.
  it.each([
    "selectPreanalyzeTargets",
    "preanalyzeIdempotencyKey",
    "summarize",
    "summaryLine",
    "PREANALYZE_EXCLUDED_FIXTURES",
    "DEMO_ORG_SLUG",
  ])("값 %s 를 내보낸다", (name) => {
    expect(Object.keys(analysisBarrel)).toContain(name);
  });

  it("배럴의 selectPreanalyzeTargets 는 preanalyze.model 의 것이다", () => {
    expect(typeof selectPreanalyzeTargets).toBe("function");
    expect(Reflect.get(analysisBarrel, "selectPreanalyzeTargets")).toBe(selectPreanalyzeTargets);
  });
});
