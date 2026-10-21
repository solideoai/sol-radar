import { describe, expect, it } from "vitest";
import type { Tables } from "@/lib/database.types";
import {
  INGESTION_CARD_SOURCES,
  INGESTION_FAILURE_STATUSES,
  INGESTION_SUCCESS_STATUSES,
  acceptsSourceForMode,
  ingestionRunInputSchema,
  toIngestionRunView,
  toIngestionSourceCard,
} from "@/server/ingestion";

// N8 수집 관리의 순수 규칙. 구현(ingestion-admin.model.ts)보다 먼저 쓴 시험이다.
// 근거: 05 IngestionRunInput(:361-366)·IngestionRun(:367-376)·검증(:428)·§6.5·6.6 예시,
// 04 §3.6 ingest_runs·ingest_errors(:208-209)·ingest_batch·run_mode(:278-287),
// 계획서 docs/plans/2026-10-20-n8-admin-ingestion-plan.md §1(5·6·11, GET 절).
//
// 고정하는 이름(배럴 @/server/ingestion):
// - ingestionRunInputSchema: zod. batch 는 소문자로 받아 대문자(SEED·LIVE)로 바꾼다.
// - acceptsSourceForMode(runMode: "live"|"fixture"|"mock", source: "g2b"|"fixture"): boolean
// - toIngestionRunView(row: ingest_runs 행, errors: ingest_errors 행[], requester: {id,name}|null): IngestionRunView

type IngestRunRow = Tables<"ingest_runs">;
type IngestErrorRow = Tables<"ingest_errors">;

const DAY_MS = 24 * 60 * 60 * 1000;
const FROM = "2026-10-15T00:00:00.000Z";
const isoAfter = (base: string, ms: number): string =>
  new Date(Date.parse(base) + ms).toISOString();
const windowOf = (lengthMs: number) => ({ from: FROM, to: isoAfter(FROM, lengthMs) });

const RUN_ID = "5d1c3f0a-8b2e-4c6d-9a7f-1e2d3c4b5a60";
const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const ZERO_SUMMARY = {
  created: 0,
  changed: 0,
  cancelled: 0,
  skippedDuplicate: 0,
  quarantined: 0,
  retried: 0,
};
// 05 §6.5 SEED 완료 예시의 집계
const SEED_SUMMARY = { ...ZERO_SUMMARY, created: 19, quarantined: 1, retried: 2 };

describe("ingestionRunInputSchema — 받는 입력(05 :361-366)", () => {
  it.each<[string, unknown]>([
    ["fixture seed", { source: "fixture", batch: "seed" }],
    ["fixture live", { source: "fixture", batch: "live" }],
    ["g2b, window·stages 생략", { source: "g2b" }],
    ["g2b window 1일", { source: "g2b", window: windowOf(DAY_MS) }],
    ["g2b window 정확히 7일", { source: "g2b", window: windowOf(7 * DAY_MS) }],
    ["g2b stages [NOTICE]", { source: "g2b", stages: ["NOTICE"] }],
    [
      "05 §6.6 예시(window 1일 + stages [NOTICE], 밀리초 없는 ISO)",
      {
        source: "g2b",
        window: { from: "2026-10-15T00:00:00Z", to: "2026-10-16T00:00:00Z" },
        stages: ["NOTICE"],
      },
    ],
  ])("%s 는 통과한다", (_label, input) => {
    expect(ingestionRunInputSchema.safeParse(input).success).toBe(true);
  });
});

