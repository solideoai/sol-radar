import { describe, expect, expectTypeOf, it } from "vitest";
import * as analysisBarrel from "@/server/analysis";
import type {
  AnalysisStores,
  AttachmentTextReader,
  PreanalyzeStore,
  RevisionDocumentText,
} from "@/server/analysis";
import { ALGORITHM_VERSION } from "@/server/scoring";
import type { ExtractionCacheKey } from "./analysis-job.model";
import { toExtractionRecord, type AnalysisRunRecord } from "./analysis.model";
import { runAnalysis } from "./analysis.service";
import { createAnalysisStores, createPreanalyzeStore } from "./analysis.repo";
import {
  toExtractionRow,
  toFailedUpdate,
  toLoadedContext,
  toQualificationCheckRows,
  toRequirementAssessmentRows,
  toRunningUpdate,
  toScoreFactorRows,
  toScoreRunResultUpdate,
  type LoaderRows,
} from "./analysis-store.model";
import {
  LEAKY_ERROR_TEXT,
  ORG_ID,
  OTHER_ORG_ID,
  SEED_PROFILE,
  bodyRows,
  conflictColumns,
  contextFromLoaded,
  eqValue,
  fakeSupabase,
  inValues,
  loaderRoute,
  loaderRowsFor,
  postgrestError,
  seedBid,
  selectedColumns,
  type PostgrestCall,
  type PostgrestRoute,
} from "./store.test-support";
import {
  G2B_BID_ID,
  NON_DEMO_BID_ID,
  bidTablesRoute,
  seedBidTables,
  seedTargets,
  toDemoBidRows,
  withForeignBids,
  withRevision2,
  type BidTables,
} from "./preanalyze.test-support";
import type { DemoBidRow } from "./preanalyze.model";
import {
  QUEUED_AT,
  buildContext,
  buildDeps,
  extractBody,
  fakeExtractionStore,
  fakeGateway,
  healthyRoutes,
  loadExtraction,
  withPatch,
} from "./test-support";

// 저장 port 의 Supabase 구현. 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어
// PostgREST 로 나가는 요청(표·방법·select 열·필터·Prefer·본문)과 순서를 본다. 규칙은 매핑 함수 몫이라 여기선 값이 그대로 가는지만 본다.
// service role 은 RLS 를 거치지 않으므로 조직 표의 모든 질의·쓰기에 org_id 가 걸려야 한다.

const RUN_ID = "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d";
const CACHE_KEY: NonNullable<ExtractionCacheKey> = {
  modelName: "fixture",
  promptHash: "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e",
};
const ORG_TABLES = ["score_runs", "company_profiles", "team_member_scoring", "assignments"];

const DOCUMENTS: RevisionDocumentText[] = [
  {
    documentId: "doc-1",
    name: "제안요청서.pdf",
    downloadStatus: "OK",
    downloadErrorCode: null,
    parseStatus: "PARSED",
    parseErrorCode: null,
    text: "가상 제안요청서 본문",
    pages: [{ page: 1, charOffset: 0 }],
  },
];

const loaderRows = (): LoaderRows =>
  loaderRowsFor(
    "FX-01",
    { scoreRunId: RUN_ID, queuedAt: QUEUED_AT, idempotencyKey: `${ORG_ID}:req-1` },
    DOCUMENTS,
  );

/** 받은 revision_id 를 기록하는 가짜 첨부 port. */
function fakeAttachments(documents: RevisionDocumentText[] = DOCUMENTS) {
  const reads: string[] = [];
  const reader: AttachmentTextReader = {
    readRevisionDocuments: async (revisionId) => {
      reads.push(revisionId);
      return documents;
    },
  };
  return { reader, reads };
}

/** 앞의 라우트가 답하지 않으면 다음 라우트로 넘긴다. */
function routes(...list: PostgrestRoute[]): PostgrestRoute {
  return (call) =>
    list.reduce<ReturnType<PostgrestRoute>>((reply, route) => reply ?? route(call), undefined);
}

/** 그 표·방법 요청에만 답한다. */
function on(method: string, table: string, reply: ReturnType<PostgrestRoute>): PostgrestRoute {
  return (call) => (call.method === method && call.table === table ? reply : undefined);
}

async function load(
  options: { route?: PostgrestRoute; cacheKey?: ExtractionCacheKey; rows?: LoaderRows } = {},
) {
  const rows = options.rows ?? loaderRows();
  const fake = fakeSupabase(routes(options.route ?? (() => undefined), loaderRoute(rows)));
  const attachments = fakeAttachments(rows.documents);
  const stores = createAnalysisStores(fake.client, attachments.reader);
  const target = { orgId: rows.scoreRun.org_id, scoreRunId: rows.scoreRun.id };
  const loaded = await stores.loader.load(
    target,
    options.cacheKey === undefined ? CACHE_KEY : options.cacheKey,
  );
  return { loaded, fake, attachments, rows };
}

function only(calls: PostgrestCall[]): PostgrestCall {
  expect(calls).toHaveLength(1);
  return calls[0];
}

/** fixture 경로 FX-01 레코드(3b mock gateway). */
const RECORD: AnalysisRunRecord = await runAnalysis(
  buildContext("FX-01"),
  buildDeps(fakeGateway(healthyRoutes("FX-01")).gateway, fakeExtractionStore().store),
);

