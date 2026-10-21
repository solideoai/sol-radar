// SOL RADAR MVP의 조직 격리·업무 역할·worker 쓰기 경계·사람 결정과 감사를 실제 PostgreSQL로 검사한다.
// 마이그레이션은 한 번 적용하고, 각 시험은 같은 기준 스냅샷을 복제한 독립 DB에서 실행한다.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { migrations, recordHistory, users } from "./database-test-support.mjs";
import { actAs, applyMigrations, createSupabaseDb } from "./supabase-pglite.mjs";

let baseline;
before(async () => {
  const pglite = await createSupabaseDb();
  try {
    await applyMigrations(pglite, migrations);
    for (const [index, id] of users.entries())
      await pglite.query("insert into auth.users values ($1, $2)", [
        id,
        `user${index}@example.invalid`,
      ]);
    await recordHistory(pglite);
    baseline = await pglite.dumpDataDir("none");
  } finally {
    await pglite.close();
  }
});

const migratedDb = async (t) => {
  const pglite = new PGlite({ extensions: { pg_trgm }, loadDataDir: baseline });
  t.after(() => pglite.close());
  await pglite.waitReady;
  return pglite;
};

describe("Supabase Storage — immutable objects and private access", () => {
  const bid = "b1d00000-0000-0000-0000-000000000011";
  const rev = "be500000-0000-0000-0000-000000000011";
  const sha = "a".repeat(64);
  const objectPath = `raw/bids/${bid}/${rev}/${sha}.pdf`;
  const lease = "1ea5e000-0000-0000-0000-000000000001";
  const claimInput = {
    bucket: "bid-documents",
    path: objectPath,
    sha256: sha,
    sizeBytes: 9,
    mimeType: "application/pdf",
    leaseToken: lease,
  };
  async function setup(t, database) {
    const db = database ?? (await migratedDb(t));
    await db.query(
      "insert into public.bid_notices(id,source,notice_id,title,agency,stage,status,budget_krw,source_url,content_hash,is_demo) values($1,'fixture','STORAGE-1','시험','기관','NOTICE','OPEN',100,'https://fixture.invalid/1','hash',true)",
      [bid],
    );
    await db.query(
      "insert into public.bid_revisions(id,bid_id,revision,raw_payload,normalized,checksum) values($1,$2,1,'{}','{}','sum')",
      [rev, bid],
    );
    const docs = (
      await db.query(
        "insert into public.bid_documents(bid_id,revision_id,name,original_url) values($1,$2,'a.pdf','https://www.g2b.go.kr/a'),($1,$2,'b.pdf','https://www.g2b.go.kr/b') returning id",
        [bid, rev],
      )
    ).rows;
    return { db, docs };
  }
  const claim = async (db, input = claimInput) =>
    (
      await db.query("select public.claim_document_storage($1::jsonb) as value", [
        JSON.stringify(input),
      ])
    ).rows[0].value;
  const finish = (db, object, documentId, token = lease) =>
    db.query("select public.finish_document_storage($1::jsonb)", [
      JSON.stringify({
        objectId: object.id,
        documentId,
        leaseToken: token,
        kind: "raw",
        format: "PDF",
      }),
    ]);

  it("00702 preserves existing raw/parsed paths and references while new incarnations use UUID paths", async (t) => {
    const db = await createSupabaseDb();
    t.after(() => db.close());
    const upgrade = migrations.find((migration) => migration.file.startsWith("20261021000702_"));
    assert.ok(upgrade);
    await applyMigrations(
      db,
      migrations.filter((migration) => migration !== upgrade),
    );
    const { docs } = await setup(t, db);
    const raw = await claim(db);
    await finish(db, raw, docs[0].id);
    const parsedPath = `parsed/bids/${bid}/${rev}/${sha}/${"b".repeat(64)}/result.json`;
    const parsed = await claim(db, {
      ...claimInput,
      path: parsedPath,
      bucket: "bid-parsed",
      sha256: "c".repeat(64),
      mimeType: "application/json",
    });
    await db.query("select public.finish_document_storage($1::jsonb)", [
      JSON.stringify({
        objectId: parsed.id,
        documentId: docs[0].id,
        leaseToken: lease,
        kind: "parsed",
        parserId: "legacy-parser",
        parseStatus: "PARSED",
        pageCount: 1,
      }),
    ]);
    const readDocument = async () =>
      (
        await db.query(
          "select object_key,text_object_key,raw_storage_id,parsed_storage_id from public.bid_documents where id=$1",
          [docs[0].id],
        )
      ).rows[0];
    const before = await readDocument();
    await applyMigrations(db, [upgrade]);
    assert.deepEqual(await readDocument(), before);
    const existing = await claim(db);
    assert.equal(existing.id, raw.id);
    assert.equal(existing.path, objectPath);
    assert.deepEqual(
      (
        await db.query(
          "select logical_path,path from public.document_storage_objects order by bucket",
        )
      ).rows,
      [
        { logical_path: objectPath, path: objectPath },
        { logical_path: parsedPath, path: parsedPath },
      ],
    );
    const newPath = objectPath.replace(sha, "d".repeat(64));
    const fresh = await claim(db, { ...claimInput, path: newPath, sha256: "d".repeat(64) });
    assert.equal(fresh.path, newPath.replace(/\/([^/]+)$/, `/${fresh.id}/$1`));
    await finish(db, fresh, docs[1].id);
    assert.deepEqual(await readDocument(), before);
  });

  it("keeps two document references to the same checksum, and serializes upload ownership", async (t) => {
    const { db, docs } = await setup(t);
    const object = await claim(db);
    assert.equal(object.status, "UPLOADING");
    await assert.rejects(
      claim(db, { ...claimInput, leaseToken: "1ea5e000-0000-0000-0000-000000000002" }),
      /storage_busy/,
    );
    await finish(db, object, docs[0].id);
    const reused = await claim(db);
    assert.equal(reused.id, object.id);
    await finish(db, reused, docs[1].id);
    assert.equal(
      (
        await db.query(
          "select id from public.bid_documents where raw_storage_id=$1 and download_status='OK'",
          [object.id],
        )
      ).rows.length,
      2,
    );
    await assert.rejects(claim(db, { ...claimInput, sizeBytes: 10 }), /storage_metadata_mismatch/);
  });

  it("only active business members can read referenced raw objects; anonymous, parsed, unreferenced and direct writes stay closed", async (t) => {
    const { db, docs } = await setup(t);
    const object = await claim(db);
    await finish(db, object, docs[0].id);
    await db.exec(
      "insert into storage.buckets(id,name,public) values('bid-documents','bid-documents',false),('bid-parsed','bid-parsed',false)",
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('bid-documents',$1),('bid-documents','unreferenced'),('bid-parsed','private.json')",
      [object.path],
    );
    await db.query(
      "insert into public.organizations(id,slug,name) values('0e000000-0000-0000-0000-000000000011','storage-test','시험')",
    );
    await db.query(
      "insert into public.memberships(org_id,user_id,org_role,sol_role) values('0e000000-0000-0000-0000-000000000011',$1,'member','VIEWER')",
      [users[0]],
    );
    await actAs(db, users[0]);
    assert.deepEqual((await db.query("select name from storage.objects")).rows, [
      { name: object.path },
    ]);
    await assert.rejects(
      db.query("insert into storage.objects(bucket_id,name) values('bid-documents','forged')"),
      /policy|permission denied/,
    );
    await assert.rejects(
      db.query("select * from public.document_storage_objects"),
      /permission denied/,
    );
    await assert.rejects(claim(db), /permission denied/);
    await actAs(db, users[1]);
    assert.equal((await db.query("select name from storage.objects")).rows.length, 0);
    await actAs(db, null, "anon");
    assert.equal((await db.query("select name from storage.objects")).rows.length, 0);
  });

  it("upload/DB failure preserves the object and expired ownership recovers; deleting objects cannot gain references", async (t) => {
    const { db, docs } = await setup(t);
    const object = await claim(db);
    await assert.rejects(
      finish(db, object, "d0c00000-0000-0000-0000-000000000099"),
      /storage_document_missing/,
    );
    assert.equal(
      (
        await db.query("select status from public.document_storage_objects where id=$1", [
          object.id,
        ])
      ).rows[0].status,
      "UPLOADING",
    );
    await db.query(
      "update public.document_storage_objects set lease_until=now()-interval '1 minute' where id=$1",
      [object.id],
    );
    const recovered = await claim(db, {
      ...claimInput,
      leaseToken: "1ea5e000-0000-0000-0000-000000000002",
    });
    await finish(db, recovered, docs[0].id, "1ea5e000-0000-0000-0000-000000000002");
    await db.query(
      "update public.document_storage_objects set created_at=now()-interval '25 hours' where id=$1",
      [object.id],
    );
    assert.equal(
      (await db.query("select id from public.document_storage_candidates()")).rows.length,
      0,
    );
    assert.equal(
      (
        await db.query("select public.claim_document_storage_delete($1,$2) as value", [
          object.id,
          lease,
        ])
      ).rows[0].value,
      null,
    );
    await db.query("delete from public.bid_documents where raw_storage_id=$1", [object.id]);
    assert.equal(
      (await db.query("select id from public.document_storage_candidates()")).rows.length,
      1,
    );
    assert.ok(
      (
        await db.query("select public.claim_document_storage_delete($1,$2) as value", [
          object.id,
          lease,
        ])
      ).rows[0].value,
    );
    await assert.rejects(claim(db), /storage_busy/);
    await assert.rejects(finish(db, object, docs[1].id), /storage_lease_lost/);
    await db.query("select public.finish_document_storage_delete($1,$2)", [object.id, lease]);
    assert.equal(
      (await db.query("select id from public.document_storage_objects where id=$1", [object.id]))
        .rows.length,
      0,
    );
  });

  it("a delayed expired deleter cannot target a new document with the same logical checksum key", async (t) => {
    const { db, docs } = await setup(t);
    const first = await claim(db);
    await finish(db, first, docs[0].id);
    const oldPath = (
      await db.query("select object_key from public.bid_documents where id=$1", [docs[0].id])
    ).rows[0].object_key;
    const bytes = new Set([oldPath]);
    await db.query("delete from public.bid_documents where id=$1", [docs[0].id]);
    await db.query(
      "update public.document_storage_objects set created_at=now()-interval '25 hours' where id=$1",
      [first.id],
    );
    const remove = async (token) =>
      (
        await db.query("select public.claim_document_storage_delete($1,$2) as value", [
          first.id,
          token,
        ])
      ).rows[0].value;
    const delayed = await remove(lease);
    await db.query(
      "update public.document_storage_objects set lease_until=now()-interval '1 minute' where id=$1",
      [first.id],
    );
    const takeoverToken = "1ea5e000-0000-0000-0000-000000000002";
    const takeover = await remove(takeoverToken);
    bytes.delete(takeover.path);
    await db.query("select public.finish_document_storage_delete($1,$2)", [
      first.id,
      takeoverToken,
    ]);
    const recreated = await claim(db);
    await finish(db, recreated, docs[1].id);
    const newPath = (
      await db.query("select object_key from public.bid_documents where id=$1", [docs[1].id])
    ).rows[0].object_key;
    bytes.add(newPath);
    bytes.delete(delayed.path);
    assert.notEqual(
      newPath,
      oldPath,
      "each physical object incarnation needs a distinct Storage key",
    );
    assert.ok(bytes.has(newPath), "the referenced recreated bytes must survive the old delete");
    assert.equal(recreated.path, newPath);
    assert.equal(
      (await claim(db)).path,
      newPath,
      "logical duplicates still reuse the current physical object",
    );
  });
});