describe("ingestionRunInputSchema — 거절하는 입력(05 :428, 계획서 §1-5)", () => {
  it.each<[string, unknown]>([
    // 05 :428 표
    ["fixture 에 batch 없음", { source: "fixture" }],
    ["fixture 에 window 있음", { source: "fixture", batch: "seed", window: windowOf(DAY_MS) }],
    ["fixture 에 stages 있음", { source: "fixture", batch: "seed", stages: ["NOTICE"] }],
    ["g2b 에 batch 있음", { source: "g2b", batch: "seed" }],
    ["g2b window 7일 + 1ms", { source: "g2b", window: windowOf(7 * DAY_MS + 1) }],
    // window 모양(계획서 §1-5: from < to)
    ["window from = to", { source: "g2b", window: { from: FROM, to: FROM } }],
    ["window from > to", { source: "g2b", window: { from: isoAfter(FROM, DAY_MS), to: FROM } }],
    ["window.from 이 ISO 시각이 아님", { source: "g2b", window: { from: "어제", to: FROM } }],
    [
      "window 가 날짜뿐(큐 job 스키마는 offset 있는 시각만 받는다)",
      { source: "g2b", window: { from: "2026-10-15", to: "2026-10-16" } },
    ],
    ["window.to 없음", { source: "g2b", window: { from: FROM } }],
    // stages(e8 판정 1: 생략과 ["NOTICE"] 만)
    ["stages [PRE_SPEC]", { source: "g2b", stages: ["PRE_SPEC"] }],
    ["stages [PLAN]", { source: "g2b", stages: ["PLAN"] }],
    ["stages [NOTICE, PRE_SPEC]", { source: "g2b", stages: ["NOTICE", "PRE_SPEC"] }],
    ["stages 빈 배열", { source: "g2b", stages: [] }],
    ["stages 소문자 [notice]", { source: "g2b", stages: ["notice"] }],
    // batch 대소문자(04 :282 — API 는 소문자, 저장은 대문자)
    ["batch 대문자 SEED", { source: "fixture", batch: "SEED" }],
    ["batch 대문자 LIVE", { source: "fixture", batch: "LIVE" }],
    ["batch 가 seed·live 밖", { source: "fixture", batch: "demo" }],
    // source
    ["source 없음", {}],
    ["source 가 g2b·fixture 밖", { source: "nara" }],
    ["source 대문자 FIXTURE", { source: "FIXTURE", batch: "seed" }],
    // 모양(분석 요청 스키마와 같이 strict)
    ["모르는 키", { source: "fixture", batch: "seed", force: true }],
    ["null", null],
    ["배열", [{ source: "fixture", batch: "seed" }]],
    ["문자열", "fixture"],
  ])("%s 면 거절한다", (_label, input) => {
    expect(ingestionRunInputSchema.safeParse(input).success).toBe(false);
  });
});

describe("ingestionRunInputSchema — batch 대문자 변환(04 :282)", () => {
  it.each([
    ["seed", "SEED"],
    ["live", "LIVE"],
  ])("batch %s 는 %s 로 바꾼다", (batch, stored) => {
    // parse 는 실패하면 던진다. 실패한 결과로 단언이 헛도는 일이 없다.
    expect(ingestionRunInputSchema.parse({ source: "fixture", batch })).toMatchObject({
      source: "fixture",
      batch: stored,
    });
  });

  it("g2b 결과에는 batch 가 없다", () => {
    expect(ingestionRunInputSchema.parse({ source: "g2b" })).not.toHaveProperty("batch");
  });
});

describe("acceptsSourceForMode — 실행 모드·소스(05 :428, ADR-020)", () => {
  it.each<["live" | "fixture" | "mock", "g2b" | "fixture", boolean]>([
    ["live", "g2b", true],
    ["live", "fixture", false],
    ["fixture", "fixture", true],
    ["fixture", "g2b", false],
    ["mock", "fixture", true],
    ["mock", "g2b", false],
  ])("%s 모드에서 %s 는 %s", (runMode, source, accepted) => {
    expect(acceptsSourceForMode(runMode, source)).toBe(accepted);
  });
});