/** 실패한 store 호출이 던진 오류. 던지지 않으면 시험을 실패시킨다. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 값을 던졌다");
  }
  throw new Error("던지지 않았다");
}

// ── loader ──

describe("loader.load · 질의", () => {
  it("score_runs 를 id·org_id 로 읽고 run 열만 고른다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("score_runs", "GET"));
    expect(eqValue(call, "id")).toBe(RUN_ID);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      [
        "id",
        "org_id",
        "bid_id",
        "revision_id",
        "company_profile_id",
        "idempotency_key",
        "status",
        "queued_at",
      ].toSorted(),
    );
  });

  it("bid_revisions 를 score_runs 의 revision_id·bid_id 로 읽는다", async () => {
    const { fake, rows } = await load();
    const call = only(fake.callsTo("bid_revisions", "GET"));
    expect(eqValue(call, "id")).toBe(rows.scoreRun.revision_id);
    expect(eqValue(call, "bid_id")).toBe(rows.scoreRun.bid_id);
    expect(selectedColumns(call)).toEqual(
      ["id", "bid_id", "revision", "raw_payload", "normalized", "fetched_at"].toSorted(),
    );
  });

  it("bid_structured_requirements 를 revision_id 로 (kind, seq) 순서로 읽는다", async () => {
    const { fake, rows } = await load();
    const call = only(fake.callsTo("bid_structured_requirements", "GET"));
    expect(eqValue(call, "revision_id")).toBe(rows.scoreRun.revision_id);
    expect(call.params.get("order")).toBe("kind.asc,seq.asc");
    expect(selectedColumns(call)).toEqual(
      ["kind", "seq", "code", "name", "value", "source_operation"].toSorted(),
    );
  });

  it("cacheKey 가 있으면 requirement_extractions 를 revision_id·성공 상태·model_name·prompt_hash 로 최신 1행 읽는다", async () => {
    const { fake, rows } = await load({ cacheKey: CACHE_KEY });
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(eqValue(call, "revision_id")).toBe(rows.scoreRun.revision_id);
    expect(inValues(call, "status")).toEqual(["COMPLETED", "PENDING_REVIEW"]);
    expect(eqValue(call, "model_name")).toBe(CACHE_KEY.modelName);
    expect(eqValue(call, "prompt_hash")).toBe(CACHE_KEY.promptHash);
    expect(call.params.get("order")).toBe("created_at.desc");
    expect(call.params.get("limit")).toBe("1");
  });

  it("cacheKey 가 null 이면 model_name·prompt_hash 조건 없이 그 revision 의 최신 성공 행 1개를 읽는다(S6)", async () => {
    const { fake, rows } = await load({ cacheKey: null });
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(eqValue(call, "revision_id")).toBe(rows.scoreRun.revision_id);
    expect(inValues(call, "status")).toEqual(["COMPLETED", "PENDING_REVIEW"]);
    expect(call.params.has("model_name")).toBe(false);
    expect(call.params.has("prompt_hash")).toBe(false);
    expect(call.params.get("order")).toBe("created_at.desc");
    expect(call.params.get("limit")).toBe("1");
  });

  it("requirement_extractions 는 id·status·payload·translations 만 고른다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(selectedColumns(call)).toEqual(["id", "status", "payload", "translations"].toSorted());
  });

  it("company_profiles 를 score_runs 의 company_profile_id 와 org_id 로 읽는다", async () => {
    const { fake, rows } = await load();
    const call = only(fake.callsTo("company_profiles", "GET"));
    expect(eqValue(call, "id")).toBe(rows.scoreRun.company_profile_id);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      [
        "revision",
        "name",
        "is_demo",
        "technologies",
        "technologies_complete",
        "licenses",
        "industry_codes",
        "past_projects",
        "financials",
        "preferences",
      ].toSorted(),
    );
  });

  it("team_member_scoring 을 org_id 로 member_id 순서로 읽는다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("team_member_scoring", "GET"));
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(call.params.get("order")).toBe("member_id.asc");
    expect(selectedColumns(call)).toEqual(
      ["member_id", "role", "grade", "skills", "availability"].toSorted(),
    );
  });

  it("assignments 를 org_id 로 읽는다", async () => {
    const { fake } = await load();
    const call = only(fake.callsTo("assignments", "GET"));
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(
      ["member_id", "starts_at", "ends_at", "allocation_percent"].toSorted(),
    );
  });

  it("조직 표(score_runs·company_profiles·team_member_scoring·assignments) 질의는 모두 org_id 조건이 있다", async () => {
    const { fake } = await load();
    const orgCalls = fake.calls.filter((call) => ORG_TABLES.includes(call.table));
    expect(orgCalls).toHaveLength(ORG_TABLES.length);
    for (const call of orgCalls) expect(eqValue(call, "org_id")).toBe(ORG_ID);
  });

  it("loader 는 읽기만 한다(GET 외 요청이 없다)", async () => {
    const { fake } = await load();
    expect(fake.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("첨부는 AttachmentTextReader 로 그 run 의 revision_id 를 한 번 읽는다", async () => {
    const { attachments, rows } = await load();
    expect(attachments.reads).toEqual([rows.scoreRun.revision_id]);
  });

  it("읽은 행을 toLoadedContext 로 바꾼 값을 돌려준다", async () => {
    const { loaded, rows } = await load();
    expect(loaded).toEqual(toLoadedContext(rows));
  });

  it("추출 행이 없으면 extraction 이 null 인 값을 돌려준다", async () => {
    const { loaded } = await load({
      route: on("GET", "requirement_extractions", { status: 200, body: [] }),
    });
    expect(loaded?.extraction).toBeNull();
  });

  it("cacheKey 가 null 이어도 읽은 성공 행을 extraction 으로 돌려준다(S6 캐시 재사용)", async () => {
    const { loaded, rows } = await load({ cacheKey: null });
    expect(loaded?.extraction?.id).toBe(rows.extraction?.id);
  });
});

describe("loader.load · 없음", () => {
  it("score_runs 행이 없으면 null 을 돌려준다", async () => {
    const { loaded } = await load({ route: on("GET", "score_runs", { status: 200, body: [] }) });
    expect(loaded).toBeNull();
  });

  it("score_runs 행이 없으면 첨부를 읽지 않는다", async () => {
    const { attachments } = await load({
      route: on("GET", "score_runs", { status: 200, body: [] }),
    });
    expect(attachments.reads).toEqual([]);
  });

  it("revision 행이 없으면 null 을 돌려준다", async () => {
    const { loaded } = await load({ route: on("GET", "bid_revisions", { status: 200, body: [] }) });
    expect(loaded).toBeNull();
  });

  it("회사 프로필 행이 없으면 null 을 돌려준다", async () => {
    const { loaded } = await load({
      route: on("GET", "company_profiles", { status: 200, body: [] }),
    });
    expect(loaded).toBeNull();
  });
});

describe("loader.load · 질의 오류", () => {
  it.each([
    "score_runs",
    "bid_revisions",
    "bid_structured_requirements",
    "requirement_extractions",
    "company_profiles",
    "team_member_scoring",
    "assignments",
  ])("%s 질의 오류는 'analysis store 오류: <표>.<동작> <code>' 로 던진다", async (table) => {
    const error = await rejectionOf(load({ route: on("GET", table, postgrestError("42501")) }));
    expect(error.message).toMatch(new RegExp(`^analysis store 오류: ${table}\\.\\S+ 42501$`));
  });

  it("오류 message 에 PostgREST 의 message·details·hint 를 싣지 않는다", async () => {
    const error = await rejectionOf(
      load({ route: on("GET", "score_runs", postgrestError("42501")) }),
    );
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("PostgREST 오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const error = await rejectionOf(
      load({ route: on("GET", "team_member_scoring", postgrestError(null)) }),
    );
    expect(error.message).toMatch(/^analysis store 오류: team_member_scoring\.\S+ UNKNOWN$/);
  });
});

// ── extraction ──

describe("extraction.loadSource", () => {
  async function loadSource() {
    const rows = loaderRows();
    const fake = fakeSupabase(loaderRoute(rows));
    const attachments = fakeAttachments();
    const stores = createAnalysisStores(fake.client, attachments.reader);
    const context = contextFromLoaded(toLoadedContext(rows), "req-1");
    const source = await stores.extraction.loadSource(context);
    return { source, fake, attachments, context, rows };
  }

  it("bid_revisions 의 normalized 를 context 의 revisionId·bidId 로 한 행 읽는다", async () => {
    const { fake, context } = await loadSource();
    const call = only(fake.callsTo("bid_revisions", "GET"));
    expect(eqValue(call, "id")).toBe(context.bid.revisionId);
    expect(eqValue(call, "bid_id")).toBe(context.bidId);
    expect(selectedColumns(call)).toEqual(["normalized"]);
  });

  it("첨부는 context 의 revisionId 로 읽는다", async () => {
    const { attachments, context } = await loadSource();
    expect(attachments.reads).toEqual([context.bid.revisionId]);
  });

  it("본문은 normalized.content, 첨부는 텍스트가 있는 문서다", async () => {
    const { source, rows } = await loadSource();
    expect(rows.revision.normalized).toMatchObject({ content: source.body });
    expect(source.attachments).toEqual([
      { documentId: "doc-1", text: "가상 제안요청서 본문", pages: [{ page: 1, charOffset: 0 }] },
    ]);
  });

  it("revision 이 없으면 analysis store 오류로 던진다", async () => {
    const rows = loaderRows();
    const fake = fakeSupabase(on("GET", "bid_revisions", postgrestError("PGRST116", 406)));
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    const context = contextFromLoaded(toLoadedContext(rows), "req-1");
    const error = await rejectionOf(stores.extraction.loadSource(context));
    expect(error.message).toMatch(/^analysis store 오류: bid_revisions\.\S+ PGRST116$/);
  });
});

describe("extraction.save", () => {
  const extraction = loadExtraction("FX-01");
  const record = toExtractionRecord(buildContext("FX-01"), extractBody(extraction), extraction);
  const SAVED_ID = "6b5a4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d";

  /** 저장한 행의 id 만 돌려준다(한 행 요청이면 객체, 아니면 배열). */
  const savedReply: PostgrestRoute = (call) =>
    call.method === "POST" && call.table === "requirement_extractions"
      ? {
          status: 201,
          body: call.accept.includes("vnd.pgrst.object+json")
            ? { id: SAVED_ID }
            : [{ id: SAVED_ID }],
        }
      : undefined;

  async function save(reply?: ReturnType<PostgrestRoute>) {
    const fake = fakeSupabase(
      reply === undefined ? savedReply : on("POST", "requirement_extractions", reply),
    );
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    return { promise: stores.extraction.save(record), fake };
  }

  it("requirement_extractions 에 (revision_id, model_name, prompt_hash) 충돌 시 병합하는 upsert 를 보낸다", async () => {
    const { promise, fake } = await save();
    await promise;
    const call = only(fake.callsTo("requirement_extractions", "POST"));
    expect(conflictColumns(call)).toEqual(["model_name", "prompt_hash", "revision_id"]);
    expect(call.prefer).toContain("resolution=merge-duplicates");
  });

  it("upsert 행은 toExtractionRow(record) 다", async () => {
    const { promise, fake } = await save();
    await promise;
    expect(bodyRows(only(fake.callsTo("requirement_extractions", "POST")))).toEqual([
      toExtractionRow(record),
    ]);
  });

  it("id 만 돌려받아 { id } 로 돌려준다", async () => {
    const { promise, fake } = await save();
    await expect(promise).resolves.toEqual({ id: SAVED_ID });
    expect(selectedColumns(only(fake.callsTo("requirement_extractions", "POST")))).toEqual(["id"]);
  });

  it("upsert 오류면 analysis store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { promise } = await save(postgrestError("23514"));
    const error = await rejectionOf(promise);
    expect(error.message).toMatch(/^analysis store 오류: requirement_extractions\.\S+ 23514$/);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });
});