describe("SOL RADAR 표 정책 — 업무 역할·조직 격리", () => {
  const ORG1 = "0e000000-0000-0000-0000-000000000001";
  const ORG2 = "0e000000-0000-0000-0000-000000000002";
  const WHO = {
    admin: users[0], // org-01 owner + ADMIN(데모 admin@soltech.invalid 과 같은 조합)
    sales: users[1], // org-01 SALES
    operator: users[2], // 운영자(profiles.is_admin). 어느 조직에도 없다
    analyst: "00000000-0000-0000-0000-000000000004", // org-01 ANALYST
    viewer: "00000000-0000-0000-0000-000000000005", // org-01 VIEWER
    outsider: "00000000-0000-0000-0000-000000000006", // org-02 owner + VIEWER
    invitee: "00000000-0000-0000-0000-000000000007", // 아직 어느 조직에도 없다
  };
  const EMAIL = {
    admin: "user0@example.invalid",
    sales: "user1@example.invalid",
    operator: "user2@example.invalid",
    analyst: "analyst@example.invalid",
    viewer: "viewer@example.invalid",
    outsider: "viewer@other.invalid",
    invitee: "invitee@example.invalid",
  };
  const BID1 = "b1d00000-0000-0000-0000-000000000001";
  const BID2 = "b1d00000-0000-0000-0000-000000000002";
  const REV1 = "be500000-0000-0000-0000-000000000001";
  const REV2 = "be500000-0000-0000-0000-000000000002";
  const EXT1 = "e0000000-0000-0000-0000-000000000001";
  const PROFILE1 = "c0000000-0000-0000-0000-000000000001";
  const PROFILE2 = "c0000000-0000-0000-0000-000000000002";
  const RUN1 = "a0000000-0000-0000-0000-000000000001";
  const RUN2 = "a0000000-0000-0000-0000-000000000002";
  const DEPT1 = "d0000000-0000-0000-0000-000000000011";
  const TITLE1 = "d0000000-0000-0000-0000-000000000021";
  const MEMBER1 = "d0000000-0000-0000-0000-000000000001";
  const REVIEW1 = "f0000000-0000-0000-0000-000000000001";
  const REVIEW2 = "f0000000-0000-0000-0000-000000000002";
  const NOTE_ADMIN = "e1000000-0000-0000-0000-000000000001";
  const NOTE_VIEWER = "e1000000-0000-0000-0000-000000000002";
  const NOTE_OUTSIDER = "e1000000-0000-0000-0000-000000000003";
  const INGEST1 = "e2000000-0000-0000-0000-000000000001";
  const BID_TABLES = [
    "bid_notices",
    "bid_revisions",
    "bid_documents",
    "bid_structured_requirements",
    "requirement_extractions",
  ];
  const ORG_TABLES = [
    "company_profiles",
    "score_runs",
    "score_factors",
    "qualification_checks",
    "requirement_assessments",
    "bid_reviews",
    "assignments",
    "audit_logs",
    "notifications",
  ];
  const OPS_TABLES = ["ingest_runs", "ingest_errors", "eval_runs"];
  const SOL_TABLES = [...BID_TABLES, ...ORG_TABLES, ...OPS_TABLES, "outbox_events"];
  const as = (pglite, who) => actAs(pglite, WHO[who], "authenticated", EMAIL[who]);
  const asAnon = (pglite) => actAs(pglite, null, "anon");
  const asWorker = async (pglite) => {
    await pglite.exec("reset role");
    await pglite.query("select set_config('request.jwt.claims', '', false)");
  };
  const rowsOf = async (pglite, sql, params = []) => (await pglite.query(sql, params)).rows;
  const countOf = async (pglite, table, where = "true", params = []) =>
    (
      await rowsOf(pglite, `select count(*)::int as n from public.${table} where ${where}`, params)
    )[0].n;
  const rejectsWith = (promise, constraint, message) =>
    assert.rejects(promise, new RegExp(constraint), message);
  const PERMISSION = /permission denied for table/;
  const POLICY = /violates row-level security policy/;
  const seed = async (pglite) => {
    await asWorker(pglite);
    for (const who of ["analyst", "viewer", "outsider", "invitee"])
      await pglite.query("insert into auth.users values ($1, $2)", [WHO[who], EMAIL[who]]);
    await pglite.query("update public.profiles set is_admin = true where id = $1", [WHO.operator]);
    await pglite.query(
      "insert into public.organizations (id, slug, name, is_demo) values ($1, 'org-01', '솔리데오', true), ($2, 'org-02', '격리 조직', true)",
      [ORG1, ORG2],
    );
    await pglite.query(
      `insert into public.memberships (org_id, user_id, org_role, sol_role) values
         ($1, $3, 'owner', 'ADMIN'), ($1, $4, 'member', 'SALES'), ($1, $5, 'member', 'ANALYST'),
         ($1, $6, 'member', 'VIEWER'), ($2, $7, 'owner', 'VIEWER')`,
      [ORG1, ORG2, WHO.admin, WHO.sales, WHO.analyst, WHO.viewer, WHO.outsider],
    );
    // 인력(배정의 복합 FK 대상). "솔리데오 카탈로그·가입 신고" 시험과 같은 최소 행이다.
    await pglite.query(
      "insert into public.departments (id, org_id, code, name, source_count, target_count, is_demo) values ($1, $2, 'SOL-D001', '시험부서', 1, 1, true)",
      [DEPT1, ORG1],
    );
    await pglite.query(
      "insert into public.job_titles (id, org_id, code, label, sort_order) values ($1, $2, 'SOL-J007', '팀장', 7)",
      [TITLE1, ORG1],
    );
    await pglite.query(
      "insert into public.team_members (id, org_id, person_code, name, gender, department_id, job_title_id, portrait_path, is_demo) values ($1, $2, 'SOL-P0001', '김민준', 'MALE', $3, $4, '/demo/people/SOL-P0001.png', true)",
      [MEMBER1, ORG1, DEPT1, TITLE1],
    );
    // 공고(공용) 두 건과 첫 revision. 첨부·구조화 자격·추출은 BID1 에만.
    await pglite.query(
      `insert into public.bid_notices (id, source, notice_id, title, agency, stage, status, budget_krw, source_url, content_hash, is_demo) values
         ($1, 'fixture', 'DEMO-2026-0001', '클라우드 통합 플랫폼 구축', '시험기관', 'NOTICE', 'OPEN', 1200000000, 'https://fixture.invalid/0001', 'hash-0001', true),
         ($2, 'fixture', 'DEMO-2026-0002', '데이터 분석 시스템 고도화', '시험기관', 'NOTICE', 'OPEN', 800000000, 'https://fixture.invalid/0002', 'hash-0002', true)`,
      [BID1, BID2],
    );
    await pglite.query(
      "insert into public.bid_revisions (id, bid_id, revision, raw_payload, normalized, checksum) values ($1, $3, 1, '{}', '{}', 'sum-0001'), ($2, $4, 1, '{}', '{}', 'sum-0002')",
      [REV1, REV2, BID1, BID2],
    );
    await pglite.query(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url) values ($1, $2, '제안요청서.pdf', 'https://www.g2b.go.kr/doc/0001')",
      [BID1, REV1],
    );
    await pglite.query(
      "insert into public.bid_structured_requirements (bid_id, revision_id, kind, seq, code, name, value, source_operation) values ($1, $2, 'LICENSE_LIMIT', 0, '1468', '소프트웨어사업자', '{}', 'getBidPblancListInfoServcPPSSrch')",
      [BID1, REV1],
    );
    await pglite.query(
      "insert into public.requirement_extractions (id, bid_id, revision_id, provider, model_name, prompt_version, prompt_hash, schema_version, status) values ($1, $2, $3, 'MOCK', 'mock', 'v0.1', 'p-0001', 'requirement-extraction/v0.1', 'COMPLETED')",
      [EXT1, BID1, REV1],
    );
    // 회사 프로필 — 두 조직의 revision 1.
    await pglite.query(
      "insert into public.company_profiles (id, org_id, revision, name) values ($1, $3, 1, '솔리데오'), ($2, $4, 1, '격리 조직')",
      [PROFILE1, PROFILE2, ORG1, ORG2],
    );
    // 분석 — 두 조직의 완료 run 하나씩과 자식 행 하나씩.
    for (const [run, org, profile] of [
      [RUN1, ORG1, PROFILE1],
      [RUN2, ORG2, PROFILE2],
    ]) {
      await pglite.query(
        `insert into public.score_runs (id, org_id, bid_id, revision_id, company_profile_id, profile_revision, extraction_id, algorithm_version,
           run_mode, ai_provider, status, score, recommendation, recommendation_basis, input_snapshot, input_snapshot_hash)
         values ($1, $2, $3, $4, $5, 1, $6, 'sol-v0.1.0', 'MOCK', 'MOCK', 'COMPLETED', 82, 'BID', 'RULES_ONLY',
           '{"schemaVersion":"analysis-input/v0.1"}', 'snap-0001')`,
        [run, org, BID1, REV1, profile, EXT1],
      );
      await pglite.query(
        "insert into public.score_factors (score_run_id, org_id, factor, points, max_points) values ($1, $2, 'skillMatch', 25, 30)",
        [run, org],
      );
      await pglite.query(
        "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'LICENSE_1468', '소프트웨어사업자', 'SATISFIED', '보유 면허와 일치', 'API_FIELD')",
        [run, org, BID1, REV1],
      );
      await pglite.query(
        "insert into public.requirement_assessments (score_run_id, org_id, item_id, item_kind, rule_status, basis) values ($1, $2, 'qualifications[0]', 'QUALIFICATION', 'SATISFIED', 'API_FIELD')",
        [run, org],
      );
    }
    // 결정 이력(검토자 없음) — 트리거가 run 의 권고를 옮겨 적는다.
    await pglite.query(
      `insert into public.bid_reviews (id, org_id, bid_id, revision_id, score_run_id, decision, reason) values
         ($1, $3, $5, $6, $7, 'BID', '시드 결정 — 권고와 같다'), ($2, $4, $5, $6, $8, 'WATCH', '시드 결정 — 권고와 다르다')`,
      [REVIEW1, REVIEW2, ORG1, ORG2, BID1, REV1, RUN1, RUN2],
    );
    await pglite.query(
      "insert into public.assignments (org_id, bid_id, member_id, starts_at, ends_at, allocation_percent) values ($1, $2, $3, '2026-11-01', '2027-04-30', 50)",
      [ORG1, BID1, MEMBER1],
    );
    // 운영 표·outbox·알림·감사(SEED)·평가.
    await pglite.query(
      "insert into public.ingest_runs (id, source, run_mode, job_key, trigger, batch, status, finished_at) values ($1, 'fixture', 'MOCK', 'ingest:fixture:seed', 'DEMO', 'SEED', 'PARTIAL', now())",
      [INGEST1],
    );
    await pglite.query(
      "insert into public.ingest_errors (ingest_run_id, source_key, error_code, redacted_detail) values ($1, 'fixture', 'SCHEMA_INVALID', 'FX-12 격리')",
      [INGEST1],
    );
    await pglite.query(
      "insert into public.eval_runs (dataset_version, dataset_sha256, system_id, split, git_commit) values ('v0.1', 'sha-eval', 'E0', 'dev', '654c6b1')",
    );
    await pglite.query(
      "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, idempotency_key) values (null, 'bid_notice', $1, 'BID_CREATED', 'fixture:DEMO-2026-0001:1:BID_CREATED')",
      [BID1],
    );
    await pglite.query(
      `insert into public.notifications (id, org_id, user_id, type, idempotency_key) values
         ($1, $4, $6, 'BID_CREATED', 'n-admin'), ($2, $4, $7, 'BID_CREATED', 'n-viewer'), ($3, $5, $8, 'BID_CREATED', 'n-outsider')`,
      [NOTE_ADMIN, NOTE_VIEWER, NOTE_OUTSIDER, ORG1, ORG2, WHO.admin, WHO.viewer, WHO.outsider],
    );
    await pglite.query(
      "insert into public.audit_logs (org_id, action, target_type, target_id) values ($1, 'SEED', 'organization', $1), ($2, 'SEED', 'organization', $2)",
      [ORG1, ORG2],
    );
    return pglite;
  };
  const solDb = async (t) => seed(await migratedDb(t));
  const requestRun = (pglite, org, profile, version, fields = {}) => {
    const columns = [
      "org_id",
      "bid_id",
      "revision_id",
      "company_profile_id",
      "profile_revision",
      "algorithm_version",
      "run_mode",
      "ai_provider",
      ...Object.keys(fields),
    ];
    const values = [org, BID1, REV1, profile, 1, version, "MOCK", "MOCK", ...Object.values(fields)];
    return rowsOf(
      pglite,
      `insert into public.score_runs (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id, status, requested_by`,
      values,
    );
  };
  const decide = (pglite, fields = {}) => {
    const row = {
      org_id: ORG1,
      bid_id: BID1,
      revision_id: REV1,
      decision: "BID",
      reason: "시험용 결정 사유 — 열 글자 이상",
      ...fields,
    };
    const columns = Object.keys(row);
    const values = Object.values(row);
    return rowsOf(
      pglite,
      `insert into public.bid_reviews (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      values,
    );
  };
  it("public의 모든 일반 테이블에 RLS가 켜져 있다", async (t) => {
    const pglite = await migratedDb(t);
    const { rows } = await pglite.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity",
    );
    assert.deepEqual(rows, []);
  });
  it("G5 — org-01 의 네 역할은 자기 조직의 조직 표를 같은 만큼 읽고 org-02 행은 0행이다 — 감사는 ADMIN 만, 알림은 본인 것만", async (t) => {
    const pglite = await solDb(t);
    const shared = ORG_TABLES.filter((table) => !["audit_logs", "notifications"].includes(table));
    for (const who of ["admin", "sales", "analyst", "viewer"]) {
      await as(pglite, who);
      for (const table of shared) {
        assert.equal(await countOf(pglite, table, "org_id = $1", [ORG1]), 1, `${who} ${table}`);
        assert.equal(
          await countOf(pglite, table, "org_id = $1", [ORG2]),
          0,
          `${who} ${table} org-02`,
        );
      }
      assert.equal(
        await countOf(pglite, "audit_logs"),
        who === "admin" ? 4 : 0,
        `${who} audit_logs`,
      );
      assert.equal(
        await countOf(pglite, "notifications"),
        ["admin", "viewer"].includes(who) ? 1 : 0,
        `${who} notifications`,
      );
    }
  });
  it("공고 다섯 표는 조직 소유가 아니다 — org-02 VIEWER 와 비멤버 운영자도 활동 중이면 읽고, ADMIN 이라도 넣기·고치기·지우기는 권한 오류다", async (t) => {
    const pglite = await solDb(t);
    const expected = {
      bid_notices: 2,
      bid_revisions: 2,
      bid_documents: 1,
      bid_structured_requirements: 1,
      requirement_extractions: 1,
    };
    for (const who of ["outsider", "operator", "viewer", "admin"]) {
      await as(pglite, who);
      for (const table of BID_TABLES)
        assert.equal(await countOf(pglite, table), expected[table], `${who} ${table}`);
    }
    await as(pglite, "admin");
    for (const table of BID_TABLES)
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set created_at = now()`,
        `delete from public.${table}`,
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
  });
  it("운영자(profiles.is_admin)는 멤버가 아닌 조직의 SOL 표를 하나도 읽지 못한다 — 조직 표 아홉 개와 운영 표 셋 모두 0행이고 정책 도우미도 빈 목록이다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "operator");
    for (const table of [...ORG_TABLES, ...OPS_TABLES])
      assert.equal(await countOf(pglite, table), 0, table);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select public.my_sol_org_ids(array['ADMIN', 'SALES', 'ANALYST', 'VIEWER']) as org",
      ),
      [],
    );
  });
  it("outbox_events 는 내부 표다 — ADMIN·VIEWER·org-02·로그아웃 누구도 읽지도 쓰지도 못한다(권한 오류)", async (t) => {
    const pglite = await solDb(t);
    for (const who of ["admin", "viewer", "outsider", "anon"]) {
      if (who === "anon") await asAnon(pglite);
      else await as(pglite, who);
      for (const sql of [
        "select * from public.outbox_events",
        "insert into public.outbox_events (aggregate_type, aggregate_id, event_type, idempotency_key) values ('bid_notice', gen_random_uuid(), 'BID_CREATED', 'k')",
        "update public.outbox_events set status = 'PROCESSED'",
        "delete from public.outbox_events",
      ])
        await assert.rejects(
          pglite.query(sql),
          /permission denied for table outbox_events/,
          `${who}: ${sql}`,
        );
    }
  });
  it("로그아웃한 사람(anon)은 SOL 표 열여덟 개를 읽지도 쓰지도 못하고 정책 도우미 my_sol_org_ids 도 부르지 못한다 — 모두 권한 오류", async (t) => {
    const pglite = await solDb(t);
    await asAnon(pglite);
    for (const table of SOL_TABLES)
      await assert.rejects(
        pglite.query(`select * from public.${table}`),
        new RegExp(`permission denied for table ${table}`),
      );
    await assert.rejects(
      pglite.query("select public.my_sol_org_ids(array['ADMIN'])"),
      /permission denied for function my_sol_org_ids/,
    );
    for (const [sql, params] of [
      [
        "insert into public.company_profiles (org_id, revision, name) values ($1, 2, '로그아웃 개정')",
        [ORG1],
      ],
      [
        "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider) values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK')",
        [ORG1, BID1, REV1, PROFILE1],
      ],
      [
        "insert into public.bid_reviews (org_id, bid_id, revision_id, decision, reason) values ($1, $2, $3, 'BID', '로그아웃 상태의 결정 시도')",
        [ORG1, BID1, REV1],
      ],
      ["update public.notifications set read_at = now()", []],
      [
        "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
        [ORG1, WHO.viewer],
      ],
    ])
      await assert.rejects(pglite.query(sql, params), PERMISSION, sql);
  });
  it("운영 표(수집 run·수집 오류·평가 결과)는 어느 조직에서든 ADMIN 인 사람만 읽는다 — SALES·ANALYST·VIEWER·org-02 는 0행이고 ADMIN 도 쓰지는 못한다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "admin");
    for (const table of OPS_TABLES) assert.equal(await countOf(pglite, table), 1, table);
    for (const who of ["sales", "analyst", "viewer", "outsider"]) {
      await as(pglite, who);
      for (const table of OPS_TABLES)
        assert.equal(await countOf(pglite, table), 0, `${who} ${table}`);
    }
    // 공용 표라 org-02 의 ADMIN 도 읽는다.
    await asWorker(pglite);
    await pglite.query(
      "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
      [ORG2, WHO.outsider],
    );
    await as(pglite, "outsider");
    for (const table of OPS_TABLES)
      assert.equal(await countOf(pglite, table), 1, `org-02 ADMIN ${table}`);
    await as(pglite, "admin");
    for (const table of OPS_TABLES)
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set id = id`,
        `delete from public.${table}`,
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
  });
  it("감사 기록은 그 조직의 ADMIN 만 읽는다 — SALES·ANALYST·VIEWER·org-02·운영자는 0행이고, ADMIN 도 org-02 것은 보지 못하며 아무도 직접 쓰지 못한다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "admin");
    assert.deepEqual(
      (await rowsOf(pglite, "select org_id, action from public.audit_logs order by action")).map(
        (row) => `${row.org_id}:${row.action}`,
      ),
      ["ANALYSIS_REQUEST", "PROFILE_CREATE_REVISION", "REVIEW_DECIDE", "SEED"].map(
        (action) => `${ORG1}:${action}`,
      ),
    );
    for (const who of ["sales", "analyst", "viewer", "outsider", "operator"]) {
      await as(pglite, who);
      assert.equal(await countOf(pglite, "audit_logs"), 0, who);
    }
    await as(pglite, "admin");
    for (const sql of [
      `insert into public.audit_logs (org_id, action, target_type, target_id) values ('${ORG1}', 'SEED', 'organization', '${ORG1}')`,
      "update public.audit_logs set action = 'LOGIN'",
      "delete from public.audit_logs",
    ])
      await assert.rejects(pglite.query(sql), /permission denied for table audit_logs/, sql);
  });
  it("분석 요청은 ADMIN·SALES·ANALYST 가 QUEUED 행으로만 넣는다 — VIEWER·org-02 는 정책 오류, 상태·결과·요청자·스냅샷 열은 권한이 없고, 상태 전이·지우기는 worker 몫이며 ANALYSIS_REQUEST 감사가 남는다", async (t) => {
    const pglite = await solDb(t);
    const requested = [];
    for (const [i, who] of ["admin", "sales", "analyst"].entries()) {
      await as(pglite, who);
      const rows = await requestRun(pglite, ORG1, PROFILE1, `sol-v0.1.${i + 1}`);
      assert.deepEqual(
        rows.map(({ status, requested_by }) => ({ status, requested_by })),
        [{ status: "QUEUED", requested_by: WHO[who] }],
        who,
      );
      requested.push([rows[0].id, WHO[who]]);
    }
    await as(pglite, "viewer");
    await assert.rejects(requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9"), POLICY, "VIEWER");
    await as(pglite, "outsider");
    // org-02 VIEWER 는 자기 조직에도, org-01 에도 못 넣는다.
    await assert.rejects(requestRun(pglite, ORG2, PROFILE2, "sol-v0.1.9"), POLICY);
    await assert.rejects(requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9"), POLICY);
    await as(pglite, "sales");
    await assert.rejects(requestRun(pglite, ORG2, PROFILE2, "sol-v0.1.9"), POLICY, "다른 조직");
    for (const fields of [
      { status: "COMPLETED" },
      { score: 90 },
      { recommendation: "BID" },
      { requested_by: WHO.admin },
      { input_snapshot: "{}" },
    ])
      await assert.rejects(
        requestRun(pglite, ORG1, PROFILE1, "sol-v0.1.9", fields),
        /permission denied for table score_runs/,
        JSON.stringify(fields),
      );
    await assert.rejects(
      pglite.query("update public.score_runs set status = 'RUNNING'"),
      /permission denied for table score_runs/,
    );
    await assert.rejects(
      pglite.query("delete from public.score_runs"),
      /permission denied for table score_runs/,
    );
    await as(pglite, "admin");
    for (const [id, actor] of requested)
      assert.deepEqual(
        await rowsOf(
          pglite,
          "select actor_id, action, before_after -> 'after' ->> 'status' as status from public.audit_logs where target_type = 'score_run' and target_id = $1",
          [id],
        ),
        [{ actor_id: actor, action: "ANALYSIS_REQUEST", status: "QUEUED" }],
      );
  });
  it("결정 기록은 ADMIN·SALES 만 넣는다 — ANALYST·VIEWER·org-02 는 정책 오류, 권고·불일치 플래그·검토자·시각은 열 권한이 없고 트리거가 채우며, REVIEW_DECIDE 감사와 담당자가 있을 때 REVIEW_ASSIGNED outbox 1건이 같은 트랜잭션에 남는다", async (t) => {
    const pglite = await solDb(t);
    for (const who of ["analyst", "viewer"]) {
      await as(pglite, who);
      await assert.rejects(decide(pglite, { score_run_id: RUN1 }), POLICY, who);
    }
    await as(pglite, "outsider");
    await assert.rejects(decide(pglite), POLICY, "org-02 → org-01");
    await assert.rejects(decide(pglite, { org_id: ORG2, score_run_id: RUN2 }), POLICY, "org-02");
    await as(pglite, "sales");
    await assert.rejects(decide(pglite, { org_id: ORG2, score_run_id: RUN2 }), POLICY, "다른 조직");
    for (const fields of [
      { system_recommendation: "BID" },
      { disagreement_flag: true },
      { reviewer_id: WHO.admin },
      { decided_at: "2026-01-01T00:00:00Z" },
    ])
      await assert.rejects(
        decide(pglite, fields),
        /permission denied for table bid_reviews/,
        JSON.stringify(fields),
      );
    // SALES: 권고 BID 인 run 에 WATCH → 권고 사본과 불일치 플래그.
    const [{ id: watch }] = await decide(pglite, {
      score_run_id: RUN1,
      decision: "WATCH",
      reason: "예산 대비 인력 여유가 부족해 지켜본다",
    });
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select reviewer_id, system_recommendation, disagreement_flag from public.bid_reviews where id = $1",
        [watch],
      ),
      [{ reviewer_id: WHO.sales, system_recommendation: "BID", disagreement_flag: true }],
    );
    // ADMIN: run 없이 BID, 담당자 viewer → 권고 없음·불일치 false·outbox 1건.
    await as(pglite, "admin");
    const [{ id: assigned }] = await decide(pglite, {
      assignee_id: WHO.viewer,
      reason: "담당자를 정해 제안 준비를 시작한다",
    });
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select reviewer_id, system_recommendation, disagreement_flag, assignee_id from public.bid_reviews where id = $1",
        [assigned],
      ),
      [
        {
          reviewer_id: WHO.admin,
          system_recommendation: null,
          disagreement_flag: false,
          assignee_id: WHO.viewer,
        },
      ],
    );
    // append-only — 고치기·지우기는 권한이 없다.
    await assert.rejects(
      pglite.query("update public.bid_reviews set decision = 'NO_BID'"),
      /permission denied for table bid_reviews/,
    );
    await assert.rejects(
      pglite.query("delete from public.bid_reviews"),
      /permission denied for table bid_reviews/,
    );
    assert.deepEqual(
      await rowsOf(
        pglite,
        `select actor_id, before_after -> 'after' ->> 'decision' as decision, before_after -> 'after' ->> 'systemRecommendation' as recommendation,
           (before_after -> 'after' ->> 'disagreementFlag')::boolean as disagreement
         from public.audit_logs where action = 'REVIEW_DECIDE' and target_id in ($1, $2) order by actor_id`,
        [watch, assigned],
      ),
      [
        { actor_id: WHO.admin, decision: "BID", recommendation: null, disagreement: false },
        { actor_id: WHO.sales, decision: "WATCH", recommendation: "BID", disagreement: true },
      ],
    );
    // outbox 는 화면 역할이 못 읽으므로 관리 작업으로 본다.
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_id, aggregate_type, aggregate_id, status, idempotency_key, payload ->> 'assigneeUserId' as assignee, payload ->> 'reviewerId' as reviewer from public.outbox_events where event_type = 'REVIEW_ASSIGNED'",
      ),
      [
        {
          org_id: ORG1,
          aggregate_type: "bid_review",
          aggregate_id: assigned,
          status: "PENDING",
          idempotency_key: `${assigned}:${WHO.viewer}:REVIEW_ASSIGNED`,
          assignee: WHO.viewer,
          reviewer: WHO.admin,
        },
      ],
    );
    // 같은 키가 이미 있으면 outbox 는 한 건만 남고 결정은 들어간다(on conflict do nothing).
    const fixed = "f0000000-0000-0000-0000-000000000099";
    const key = `${fixed}:${WHO.viewer}:REVIEW_ASSIGNED`;
    await pglite.query(
      "insert into public.outbox_events (org_id, aggregate_type, aggregate_id, event_type, idempotency_key) values ($1, 'bid_review', $2, 'REVIEW_ASSIGNED', $3)",
      [ORG1, fixed, key],
    );
    await pglite.query(
      "insert into public.bid_reviews (id, org_id, bid_id, revision_id, assignee_id, decision, reason) values ($1, $2, $3, $4, $5, 'BID', '같은 담당자에게 다시 배정한다')",
      [fixed, ORG1, BID1, REV1, WHO.viewer],
    );
    assert.equal(await countOf(pglite, "outbox_events", "idempotency_key = $1", [key]), 1);
  });
  it("결정의 분석 run 은 같은 조직·같은 공고의 것만이고(score_run_mismatch) 담당자는 같은 조직 멤버만이다(bid_reviews_assignee_fkey) — 담당자가 조직을 나가면 담당자만 비고 결정은 남는다", async (t) => {
    const pglite = await solDb(t);
    await as(pglite, "sales");
    const mismatch = { code: "23503", hint: "score_run_mismatch" };
    // 같은 조직, 다른 공고의 run.
    await assert.rejects(
      decide(pglite, { bid_id: BID2, revision_id: REV2, score_run_id: RUN1 }),
      mismatch,
      "다른 공고",
    );
    // org-02 의 run — 복합 FK 보다 먼저 트리거가 본다.
    await assert.rejects(decide(pglite, { score_run_id: RUN2 }), mismatch, "org-02 run");
    await assert.rejects(
      decide(pglite, { score_run_id: "a0000000-0000-0000-0000-0000000000ff" }),
      mismatch,
      "없는 run",
    );
    for (const assignee of [WHO.outsider, WHO.operator, WHO.invitee])
      await rejectsWith(decide(pglite, { assignee_id: assignee }), "bid_reviews_assignee_fkey");
    await rejectsWith(decide(pglite, { revision_id: REV2 }), "bid_reviews_revision_fkey");
    const [{ id }] = await decide(pglite, { assignee_id: WHO.analyst, score_run_id: RUN1 });
    await asWorker(pglite);
    await pglite.query("delete from public.memberships where org_id = $1 and user_id = $2", [
      ORG1,
      WHO.analyst,
    ]);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select assignee_id, decision, system_recommendation from public.bid_reviews where id = $1",
        [id],
      ),
      [{ assignee_id: null, decision: "BID", system_recommendation: "BID" }],
    );
  });
  it("업무 역할 변경은 그 조직의 ADMIN 만 한다 — SALES 의 시도와 org-02 owner(VIEWER)의 시도는 0행, ADMIN 은 자기 조직만 바꾸고 org-02 에는 0행이다", async (t) => {
    const pglite = await solDb(t);
    const setRole = (org, user, role) =>
      rowsOf(
        pglite,
        "update public.memberships set sol_role = $3 where org_id = $1 and user_id = $2 returning user_id, sol_role",
        [org, user, role],
      );
    await as(pglite, "sales");
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ANALYST"), []);
    assert.deepEqual(await setRole(ORG1, WHO.sales, "ADMIN"), [], "자기 역할");
    await as(pglite, "outsider");
    // org-02 의 owner 지만 ADMIN 이 아니다(ADR-021).
    assert.deepEqual(await setRole(ORG2, WHO.outsider, "ADMIN"), []);
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ADMIN"), []);
    await as(pglite, "admin");
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ANALYST"), [
      { user_id: WHO.viewer, sol_role: "ANALYST" },
    ]);
    assert.deepEqual(await setRole(ORG2, WHO.outsider, "ADMIN"), []);
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select org_id, user_id, sol_role from public.memberships order by org_id, user_id",
      ),
      [
        { org_id: ORG1, user_id: WHO.admin, sol_role: "ADMIN" },
        { org_id: ORG1, user_id: WHO.sales, sol_role: "SALES" },
        { org_id: ORG1, user_id: WHO.analyst, sol_role: "ANALYST" },
        { org_id: ORG1, user_id: WHO.viewer, sol_role: "ANALYST" },
        { org_id: ORG2, user_id: WHO.outsider, sol_role: "VIEWER" },
      ],
    );
  });
  it("업무 역할 보호 트리거 — update 정책이 실수로 열려도 ADMIN 이 아닌 사람의 sol_role 변경은 42501(sol_role_admin_only)이고, 같은 값·ADMIN·JWT 없는 관리 작업·service_role 은 통과한다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    // 첫 잠금(정책)이 열린 상황: 멤버 전원이 자기 조직 멤버십을 고친다. 두 번째 잠금(트리거)만 남는다.
    await pglite.exec(
      'create policy "시험 — 멤버 전원 수정" on public.memberships for update to authenticated using (org_id in (select public.my_org_ids())) with check (org_id in (select public.my_org_ids()))',
    );
    const setRole = (org, user, role) =>
      rowsOf(
        pglite,
        "update public.memberships set sol_role = $3 where org_id = $1 and user_id = $2 returning sol_role",
        [org, user, role],
      );
    await as(pglite, "sales");
    await assert.rejects(setRole(ORG1, WHO.sales, "ADMIN"), {
      code: "42501",
      hint: "sol_role_admin_only",
    });
    await assert.rejects(setRole(ORG1, WHO.viewer, "ADMIN"), {
      code: "42501",
      hint: "sol_role_admin_only",
    });
    // 값이 그대로면 트리거는 거절하지 않는다(열린 정책대로 통과).
    assert.deepEqual(await setRole(ORG1, WHO.sales, "SALES"), [{ sol_role: "SALES" }]);
    await as(pglite, "admin");
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "ANALYST"), [{ sol_role: "ANALYST" }]);
    await asWorker(pglite);
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "SALES"), [{ sol_role: "SALES" }]);
    await pglite.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ role: "service_role" }),
    ]);
    assert.deepEqual(await setRole(ORG1, WHO.viewer, "VIEWER"), [{ sol_role: "VIEWER" }]);
    await asWorker(pglite);
    assert.deepEqual(
      await rowsOf(
        pglite,
        "select sol_role from public.memberships where org_id = $1 and user_id = $2",
        [ORG1, WHO.sales],
      ),
      [{ sol_role: "SALES" }],
    );
  });
  it("worker 전용 표(점수 요소·자격 판정·항목 판정·인력 배정)는 조직 전원이 읽고 ADMIN 도 넣기·고치기·지우기는 권한 오류다", async (t) => {
    const pglite = await solDb(t);
    const tables = [
      "score_factors",
      "qualification_checks",
      "requirement_assessments",
      "assignments",
    ];
    for (const who of ["admin", "sales", "analyst", "viewer"]) {
      await as(pglite, who);
      for (const table of tables)
        assert.equal(await countOf(pglite, table, "org_id = $1", [ORG1]), 1, `${who} ${table}`);
    }
    await as(pglite, "admin");
    for (const table of tables)
      for (const sql of [
        `insert into public.${table} default values`,
        `update public.${table} set org_id = '${ORG1}'`,
        `delete from public.${table}`,
      ])
        await assert.rejects(pglite.query(sql), PERMISSION, sql);
  });
  it("테넌트 혼입은 복합 외래 키가 거절한다(23503) — worker 가 RLS 없이 써도 다른 조직 프로필의 run, run 과 다른 org_id 의 요소·자격·항목 판정, 다른 조직 직원의 배정, 비멤버 수신자의 알림, 다른 공고의 revision 은 들어가지 않는다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const rejects = async (sql, params, constraint) => {
      await assert.rejects(pglite.query(sql, params), { code: "23503" }, constraint);
      await rejectsWith(pglite.query(sql, params), constraint);
    };
    await rejects(
      "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider) values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK')",
      [ORG1, BID1, REV1, PROFILE2],
      "score_runs_company_profile_fkey",
    );
    await rejects(
      "insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version, run_mode, ai_provider) values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK')",
      [ORG1, BID2, REV1, PROFILE1],
      "score_runs_revision_fkey",
    );
    await rejects(
      "insert into public.score_factors (score_run_id, org_id, factor, points, max_points) values ($1, $2, 'pastPerformance', 10, 25)",
      [RUN1, ORG2],
      "score_factors_score_run_fkey",
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'C', '조건', 'SATISFIED', '사유', 'API_FIELD')",
      [RUN1, ORG2, BID1, REV1],
      "qualification_checks_score_run_fkey",
    );
    await rejects(
      "insert into public.qualification_checks (score_run_id, org_id, bid_id, revision_id, requirement_code, requirement_name, outcome, reason, basis) values ($1, $2, $3, $4, 'C', '조건', 'SATISFIED', '사유', 'API_FIELD')",
      [RUN1, ORG1, BID2, REV1],
      "qualification_checks_revision_fkey",
    );
    await rejects(
      "insert into public.requirement_assessments (score_run_id, org_id, item_id, item_kind, rule_status, basis) values ($1, $2, 'requiredSkills[0]', 'SKILL', 'SATISFIED', 'EXTRACTION')",
      [RUN1, ORG2],
      "requirement_assessments_score_run_fkey",
    );
    await rejects(
      "insert into public.assignments (org_id, bid_id, member_id, starts_at, ends_at, allocation_percent) values ($1, $2, $3, '2026-11-01', '2026-12-01', 10)",
      [ORG2, BID1, MEMBER1],
      "assignments_member_fkey",
    );
    await rejects(
      "insert into public.notifications (org_id, user_id, type, idempotency_key) values ($1, $2, 'BID_CREATED', 'n-mixed')",
      [ORG2, WHO.admin],
      "notifications_recipient_fkey",
    );
    await rejects(
      "insert into public.bid_reviews (org_id, bid_id, revision_id, assignee_id, decision, reason) values ($1, $2, $3, $4, 'BID', '다른 조직 사람을 담당자로')",
      [ORG2, BID1, REV1, WHO.admin],
      "bid_reviews_assignee_fkey",
    );
    await rejects(
      "insert into public.bid_documents (bid_id, revision_id, name, original_url) values ($1, $2, 'x', 'https://www.g2b.go.kr/x')",
      [BID2, REV1],
      "bid_documents_revision_fkey",
    );
    await rejects(
      "insert into public.bid_structured_requirements (bid_id, revision_id, kind, seq, value, source_operation) values ($1, $2, 'LICENSE_LIMIT', 1, '{}', 'op')",
      [BID2, REV1],
      "bid_structured_requirements_revision_fkey",
    );
    await rejects(
      "insert into public.requirement_extractions (bid_id, revision_id, provider, model_name, prompt_version, prompt_hash, schema_version) values ($1, $2, 'MOCK', 'mock', 'v0.1', 'p-0002', 's')",
      [BID2, REV1],
      "requirement_extractions_revision_fkey",
    );
    // 혼입이 없으면 들어간다.
    await pglite.query(
      "insert into public.score_factors (score_run_id, org_id, factor, points, max_points) values ($1, $2, 'pastPerformance', 10, 25)",
      [RUN1, ORG1],
    );
    assert.equal(await countOf(pglite, "score_factors", "score_run_id = $1", [RUN1]), 2);
  });
  describe("수집 run 열 단위 읽기 (20261019000019, N8 W1)", () => {
    const INGEST_RUN_HIDDEN = ["job_key", "idempotency_key", "requested_by", "params"];
    const INGEST_DENIED = { code: "42501", message: /permission denied for table ingest_runs/ };
    const MANUAL1 = "e2000000-0000-0000-0000-000000000002";
    const seedManualRun = async (pglite) => {
      await asWorker(pglite);
      await pglite.query(
        `insert into public.ingest_runs (id, source, run_mode, job_key, trigger, batch, params, status, requested_by, idempotency_key, started_at)
         values ($1, 'fixture', 'MOCK', $2, 'MANUAL', 'SEED', '{"note":"hidden"}', 'RUNNING', $3, $4, now() + interval '1 minute')`,
        [MANUAL1, `manual:${ORG1}:req-w1`, WHO.sales, `${ORG1}:req-w1`],
      );
      await pglite.query(
        "insert into public.audit_logs (org_id, actor_id, action, target_type, target_id) values ($1, $2, 'INGEST_MANUAL', 'ingest_run', $3)",
        [ORG1, WHO.sales, MANUAL1],
      );
    };
    const promoteOrg2Admin = async (pglite) => {
      await asWorker(pglite);
      await pglite.query(
        "update public.memberships set sol_role = 'ADMIN' where org_id = $1 and user_id = $2",
        [ORG2, WHO.outsider],
      );
    };
    const w1Db = async (t) => {
      const pglite = await solDb(t);
      await seedManualRun(pglite);
      await promoteOrg2Admin(pglite);
      return pglite;
    };
    const ADMINS = [
      ["org-01 ADMIN", "admin"],
      ["org-02 ADMIN", "outsider"],
    ];
    it("② 숨긴 열(job_key·idempotency_key·requested_by·params)은 org-01·org-02 ADMIN 모두 하나씩 고르면 권한 오류(42501)이고, 그 열로 거르기와 select * 도 권한 오류다", async (t) => {
      const pglite = await w1Db(t);
      for (const [label, who] of ADMINS) {
        await as(pglite, who);
        for (const column of INGEST_RUN_HIDDEN) {
          await assert.rejects(
            pglite.query(`select ${column} from public.ingest_runs`),
            INGEST_DENIED,
            `${label} select ${column}`,
          );
          await assert.rejects(
            pglite.query(`select id, ${column} from public.ingest_runs where id = $1`, [MANUAL1]),
            INGEST_DENIED,
            `${label} select id, ${column}`,
          );
          // PostgREST 의 ?<열>=eq.<값> 필터 자리. 숨긴 열 값을 짐작해 맞혀 보는 길도 닫힌다.
          await assert.rejects(
            pglite.query(`select id from public.ingest_runs where ${column} is not null`),
            INGEST_DENIED,
            `${label} where ${column}`,
          );
        }
        await assert.rejects(
          pglite.query("select * from public.ingest_runs"),
          INGEST_DENIED,
          `${label} select *`,
        );
      }
    });
  });
  describe("공고 목록 뷰 조직 격리", () => {
    const KEY1 = `${ORG1}:5a1e0000-0000-4000-8000-000000000001`;
    const LIST_COLUMNS = [
      "id",
      "status",
      "budget_krw_text",
      "latest_run_id",
      "latest_run_status",
      "latest_run_score",
      "latest_run_recommendation",
      "latest_run_basis",
      "latest_run_flags",
      "scored_score",
      "scored_recommendation",
      "latest_decision",
      "latest_reviewer_display_name",
      "latest_reviewer_email",
      "docs_total",
      "docs_pending",
      "docs_parsed",
      "docs_partial",
      "docs_unsupported",
      "docs_failed",
      "docs_download_failed",
    ];
    const listOf = (pglite) =>
      rowsOf(pglite, `select ${LIST_COLUMNS.join(", ")} from public.bid_list_items order by id`);
    const NO_DOCS = {
      docs_total: 0,
      docs_pending: 0,
      docs_parsed: 0,
      docs_partial: 0,
      docs_unsupported: 0,
      docs_failed: 0,
      docs_download_failed: 0,
    };
    const NO_ORG_DATA = {
      latest_run_id: null,
      latest_run_status: null,
      latest_run_score: null,
      latest_run_recommendation: null,
      latest_run_basis: null,
      latest_run_flags: null,
      scored_score: null,
      scored_recommendation: null,
      latest_decision: null,
      latest_reviewer_display_name: null,
      latest_reviewer_email: null,
    };
    const BID1_ROW = {
      id: BID1,
      status: "OPEN",
      budget_krw_text: "1200000000",
      ...NO_DOCS,
      docs_total: 1,
      docs_pending: 1,
    };
    const BID2_ROW = { id: BID2, status: "OPEN", budget_krw_text: "800000000", ...NO_DOCS };
    const completedRun = (run) => ({
      latest_run_id: run,
      latest_run_status: "COMPLETED",
      latest_run_score: 82,
      latest_run_recommendation: "BID",
      latest_run_basis: "RULES_ONLY",
      latest_run_flags: [],
      scored_score: 82,
      scored_recommendation: "BID",
    });
    it("bid_list_items 는 security_invoker 다 — org-02 VIEWER 는 공고를 모두 보지만 org-01 의 run·결정은 보지 않고(자기 조직 것만), 비멤버 운영자는 조직 열이 모두 비어 있다", async (t) => {
      const pglite = await solDb(t);
      // org-01 만 BID2 를 분석·결정한다.
      await as(pglite, "sales");
      const [{ id: bid2Run }] = await rowsOf(
        pglite,
        `insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
           run_mode, ai_provider, idempotency_key)
         values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK', $5) returning id`,
        [ORG1, BID2, REV2, PROFILE1, KEY1],
      );
      await decide(pglite, { bid_id: BID2, revision_id: REV2, decision: "NO_BID" });

      await as(pglite, "viewer");
      const [, bid2] = await listOf(pglite);
      assert.equal(bid2.latest_run_id, bid2Run);
      assert.equal(bid2.latest_decision, "NO_BID");

      // BID1 은 두 조직이 모두 분석·결정했다(seed). org-02 는 RUN2·WATCH 를, org-01 은 RUN1·BID 를 본다.
      await as(pglite, "outsider");
      assert.deepEqual(await listOf(pglite), [
        { ...BID1_ROW, ...NO_ORG_DATA, ...completedRun(RUN2), latest_decision: "WATCH" },
        { ...BID2_ROW, ...NO_ORG_DATA },
      ]);
      await as(pglite, "operator");
      assert.deepEqual(await listOf(pglite), [
        { ...BID1_ROW, ...NO_ORG_DATA },
        { ...BID2_ROW, ...NO_ORG_DATA },
      ]);
    });
  });
});

