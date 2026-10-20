import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  ALGORITHM_VERSION,
  KEV_DISCLAIMER,
  requirementExtractionSchema,
  type AnalysisResult,
  type FactorKey,
} from "@/server/scoring";
import { toExtractionRecord, type AnalysisRunRecord } from "./analysis.model";
import { runAnalysis } from "./analysis.service";
import {
  toExtractionRow,
  toFailedUpdate,
  toFinishScoreRunPayload,
  toLoadedContext,
  toQualificationCheckRows,
  toRequirementAssessmentRows,
  toRunningUpdate,
  toScoreFactorRows,
} from "./analysis-store.model";
import {
  GOLDEN_IDS,
  NO_BUDGET_ID,
  ORG_ID,
  OTHER_ORG_ID,
  contextFromLoaded,
  createMigratedDb,
  deleteRows,
  insertParentRows,
  insertRows,
  kevOffRoutes,
  loaderRowsFor,
  seedBid,
  seedDocumentsFor,
  updateRows,
  type GoldenId,
  type SqlDb,
} from "./store.test-support";
import {
  ATTEMPT_STARTED_AT,
  QUEUED_AT,
  buildContext,
  buildDeps,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  healthyRoutes,
  loadGolden,
  loadKevResponses,
  refusedReply,
  withPatch,
  type GatewayRoutes,
} from "./test-support";

// DB 경로(e8 신호 3e181b7): 데모 seed 의 행 계획 함수가 만든 org-01 의 실제 행(접힌 인력·데모 배정 2건·
// 프로필 revision 2·seed mock 추출·PENDING 첨부)을 loader 가 읽은 것처럼 toLoadedContext 에 넣고 runAnalysis 를 돌린다.
// gateway 는 실제 createGatewayClient + 가짜 fetch(3b mock /kev·/explain)다. 골든 숫자는 fixtures/goldens 에서 읽는다.
// 뒤쪽은 쓰기 매핑 결과를 실제 마이그레이션을 올린 PGlite 에 SQL 로 넣어 check·FK 를 본다. 느리므로 파일 하나에 DB 하나다.

const RUN_IDS: Record<string, string> = {
  "FX-01": "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a01",
  "FX-02": "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a02",
  "FX-03": "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a03",
  "FX-11": "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a11",
  S6: "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a06",
  FAILED: "0e1d2c3b-4a59-4687-9a6b-5c4d3e2f1a0f",
};

/** 3b mock 이 다 거절하는 gateway(S6 장애 주입). */
const DOWN_ROUTES: GatewayRoutes = { "/kev": refusedReply, "/explain": refusedReply };

/** seed 행 → toLoadedContext → runAnalysis. 캐시 추출은 사전 분석이 저장한 뒤의 캐시를 흉내 낸 mock 추출 행이고 첨부는 seed 의 PENDING 문서다. */
async function dbPathRun(
  id: GoldenId | typeof NO_BUDGET_ID,
  runKey: string = id,
  routes: GatewayRoutes = healthyRoutes(id),
) {
  const requestId = `req-db-${runKey}`;
  const rows = loaderRowsFor(
    id,
    { scoreRunId: RUN_IDS[runKey], queuedAt: QUEUED_AT, idempotencyKey: `${ORG_ID}:${requestId}` },
    seedDocumentsFor(id),
  );
  const loaded = toLoadedContext(rows);
  const fake = fakeGateway(routes);
  const store = fakeExtractionStore();
  const record = await runAnalysis(
    contextFromLoaded(loaded, requestId),
    buildDeps(fake.gateway, store.store),
  );
  return { record, fake, store, loaded, rows };
}

/** 같은 fixture 의 fixture 경로(people.json 팀 그대로) 결과. 인력 가용 FTE 비교용. */
async function fixturePathResult(id: GoldenId): Promise<AnalysisResult> {
  const fake = fakeGateway(healthyRoutes(id));
  const record = await runAnalysis(
    buildContext(id),
    buildDeps(fake.gateway, fakeExtractionStore().store),
  );
  return record.result;
}