// ── tracker ──

describe("tracker", () => {
  const running = {
    orgId: ORG_ID,
    scoreRunId: RUN_ID,
    runMode: "mock" as const,
    aiProvider: "mock" as const,
    startedAt: "2026-10-16T09:00:00.000Z",
  };
  const failed = {
    orgId: ORG_ID,
    scoreRunId: RUN_ID,
    errorCode: "ANALYSIS_JOB_FAILED",
    finishedAt: "2026-10-16T09:00:05.000Z",
  };

  function stores(route?: PostgrestRoute) {
    const fake = fakeSupabase(route);
    return { stores: createAnalysisStores(fake.client, fakeAttachments().reader), fake };
  }

  it("markRunning 은 score_runs 를 id·org_id·status in (QUEUED, RUNNING) 조건으로 갱신한다", async () => {
    const { stores: store, fake } = stores();
    await store.tracker.markRunning(running);
    const call = only(fake.callsTo("score_runs", "PATCH"));
    expect(eqValue(call, "id")).toBe(RUN_ID);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(inValues(call, "status")).toEqual(["QUEUED", "RUNNING"]);
  });

  it("markRunning 의 본문은 toRunningUpdate(input) 다", async () => {
    const { stores: store, fake } = stores();
    await store.tracker.markRunning(running);
    expect(only(fake.callsTo("score_runs", "PATCH")).body).toEqual(toRunningUpdate(running));
  });

  it("markFailed 는 score_runs 를 id·org_id·status in (QUEUED, RUNNING) 조건으로 갱신한다", async () => {
    const { stores: store, fake } = stores();
    await store.tracker.markFailed(failed);
    const call = only(fake.callsTo("score_runs", "PATCH"));
    expect(eqValue(call, "id")).toBe(RUN_ID);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(inValues(call, "status")).toEqual(["QUEUED", "RUNNING"]);
  });

  it("markFailed 의 본문은 toFailedUpdate(input) 다", async () => {
    const { stores: store, fake } = stores();
    await store.tracker.markFailed(failed);
    expect(only(fake.callsTo("score_runs", "PATCH")).body).toEqual(toFailedUpdate(failed));
  });

  it("이미 끝난 run 이라 0행이 바뀌어도 던지지 않는다", async () => {
    const { stores: store } = stores(on("PATCH", "score_runs", { status: 200, body: [] }));
    await expect(store.tracker.markFailed(failed)).resolves.toBeUndefined();
  });

  it("갱신 오류면 analysis store 오류로 던진다", async () => {
    const { stores: store } = stores(on("PATCH", "score_runs", postgrestError("40001")));
    const error = await rejectionOf(store.tracker.markRunning(running));
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ 40001$/);
  });
});

// ── sink ──

const FINISHED: ReturnType<PostgrestRoute> = { status: 200, body: [{ id: RECORD.scoreRunId }] };

function sinkStores(route?: PostgrestRoute) {
  const fake = fakeSupabase(
    routes(route ?? (() => undefined), on("PATCH", "score_runs", FINISHED)),
  );
  return { sink: createAnalysisStores(fake.client, fakeAttachments().reader).sink, fake };
}

describe("sink.save · 순서", () => {
  it("score_factors → requirement_assessments 삭제·넣기 → qualification_checks 삭제·넣기 → score_runs 마감 순서로 쓴다", async () => {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    expect(fake.sequence()).toEqual([
      "POST score_factors",
      "DELETE requirement_assessments",
      "POST requirement_assessments",
      "DELETE qualification_checks",
      "POST qualification_checks",
      "PATCH score_runs",
    ]);
  });

  it("FX-01 레코드에는 항목 판정·자격 판정이 있다(전제)", () => {
    expect(RECORD.result.requirementAssessments.length).toBeGreaterThan(0);
    expect(RECORD.result.qualificationChecks.length).toBeGreaterThan(0);
  });
});

