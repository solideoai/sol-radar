// 시험 전용 도우미(라운드 B 저장 port). 제품 코드가 import 하지 않는다.
// 1. 데모 seed 의 행 계획 함수(scripts/demo/plan.mjs·bid-notices.mjs·people/seed.mjs)로 org-01 의 실제 seed 행을 만든다.
//    seed 와 같은 함수를 부르므로 DB 경로(loader 가 읽을 행)가 seed 와 어긋나면 시험이 빨개진다. 숫자를 시험에 박지 않는다.
// 2. 실제 supabase-js 클라이언트에 가짜 fetch 를 넣어 PostgREST 요청(표·방법·필터·Prefer·본문)을 기록하고 정해 둔 답을 준다.
//    타입이 붙은 진짜 클라이언트라 단언(as) 없이 repo 에 넘긴다. 실제 네트워크는 부르지 않는다.
// 3. PGlite(scripts/supabase-pglite.mjs)에 실제 마이그레이션을 올리고 행을 SQL 로 넣는 작은 도우미.
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  loadCompanyProfileFixture,
  loadDemoBidFixtures,
  loadExtractionFixtures,
} from "@test-harness/demo-bid-notices.mjs";
import {
  extractionFileFor,
  planCompanyProfiles,
  planSeedBatch,
  toAssignmentRows,
  toBidRows,
  toExtractionRow as toSeedExtractionRow,
} from "@test-harness/demo-plan.mjs";
import { loadPeopleFixtures, orgUuid, seedSolideoPeople } from "@test-harness/people-seed.mjs";
import {
  applyMigrations,
  createSupabaseDb,
  loadMigrations,
} from "@test-harness/supabase-pglite.mjs";
import type { Database, Json } from "@/lib/database.types";
import type { LoadedAnalysisContext } from "./analysis-job.model";
import type { AnalysisContext } from "./analysis.model";
import type { LoaderRows, RevisionDocumentText } from "./analysis-store.model";
import {
  CALCULATION_DATE,
  MOCK_EXPLAIN_TEXT,
  explainBody,
  jsonReply,
  kevDisabledBody,
  type GatewayRoutes,
} from "./test-support";

type Tables = Database["public"]["Tables"];
type Insert<T extends keyof Tables> = Tables[T]["Insert"];

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

// ── 1. seed 행 ──

/** seed 시각. fixtures/manifest.yaml calculationDate 의 KST 18:00 이다(골든 계산일과 같은 날). */
export const SEED_ANCHOR = new Date(`${CALCULATION_DATE}T18:00:00+09:00`);
export const ORG_ID: string = orgUuid("org-01");
export const OTHER_ORG_ID: string = orgUuid("org-02");

export const GOLDEN_IDS = ["FX-01", "FX-02", "FX-03"] as const;
export type GoldenId = (typeof GOLDEN_IDS)[number];

/** 예산 미공개 공고(budgetKrw=null). 골든 파일·Kev fixture 가 없다. C4 결과는 COMPLETED·missingFactors=[scaleFit BUDGET_UNKNOWN]. */
export const NO_BUDGET_ID = "FX-11";

/** Kev fixture 가 없는 공고의 gateway: /kev 는 Kev 를 끈 응답(KEV_ENABLED=false, errorCode 없음), /explain 은 mock 템플릿. */
export function kevOffRoutes(): GatewayRoutes {
  return {
    "/kev": jsonReply(kevDisabledBody(null)),
    "/explain": jsonReply(explainBody(MOCK_EXPLAIN_TEXT, true)),
  };
}

const [bidFixtures, extractionFixtures, companyFixture, peopleFixtures] = await Promise.all([
  loadDemoBidFixtures(REPO_ROOT),
  loadExtractionFixtures(REPO_ROOT),
  loadCompanyProfileFixture(REPO_ROOT),
  loadPeopleFixtures(),
]);

const seedPlan = planSeedBatch(bidFixtures, { anchor: SEED_ANCHOR });
const seedBidRows = toBidRows(seedPlan);