describe("솔리데오 카탈로그·명부·점수 정책", () => {
  const solideo = "db4c863c-cb6a-593d-93ff-709a17e0157a";
  const other = "33a80d95-1a64-5fe0-ad6d-e768657e9034";
  const department = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
  const title = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
  const otherDepartment = "10000000-0000-0000-0000-000000000001";
  const otherTitle = "10000000-0000-0000-0000-000000000002";
  const setup = async (t) => {
    const fresh = await migratedDb(t);
    await fresh.query(
      "insert into public.organizations (id,slug,name) values ($1,'org-01','솔리데오'),($2,'org-02','격리 조직')",
      [solideo, other],
    );
    await fresh.query(
      "insert into public.departments (id,org_id,code,name,source_count,target_count,is_demo) values ($1,$2,'SOL-D001','시험부서',3,4,true),($3,$4,'OTHER-D001','다른부서',1,1,true)",
      [department, solideo, otherDepartment, other],
    );
    await fresh.query(
      "insert into public.job_titles (id,org_id,code,label,sort_order) values ($1,$2,'SOL-J007','팀장',7),($3,$4,'OTHER-J001','다른직급',1)",
      [title, solideo, otherTitle, other],
    );
    await fresh.query(
      "insert into public.memberships (org_id,user_id,org_role) values ($1,$2,'member'),($3,$4,'member')",
      [solideo, users[0], other, users[1]],
    );
    await fresh.query(
      "insert into public.team_members (org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,'SOL-P0001','김민준','MALE',$2,$3,'/demo/people/SOL-P0001.png',true)",
      [solideo, department, title],
    );
    return fresh;
  };
  const resolve = (fresh, dept = "SOL-D001", job = "SOL-J007") =>
    fresh.query("select * from public.resolve_solideo_employment($1,$2)", [dept, job]);
  it("other-organization users and platform admins cannot read the roster; anonymous is denied", async (t) => {
    const fresh = await setup(t);
    await fresh.query("update public.profiles set is_admin=true where id=$1", [users[2]]);
    for (const userId of [users[1], users[2]]) {
      await actAs(fresh, userId);
      for (const table of ["departments", "job_titles", "team_members", "memberships"]) {
        assert.deepEqual(
          (await fresh.query(`select * from public.${table} where org_id=$1`, [solideo])).rows,
          [],
        );
      }
    }
    await actAs(fresh, null, "anon");
    for (const table of ["departments", "job_titles", "team_members", "memberships"]) {
      await assert.rejects(fresh.query(`select * from public.${table}`), /permission denied/);
    }
  });
  it("회원만 자기 조직 카탈로그·명부를 읽고 일반 사용자 쓰기는 전부 거부한다", async (t) => {
    const fresh = await setup(t);
    await actAs(fresh, users[0]);
    for (const table of ["departments", "job_titles", "team_members"]) {
      assert.equal((await fresh.query(`select * from public.${table}`)).rows.length, 1);
      assert.equal(
        (await fresh.query(`select * from public.${table} where org_id=$1`, [other])).rows.length,
        0,
      );
      for (const sql of [
        `insert into public.${table} (org_id) values ($1)`,
        `update public.${table} set org_id=$1`,
        `delete from public.${table} where org_id=$1`,
      ])
        await assert.rejects(fresh.query(sql, [solideo]), /permission denied/);
    }
    await actAs(fresh, users[1]);
    assert.equal((await fresh.query("select * from public.team_members")).rows.length, 0);
    await actAs(fresh, null, "anon");
    await assert.rejects(resolve(fresh), /permission denied/);
  });
  it("ADR021 점수는 같은 조직만 읽고 owner·운영자·일반회원·익명은 쓰지 못한다", async (t) => {
    const fresh = await setup(t);
    await fresh.exec(
      "insert into public.team_member_scoring(member_id,org_id,role) select id,org_id,'DEV' from public.team_members",
    );
    await fresh.query("update public.profiles set is_admin=true where id=$1", [users[2]]);
    await fresh.query(
      "update public.memberships set org_role='owner' where org_id=$1 and user_id=$2",
      [solideo, users[0]],
    );
    for (const [user, role, count] of [
      [users[0], "authenticated", 1],
      [users[1], "authenticated", 0],
      [users[2], "authenticated", 0],
      [null, "anon", null],
    ]) {
      await actAs(fresh, user, role);
      if (count === null)
        await assert.rejects(
          fresh.query("select * from public.team_member_scoring"),
          /permission denied/,
        );
      else
        assert.equal(
          (await fresh.query("select * from public.team_member_scoring")).rows.length,
          count,
        );
      for (const sql of [
        "insert into public.team_member_scoring(member_id,org_id,role) values (gen_random_uuid(),$1,'DEV')",
        "update public.team_member_scoring set org_id=$1",
        "update public.team_member_scoring set certifications='[]'::jsonb where org_id=$1",
        "update public.team_member_scoring set past_projects='[]'::jsonb where org_id=$1",
        "update public.team_member_scoring set capability_source='UNSPECIFIED' where org_id=$1",
        "update public.team_member_scoring set capability_version='tampered' where org_id=$1",
        "delete from public.team_member_scoring where org_id=$1",
      ])
        await assert.rejects(fresh.query(sql, [solideo]), /permission denied/);
    }
    await fresh.exec("reset role");
    // An ordinary member has the same read-only scoring access.
    await fresh.query(
      "insert into public.memberships(org_id,user_id,org_role) values ($1,$2,'member')",
      [solideo, users[1]],
    );
    await actAs(fresh, users[1]);
    assert.equal((await fresh.query("select * from public.team_member_scoring")).rows.length, 1);
    await assert.rejects(
      fresh.query("delete from public.team_member_scoring"),
      /permission denied/,
    );
  });

  it("합성 직원 속성은 JSON 배열·출처·완전성을 DB 제약으로 강제한다", async (t) => {
    const fresh = await setup(t);
    await fresh.exec(
      "insert into public.team_member_scoring(member_id,org_id,role) select id,org_id,'DEV' from public.team_members",
    );
    for (const sql of [
      "update public.team_member_scoring set certifications='{}'::jsonb",
      "update public.team_member_scoring set past_projects='null'::jsonb",
      "update public.team_member_scoring set capability_source='REAL'",
      "update public.team_member_scoring set capability_source='SYNTHETIC'",
    ])
      await assert.rejects(fresh.exec(sql), /check constraint/);
    const row = (
      await fresh.query(
        "select certifications,past_projects,capability_source,capability_version from public.team_member_scoring",
      )
    ).rows[0];
    assert.deepEqual(row, {
      certifications: [],
      past_projects: [],
      capability_source: "UNSPECIFIED",
      capability_version: null,
    });
  });

  it("ADR021 점수 복합 FK는 조직 혼입을 막고 직원·조직 삭제는 점수도 삭제한다", async (t) => {
    const fresh = await setup(t);
    const member = (await fresh.query("select id from public.team_members")).rows[0].id;
    await assert.rejects(
      fresh.query(
        "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEV')",
        [member, other],
      ),
      /foreign key/,
    );
    await fresh.query(
      "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEV')",
      [member, solideo],
    );
    await assert.rejects(
      fresh.query("update public.team_member_scoring set org_id=$1", [other]),
      /foreign key/,
    );
    await fresh.query("delete from public.team_members where id=$1", [member]);
    assert.equal((await fresh.query("select * from public.team_member_scoring")).rows.length, 0);
    await fresh.query(
      "insert into public.team_members(id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path) values ($1,$2,'SOL-P0001','김민준','MALE',$3,$4,'/demo/people/SOL-P0001.png')",
      [member, solideo, department, title],
    );
    await fresh.query(
      "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEV')",
      [member, solideo],
    );
    await fresh.query("delete from public.organizations where id=$1", [solideo]);
    assert.equal((await fresh.query("select * from public.team_member_scoring")).rows.length, 0);
    assert.equal((await fresh.query("select * from public.team_members")).rows.length, 0);
  });
});