describe("sink.save · 각 쓰기", () => {
  async function saved() {
    const { sink, fake } = sinkStores();
    await sink.save(RECORD);
    return fake;
  }

  it("score_factors 는 (score_run_id, factor) 충돌 시 병합하는 upsert 다", async () => {
    const call = only((await saved()).callsTo("score_factors", "POST"));
    expect(conflictColumns(call)).toEqual(["factor", "score_run_id"]);
    expect(call.prefer).toContain("resolution=merge-duplicates");
  });

  it("score_factors 행은 toScoreFactorRows(record) 다", async () => {
    const call = only((await saved()).callsTo("score_factors", "POST"));
    expect(bodyRows(call)).toEqual(toScoreFactorRows(RECORD));
  });

  // 재시도가 다른 추출로 항목을 줄이면 upsert 는 옛 항목 행을 남긴다. 그래서 그 run 의 행을 지우고 넣는다.
  it("requirement_assessments 삭제는 score_run_id·org_id 조건이다", async () => {
    const call = only((await saved()).callsTo("requirement_assessments", "DELETE"));
    expect(eqValue(call, "score_run_id")).toBe(RECORD.scoreRunId);
    expect(eqValue(call, "org_id")).toBe(RECORD.orgId);
  });

  it("requirement_assessments 넣기는 병합 upsert 가 아니다(지운 뒤 넣는다)", async () => {
    const call = only((await saved()).callsTo("requirement_assessments", "POST"));
    expect(call.prefer ?? "").not.toContain("resolution=merge-duplicates");
  });

  it("requirement_assessments 행은 toRequirementAssessmentRows(record) 다", async () => {
    const call = only((await saved()).callsTo("requirement_assessments", "POST"));
    expect(bodyRows(call)).toEqual(toRequirementAssessmentRows(RECORD));
  });

  it("qualification_checks 삭제는 score_run_id·org_id 조건이다", async () => {
    const call = only((await saved()).callsTo("qualification_checks", "DELETE"));
    expect(eqValue(call, "score_run_id")).toBe(RECORD.scoreRunId);
    expect(eqValue(call, "org_id")).toBe(RECORD.orgId);
  });

  it("qualification_checks 넣기 행은 toQualificationCheckRows(record) 다", async () => {
    const call = only((await saved()).callsTo("qualification_checks", "POST"));
    expect(bodyRows(call)).toEqual(toQualificationCheckRows(RECORD));
  });

  it("score_runs 마감은 id·org_id·status in (QUEUED, RUNNING) 조건이다", async () => {
    const call = only((await saved()).callsTo("score_runs", "PATCH"));
    expect(eqValue(call, "id")).toBe(RECORD.scoreRunId);
    expect(eqValue(call, "org_id")).toBe(RECORD.orgId);
    expect(inValues(call, "status")).toEqual(["QUEUED", "RUNNING"]);
  });

  it("score_runs 마감 본문은 toScoreRunResultUpdate(record) 이고 바뀐 행 id 를 돌려받는다", async () => {
    const call = only((await saved()).callsTo("score_runs", "PATCH"));
    expect(call.body).toEqual(toScoreRunResultUpdate(RECORD));
    expect(call.prefer).toContain("return=representation");
  });

  it("넣는 자식 행은 모두 record.orgId 를 갖는다", async () => {
    const posts = (await saved()).calls.filter((call) => call.method === "POST");
    const rows = posts.flatMap(bodyRows);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.org_id).toBe(RECORD.orgId);
  });

  it("갱신·삭제 요청은 모두 org_id 조건이 있다", async () => {
    const filtered = (await saved()).calls.filter(
      (call) => call.method === "PATCH" || call.method === "DELETE",
    );
    expect(filtered).toHaveLength(3);
    for (const call of filtered) expect(eqValue(call, "org_id")).toBe(RECORD.orgId);
  });
});

describe("sink.save · 빈 행", () => {
  it("항목 판정이 없으면 requirement_assessments 는 지우기만 하고 넣지 않는다", async () => {
    const record = withPatch(RECORD, (draft) => {
      draft.result.requirementAssessments = [];
    });
    const { sink, fake } = sinkStores();
    await sink.save(record);
    expect(fake.callsTo("requirement_assessments").map((call) => call.method)).toEqual(["DELETE"]);
  });

  it("자격 판정이 없으면 qualification_checks 는 지우기만 하고 넣지 않는다", async () => {
    const record = withPatch(RECORD, (draft) => {
      draft.result.qualificationChecks = [];
    });
    const { sink, fake } = sinkStores();
    await sink.save(record);
    expect(fake.sequence()).toEqual([
      "POST score_factors",
      "DELETE requirement_assessments",
      "POST requirement_assessments",
      "DELETE qualification_checks",
      "PATCH score_runs",
    ]);
  });
});