type SeededBid = { fixtureId: string; bidId: string; revisionId: string };
const seededBids: SeededBid[] = seedPlan.created.map(
  ({ fixtureId, bidId, revisionId }: SeededBid) => ({ fixtureId, bidId, revisionId }),
);

type SeedProfileRow = Insert<"company_profiles"> & { id: string; org_id: string; revision: number };
const seedProfiles: SeedProfileRow[] = planCompanyProfiles({
  profile: companyFixture,
  anchor: SEED_ANCHOR,
  // 시험 DB 에는 Auth 계정이 없다. created_by 는 null 로 둔다(seed 는 관리자 id 를 넣는다).
  createdBy: { "org-01": null, "org-02": null },
});

function seedProfile(orgId: string, revision: number): SeedProfileRow {
  const profile = seedProfiles.find((row) => row.org_id === orgId && row.revision === revision);
  if (!profile) throw new Error(`seed 회사 프로필이 없다: ${orgId} r${revision}`);
  return profile;
}

/** loader 가 읽는 회사 프로필: org-01 revision 2(08 §6.1 단일 원천). */
export const SEED_PROFILE = seedProfile(ORG_ID, 2);

type SeedAssignmentRow = Insert<"assignments">;
/** 데모 배정 2건(seed 의 assignments 표). */
export const SEED_ASSIGNMENTS: SeedAssignmentRow[] = toAssignmentRows({ bids: seededBids });

// seed 의 인력 행 함수(seedSolideoPeople)를 기록용 클라이언트로 돌려 team_member_scoring 행을 받는다.
// 기존 배정 7건이 availability 에 접힌 값(3e181b7)이 그대로 들어온다.
const teamScoringRowSchema = z.object({
  member_id: z.string(),
  org_id: z.string(),
  role: z.string(),
  grade: z.string().nullable(),
  skills: z.array(z.string()),
  availability: z.array(z.object({ startsAt: z.string(), endsAt: z.string(), fte: z.number() })),
});
export type SeedTeamScoringRow = z.infer<typeof teamScoringRowSchema>;

async function recordTeamScoringSeed(): Promise<SeedTeamScoringRow[]> {
  const upserts: { table: string; rows: unknown[] }[] = [];
  await seedSolideoPeople({
    client: {
      upsert: async (table: string, rows: unknown[]) => {
        upserts.push({ table, rows });
      },
    },
    orgId: ORG_ID,
    fixtures: peopleFixtures,
  });
  return upserts
    .filter((upsert) => upsert.table === "team_member_scoring")
    .flatMap((upsert) => upsert.rows.map((row) => teamScoringRowSchema.parse(row)));
}

/** seed 순서(명부 순서) 그대로. loader 는 member_id 순으로 읽지만 toLoadedContext 도 정렬해야 한다. */
export const SEED_TEAM_SCORING: SeedTeamScoringRow[] = await recordTeamScoringSeed();

type SeedNoticeRow = Insert<"bid_notices"> & { id: string };
type SeedRevisionRow = {
  id: string;
  bid_id: string;
  revision: number;
  amendment_no: string | null;
  raw_payload: Json;
  normalized: Json;
  checksum: string;
  changed_fields: string[];
  fetched_at: string;
};
type SeedDocumentRow = Insert<"bid_documents"> & { id: string };
type SeedExtractionRow = Insert<"requirement_extractions"> & {
  id: string;
  status: string;
  payload: Json;
  translations: Json | null;
};

export type SeedBid = {
  fixtureId: string;
  notice: SeedNoticeRow;
  revision: SeedRevisionRow;
  documents: SeedDocumentRow[];
  extraction: SeedExtractionRow;
};