describe("toIngestionRunView — ingest_runs 행 → IngestionRun(05 :367-376)", () => {
  const runRow = (overrides: Partial<IngestRunRow> = {}): IngestRunRow => ({
    id: RUN_ID,
    source: "fixture",
    run_mode: "FIXTURE",
    job_key: `manual:${ORG_ID}:req-1`,
    trigger: "MANUAL",
    batch: "SEED",
    params: null,
    cursor: null,
    status: "PARTIAL",
    summary: SEED_SUMMARY,
    quota_used: 0,
    requested_by: USER_ID,
    idempotency_key: `${ORG_ID}:req-1`,
    started_at: "2026-10-20T01:00:00.000Z",
    finished_at: "2026-10-20T01:02:00.000Z",
    ...overrides,
  });
  const errorRow = (overrides: Partial<IngestErrorRow> = {}): IngestErrorRow => ({
    id: "e0f1a2b3-c4d5-4e6f-8a7b-9c0d1e2f3a4b",
    ingest_run_id: RUN_ID,
    source_key: "fixture:FX-12",
    error_code: "MISSING_REQUIRED_FIELD",
    result_code: null,
    redacted_detail: "title 누락",
    created_at: "2026-10-20T01:01:00.000Z",
    ...overrides,
  });
  const REQUESTER = { id: USER_ID, name: "김수집" };

  it("05 §6.5 SEED 완료 예시를 정확히 이 모양으로 낸다", () => {
    expect(toIngestionRunView(runRow(), [errorRow()], REQUESTER)).toStrictEqual({
      id: RUN_ID,
      source: "fixture",
      runMode: "fixture",
      batch: "seed",
      trigger: "MANUAL",
      status: "PARTIAL",
      summary: SEED_SUMMARY,
      quotaUsed: 0,
      errors: [
        {
          sourceKey: "fixture:FX-12",
          errorCode: "MISSING_REQUIRED_FIELD",
          resultCode: null,
          detail: "title 누락",
        },
      ],
      cursor: null,
      requestedBy: REQUESTER,
      startedAt: "2026-10-20T01:00:00.000Z",
      finishedAt: "2026-10-20T01:02:00.000Z",
    });
  });

  it("g2b live run 은 batch null·quotaUsed·cursor·resultCode 를 그대로 낸다", () => {
    const row = runRow({
      source: "g2b",
      run_mode: "LIVE",
      batch: null,
      quota_used: 12,
      cursor: "20261016",
      status: "SUCCEEDED",
      summary: { ...ZERO_SUMMARY, created: 4 },
    });
    const error = errorRow({
      source_key: "g2b-bid-notice",
      error_code: "RATE_LIMITED",
      result_code: "22",
      redacted_detail: "일일 호출 한도",
    });

    expect(toIngestionRunView(row, [error], REQUESTER)).toMatchObject({
      source: "g2b",
      runMode: "live",
      batch: null,
      quotaUsed: 12,
      cursor: "20261016",
      errors: [
        {
          sourceKey: "g2b-bid-notice",
          errorCode: "RATE_LIMITED",
          resultCode: "22",
          detail: "일일 호출 한도",
        },
      ],
    });
  });

  it.each([
    ["FIXTURE", "fixture"],
    ["LIVE", "live"],
    ["MOCK", "mock"],
  ])("run_mode %s 는 runMode %s 다", (stored, api) => {
    expect(toIngestionRunView(runRow({ run_mode: stored }), [], null).runMode).toBe(api);
  });

  it.each<[string | null, string | null]>([
    ["SEED", "seed"],
    ["LIVE", "live"],
    [null, null],
  ])("batch %s 는 %s 다", (stored, api) => {
    expect(toIngestionRunView(runRow({ batch: stored }), [], null).batch).toBe(api);
  });

  it("summary 에 빠진 키는 0 이다", () => {
    const row = runRow({ summary: { created: 2, retried: 1 } });

    expect(toIngestionRunView(row, [], null).summary).toStrictEqual({
      ...ZERO_SUMMARY,
      created: 2,
      retried: 1,
    });
  });

  it.each<[string, IngestRunRow["summary"]]>([
    ["빈 객체", {}],
    ["null", null],
    ["문자열", "summary"],
    ["배열", [1, 2]],
  ])("summary 가 %s 면 6키 모두 0 이다", (_label, summary) => {
    expect(toIngestionRunView(runRow({ summary }), [], null).summary).toStrictEqual(ZERO_SUMMARY);
  });

  it("오류 행은 순서대로 sourceKey·errorCode·resultCode·detail 네 키만 낸다(detail = redacted_detail)", () => {
    const errors = [
      errorRow(),
      errorRow({
        id: "f1a2b3c4-d5e6-4f7a-8b9c-0d1e2f3a4b5c",
        source_key: "fixture:FX-14",
        error_code: "SCHEMA_INVALID",
        redacted_detail: "deadline_at 형식",
      }),
    ];

    expect(toIngestionRunView(runRow(), errors, null).errors).toStrictEqual([
      {
        sourceKey: "fixture:FX-12",
        errorCode: "MISSING_REQUIRED_FIELD",
        resultCode: null,
        detail: "title 누락",
      },
      {
        sourceKey: "fixture:FX-14",
        errorCode: "SCHEMA_INVALID",
        resultCode: null,
        detail: "deadline_at 형식",
      },
    ]);
  });

  it("오류 행이 없으면 errors 는 빈 배열이다", () => {
    expect(toIngestionRunView(runRow(), [], null).errors).toStrictEqual([]);
  });

  it("실행 중 run 은 finishedAt null 이다", () => {
    const view = toIngestionRunView(runRow({ status: "RUNNING", finished_at: null }), [], null);

    expect(view).toMatchObject({ status: "RUNNING", finishedAt: null });
  });

  it("요청자가 지금 조직 구성원이 아니면(requester null) requestedBy 는 null 이고 요청자 id 를 어디에도 싣지 않는다", () => {
    const view = toIngestionRunView(runRow(), [], null);

    expect(view.requestedBy).toBeNull();
    expect(JSON.stringify(view)).not.toContain(USER_ID);
  });

  it("요청자가 지금 조직 구성원이면 requestedBy 는 {id, name} 이다", () => {
    expect(toIngestionRunView(runRow(), [], REQUESTER).requestedBy).toStrictEqual(REQUESTER);
  });

  it("job_key·idempotency_key·params 는 내보내지 않는다", () => {
    const view = toIngestionRunView(runRow({ params: { anchor: FROM } }), [], REQUESTER);

    expect(Object.keys(view).sort()).toStrictEqual(
      [
        "batch",
        "cursor",
        "errors",
        "finishedAt",
        "id",
        "quotaUsed",
        "requestedBy",
        "runMode",
        "source",
        "startedAt",
        "status",
        "summary",
        "trigger",
      ].sort(),
    );
  });
});