describe("sink.save · 중간 실패는 score_runs 를 마감하지 않는다", () => {
  it.each<[string, string, string[]]>([
    ["score_factors 넣기", "POST score_factors", ["POST score_factors"]],
    [
      "requirement_assessments 삭제",
      "DELETE requirement_assessments",
      ["POST score_factors", "DELETE requirement_assessments"],
    ],
    [
      "requirement_assessments 넣기",
      "POST requirement_assessments",
      ["POST score_factors", "DELETE requirement_assessments", "POST requirement_assessments"],
    ],
    [
      "qualification_checks 삭제",
      "DELETE qualification_checks",
      [
        "POST score_factors",
        "DELETE requirement_assessments",
        "POST requirement_assessments",
        "DELETE qualification_checks",
      ],
    ],
    [
      "qualification_checks 넣기",
      "POST qualification_checks",
      [
        "POST score_factors",
        "DELETE requirement_assessments",
        "POST requirement_assessments",
        "DELETE qualification_checks",
        "POST qualification_checks",
      ],
    ],
  ])("%s 가 실패하면 그 뒤 쓰기를 하지 않는다", async (_label, failing, expected) => {
    const [method, table] = failing.split(" ");
    const { sink, fake } = sinkStores(on(method, table, postgrestError("23503")));
    await rejectionOf(sink.save(RECORD));
    expect(fake.sequence()).toEqual(expected);
  });

  it("실패는 analysis store 오류로 던지고 message 를 싣지 않는다", async () => {
    const { sink } = sinkStores(on("POST", "score_factors", postgrestError("23514")));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toMatch(/^analysis store 오류: score_factors\.\S+ 23514$/);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("score_runs 마감이 0행이면 'analysis store 오류: score_runs.finish NOT_RUNNING' 을 던진다", async () => {
    const { sink } = sinkStores(on("PATCH", "score_runs", { status: 200, body: [] }));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toBe("analysis store 오류: score_runs.finish NOT_RUNNING");
  });

  it("score_runs 마감 오류면 analysis store 오류로 던진다", async () => {
    const { sink } = sinkStores(on("PATCH", "score_runs", postgrestError("23514")));
    const error = await rejectionOf(sink.save(RECORD));
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ 23514$/);
  });
});

// ── staleRuns(멈춘 run 찾기, C5-B) ──
// 복구는 운영 작업이라 조직 조건 없이 모든 조직의 QUEUED·RUNNING run 을 본다(service role). 처리할 때는 행의 org_id 를 쓴다.

describe("staleRuns.findStaleRuns · 질의", () => {
  const INPUT = {
    queuedBefore: "2026-10-16T08:50:00.000Z",
    runningBefore: "2026-10-16T08:40:00.000Z",
    limit: 7,
  };

  async function find(input = INPUT) {
    const fake = fakeSupabase();
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    await stores.staleRuns.findStaleRuns(input);
    return fake;
  }

  it("score_runs 를 GET 한 번으로 읽는다", async () => {
    const fake = await find();
    expect(fake.sequence()).toEqual(["GET score_runs"]);
  });

  it("id·org_id·idempotency_key·status 열만 고른다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(selectedColumns(call)).toEqual(["id", "org_id", "idempotency_key", "status"].toSorted());
  });

  it("status in (QUEUED, RUNNING) 조건을 건다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(inValues(call, "status")).toEqual(["QUEUED", "RUNNING"]);
  });

  it("or 조건은 QUEUED 는 queued_at, RUNNING 은 started_at 을 각 기준 시각과 lt 로 비교한다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.get("or")).toBe(
      "(and(status.eq.QUEUED,queued_at.lt.2026-10-16T08:50:00.000Z),and(status.eq.RUNNING,started_at.lt.2026-10-16T08:40:00.000Z))",
    );
  });

  it("or 조건에 받은 기준 시각을 그대로 넣는다", async () => {
    const call = only(
      (
        await find({
          queuedBefore: "2026-01-02T03:04:05.678Z",
          runningBefore: "2025-12-31T23:59:59.999Z",
          limit: 1,
        })
      ).callsTo("score_runs", "GET"),
    );
    expect(call.params.get("or")).toBe(
      "(and(status.eq.QUEUED,queued_at.lt.2026-01-02T03:04:05.678Z),and(status.eq.RUNNING,started_at.lt.2025-12-31T23:59:59.999Z))",
    );
  });

  it("queued_at 오름차순(오래된 순)으로 정렬한다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.get("order")).toBe("queued_at.asc");
  });

  it("limit 건까지만 읽는다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.get("limit")).toBe("7");
  });

  it("org_id 조건을 걸지 않는다(모든 조직의 멈춘 run 을 본다)", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.has("org_id")).toBe(false);
  });

  it("id 조건을 걸지 않는다", async () => {
    const call = only((await find()).callsTo("score_runs", "GET"));
    expect(call.params.has("id")).toBe(false);
  });
});

describe("staleRuns.findStaleRuns · 결과", () => {
  const INPUT = {
    queuedBefore: "2026-10-16T08:50:00.000Z",
    runningBefore: "2026-10-16T08:40:00.000Z",
    limit: 50,
  };
  const OTHER_RUN_ID = "5e4d3c2b-1a09-4f8e-b7d6-c5b4a3928170";

  async function findWith(reply: ReturnType<PostgrestRoute>) {
    const fake = fakeSupabase(on("GET", "score_runs", reply));
    const stores = createAnalysisStores(fake.client, fakeAttachments().reader);
    return stores.staleRuns.findStaleRuns(INPUT);
  }

  it("행을 { orgId, scoreRunId, idempotencyKey, status } 로 바꿔 받은 순서대로 돌려준다", async () => {
    const runs = await findWith({
      status: 200,
      body: [
        {
          id: RUN_ID,
          org_id: ORG_ID,
          idempotency_key: `${ORG_ID}:req-1`,
          status: "QUEUED",
        },
        { id: OTHER_RUN_ID, org_id: OTHER_ORG_ID, idempotency_key: null, status: "RUNNING" },
      ],
    });
    expect(runs).toEqual([
      { orgId: ORG_ID, scoreRunId: RUN_ID, idempotencyKey: `${ORG_ID}:req-1`, status: "QUEUED" },
      { orgId: OTHER_ORG_ID, scoreRunId: OTHER_RUN_ID, idempotencyKey: null, status: "RUNNING" },
    ]);
  });

  it("행이 없으면 빈 목록을 돌려준다", async () => {
    await expect(findWith({ status: 200, body: [] })).resolves.toEqual([]);
  });
});

describe("staleRuns.findStaleRuns · 질의 오류", () => {
  const INPUT = {
    queuedBefore: "2026-10-16T08:50:00.000Z",
    runningBefore: "2026-10-16T08:40:00.000Z",
    limit: 50,
  };

  function findWith(reply: ReturnType<PostgrestRoute>) {
    const fake = fakeSupabase(on("GET", "score_runs", reply));
    return createAnalysisStores(fake.client, fakeAttachments().reader).staleRuns.findStaleRuns(
      INPUT,
    );
  }

  it("질의 오류는 'analysis store 오류: score_runs.<동작> <code>' 로 던진다", async () => {
    const error = await rejectionOf(findWith(postgrestError("42501")));
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ 42501$/);
  });

  it("오류 message 에 PostgREST 의 message·details·hint 를 싣지 않는다", async () => {
    const error = await rejectionOf(findWith(postgrestError("42501")));
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("PostgREST 오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const error = await rejectionOf(findWith(postgrestError(null)));
    expect(error.message).toMatch(/^analysis store 오류: score_runs\.\S+ UNKNOWN$/);
  });
});

// ── 배럴 ──

describe("@/server/analysis 배럴 · 저장 port", () => {
  it.each(["createAnalysisStores", "EMPTY_ATTACHMENT_READER"])("값 %s 를 내보낸다", (name) => {
    expect(Object.keys(analysisBarrel)).toContain(name);
  });

  it.each([
    "toLoadedContext",
    "toExtractSource",
    "toExtractionRow",
    "toRunningUpdate",
    "toFailedUpdate",
    "toScoreRunResultUpdate",
    "toScoreFactorRows",
    "toQualificationCheckRows",
    "toRequirementAssessmentRows",
  ])("행 매핑 함수 %s 는 내보내지 않는다", (name) => {
    expect(Object.keys(analysisBarrel)).not.toContain(name);
  });

  it("배럴의 createAnalysisStores 는 analysis.repo 의 것이다", () => {
    expect(analysisBarrel.createAnalysisStores).toBe(createAnalysisStores);
  });

  // 등록 단계에서 멈춘 run 찾기(staleRuns)가 더해져 다섯 port 다.
  it("AnalysisStores 는 loader·tracker·extraction·sink·staleRuns 다섯 port 다", () => {
    expectTypeOf<AnalysisStores>().toEqualTypeOf<{
      loader: analysisBarrel.AnalysisContextLoader;
      tracker: analysisBarrel.AnalysisRunTracker;
      extraction: analysisBarrel.ExtractionStore;
      sink: analysisBarrel.AnalysisRunSink;
      staleRuns: analysisBarrel.StaleRunFinder;
    }>();
  });
});