/** seed 가 그 fixture 의 r1 로 넣는 공고·revision·첨부·mock 추출 행. */
export function seedBid(fixtureId: string): SeedBid {
  const created = seededBids.find((bid) => bid.fixtureId === fixtureId);
  if (!created) throw new Error(`seed 에 적재되지 않은 fixture: ${fixtureId}`);
  const notices: SeedNoticeRow[] = seedBidRows.notices;
  const revisions: SeedRevisionRow[] = seedBidRows.revisions;
  const documents: SeedDocumentRow[] = seedBidRows.documents;
  const notice = notices.find((row) => row.id === created.bidId);
  const revision = revisions.find((row) => row.id === created.revisionId);
  if (!notice || !revision) throw new Error(`seed 공고 행이 없다: ${fixtureId}`);
  const file: string | null = extractionFileFor(extractionFixtures.index, fixtureId, 1);
  if (file === null) throw new Error(`mock 추출 fixture 가 없다: ${fixtureId}`);
  const extraction: SeedExtractionRow = toSeedExtractionRow({
    fixtureId,
    bidId: created.bidId,
    revisionId: created.revisionId,
    revision: 1,
    extraction: extractionFixtures.files[file],
  });
  return {
    fixtureId,
    notice,
    revision,
    documents: documents.filter((row) => row.revision_id === created.revisionId),
    extraction,
  };
}

/** seed 첨부(다운로드 전 PENDING, 파싱 없음)를 C3 AttachmentTextReader 가 돌려줄 모양으로. */
export function seedDocumentsFor(fixtureId: string): RevisionDocumentText[] {
  return seedBid(fixtureId).documents.map((row) => ({
    documentId: row.id,
    name: row.name,
    downloadStatus: "PENDING",
    downloadErrorCode: null,
    parseStatus: null,
    parseErrorCode: null,
    text: null,
    pages: [],
  }));
}

/**
 * PostgREST 가 timestamptz 를 돌려주는 모양("2026-10-16T09:00:00+00:00", 소수 초는 있을 때만).
 * loader 가 읽는 행은 이 모양이라 toLoadedContext 가 ISO(Z) 로 바꿔야 하는 것을 시험이 본다.
 */
export function toPostgrestTimestamp(iso: string): string {
  const at = new Date(iso);
  const base = at.toISOString().slice(0, 19);
  const millis = at.getUTCMilliseconds();
  const fraction = millis === 0 ? "" : `.${String(millis).padStart(3, "0").replace(/0+$/, "")}`;
  return `${base}${fraction}+00:00`;
}

export type SeedRun = {
  scoreRunId: string;
  /** ISO8601. 행에는 PostgREST 모양으로 들어간다. */
  queuedAt: string;
  status?: string;
  idempotencyKey?: string | null;
};

/** loader 가 org-01 의 그 fixture run 에서 읽을 행 전부(seed 와 같은 값). documents 는 첨부 port 의 몫이다. */
export function loaderRowsFor(
  fixtureId: string,
  run: SeedRun,
  documents: RevisionDocumentText[] = [],
): LoaderRows {
  const bid = seedBid(fixtureId);
  const profile = SEED_PROFILE;
  return {
    scoreRun: {
      id: run.scoreRunId,
      org_id: ORG_ID,
      bid_id: bid.notice.id,
      revision_id: bid.revision.id,
      company_profile_id: profile.id,
      idempotency_key: run.idempotencyKey === undefined ? null : run.idempotencyKey,
      status: run.status ?? "QUEUED",
      queued_at: toPostgrestTimestamp(run.queuedAt),
    },
    revision: {
      id: bid.revision.id,
      bid_id: bid.revision.bid_id,
      revision: bid.revision.revision,
      raw_payload: bid.revision.raw_payload,
      normalized: bid.revision.normalized,
      fetched_at: toPostgrestTimestamp(bid.revision.fetched_at),
    },
    // seed 는 구조화 자격 행을 넣지 않는다(fixture 공고에 API 구조화 필드가 없다).
    structured: [],
    extraction: {
      id: bid.extraction.id,
      status: bid.extraction.status,
      payload: bid.extraction.payload,
      translations: bid.extraction.translations,
    },
    profile: {
      revision: profile.revision,
      name: profile.name,
      is_demo: profile.is_demo ?? true,
      technologies: profile.technologies ?? [],
      technologies_complete: profile.technologies_complete ?? false,
      licenses: profile.licenses ?? [],
      industry_codes: profile.industry_codes ?? [],
      past_projects: profile.past_projects ?? [],
      financials: profile.financials ?? null,
      preferences: profile.preferences ?? null,
    },
    teamScoring: SEED_TEAM_SCORING.map((row) => ({
      member_id: row.member_id,
      role: row.role,
      grade: row.grade,
      skills: row.skills,
      availability: row.availability,
    })),
    assignments: SEED_ASSIGNMENTS.map((row) => ({
      member_id: row.member_id,
      starts_at: toPostgrestTimestamp(row.starts_at),
      ends_at: toPostgrestTimestamp(row.ends_at),
      allocation_percent: row.allocation_percent,
    })),
    documents,
  };
}