function factorOf(result: AnalysisResult, key: FactorKey) {
  const factor = result.factors.find((entry) => entry.factor === key);
  if (!factor) throw new Error(`요소가 없다: ${key}`);
  return factor;
}

const DB_RUNS = new Map(
  await Promise.all(GOLDEN_IDS.map(async (id) => [id, await dbPathRun(id)] as const)),
);
const FIXTURE_RESULTS = new Map(
  await Promise.all(GOLDEN_IDS.map(async (id) => [id, await fixturePathResult(id)] as const)),
);

function dbRun(id: GoldenId) {
  const run = DB_RUNS.get(id);
  if (!run) throw new Error(`DB 경로 결과가 없다: ${id}`);
  return run;
}

function fixtureResult(id: GoldenId): AnalysisResult {
  const result = FIXTURE_RESULTS.get(id);
  if (!result) throw new Error(`fixture 경로 결과가 없다: ${id}`);
  return result;
}

// ── 골든(DB 경로) ──

describe("DB 경로 골든 · seed 행 → toLoadedContext → runAnalysis", () => {
  for (const id of GOLDEN_IDS) {
    it(`${id}: score·recommendation 이 fixtures/goldens/${id}.json 과 같다`, () => {
      const golden = loadGolden(id);
      const { result } = dbRun(id).record;
      expect(result.score).toBe(golden.score);
      expect(result.recommendation).toBe(golden.recommendation);
    });

    it(`${id}: staffAvailability points 가 골든과 같다`, () => {
      const golden = loadGolden(id).factors.find((factor) => factor.factor === "staffAvailability");
      expect(golden).toBeDefined();
      expect(factorOf(dbRun(id).record.result, "staffAvailability").points).toBe(golden?.points);
    });

    it(`${id}: 요소별 normalized·points·maxPoints 가 골든과 같다`, () => {
      expect(
        dbRun(id).record.result.factors.map(({ factor, normalized, points, maxPoints }) => ({
          factor,
          normalized,
          points,
          maxPoints,
        })),
      ).toEqual(loadGolden(id).factors);
    });

    it(`${id}: reviewFlags 가 골든과 같다(seed 의 PENDING 첨부가 PARSE_UNSUPPORTED 를 만들지 않는다)`, () => {
      expect(dbRun(id).record.result.reviewFlags).toEqual(loadGolden(id).reviewFlags);
    });

    it(`${id}: DB 팀(접힌 availability + 데모 배정 2건)의 가용 FTE 가 fixture 팀과 같다`, () => {
      const db = factorOf(dbRun(id).record.result, "staffAvailability").rawValue;
      const fixture = factorOf(fixtureResult(id), "staffAvailability").rawValue;
      expect(db.availableFte).toBe(fixture.availableFte);
      expect(db.requiredFte).toBe(fixture.requiredFte);
    });

    it(`${id}: COMPLETED·RULES_WITH_KEV_ASSIST 다`, () => {
      const { result } = dbRun(id).record;
      expect(result.status).toBe("COMPLETED");
      expect(result.recommendationBasis).toBe("RULES_WITH_KEV_ASSIST");
    });

    it(`${id}: seed 추출 행을 캐시로 써서 /extract 를 부르지 않고 extractionId 가 그 행 id 다`, () => {
      const { record, fake, store } = dbRun(id);
      expect(fake.count("/extract")).toBe(0);
      expect(store.saves).toHaveLength(0);
      expect(record.extractionId).toBe(seedBid(id).extraction.id);
    });

    it(`${id}: /kev 요청의 fixtureId 는 raw_payload.fixtureId 의 revision stem(${id}.r01)이다`, () => {
      expect(dbRun(id).fake.bodyOf("/kev").fixtureId).toBe(`${id}.r01`);
    });

    it(`${id}: 레코드의 org·run·bid·revision·프로필 id 는 seed 행 값이다`, () => {
      const { record, rows } = dbRun(id);
      expect(record).toMatchObject({
        orgId: ORG_ID,
        scoreRunId: rows.scoreRun.id,
        bidId: rows.scoreRun.bid_id,
        revisionId: rows.revision.id,
        companyProfileId: rows.scoreRun.company_profile_id,
      });
    });
  }
});