// 소스별 최근 수집 카드(N8 디자인 스펙 §4.4, D3). 저장이 고른 최신 성공·실패 행 → 카드 보기 모델.
describe("toIngestionSourceCard — 소스별 카드(§4.4)", () => {
  const SUCCESS_ID = "a1000000-0000-4000-8000-0000000000a1";
  const FAILURE_ID = "f1000000-0000-4000-8000-0000000000f1";
  const OTHER_FAILURE_ID = "f2000000-0000-4000-8000-0000000000f2";
  // 화면 역할이 읽는 열만 있는 행(W1). 숨긴 네 열이 없다
  type CardRunRow = Omit<IngestRunRow, "job_key" | "idempotency_key" | "requested_by" | "params">;
  const cardRow = (overrides: Partial<CardRunRow> = {}): CardRunRow => ({
    id: SUCCESS_ID,
    source: "fixture",
    run_mode: "MOCK",
    trigger: "DEMO",
    batch: "SEED",
    cursor: null,
    status: "PARTIAL",
    summary: SEED_SUMMARY,
    quota_used: 0,
    started_at: "2026-10-20T04:51:00.000Z",
    finished_at: "2026-10-20T04:51:12.000Z",
    ...overrides,
  });
  const failedRow = (overrides: Partial<CardRunRow> = {}): CardRunRow =>
    cardRow({
      id: FAILURE_ID,
      status: "FAILED",
      summary: ZERO_SUMMARY,
      started_at: "2026-10-20T05:00:00.000Z",
      finished_at: "2026-10-20T05:00:03.000Z",
      ...overrides,
    });
  const errorOf = (
    runId: string,
    sourceKey: string,
    errorCode: string,
    createdAt: string,
  ): IngestErrorRow => ({
    id: `${runId.slice(0, 8)}-${sourceKey}`,
    ingest_run_id: runId,
    source_key: sourceKey,
    error_code: errorCode,
    result_code: null,
    redacted_detail: `${errorCode} 상세`,
    created_at: createdAt,
  });

  it("카드 순서는 데모 데이터(fixture) → 나라장터(g2b) 다", () => {
    expect(INGESTION_CARD_SOURCES).toStrictEqual(["fixture", "g2b"]);
  });

  it("마지막 성공은 SUCCEEDED·PARTIAL, 마지막 실패는 FAILED 다", () => {
    expect(INGESTION_SUCCESS_STATUSES).toStrictEqual(["SUCCEEDED", "PARTIAL"]);
    expect(INGESTION_FAILURE_STATUSES).toStrictEqual(["FAILED"]);
  });

  it("성공 run 은 끝난 시각과 신규·변경·격리 숫자를, 실패 run 은 끝난 시각과 그 run 의 오류만 순서대로 싣는다", () => {
    const errors = [
      errorOf(FAILURE_ID, "fixture:DEMO-2026-0003", "BUDGET_UNPARSED", "2026-10-20T05:00:01.000Z"),
      errorOf(
        OTHER_FAILURE_ID,
        "g2b:page:start",
        "API_SERVICE_KEY_INVALID",
        "2026-10-20T05:00:01.500Z",
      ),
      errorOf(FAILURE_ID, "fixture:page:2", "SCHEMA_INVALID", "2026-10-20T05:00:02.000Z"),
    ];

    expect(
      toIngestionSourceCard("fixture", { success: cardRow(), failure: failedRow() }, errors),
    ).toStrictEqual({
      source: "fixture",
      lastSuccess: {
        runId: SUCCESS_ID,
        status: "PARTIAL",
        finishedAt: "2026-10-20T04:51:12.000Z",
        created: 19,
        changed: 0,
        quarantined: 1,
      },
      lastFailure: {
        runId: FAILURE_ID,
        finishedAt: "2026-10-20T05:00:03.000Z",
        errors: [
          {
            sourceKey: "fixture:DEMO-2026-0003",
            errorCode: "BUDGET_UNPARSED",
            resultCode: null,
            detail: "BUDGET_UNPARSED 상세",
          },
          {
            sourceKey: "fixture:page:2",
            errorCode: "SCHEMA_INVALID",
            resultCode: null,
            detail: "SCHEMA_INVALID 상세",
          },
        ],
      },
    });
  });

  it("run 이 없으면 성공·실패 모두 null 이다(화면은 '수집 기록이 없습니다')", () => {
    expect(toIngestionSourceCard("g2b", { success: null, failure: null }, [])).toStrictEqual({
      source: "g2b",
      lastSuccess: null,
      lastFailure: null,
    });
  });

  it("성공만 있으면 실패는 null 이고, 실패만 있으면 성공은 null 이다", () => {
    const g2bSuccess = cardRow({
      source: "g2b",
      run_mode: "LIVE",
      batch: null,
      status: "SUCCEEDED",
    });
    expect(
      toIngestionSourceCard("g2b", { success: g2bSuccess, failure: null }, []).lastFailure,
    ).toBeNull();
    const onlyFailure = toIngestionSourceCard(
      "fixture",
      { success: null, failure: failedRow() },
      [],
    );
    expect(onlyFailure.lastSuccess).toBeNull();
    expect(onlyFailure.lastFailure).toStrictEqual({
      runId: FAILURE_ID,
      finishedAt: "2026-10-20T05:00:03.000Z",
      errors: [],
    });
  });

  it("summary 의 빠진 키는 0 이다(worker 가 쓰는 jsonb 를 믿지 않는다)", () => {
    const card = toIngestionSourceCard(
      "fixture",
      { success: cardRow({ status: "SUCCEEDED", summary: { created: 3 } }), failure: null },
      [],
    );

    expect(card.lastSuccess).toMatchObject({ created: 3, changed: 0, quarantined: 0 });
  });

  it("끝난 run 의 finished_at 이 비어 있으면 시작 시각을 쓴다(지어내지 않는다)", () => {
    const card = toIngestionSourceCard(
      "fixture",
      { success: cardRow({ finished_at: null }), failure: failedRow({ finished_at: null }) },
      [],
    );

    expect(card.lastSuccess?.finishedAt).toBe("2026-10-20T04:51:00.000Z");
    expect(card.lastFailure?.finishedAt).toBe("2026-10-20T05:00:00.000Z");
  });

  it.each<[string, Partial<CardRunRow>, "success" | "failure"]>([
    ["성공 자리에 FAILED", { status: "FAILED" }, "success"],
    ["성공 자리에 RUNNING", { status: "RUNNING", finished_at: null }, "success"],
    ["실패 자리에 SUCCEEDED", { status: "SUCCEEDED" }, "failure"],
    ["다른 소스 행", { source: "g2b", run_mode: "LIVE", batch: null }, "success"],
  ])("%s 이 오면 던진다(저장과 규칙이 어긋난 것을 감추지 않는다)", (_label, overrides, slot) => {
    const row = slot === "success" ? cardRow(overrides) : failedRow(overrides);
    const latest =
      slot === "success" ? { success: row, failure: null } : { success: null, failure: row };

    expect(() => toIngestionSourceCard("fixture", latest, [])).toThrow(
      "ingest_runs 카드 행의 소스·상태가 요청과 맞지 않다",
    );
  });
});