/** worker 처리기 9단계처럼 loader 값에 요청·처리 설정을 더한다(3b mock /health 와 같은 설정: mock·Kev 켜짐·v0.1). */
export function contextFromLoaded(
  loaded: LoadedAnalysisContext,
  requestId: string,
): AnalysisContext {
  return {
    requestId,
    orgId: loaded.orgId,
    scoreRunId: loaded.scoreRunId,
    bidId: loaded.bidId,
    companyProfileId: loaded.companyProfileId,
    fixtureId: loaded.fixtureId,
    bid: loaded.bid,
    extraction: loaded.extraction,
    profile: loaded.profile,
    team: loaded.team,
    documentIssues: loaded.documentIssues,
    queuedAt: loaded.queuedAt,
    runMode: "mock",
    aiProvider: "mock",
    kev: { enabled: true, questionSetVersion: "kev-qs/v0.1" },
  };
}

// ── 2. 가짜 PostgREST(실제 supabase-js + 가짜 fetch) ──

export type PostgrestCall = {
  method: string;
  /** /rest/v1/<표> 의 표 이름 */
  table: string;
  params: URLSearchParams;
  prefer: string;
  accept: string;
  /** JSON 본문. 없으면 null. */
  body: unknown;
};
export type PostgrestReply = { status: number; body?: unknown };
/** undefined 를 돌려주면 기본 답(아래 defaultReply)을 쓴다. */
export type PostgrestRoute = (call: PostgrestCall) => PostgrestReply | undefined;

const SUPABASE_URL = "http://supabase.test";
// 시험용 가짜 값. 실제 키 모양이 아니다.
const FAKE_SERVICE_KEY = "fake-service-role-key-for-tests";

function rowsOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  return body === null || body === undefined ? [] : [body];
}

/** eq 필터 값. "eq.<값>" 이 아니면 undefined. */
export function eqValue(call: PostgrestCall, column: string): string | undefined {
  const values = call.params.getAll(column).filter((value) => value.startsWith("eq."));
  return values.length === 1 ? values[0].slice("eq.".length) : undefined;
}

/** in 필터 값(정렬). "in.(a,b)" 가 아니면 undefined. */
export function inValues(call: PostgrestCall, column: string): string[] | undefined {
  const value = call.params.getAll(column).find((entry) => entry.startsWith("in.("));
  if (value === undefined) return undefined;
  return value
    .slice("in.(".length, -1)
    .split(",")
    .map((item) => item.replace(/^"|"$/g, ""))
    .toSorted();
}

/** select 열(정렬). */
export function selectedColumns(call: PostgrestCall): string[] {
  return (call.params.get("select") ?? "").split(",").filter(Boolean).toSorted();
}

/** on_conflict 열(정렬). */
export function conflictColumns(call: PostgrestCall): string[] {
  return (call.params.get("on_conflict") ?? "").split(",").filter(Boolean).toSorted();
}

/** 본문의 행들(객체 하나면 한 행). */
export function bodyRows(call: PostgrestCall): Record<string, unknown>[] {
  return rowsOf(call.body).flatMap((row) =>
    typeof row === "object" && row !== null && !Array.isArray(row) ? [{ ...row }] : [],
  );
}

