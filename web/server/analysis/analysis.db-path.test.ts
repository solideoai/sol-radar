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
  toLoadedContext,
  toQualificationCheckRows,
  toRequirementAssessmentRows,
  toRunningUpdate,
  toScoreFactorRows,
  toScoreRunResultUpdate,
} from "./analysis-store.model";
import {
  GOLDEN_IDS,
  NO_BUDGET_ID,
  ORG_ID,
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

/** seed 행 → toLoadedContext → runAnalysis. 캐시 추출은 seed 의 mock 추출 행이고 첨부는 seed 의 PENDING 문서다. */
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

async function markRunning(db: SqlDb, record: AnalysisRunRecord) {
  return updateRows(
    db,
    "score_runs",
    toRunningUpdate({
      orgId: record.orgId,
      scoreRunId: record.scoreRunId,
      runMode: record.meta.runMode,
      aiProvider: record.meta.model.provider,
      startedAt: record.meta.startedAt,
    }),
    { id: record.scoreRunId, org_id: record.orgId, ...ACTIVE },
  );
}

/** sink 순서로 자식 3표를 쓴다. 마감은 하지 않는다. */
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

/** score_runs 마감. 바뀐 행을 돌려준다. */
async function finishRun(db: SqlDb, record: AnalysisRunRecord) {
  return updateRows(db, "score_runs", toScoreRunResultUpdate(record), {
    id: record.scoreRunId,
    org_id: record.orgId,
    ...ACTIVE,
  });
}

/** 요청 → RUNNING → 자식 3표 → 마감. 바뀐 행을 돌려준다. */
async function writeWholeRun(db: SqlDb, record: AnalysisRunRecord) {
  await queueRun(db, record);
  await markRunning(db, record);
  await writeChildren(db, record);
  return finishRun(db, record);
}

async function countOf(db: SqlDb, table: string, scoreRunId: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `select count(*)::int as count from public.${table} where score_run_id = $1`,
    [scoreRunId],
  );
  return rows[0].count;
}

async function scoreRunRow(db: SqlDb, scoreRunId: string) {
  const { rows } = await db.query<Record<string, unknown>>(
    "select * from public.score_runs where id = $1",
    [scoreRunId],
  );
  return rows[0];
}

const FX01 = dbRun("FX-01").record;
const FX03 = dbRun("FX-03").record;
const S6 = (await dbPathRun("FX-01", "S6", DOWN_ROUTES)).record;
const FAILED_RUN = (await dbPathRun("FX-02", "FAILED")).record;
// FX-11: 예산 미공개 공고. 골든 파일이 없어 점수는 단언하지 않는다. Kev fixture 가 없어 gateway 가 Kev 를 끈 응답을 준다.
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

  it("QUEUED run 을 toRunningUpdate 로 RUNNING 으로 바꾸면 run_mode·ai_provider check 를 통과한다", async () => {
    await queueRun(db, FX01);
    const updated = await markRunning(db, FX01);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: "RUNNING", run_mode: "MOCK", ai_provider: "MOCK" });
  });

  it("FX-01 COMPLETED: 자식 3표 → score_runs 마감이 check·FK 위반 없이 한 행을 마감한다", async () => {
    const finished = await writeWholeRun(db, FX01);
    expect(finished).toHaveLength(1);
  });

  it("FX-01 COMPLETED: 마감한 run 은 COMPLETED·골든 점수·권고·입력 스냅샷·seed 추출 id 를 갖는다", async () => {
    await writeWholeRun(db, FX01);
    const golden = loadGolden("FX-01");
    expect(await scoreRunRow(db, FX01.scoreRunId)).toMatchObject({
      status: "COMPLETED",
      score: golden.score,
      recommendation: golden.recommendation,
      input_snapshot_hash: FX01.result.inputSnapshotHash,
      extraction_id: seedBid("FX-01").extraction.id,
    });
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

  it("FX-03 NO_BID: 마감이 check·FK 위반 없이 끝나고 권고가 골든(NO_BID)이다", async () => {
    const finished = await writeWholeRun(db, FX03);
    expect(finished).toHaveLength(1);
    expect(finished[0].recommendation).toBe(loadGolden("FX-03").recommendation);
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
    const finished = await writeWholeRun(db, S6);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      status: "PARTIAL",
      error_code: "AI_UNAVAILABLE",
      kev_output: null,
    });
    expect(finished[0].review_flags).toContain("AI_UNAVAILABLE");
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
    const finished = await writeWholeRun(db, FX11);
    expect(finished).toHaveLength(1);
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

  it("markFailed: toFailedUpdate 로 FAILED·error_code·finished_at 갱신이 통과한다", async () => {
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
      }),
      { id: FAILED_RUN.scoreRunId, org_id: FAILED_RUN.orgId, ...ACTIVE },
    );
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ status: "FAILED", error_code: "ANALYSIS_JOB_FAILED" });
  });

  it("재시도: 자식 3표를 두 번 써도(factors upsert·나머지 지우고 넣기) 행 수가 한 번 쓴 것과 같다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    await writeChildren(db, FX01);
    await writeChildren(db, FX01);
    expect(await countOf(db, "score_factors", FX01.scoreRunId)).toBe(5);
    expect(await countOf(db, "requirement_assessments", FX01.scoreRunId)).toBe(
      FX01.result.requirementAssessments.length,
    );
    expect(await countOf(db, "qualification_checks", FX01.scoreRunId)).toBe(
      FX01.result.qualificationChecks.length,
    );
  });

  it("재시도가 항목을 줄이면 옛 항목 판정 행이 남지 않는다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    await writeChildren(db, FX01);
    const fewer = withPatch(FX01, (draft) => {
      draft.result.requirementAssessments = draft.result.requirementAssessments.slice(0, 1);
    });
    expect(FX01.result.requirementAssessments.length).toBeGreaterThan(1);
    await writeChildren(db, fewer);
    expect(await countOf(db, "requirement_assessments", FX01.scoreRunId)).toBe(1);
  });

  it("이미 마감한 run 을 다시 마감하면 status 조건 때문에 0행이다(sink 의 NOT_RUNNING)", async () => {
    await writeWholeRun(db, FX01);
    expect(await finishRun(db, FX01)).toEqual([]);
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

  it("시험대 확인: 결과 갱신에서 input_snapshot 을 빼면 finished snapshot check 가 거절한다", async () => {
    await queueRun(db, FX01);
    await markRunning(db, FX01);
    await writeChildren(db, FX01);
    const update = { ...toScoreRunResultUpdate(FX01), input_snapshot: null };
    await expect(
      updateRows(db, "score_runs", update, { id: FX01.scoreRunId, org_id: FX01.orgId, ...ACTIVE }),
    ).rejects.toThrow(/score_runs_finished_snapshot_check/);
  });

  it("시험대 확인: review_flags 에 집합 밖 값을 넣으면 review_flags check 가 거절한다", async () => {
    await queueRun(db, FX01);
    const update = { ...toScoreRunResultUpdate(FX01), review_flags: ["NOT_A_FLAG"] };
    await expect(
      updateRows(db, "score_runs", update, { id: FX01.scoreRunId, org_id: FX01.orgId, ...ACTIVE }),
    ).rejects.toThrow(/score_runs_review_flags_check/);
  });
});