describe("@/server/analysis 배럴 · 멈춘 run 찾기 port", () => {
  it("AnalysisStores.staleRuns 는 StaleRunFinder 다", () => {
    expectTypeOf<AnalysisStores["staleRuns"]>().toEqualTypeOf<analysisBarrel.StaleRunFinder>();
  });
});

// ── createPreanalyzeStore(사전 분석 `pnpm demo:preanalyze`, C5-B) ──
// worker 컨테이너에서 service role 클라이언트로 돈다. RLS 를 거치지 않으므로 조직 표(company_profiles·score_runs)의
// 모든 질의·쓰기에 org_id 를 직접 건다. score_runs 는 idempotency_key 충돌 시 아무것도 하지 않는(on conflict do nothing)
// insert 로 만들고 그 키로 다시 읽는다. 공고 행은 seed 의 행 계획 함수가 만든 것이다.

const PRE_RUN_ID = "4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d";
const PRE_OTHER_RUN_ID = "6c5d4e3f-2a1b-4c0d-8e9f-7a6b5c4d3e2f";
const FX01_TARGET = seedTargets().filter((target) => target.fixtureId === "FX-01")[0];
const FX01_EXTRACTION_ID = seedBid("FX-01").extraction.id;
const PRE_KEY = `${ORG_ID}:demo-pre-FX-01-r01`;

type EnsureInput = Parameters<PreanalyzeStore["ensureQueuedRun"]>[0];

/** ensureQueuedRun 입력(사전 분석 CLI 가 넘기는 값). */
const ENSURE_INPUT: EnsureInput = {
  orgId: ORG_ID,
  bidId: FX01_TARGET.bidId,
  revisionId: FX01_TARGET.revisionId,
  companyProfileId: SEED_PROFILE.id,
  profileRevision: SEED_PROFILE.revision,
  extractionId: FX01_EXTRACTION_ID,
  idempotencyKey: PRE_KEY,
};

/** 한 행 요청(object+json)이면 객체, 아니면 배열로 답한다. */
function rowsReply(call: PostgrestCall, rows: unknown[]): ReturnType<PostgrestRoute> {
  if (!call.accept.includes("vnd.pgrst.object+json")) return { status: 200, body: rows };
  return rows.length === 1 ? { status: 200, body: rows[0] } : postgrestError("PGRST116", 406);
}

/** 그 표 GET 에 rows 로 답한다. */
function getRows(table: string, rows: unknown[]): PostgrestRoute {
  return (call) =>
    call.method === "GET" && call.table === table ? rowsReply(call, rows) : undefined;
}

function preStore(route?: PostgrestRoute) {
  const fake = fakeSupabase(route);
  return { store: createPreanalyzeStore(fake.client), fake };
}

/** 이미 있는 run 을 다시 읽은 것처럼 score_runs GET 에 { id, status } 로 답한다. */
const existingRun = (status: string) => getRows("score_runs", [{ id: PRE_RUN_ID, status }]);

describe("createPreanalyzeStore · findDemoOrg", () => {
  it("organizations 를 slug=org-01·is_demo=true 로 id 만 골라 읽는다", async () => {
    const { store, fake } = preStore(getRows("organizations", [{ id: ORG_ID }]));
    await store.findDemoOrg();
    const call = only(fake.callsTo("organizations", "GET"));
    // 19 §1: 데모 조직은 솔리데오(org-01)다.
    expect(eqValue(call, "slug")).toBe("org-01");
    expect(eqValue(call, "is_demo")).toBe("true");
    expect(selectedColumns(call)).toEqual(["id"]);
  });

  it("찾으면 그 조직 id 를 돌려준다", async () => {
    const { store } = preStore(getRows("organizations", [{ id: ORG_ID }]));
    await expect(store.findDemoOrg()).resolves.toBe(ORG_ID);
  });

  it("없으면 null 을 돌려준다", async () => {
    const { store } = preStore(getRows("organizations", []));
    await expect(store.findDemoOrg()).resolves.toBeNull();
  });

  it("organizations 만 한 번 읽는다", async () => {
    const { store, fake } = preStore(getRows("organizations", [{ id: ORG_ID }]));
    await store.findDemoOrg();
    expect(fake.sequence()).toEqual(["GET organizations"]);
  });
});

describe("createPreanalyzeStore · latestProfile", () => {
  const PROFILE_ROW = { id: SEED_PROFILE.id, revision: SEED_PROFILE.revision };

  it("company_profiles 를 org_id 로 revision 내림차순 1행, id·revision 만 읽는다", async () => {
    const { store, fake } = preStore(getRows("company_profiles", [PROFILE_ROW]));
    await store.latestProfile(ORG_ID);
    const call = only(fake.callsTo("company_profiles", "GET"));
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(call.params.get("order")).toBe("revision.desc");
    expect(call.params.get("limit")).toBe("1");
    expect(selectedColumns(call)).toEqual(["id", "revision"]);
  });

  it("받은 orgId 를 그대로 org_id 조건에 쓴다", async () => {
    const { store, fake } = preStore(getRows("company_profiles", []));
    await store.latestProfile(OTHER_ORG_ID);
    expect(eqValue(only(fake.callsTo("company_profiles", "GET")), "org_id")).toBe(OTHER_ORG_ID);
  });

  it("최신 프로필의 { id, revision } 을 돌려준다", async () => {
    const { store } = preStore(getRows("company_profiles", [PROFILE_ROW]));
    await expect(store.latestProfile(ORG_ID)).resolves.toEqual({
      id: SEED_PROFILE.id,
      revision: SEED_PROFILE.revision,
    });
  });

  it("프로필이 없으면 null 을 돌려준다", async () => {
    const { store } = preStore(getRows("company_profiles", []));
    await expect(store.latestProfile(ORG_ID)).resolves.toBeNull();
  });
});