/** 라우트가 없을 때의 답. 읽기는 빈 목록, 쓰기는 성공(갱신은 걸린 id 한 행). */
function defaultReply(call: PostgrestCall): PostgrestReply {
  const representation = call.prefer.includes("return=representation");
  const single = call.accept.includes("vnd.pgrst.object+json");
  if (call.method === "GET") return { status: 200, body: [] };
  if (call.method === "POST") {
    if (!representation) return { status: 201 };
    const rows = bodyRows(call).map((row, index) => ({ id: `fake-inserted-${index}`, ...row }));
    return { status: 201, body: single ? rows[0] : rows };
  }
  if (call.method === "PATCH") {
    if (!representation) return { status: 204 };
    const rows = [{ id: eqValue(call, "id") ?? "fake-updated-0" }];
    return { status: 200, body: single ? rows[0] : rows };
  }
  return { status: 204 };
}

/** PostgREST 오류 답. message·details·hint 에는 값처럼 보이는 글자를 넣는다(오류 메시지로 새면 안 된다). */
export const LEAKY_ERROR_TEXT = "LEAK-공고원문-비밀값";
export function postgrestError(code: string | null, status = 400): PostgrestReply {
  return {
    status,
    body: {
      ...(code === null ? {} : { code }),
      message: `${LEAKY_ERROR_TEXT} message`,
      details: `${LEAKY_ERROR_TEXT} details`,
      hint: `${LEAKY_ERROR_TEXT} hint`,
    },
  };
}