// ── PGlite 쓰기 제약 ──
// C5-B 보안 후속 2: 결과 저장은 RPC finish_score_run(p) 한 번(한 트랜잭션)이다(20261019000011). p 는 toFinishScoreRunPayload(record) 다.
// 그 run 이 RUNNING 이고 started_at 이 이 시도의 시작 시각(record.attemptStartedAt)일 때만 자식 3표와 마감을 쓴다.
// 예전 기대(자식 3표를 SQL 로 차례로 쓰고 score_runs 를 status in (QUEUED, RUNNING) 조건으로 마감, 끝난 run 이면 0행)는
// 이 결정으로 함수 호출로 바뀌었다. 매핑 출력이 함수가 읽는 열과 맞는지를 실제 레코드(골든·S6·FX-11)로 본다.

/** C6 가 넣는 요청 행(QUEUED). */
async function queueRun(db: SqlDb, record: AnalysisRunRecord): Promise<void> {
  await insertRows(db, "score_runs", [
    {
      id: record.scoreRunId,
      org_id: record.orgId,
      bid_id: record.bidId,
      revision_id: record.revisionId,
      company_profile_id: record.companyProfileId,
      profile_revision: record.input.profile.revision,
      algorithm_version: ALGORITHM_VERSION,
      run_mode: "MOCK",
      ai_provider: "MOCK",
      idempotency_key: record.idempotencyKey,
      status: "QUEUED",
      queued_at: record.meta.queuedAt,
    },
  ]);
}

const ACTIVE = { status: ["QUEUED", "RUNNING"] };

/** 다른 시도가 run 을 다시 잡은 시각(record.attemptStartedAt 과 1ms 다르다). */
const OTHER_ATTEMPT_STARTED_AT = new Date(Date.parse(ATTEMPT_STARTED_AT) + 1).toISOString();

/** worker 의 markRunning. started_at 은 그 시도의 시작 시각이다(기본은 레코드의 시도). */
async function markRunning(
  db: SqlDb,
  record: AnalysisRunRecord,
  startedAt: string = record.attemptStartedAt,
) {
  return updateRows(
    db,
    "score_runs",
    toRunningUpdate({
      orgId: record.orgId,
      scoreRunId: record.scoreRunId,
      runMode: record.meta.runMode,
      aiProvider: record.meta.model.provider,
      startedAt,
      // C6 가 넣은 QUEUED run 을 처음 잡는다. expected 는 쓰기 조건이라 갱신 열에는 없다.
      expected: { status: "QUEUED", startedAt: null },
    }),
    { id: record.scoreRunId, org_id: record.orgId, ...ACTIVE },
  );
}

/** 앞 시도가 남긴 자식 행(예전 sink 의 순서 쓰기 흉내). 마감은 하지 않는다. */
async function writeChildren(db: SqlDb, record: AnalysisRunRecord): Promise<void> {
  await insertRows(db, "score_factors", toScoreFactorRows(record), {
    onConflict: ["score_run_id", "factor"],
  });
  await deleteRows(db, "requirement_assessments", {
    score_run_id: record.scoreRunId,
    org_id: record.orgId,
  });
  const assessments = toRequirementAssessmentRows(record);
  if (assessments.length > 0) await insertRows(db, "requirement_assessments", assessments);
  await deleteRows(db, "qualification_checks", {
    score_run_id: record.scoreRunId,
    org_id: record.orgId,
  });
  const checks = toQualificationCheckRows(record);
  if (checks.length > 0) await insertRows(db, "qualification_checks", checks);
}