describe("createPreanalyzeStore · listDemoBids", () => {
  /** seed 공고 19건 + FX-06 r2(latest 2) + 대상 아닌 공고(g2b·데모 아님). */
  const tables = (): BidTables => withForeignBids(withRevision2(seedBidTables(), "FX-06"));

  async function list(source: BidTables = tables()) {
    const fake = fakeSupabase(bidTablesRoute(source));
    const rows = await createPreanalyzeStore(fake.client).listDemoBids();
    return { rows, fake, source };
  }

  const byRevisionId = (a: DemoBidRow, b: DemoBidRow) =>
    a.revisionId < b.revisionId ? -1 : a.revisionId > b.revisionId ? 1 : 0;

  /** 데모 fixture 공고(seed 19건)의 revision 행 전부를 DemoBidRow 로. */
  const demoRows = (source: BidTables) =>
    toDemoBidRows(source).filter(
      (row) => row.bidId !== G2B_BID_ID && row.bidId !== NON_DEMO_BID_ID,
    );

  it("읽기만 한다(GET 외 요청이 없다)", async () => {
    const { fake } = await list();
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("bid_notices·bid_revisions 만 읽는다", async () => {
    const { fake } = await list();
    for (const call of fake.calls) expect(["bid_notices", "bid_revisions"]).toContain(call.table);
  });

  it("최신 revision 행(revision = latestRevision)을 데모 fixture 공고마다 하나씩 돌려준다", async () => {
    const { rows, source } = await list();
    const latest = rows.filter((row) => row.revision === row.latestRevision).toSorted(byRevisionId);
    const expected = demoRows(source)
      .filter((row) => row.revision === row.latestRevision)
      .toSorted(byRevisionId);
    expect(expected).toHaveLength(19);
    expect(latest).toEqual(expected);
  });

  it("행은 { bidId, revisionId, revision, rawPayload, latestRevision } 이고 값은 두 표의 값 그대로다", async () => {
    const { rows, source } = await list();
    const all = demoRows(source);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(all.find((candidate) => candidate.revisionId === row.revisionId)).toEqual(row);
    }
  });

  it("raw_payload 를 바꾸지 않고 그대로 싣는다(fixtureId 를 꺼낼 수 있다)", async () => {
    const { rows } = await list();
    const fx01 = rows.find((row) => row.revisionId === FX01_TARGET.revisionId);
    expect(fx01?.rawPayload).toMatchObject({ fixtureId: "FX-01" });
  });

  it("FX-06 은 latestRevision 2 로 읽고 r2 행이 있다", async () => {
    const { rows } = await list();
    const fx06 = rows.filter((row) => row.bidId === seedBid("FX-06").notice.id);
    expect(fx06.every((row) => row.latestRevision === 2)).toBe(true);
    expect(fx06.map((row) => row.revision)).toContain(2);
  });

  it("g2b 공고(source=g2b)는 is_demo=true 여도 돌려주지 않는다", async () => {
    const { rows } = await list();
    expect(rows.map((row) => row.bidId)).not.toContain(G2B_BID_ID);
  });

  it("데모가 아닌 공고(is_demo=false)는 source=fixture 여도 돌려주지 않는다", async () => {
    const { rows } = await list();
    expect(rows.map((row) => row.bidId)).not.toContain(NON_DEMO_BID_ID);
  });

  it("같은 revision 을 두 번 돌려주지 않는다", async () => {
    const { rows } = await list();
    const ids = rows.map((row) => row.revisionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("공고가 없으면 빈 목록이다", async () => {
    const { rows } = await list({ notices: [], revisions: [] });
    expect(rows).toEqual([]);
  });
});

describe("createPreanalyzeStore · latestExtractionId", () => {
  it("requirement_extractions 를 revision_id·성공 상태로 created_at 내림차순 1행, id 만 읽는다", async () => {
    const { store, fake } = preStore(
      getRows("requirement_extractions", [{ id: FX01_EXTRACTION_ID }]),
    );
    await store.latestExtractionId(FX01_TARGET.revisionId);
    const call = only(fake.callsTo("requirement_extractions", "GET"));
    expect(eqValue(call, "revision_id")).toBe(FX01_TARGET.revisionId);
    expect(inValues(call, "status")).toEqual(["COMPLETED", "PENDING_REVIEW"]);
    expect(call.params.get("order")).toBe("created_at.desc");
    expect(call.params.get("limit")).toBe("1");
    expect(selectedColumns(call)).toEqual(["id"]);
  });

  it("찾으면 그 추출 id 를 돌려준다", async () => {
    const { store } = preStore(getRows("requirement_extractions", [{ id: FX01_EXTRACTION_ID }]));
    await expect(store.latestExtractionId(FX01_TARGET.revisionId)).resolves.toBe(
      FX01_EXTRACTION_ID,
    );
  });

  it("성공 추출이 없으면 null 을 돌려준다", async () => {
    const { store } = preStore(getRows("requirement_extractions", []));
    await expect(store.latestExtractionId(FX01_TARGET.revisionId)).resolves.toBeNull();
  });
});

describe("createPreanalyzeStore · ensureQueuedRun", () => {
  async function ensure(status = "QUEUED", input: EnsureInput = ENSURE_INPUT) {
    const { store, fake } = preStore(existingRun(status));
    const result = await store.ensureQueuedRun(input);
    return { result, fake };
  }

  it("score_runs 에 넣고 같은 키로 다시 읽는다(POST → GET)", async () => {
    const { fake } = await ensure();
    expect(fake.sequence()).toEqual(["POST score_runs", "GET score_runs"]);
  });

  it("넣기는 idempotency_key 충돌 시 아무것도 하지 않는다(Prefer resolution=ignore-duplicates)", async () => {
    const { fake } = await ensure();
    const call = only(fake.callsTo("score_runs", "POST"));
    expect(conflictColumns(call)).toEqual(["idempotency_key"]);
    expect(call.prefer).toContain("resolution=ignore-duplicates");
  });

  it("넣기는 병합 upsert 가 아니다(이미 있는 run 의 결과를 덮어쓰지 않는다)", async () => {
    const { fake } = await ensure();
    expect(only(fake.callsTo("score_runs", "POST")).prefer).not.toContain(
      "resolution=merge-duplicates",
    );
  });

  it("넣는 행은 조직·공고·revision·프로필·추출·ALGORITHM_VERSION·MOCK·MOCK·멱등 키 한 행이다", async () => {
    const { fake } = await ensure();
    expect(bodyRows(only(fake.callsTo("score_runs", "POST")))).toEqual([
      {
        org_id: ORG_ID,
        bid_id: FX01_TARGET.bidId,
        revision_id: FX01_TARGET.revisionId,
        company_profile_id: SEED_PROFILE.id,
        profile_revision: SEED_PROFILE.revision,
        extraction_id: FX01_EXTRACTION_ID,
        algorithm_version: ALGORITHM_VERSION,
        run_mode: "MOCK",
        ai_provider: "MOCK",
        idempotency_key: PRE_KEY,
      },
    ]);
  });

  it("추출이 없으면 extraction_id 는 null 이다", async () => {
    const { fake } = await ensure("QUEUED", { ...ENSURE_INPUT, extractionId: null });
    const [row] = bodyRows(only(fake.callsTo("score_runs", "POST")));
    expect(row).toHaveProperty("extraction_id", null);
  });

  it("다시 읽기는 idempotency_key·org_id 조건이고 id·status 만 고른다", async () => {
    const { fake } = await ensure();
    const call = only(fake.callsTo("score_runs", "GET"));
    expect(eqValue(call, "idempotency_key")).toBe(PRE_KEY);
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(["id", "status"]);
  });

  it("새로 만든 run 이면 { id, status: QUEUED } 를 돌려준다", async () => {
    const { result } = await ensure("QUEUED");
    expect(result).toEqual({ id: PRE_RUN_ID, status: "QUEUED" });
  });

  it("이미 끝난 run 이면 다시 읽은 상태(COMPLETED)를 그대로 돌려준다", async () => {
    const { result } = await ensure("COMPLETED");
    expect(result).toEqual({ id: PRE_RUN_ID, status: "COMPLETED" });
  });
});

describe("createPreanalyzeStore · readStatuses", () => {
  const ROWS = [
    { id: PRE_RUN_ID, status: "COMPLETED" },
    { id: PRE_OTHER_RUN_ID, status: "RUNNING" },
  ];

  it("score_runs 를 id in (…)·org_id 로 id·status 만 읽는다", async () => {
    const { store, fake } = preStore(getRows("score_runs", ROWS));
    await store.readStatuses(ORG_ID, [PRE_RUN_ID, PRE_OTHER_RUN_ID]);
    const call = only(fake.callsTo("score_runs", "GET"));
    expect(inValues(call, "id")).toEqual([PRE_RUN_ID, PRE_OTHER_RUN_ID].toSorted());
    expect(eqValue(call, "org_id")).toBe(ORG_ID);
    expect(selectedColumns(call)).toEqual(["id", "status"]);
  });

  it("행을 { id, status } 로 돌려준다", async () => {
    const { store } = preStore(getRows("score_runs", ROWS));
    const statuses = await store.readStatuses(ORG_ID, [PRE_RUN_ID, PRE_OTHER_RUN_ID]);
    expect(statuses.toSorted((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
      ROWS.toSorted((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });

  it("읽기만 한다", async () => {
    const { store, fake } = preStore(getRows("score_runs", ROWS));
    await store.readStatuses(ORG_ID, [PRE_RUN_ID]);
    expect(fake.sequence()).toEqual(["GET score_runs"]);
  });
});

describe("createPreanalyzeStore · 조직 조건과 쓰기", () => {
  /** 여섯 동작을 한 번씩 부르고 나간 요청을 모은다. */
  async function everyCall() {
    const fake = fakeSupabase(
      routes(
        getRows("organizations", [{ id: ORG_ID }]),
        getRows("company_profiles", [{ id: SEED_PROFILE.id, revision: SEED_PROFILE.revision }]),
        getRows("requirement_extractions", [{ id: FX01_EXTRACTION_ID }]),
        getRows("score_runs", [{ id: PRE_RUN_ID, status: "QUEUED" }]),
        bidTablesRoute(seedBidTables()),
      ),
    );
    const store = createPreanalyzeStore(fake.client);
    await store.findDemoOrg();
    await store.latestProfile(ORG_ID);
    await store.listDemoBids();
    await store.latestExtractionId(FX01_TARGET.revisionId);
    await store.ensureQueuedRun(ENSURE_INPUT);
    await store.readStatuses(ORG_ID, [PRE_RUN_ID]);
    return fake;
  }

  // service role 은 RLS 를 거치지 않는다. 조직 표 요청은 모두 org_id 로 거른다.
  it("조직 표(company_profiles·score_runs) 읽기는 모두 org_id 조건이 있다", async () => {
    const fake = await everyCall();
    const reads = fake.calls.filter(
      (call) => call.method === "GET" && ["company_profiles", "score_runs"].includes(call.table),
    );
    expect(reads.length).toBe(3);
    for (const call of reads) expect(eqValue(call, "org_id")).toBe(ORG_ID);
  });

  it("score_runs 에 넣는 행은 모두 받은 orgId 를 갖는다", async () => {
    const fake = await everyCall();
    const rows = fake.callsTo("score_runs", "POST").flatMap(bodyRows);
    expect(rows.length).toBe(1);
    for (const row of rows) expect(row.org_id).toBe(ORG_ID);
  });

  it("쓰기는 ensureQueuedRun 의 score_runs 넣기 하나뿐이다(갱신·삭제가 없다)", async () => {
    const fake = await everyCall();
    expect(
      fake.calls
        .filter((call) => call.method !== "GET")
        .map((call) => `${call.method} ${call.table}`),
    ).toEqual(["POST score_runs"]);
  });
});

describe("createPreanalyzeStore · 질의 오류", () => {
  type Action = (store: PreanalyzeStore) => Promise<unknown>;
  const ACTIONS: [string, string, string, Action][] = [
    ["findDemoOrg", "GET", "organizations", (store) => store.findDemoOrg()],
    ["latestProfile", "GET", "company_profiles", (store) => store.latestProfile(ORG_ID)],
    [
      "latestExtractionId",
      "GET",
      "requirement_extractions",
      (store) => store.latestExtractionId(FX01_TARGET.revisionId),
    ],
    ["ensureQueuedRun 넣기", "POST", "score_runs", (store) => store.ensureQueuedRun(ENSURE_INPUT)],
    [
      "ensureQueuedRun 다시 읽기",
      "GET",
      "score_runs",
      (store) => store.ensureQueuedRun(ENSURE_INPUT),
    ],
    ["readStatuses", "GET", "score_runs", (store) => store.readStatuses(ORG_ID, [PRE_RUN_ID])],
  ];

  it.each(ACTIONS)(
    "%s 오류(%s %s)는 'analysis store 오류: <표>.<동작> <code>' 로 던진다",
    async (_label, method, table, action) => {
      const { store } = preStore(on(method, table, postgrestError("42501")));
      const error = await rejectionOf(action(store));
      expect(error.message).toMatch(new RegExp(`^analysis store 오류: ${table}\\.\\S+ 42501$`));
    },
  );

  it.each(ACTIONS)(
    "%s 오류 message 에 PostgREST 의 message·details·hint 를 싣지 않는다",
    async (_label, method, table, action) => {
      const { store } = preStore(on(method, table, postgrestError("42501")));
      const error = await rejectionOf(action(store));
      expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
    },
  );

  it("listDemoBids 질의 오류는 'analysis store 오류: <공고 표>.<동작> <code>' 로 던지고 message 를 싣지 않는다", async () => {
    const fake = fakeSupabase((call) =>
      call.method === "GET" ? postgrestError("42501") : undefined,
    );
    const error = await rejectionOf(createPreanalyzeStore(fake.client).listDemoBids());
    expect(error.message).toMatch(/^analysis store 오류: bid_(notices|revisions)\.\S+ 42501$/);
    expect(error.message).not.toContain(LEAKY_ERROR_TEXT);
  });

  it("PostgREST 오류에 code 가 없으면 UNKNOWN 이다", async () => {
    const { store } = preStore(on("GET", "company_profiles", postgrestError(null)));
    const error = await rejectionOf(store.latestProfile(ORG_ID));
    expect(error.message).toMatch(/^analysis store 오류: company_profiles\.\S+ UNKNOWN$/);
  });
});

describe("@/server/analysis 배럴 · 사전 분석 저장 port", () => {
  it("값 createPreanalyzeStore 를 내보낸다", () => {
    expect(Object.keys(analysisBarrel)).toContain("createPreanalyzeStore");
  });

  it("배럴의 createPreanalyzeStore 는 analysis.repo 의 것이다", () => {
    expect(typeof createPreanalyzeStore).toBe("function");
    expect(Reflect.get(analysisBarrel, "createPreanalyzeStore")).toBe(createPreanalyzeStore);
  });
});