export function fakeSupabase(route: PostgrestRoute = () => undefined) {
  const calls: PostgrestCall[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = new Headers(init?.headers);
    const call: PostgrestCall = {
      method: (init?.method ?? "GET").toUpperCase(),
      table: url.pathname.replace(/^\/rest\/v1\//, ""),
      params: url.searchParams,
      prefer: headers.get("prefer") ?? "",
      accept: headers.get("accept") ?? "",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const reply = route(call) ?? defaultReply(call);
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient<Database>(SUPABASE_URL, FAKE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return {
    client,
    calls,
    /** 그 표(와 방법)로 간 요청. */
    callsTo: (table: string, method?: string) =>
      calls.filter(
        (call) => call.table === table && (method === undefined || call.method === method),
      ),
    /** 요청 순서를 "방법 표" 로. */
    sequence: () => calls.map((call) => `${call.method} ${call.table}`),
  };
}

/** loader 가 읽을 행을 표마다 돌려주는 라우트(GET 만). 표 하나를 null 로 주면 0행이다. */
export function loaderRoute(rows: LoaderRows): PostgrestRoute {
  const byTable: Record<string, unknown[]> = {
    score_runs: [rows.scoreRun],
    bid_revisions: [rows.revision],
    bid_structured_requirements: rows.structured,
    requirement_extractions: rows.extraction === null ? [] : [rows.extraction],
    company_profiles: [rows.profile],
    team_member_scoring: rows.teamScoring,
    assignments: rows.assignments,
  };
  return (call) => {
    if (call.method !== "GET") return undefined;
    const tableRows = byTable[call.table];
    if (tableRows === undefined) return undefined;
    const single = call.accept.includes("vnd.pgrst.object+json");
    if (single)
      return tableRows.length === 1
        ? { status: 200, body: tableRows[0] }
        : postgrestError("PGRST116", 406);
    return { status: 200, body: tableRows };
  };
}

// ── 3. PGlite ──

export type SqlDb = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
};

/** 모든 마이그레이션을 올린 Supabase 흉내 DB. 닫는 것은 부른 쪽 몫이다. */
export async function createMigratedDb(): Promise<SqlDb> {
  const db: SqlDb = await createSupabaseDb();
  await applyMigrations(db, await loadMigrations(MIGRATIONS_DIR));
  return db;
}

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

async function columnTypes(db: SqlDb, table: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ column_name: string; data_type: string }>(
    "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1",
    [table],
  );
  if (rows.length === 0) throw new Error(`public.${table} 표가 없다`);
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}

/** PostgREST 처럼 JSON 값을 열 타입에 맞춰 넣는다. jsonb 는 JSON 문자열, 배열 열은 JS 배열, null 은 SQL NULL. */
function toParam(type: string, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  return type === "jsonb" ? JSON.stringify(value) : value;
}

type SqlRow = Record<string, unknown>;

function definedEntries(row: object): [string, unknown][] {
  return Object.entries(row).filter(([, value]) => value !== undefined);
}

/** 한 행씩 insert(…) returning *. onConflict 를 주면 그 열로 on conflict do update(upsert)다. */
export async function insertRows(
  db: SqlDb,
  table: string,
  rows: readonly object[],
  options: { onConflict?: readonly string[] } = {},
): Promise<SqlRow[]> {
  const types = await columnTypes(db, table);
  const inserted: SqlRow[] = [];
  for (const row of rows) {
    const entries = definedEntries(row);
    const columns = entries.map(([column]) => column);
    const params = entries.map(([column, value]) => toParam(types.get(column) ?? "text", value));
    const conflict = options.onConflict;
    const updates = columns.filter((column) => !conflict?.includes(column));
    const onConflict =
      conflict === undefined
        ? ""
        : ` on conflict (${conflict.map(quoteIdent).join(", ")}) do update set ${updates
            .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)
            .join(", ")}`;
    const { rows: returned } = await db.query<SqlRow>(
      `insert into public.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) values (${columns
        .map((_, index) => `$${index + 1}`)
        .join(", ")})${onConflict} returning *`,
      params,
    );
    inserted.push(...returned);
  }
  return inserted;
}

/** where 의 값이 배열이면 in(…), 아니면 = 이다. */
function whereSql(
  where: Record<string, unknown>,
  types: Map<string, string>,
  params: unknown[],
): string {
  const clauses = Object.entries(where).map(([column, value]) => {
    if (Array.isArray(value)) {
      params.push(value);
      return `${quoteIdent(column)} = any($${params.length})`;
    }
    params.push(toParam(types.get(column) ?? "text", value));
    return `${quoteIdent(column)} = $${params.length}`;
  });
  if (clauses.length === 0) throw new Error("조건 없는 갱신·삭제는 하지 않는다");
  return clauses.join(" and ");
}

/** update … where … returning *. 바뀐 행을 돌려준다. */
export async function updateRows(
  db: SqlDb,
  table: string,
  patch: object,
  where: Record<string, unknown>,
): Promise<SqlRow[]> {
  const types = await columnTypes(db, table);
  const params: unknown[] = [];
  const sets = definedEntries(patch).map(([column, value]) => {
    params.push(toParam(types.get(column) ?? "text", value));
    return `${quoteIdent(column)} = $${params.length}`;
  });
  const condition = whereSql(where, types, params);
  const { rows } = await db.query<SqlRow>(
    `update public.${quoteIdent(table)} set ${sets.join(", ")} where ${condition} returning *`,
    params,
  );
  return rows;
}

export async function deleteRows(
  db: SqlDb,
  table: string,
  where: Record<string, unknown>,
): Promise<void> {
  const types = await columnTypes(db, table);
  const params: unknown[] = [];
  await db.query(
    `delete from public.${quoteIdent(table)} where ${whereSql(where, types, params)}`,
    params,
  );
}

/** 분석 run 의 부모 행(조직 두 곳·공고·revision·회사 프로필·seed mock 추출)을 seed 와 같은 값으로 넣는다. */
export async function insertParentRows(db: SqlDb, fixtureIds: readonly string[]): Promise<void> {
  await insertRows(db, "organizations", [
    { id: ORG_ID, slug: "org-01", name: "솔리데오", personal_owner_id: null, is_demo: true },
    {
      id: OTHER_ORG_ID,
      slug: "org-02",
      name: "격리 확인 조직",
      personal_owner_id: null,
      is_demo: true,
    },
  ]);
  const bids = fixtureIds.map(seedBid);
  await insertRows(
    db,
    "bid_notices",
    bids.map((bid) => bid.notice),
  );
  await insertRows(
    db,
    "bid_revisions",
    bids.map((bid) => bid.revision),
  );
  await insertRows(db, "company_profiles", seedProfiles);
  await insertRows(
    db,
    "requirement_extractions",
    bids.map((bid) => bid.extraction),
  );
}