/** sink 가 보내는 RPC 와 같은 호출(service role 자리). 돌려준 run id 다. */
async function finishRun(db: SqlDb, payload: unknown): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    "select public.finish_score_run($1::jsonb) as id",
    [JSON.stringify(payload)],
  );
  return rows[0].id;
}

async function scoreRunRow(db: SqlDb, scoreRunId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    "select * from public.score_runs where id = $1",
    [scoreRunId],
  );
  return rows[0];
}

/** 요청 → RUNNING(이 시도) → finish_score_run. 돌려준 id 와 마감한 score_runs 행이다. */
async function writeWholeRun(db: SqlDb, record: AnalysisRunRecord) {
  await queueRun(db, record);
  await markRunning(db, record);
  const id = await finishRun(db, toFinishScoreRunPayload(record));
  return { id, row: await scoreRunRow(db, record.scoreRunId) };
}

async function countOf(db: SqlDb, table: string, scoreRunId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from public.${table} where score_run_id = $1`,
    [scoreRunId],
  );
  return rows[0].count;
}

/** run 하나의 score_runs 행과 자식 3표 행 전부(id·시각 포함). "그대로다"의 기준이다. */
async function runSnapshot(db: SqlDb, scoreRunId: string) {
  const children = async (table: string) =>
    (
      await db.query<Record<string, unknown>>(
        `select * from public.${table} where score_run_id = $1 order by id`,
        [scoreRunId],
      )
    ).rows;
  return {
    run: await scoreRunRow(db, scoreRunId),
    score_factors: await children("score_factors"),
    requirement_assessments: await children("requirement_assessments"),
    qualification_checks: await children("qualification_checks"),
  };
}

const NOT_RUNNING = { message: "SCORE_RUN_NOT_RUNNING" };
const NOT_FOUND = { message: "SCORE_RUN_NOT_FOUND" };

const FX01 = dbRun("FX-01").record;
const FX03 = dbRun("FX-03").record;
const S6 = (await dbPathRun("FX-01", "S6", DOWN_ROUTES)).record;
const FAILED_RUN = (await dbPathRun("FX-02", "FAILED")).record;
// FX-11: 예산 미공개 공고. 골든 파일이 없어 점수는 단언하지 않는다. KEV_ENABLED=false 시나리오다(kevOffRoutes 로 Kev 를 끈다).
const FX11 = (await dbPathRun(NO_BUDGET_ID, NO_BUDGET_ID, kevOffRoutes())).record;

describe("PGlite 쓰기 제약 · 전제", () => {
  it("S6 레코드는 PARTIAL·AI_UNAVAILABLE·Kev 없음이다", () => {
    expect(S6.result.status).toBe("PARTIAL");
    expect(S6.result.errorCode).toBe("AI_UNAVAILABLE");
    expect(S6.kevOutput).toBeNull();
  });

  it("FX-03 레코드에 NOT_SATISFIED 자격 판정이 있다", () => {
    expect(FX03.result.qualificationChecks.map((check) => check.outcome)).toContain(
      "NOT_SATISFIED",
    );
  });

  it("FX-11 레코드(DB 경로)는 COMPLETED·Kev 꺼짐이고 missingFactors 가 scaleFit=BUDGET_UNKNOWN 하나다", () => {
    expect(FX11.result.status).toBe("COMPLETED");
    expect(FX11.result.kev.enabled).toBe(false);
    expect(FX11.result.missingFactors).toEqual([{ factor: "scaleFit", reason: "BUDGET_UNKNOWN" }]);
  });

  it("레코드의 attemptStartedAt 은 contextFromLoaded 가 준 시도 시작 시각이고 meta.startedAt 과 다르다", () => {
    expect(FX01.attemptStartedAt).toBe(ATTEMPT_STARTED_AT);
    expect(FX01.attemptStartedAt).not.toBe(FX01.meta.startedAt);
  });
});

describe("PGlite 쓰기 제약 · 실제 마이그레이션 위 SQL", () => {
  let db: SqlDb;

  beforeAll(async () => {
    db = await createMigratedDb();
    await insertParentRows(db, [...GOLDEN_IDS, NO_BUDGET_ID]);
  }, 120_000);

  afterEach(async () => {
    // 자식 3표는 FK cascade 로 함께 지워진다. 시험마다 빈 run 표에서 시작한다(진행 중 run 부분 UNIQUE 충돌 방지).
    await db.exec("delete from public.score_runs");
  });

  afterAll(async () => {
    await db.close();
  });

  it("QUEUED run 을 toRunningUpdate 로 RUNNING 으로 바꾸면 run_mode·ai_provider check 를 통과하고 started_at 은 이 시도의 시작 시각이다", async () => {
    await queueRun(db, FX01);
    const updated = await markRunning(db, FX01);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: "RUNNING", run_mode: "MOCK", ai_provider: "MOCK" });
    expect(updated[0].started_at).toEqual(new Date(FX01.attemptStartedAt));
  });

  it("FX-01 COMPLETED: finish_score_run 한 번이 check·FK 위반 없이 그 run id 를 돌려준다", async () => {
    const { id } = await writeWholeRun(db, FX01);
    expect(id).toBe(FX01.scoreRunId);
  });

  it("FX-01 COMPLETED: 마감한 run 은 COMPLETED·골든 점수·권고·입력 스냅샷·seed 추출 id 를 갖는다", async () => {
    const { row } = await writeWholeRun(db, FX01);
    const golden = loadGolden("FX-01");
    expect(row).toMatchObject({
      status: "COMPLETED",
      score: golden.score,
      recommendation: golden.recommendation,
      input_snapshot_hash: FX01.result.inputSnapshotHash,
      extraction_id: seedBid("FX-01").extraction.id,
    });
  });

  it("FX-01 COMPLETED: 마감은 started_at 을 이 시도의 시작 시각 그대로 두고 finished_at 은 meta.finishedAt 이다", async () => {
    const { row } = await writeWholeRun(db, FX01);
    expect(row.started_at).toEqual(new Date(FX01.attemptStartedAt));
    expect(row.finished_at).toEqual(new Date(FX01.meta.finishedAt));
  });

  it("FX-01 COMPLETED: score_factors 다섯 행과 requirement_assessments·qualification_checks 행이 들어간다", async () => {
    await writeWholeRun(db, FX01);
    expect(await countOf(db, "score_factors", FX01.scoreRunId)).toBe(5);
    expect(await countOf(db, "requirement_assessments", FX01.scoreRunId)).toBe(
      FX01.result.requirementAssessments.length,
    );
    expect(await countOf(db, "qualification_checks", FX01.scoreRunId)).toBe(
      FX01.result.qualificationChecks.length,
    );
  });

  it("FX-01 COMPLETED: 자식 행의 score_run_id·org_id 는 그 run·조직이다", async () => {
    await writeWholeRun(db, FX01);
    for (const table of ["score_factors", "requirement_assessments", "qualification_checks"]) {
      const { rows } = await db.query<{ org_id: string }>(
        `select distinct org_id from public.${table} where score_run_id = $1`,
        [FX01.scoreRunId],
      );
      expect(rows, table).toEqual([{ org_id: FX01.orgId }]);
    }
  });

  it("FX-03 NO_BID: 마감이 check·FK 위반 없이 끝나고 권고가 골든(NO_BID)이다", async () => {
    const { id, row } = await writeWholeRun(db, FX03);
    expect(id).toBe(FX03.scoreRunId);
    expect(row.recommendation).toBe(loadGolden("FX-03").recommendation);
  });

  it("FX-03 NO_BID: NOT_SATISFIED 자격 행은 reason_code 가 null 로 들어간다(needs_review check)", async () => {
    await writeWholeRun(db, FX03);
    const { rows } = await db.query<{ reason_code: string | null }>(
      "select reason_code from public.qualification_checks where score_run_id = $1 and outcome = 'NOT_SATISFIED'",
      [FX03.scoreRunId],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.reason_code)).toEqual(rows.map(() => null));
  });

  it("S6 PARTIAL: review_flags(AI_UNAVAILABLE)·kev_output null 로 PARTIAL 마감이 통과한다", async () => {
    const { row } = await writeWholeRun(db, S6);
    expect(row).toMatchObject({
      status: "PARTIAL",
      error_code: "AI_UNAVAILABLE",
      kev_output: null,
    });
    expect(row.review_flags).toContain("AI_UNAVAILABLE");
  });

  it("FX-01 COMPLETED: 마감한 run 의 kev_assist 를 다시 읽으면 result.kev 이고 suggestedOption BID·probabilities 가 fixtures/kev/FX-01.json 값이다", async () => {
    await writeWholeRun(db, FX01);
    const { recommendation } = loadKevResponses("FX-01");
    const { rows } = await db.query<{ kev_assist: unknown }>(
      "select kev_assist from public.score_runs where id = $1",
      [FX01.scoreRunId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kev_assist).toEqual(FX01.result.kev);
    expect(rows[0].kev_assist).toMatchObject({
      enabled: true,
      suggestedOption: "BID",
      probabilities: recommendation.probabilities,
    });
  });

  it("FX-11 COMPLETED: 마감한 run 의 score_factors 를 다시 읽으면 scaleFit 만 missing_reason BUDGET_UNKNOWN 이고 나머지 네 요소는 null 이다", async () => {
    const { id } = await writeWholeRun(db, FX11);
    expect(id).toBe(FX11.scoreRunId);
    const { rows } = await db.query<{ factor: string; missing_reason: string | null }>(
      "select factor, missing_reason from public.score_factors where score_run_id = $1",
      [FX11.scoreRunId],
    );
    expect(Object.fromEntries(rows.map((row) => [row.factor, row.missing_reason]))).toEqual({
      skillMatch: null,
      pastPerformance: null,
      staffAvailability: null,
      scaleFit: "BUDGET_UNKNOWN",
      strategicPreference: null,
    });
  });

  it("Kev 를 쓰지 않은 run(FX-11 Kev 꺼짐·S6 Kev 장애)도 kev_assist 는 null 이 아니라 enabled=false 객체(disclaimer 포함)로 남는다", async () => {
    for (const record of [FX11, S6]) {
      await writeWholeRun(db, record);
      const { rows } = await db.query<{ kev_assist: unknown }>(
        "select kev_assist from public.score_runs where id = $1",
        [record.scoreRunId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].kev_assist).toEqual(record.result.kev);
      expect(rows[0].kev_assist).toMatchObject({
        enabled: false,
        probabilities: null,
        disclaimer: KEV_DISCLAIMER,
      });
    }
  });

  it("markFailed: toFailedUpdate 로 이 시도가 잡은 run(RUNNING·started_at 같음)의 FAILED·error_code·finished_at 갱신이 통과한다", async () => {
    await queueRun(db, FAILED_RUN);
    await markRunning(db, FAILED_RUN);
    const updated = await updateRows(
      db,
      "score_runs",
      toFailedUpdate({
        orgId: FAILED_RUN.orgId,
        scoreRunId: FAILED_RUN.scoreRunId,
        errorCode: "ANALYSIS_JOB_FAILED",
        finishedAt: FAILED_RUN.meta.finishedAt,
        expected: { status: "RUNNING", startedAt: FAILED_RUN.attemptStartedAt },
      }),
      {
        id: FAILED_RUN.scoreRunId,
        org_id: FAILED_RUN.orgId,
        status: "RUNNING",
        started_at: FAILED_RUN.attemptStartedAt,
      },
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: "FAILED", error_code: "ANALYSIS_JOB_FAILED" });
  });

  it("재시도: 앞 시도가 남긴 자식 행이 있어도 함수 한 번 뒤 행 수는 레코드와 같다(요소 upsert·나머지 지우고 넣기)", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    await writeChildren(db, FX01);
    await finishRun(db, toFinishScoreRunPayload(FX01));
    expect(await countOf(db, "score_factors", FX01.scoreRunId)).toBe(5);
    expect(await countOf(db, "requirement_assessments", FX01.scoreRunId)).toBe(
      FX01.result.requirementAssessments.length,
    );
    expect(await countOf(db, "qualification_checks", FX01.scoreRunId)).toBe(
      FX01.result.qualificationChecks.length,
    );
  });

  it("재시도가 항목을 줄이면 앞 시도의 옛 항목 판정 행이 남지 않는다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    await writeChildren(db, FX01);
    const fewer = withPatch(FX01, (draft) => {
      draft.result.requirementAssessments = draft.result.requirementAssessments.slice(0, 1);
    });
    expect(FX01.result.requirementAssessments.length).toBeGreaterThan(1);
    await finishRun(db, toFinishScoreRunPayload(fewer));
    expect(await countOf(db, "requirement_assessments", FX01.scoreRunId)).toBe(1);
  });

  it("이미 마감한 run 에 늦은 시도(같은 시도 식별자)가 다시 부르면 SCORE_RUN_NOT_RUNNING 이고 run·자식 행이 그대로다", async () => {
    await writeWholeRun(db, FX01);
    const before = await runSnapshot(db, FX01.scoreRunId);
    const late = withPatch(FX01, (draft) => {
      draft.result.requirementAssessments = draft.result.requirementAssessments.slice(0, 1);
      draft.result.qualificationChecks = [];
    });
    await expect(finishRun(db, toFinishScoreRunPayload(late))).rejects.toMatchObject(NOT_RUNNING);
    expect(await runSnapshot(db, FX01.scoreRunId)).toEqual(before);
  });

  it("FAILED 로 닫힌 run(복구·영구 실패)에 늦은 시도가 부르면 SCORE_RUN_NOT_RUNNING 이고 FAILED·자식 행 0 그대로다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    await updateRows(
      db,
      "score_runs",
      toFailedUpdate({
        orgId: FX01.orgId,
        scoreRunId: FX01.scoreRunId,
        errorCode: "STALE_RUN",
        finishedAt: FX01.meta.finishedAt,
        expected: { status: "RUNNING", startedAt: FX01.attemptStartedAt },
      }),
      { id: FX01.scoreRunId, org_id: FX01.orgId, ...ACTIVE },
    );
    const before = await runSnapshot(db, FX01.scoreRunId);
    await expect(finishRun(db, toFinishScoreRunPayload(FX01))).rejects.toMatchObject(NOT_RUNNING);
    expect(await runSnapshot(db, FX01.scoreRunId)).toEqual(before);
    expect(before.run).toMatchObject({ status: "FAILED", error_code: "STALE_RUN" });
    expect(before.score_factors).toEqual([]);
  });

  it("다른 시도가 다시 잡은 run(started_at 이 다르다)이면 SCORE_RUN_NOT_RUNNING 이고 그 시도의 run·자식 행이 그대로다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01, OTHER_ATTEMPT_STARTED_AT);
    await writeChildren(
      db,
      withPatch(FX01, (draft) => {
        draft.result.requirementAssessments = draft.result.requirementAssessments.slice(0, 1);
      }),
    );
    const before = await runSnapshot(db, FX01.scoreRunId);
    await expect(finishRun(db, toFinishScoreRunPayload(FX01))).rejects.toMatchObject(NOT_RUNNING);
    expect(await runSnapshot(db, FX01.scoreRunId)).toEqual(before);
    expect(before.run).toMatchObject({ status: "RUNNING" });
  });

  it("아무 시도도 잡지 않은 QUEUED run 이면 SCORE_RUN_NOT_RUNNING 이고 run 이 그대로다", async () => {
    await queueRun(db, FX01);
    const before = await runSnapshot(db, FX01.scoreRunId);
    await expect(finishRun(db, toFinishScoreRunPayload(FX01))).rejects.toMatchObject(NOT_RUNNING);
    expect(await runSnapshot(db, FX01.scoreRunId)).toEqual(before);
  });

  it("p.org_id 가 그 run 의 조직이 아니면 SCORE_RUN_NOT_FOUND 이고 run·자식 행이 그대로다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    const before = await runSnapshot(db, FX01.scoreRunId);
    const payload = { ...toFinishScoreRunPayload(FX01), org_id: OTHER_ORG_ID };
    await expect(finishRun(db, payload)).rejects.toMatchObject(NOT_FOUND);
    expect(await runSnapshot(db, FX01.scoreRunId)).toEqual(before);
  });

  it("자격 판정 한 행이 check 위반이면 앞서 쓴 요소·항목 판정과 옛 행 지우기까지 모두 되돌아간다(한 트랜잭션)", async () => {
    await queueRun(db, FX03);
    await markRunning(db, FX03);
    // 앞 시도가 남긴 행: 항목 판정 한 행만.
    await writeChildren(
      db,
      withPatch(FX03, (draft) => {
        draft.result.requirementAssessments = draft.result.requirementAssessments.slice(0, 1);
      }),
    );
    const before = await runSnapshot(db, FX03.scoreRunId);
    const broken = withPatch(toFinishScoreRunPayload(FX03), (draft) => {
      const last = draft.checks[draft.checks.length - 1];
      last.outcome = "NEEDS_REVIEW";
      last.reason_code = null;
    });
    await expect(finishRun(db, broken)).rejects.toThrow(/qualification_checks_needs_review_check/);
    expect(await runSnapshot(db, FX03.scoreRunId)).toEqual(before);
  });

  it("시험대 확인: 마감 열에서 input_snapshot 을 빼면 finished snapshot check 가 거절하고 자식 3표 쓰기도 되돌아간다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    const before = await runSnapshot(db, FX01.scoreRunId);
    const broken = withPatch(toFinishScoreRunPayload(FX01), (draft) => {
      draft.run.input_snapshot = null;
    });
    await expect(finishRun(db, broken)).rejects.toThrow(/score_runs_finished_snapshot_check/);
    expect(await runSnapshot(db, FX01.scoreRunId)).toEqual(before);
  });

  it("시험대 확인: review_flags 에 집합 밖 값을 넣으면 review_flags check 가 거절한다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    const broken = withPatch(toFinishScoreRunPayload(FX01), (draft) => {
      draft.run.review_flags = ["NOT_A_FLAG"];
    });
    await expect(finishRun(db, broken)).rejects.toThrow(/score_runs_review_flags_check/);
  });

  it("추출 쓰기: DB 경로 추출 레코드를 (revision_id, model_name, prompt_hash) 로 upsert 하면 seed 추출 행 id 가 돌아온다", async () => {
    const { loaded } = dbRun("FX-01");
    const extraction = requirementExtractionSchema.parse(loaded.extraction?.payload);
    const record = toExtractionRecord(
      contextFromLoaded(loaded, "req-db-extract"),
      extractBody(extraction),
      extraction,
    );
    const saved = await insertRows(db, "requirement_extractions", [toExtractionRow(record)], {
      onConflict: ["revision_id", "model_name", "prompt_hash"],
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe(seedBid("FX-01").extraction.id);
  });
});
