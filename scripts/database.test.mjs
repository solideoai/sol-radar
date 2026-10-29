// SOL RADAR MVP의 조직 격리·업무 역할·worker 쓰기 경계·사람 결정과 감사를 실제 PostgreSQL로 검사한다.
// 마이그레이션은 한 번 적용하고, 각 시험은 같은 기준 스냅샷을 복제한 독립 DB에서 실행한다.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { findRlsBypasses } from "./db-verify.mjs";
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

it("RLS 검사기는 긴 함수 서명을 자르지 않고 허용 함수와 위험 함수를 구별한다", async (t) => {
  const db = await migratedDb(t);
  const signature =
    "long_signature_probe(uuid, text, text, boolean, uuid, boolean, timestamp with time zone)";
  await db.exec(`create function public.long_signature_probe(uuid,text,text,boolean,uuid,boolean,timestamptz)
    returns void language sql security definer set search_path='' as 'select';
    revoke execute on function public.long_signature_probe(uuid,text,text,boolean,uuid,boolean,timestamptz) from public,anon;
    grant execute on function public.long_signature_probe(uuid,text,text,boolean,uuid,boolean,timestamptz) to authenticated;`);
  const findings = await findRlsBypasses(db);
  assert.deepEqual(findings, [
    {
      schema: "public",
      name: signature,
      kind: "function",
      role: "authenticated",
      problem: "EXECUTE",
    },
  ]);
});

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

  it("an EXECUTIVE member reads referenced raw objects like a VIEWER; unreferenced and writes stay closed", async (t) => {
    const { db, docs } = await setup(t);
    const object = await claim(db);
    await finish(db, object, docs[0].id);
    await db.exec(
      "insert into storage.buckets(id,name,public) values('bid-documents','bid-documents',false)",
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values('bid-documents',$1),('bid-documents','unreferenced')",
      [object.path],
    );
    await db.query(
      "insert into public.organizations(id,slug,name) values('0e000000-0000-0000-0000-000000000011','storage-test','시험')",
    );
    await db.query(
      "insert into public.memberships(org_id,user_id,org_role,sol_role) values('0e000000-0000-0000-0000-000000000011',$1,'member','EXECUTIVE')",
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

describe("documents job — 문서별 처리 리스·실패 기록·처리 대상(20261027000500)", () => {
  const ATTEMPT = [
    "a0000000-0000-4000-8000-000000000001",
    "a0000000-0000-4000-8000-000000000002",
    "a0000000-0000-4000-8000-000000000003",
  ];
  // 공고 하나 + revision 하나 + 첨부. 기본은 live·접수 중·마감 전·최신 revision 이다.
  async function notice(db, n, options = {}) {
    const bid = `b2d00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const rev = `be600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const {
      isDemo = false,
      status = "OPEN",
      deadline = "now()+interval '7 days'",
      latest = 1,
      names = ["공고서.pdf"],
    } = options;
    await db.query(
      `insert into public.bid_notices(id,source,notice_id,title,stage,status,source_url,content_hash,is_demo,deadline_at,latest_revision)
       values($1,'g2b-bid-notice',$2,'시험','NOTICE',$3,'https://www.g2b.go.kr/x','h',$4,${deadline},$5)`,
      [bid, `DOC-${n}`, status, isDemo, latest],
    );
    await db.query(
      "insert into public.bid_revisions(id,bid_id,revision,raw_payload,normalized,checksum) values($1,$2,1,'{}','{}','sum')",
      [rev, bid],
    );
    const docs = [];
    for (const name of names)
      docs.push(
        (
          await db.query(
            "insert into public.bid_documents(bid_id,revision_id,name,original_url) values($1,$2,$3,'https://www.g2b.go.kr/pn/a') returning id",
            [bid, rev, name],
          )
        ).rows[0].id,
      );
    return { bid, rev, docs };
  }
  const asWorker = (db) => db.exec("reset role; set role service_role");
  const call = async (db, sql, params) => (await db.query(sql, params)).rows[0].value;
  const claim = (db, id, attempt) =>
    call(db, "select public.claim_document_processing($1,$2,60) as value", [id, attempt]);
  const failDownload = (db, id, attempt, code = "HTTP_4XX") =>
    call(db, "select public.fail_document_download($1,$2,$3,'HTTP 404') as value", [
      id,
      attempt,
      code,
    ]);

  it("리스는 한 시도만 잡고, 끝난 리스는 다음 시도가 이어 받으며, 실패 기록은 리스를 가진 시도만 남긴다", async (t) => {
    const db = await migratedDb(t);
    const { docs } = await notice(db, 1, { names: ["공고서.pdf", "제안요청서.hwpx"] });
    await asWorker(db);
    const first = await claim(db, docs[0], ATTEMPT[0]);
    assert.equal(first.claimed, true);
    assert.equal(first.document.originalUrl, "https://www.g2b.go.kr/pn/a");
    const busy = await claim(db, docs[0], ATTEMPT[1]);
    assert.deepEqual([busy.claimed, busy.reason], [false, "BUSY"]);
    assert.equal(await failDownload(db, docs[0], ATTEMPT[1]), false);
    // 같은 시도는 기한을 늘린다.
    assert.equal((await claim(db, docs[0], ATTEMPT[0])).claimed, true);

    await db.exec("reset role");
    await db.query(
      "update public.bid_documents set processing_lease_until=now()-interval '1 second' where id=$1",
      [docs[0]],
    );
    await asWorker(db);
    assert.equal((await claim(db, docs[0], ATTEMPT[1])).claimed, true);
    assert.equal(await failDownload(db, docs[0], ATTEMPT[0]), false, "만료된 시도는 쓰지 못한다");
    await assert.rejects(failDownload(db, docs[0], ATTEMPT[1], "NOT_FOUND"), /invalid_code/);
    assert.equal(await failDownload(db, docs[0], ATTEMPT[1]), true);
    const failed = (
      await db.query(
        "select download_status,download_error_code,processing_attempt_id from public.bid_documents where id=$1",
        [docs[0]],
      )
    ).rows[0];
    assert.deepEqual(failed, {
      download_status: "FAILED",
      download_error_code: "HTTP_4XX",
      processing_attempt_id: null,
    });
    assert.equal((await claim(db, docs[0], ATTEMPT[2])).reason, "DONE");

    // 파싱 실패 기록은 다운로드 OK·파싱 대기 행에만 쓴다(파일 열은 시험용 값).
    await db.exec("reset role");
    await db.query(
      "update public.bid_documents set download_status='OK',object_key='raw/bids/x.hwpx',sha256=$2,size_bytes=1,parse_status='PENDING' where id=$1",
      [docs[1], "e".repeat(64)],
    );
    await asWorker(db);
    assert.equal((await claim(db, docs[1], ATTEMPT[0])).document.parseStatus, "PENDING");
    assert.equal(
      await call(
        db,
        "select public.fail_document_parse($1,$2,'UNSUPPORTED','UNSUPPORTED_FORMAT','none','PARSER_NOT_CONFIGURED:HWPX') as value",
        [docs[1], ATTEMPT[0]],
      ),
      true,
    );
    assert.deepEqual(
      (
        await db.query(
          "select parse_status,parse_error_code,parser_id,processing_lease_until from public.bid_documents where id=$1",
          [docs[1]],
        )
      ).rows[0],
      {
        parse_status: "UNSUPPORTED",
        parse_error_code: "UNSUPPORTED_FORMAT",
        parser_id: "none",
        processing_lease_until: null,
      },
    );
  });

  it("처리 대상은 최신 revision·접수 중·마감 전 실제 공고의 파서 형식 첨부가 남은 revision 이고, 공고당 상한을 채우면 빠진다", async (t) => {
    const db = await migratedDb(t);
    const open = await notice(db, 11, { names: ["공고서.pdf", "제안요청서.hwpx", "내역.xlsx"] });
    await notice(db, 12, { deadline: "now()-interval '1 hour'" });
    await notice(db, 13, { status: "CLOSED" });
    await notice(db, 14, { names: ["가격.xlsx", "첨부.zip"] });
    await notice(db, 15, { isDemo: true });
    await notice(db, 16, { latest: 2 });
    const amended = await notice(db, 17, { status: "AMENDED", deadline: "null" });
    await asWorker(db);
    const candidates = async (maxPerBid) =>
      (
        await db.query(
          "select revision_id from public.document_processing_candidates(false,null,100,$1)",
          [maxPerBid],
        )
      ).rows.map((row) => row.revision_id);
    assert.deepEqual((await candidates(3)).toSorted(), [open.rev, amended.rev].toSorted());

    assert.equal((await claim(db, open.docs[0], ATTEMPT[0])).claimed, true);
    assert.equal(await failDownload(db, open.docs[0], ATTEMPT[0]), true);
    assert.ok((await candidates(3)).includes(open.rev), "상한 전이면 남은 hwpx 로 다시 넣는다");
    assert.ok(!(await candidates(1)).includes(open.rev), "끝난 파서 형식 첨부가 상한을 채웠다");
  });

  it("화면 역할(authenticated·anon)은 리스·실패 기록·처리 대상 함수를 실행하지 못한다", async (t) => {
    const db = await migratedDb(t);
    const { docs } = await notice(db, 21);
    for (const role of ["authenticated", "anon"]) {
      await actAs(db, users[0], role);
      for (const [sql, params] of [
        ["select public.claim_document_processing($1,$2,60)", [docs[0], ATTEMPT[0]]],
        ["select public.fail_document_download($1,$2,'HTTP_4XX','x')", [docs[0], ATTEMPT[0]]],
        [
          "select public.fail_document_parse($1,$2,'FAILED','PARSER_ERROR','p','x')",
          [docs[0], ATTEMPT[0]],
        ],
        ["select public.release_document_processing($1,$2)", [docs[0], ATTEMPT[0]]],
        ["select * from public.document_processing_candidates(false,null,10,3)", []],
      ])
        await assert.rejects(db.query(sql, params), /permission denied/, `${role}: ${sql}`);
    }
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
  const INSIGHT_PAYLOAD = JSON.stringify({
    summary: "규칙 결과로 정리한 추천 분석",
    strengths: [],
    improvements: [],
    refs: [],
  });
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
    "recommendation_insights",
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
    // 분석 — 두 조직의 완료 run 하나씩과 자식 행 하나씩. 추천 분석은 규칙 결과로 닫힌 DONE 한 건(PENDING 은 시험이 넣는다).
    for (const [run, org, profile, requester] of [
      [RUN1, ORG1, PROFILE1, WHO.admin],
      [RUN2, ORG2, PROFILE2, WHO.outsider],
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
      await pglite.query(
        `insert into public.recommendation_insights (org_id, score_run_id, status, source, payload, fallback_reason, prompt_hash, requested_by, finished_at)
         values ($1, $2, 'DONE', 'TEMPLATE', $3, 'MODEL_UNAVAILABLE', 'p-insight', $4, now())`,
        [org, run, INSIGHT_PAYLOAD, requester],
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
  it("EXECUTIVE 역할 — 멤버십·초대에 저장되고 읽기 함수는 통과, 쓰기 정책은 막힌다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const EXEC = "00000000-0000-0000-0000-000000000008";
    await pglite.query("insert into auth.users values ($1, 'executive@example.invalid')", [EXEC]);
    await pglite.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'member', 'EXECUTIVE')",
      [ORG1, EXEC],
    );
    await pglite.query(
      "insert into public.invitations (org_id, email, org_role, sol_role) values ($1, 'exec-invite@example.invalid', 'member', 'EXECUTIVE')",
      [ORG1],
    );
    await rejectsWith(
      pglite.query(
        "insert into public.invitations (org_id, email, org_role, sol_role) values ($1, 'owner-invite@example.invalid', 'member', 'OWNER')",
        [ORG1],
      ),
      "invitations_sol_role_check",
    );
    await assert.rejects(
      pglite.query(
        "update public.memberships set sol_role = 'OWNER' where org_id = $1 and user_id = $2",
        [ORG1, EXEC],
      ),
      { code: "23514" },
    );

    await actAs(pglite, EXEC, "authenticated", "executive@example.invalid");
    // 읽기 함수는 역할이 없으면 빈 결과를 준다. EXECUTIVE 도 VIEWER 와 같은 결과를 받아야 한다.
    const reads = async () => [
      await rowsOf(pglite, "select * from public.latest_ingest_run('all')"),
      await rowsOf(pglite, "select * from public.procurement_source_health('all')"),
      await rowsOf(pglite, "select public.procurement_last_scheduled_ingest('all') as v"),
    ];
    const executiveReads = await reads();
    assert.ok(executiveReads[0].length > 0 && executiveReads[1].length > 0);
    await as(pglite, "viewer");
    assert.deepEqual(executiveReads, await reads());
    await actAs(pglite, EXEC, "authenticated", "executive@example.invalid");

    await assert.rejects(requestRun(pglite, ORG1, PROFILE1, "executive-run"), {
      code: "42501",
    });
    await assert.rejects(decide(pglite), { code: "42501" });
  });
  it("EXECUTIVE 는 결정·공고 프로젝트·회사 프로필을 쓰지 못하고, ADMIN 도 sources·public_history 열은 쓰지 못한다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const EXEC = "00000000-0000-0000-0000-000000000008";
    await pglite.query("insert into auth.users values ($1, 'executive@example.invalid')", [EXEC]);
    await pglite.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'member', 'EXECUTIVE')",
      [ORG1, EXEC],
    );
    await actAs(pglite, EXEC, "authenticated", "executive@example.invalid");
    // 결정: 열 권한은 열려 있으므로 RLS 정책이 막는다.
    await assert.rejects(decide(pglite), POLICY);
    // 공고 프로젝트는 직접 insert 가 아니라 open_bid_project 로만 만든다.
    await assert.rejects(
      pglite.query("select public.open_bid_project($1)", [REVIEW1]),
      /FORBIDDEN/,
    );
    // 회사 프로필: insert 열 권한은 (org_id, revision, name)에 열려 있다 → ADMIN 은 성공, EXECUTIVE 는 정책 거부.
    const insertProfile = (revision) =>
      pglite.query(
        "insert into public.company_profiles (org_id, revision, name) values ($1, $2, '개정 시험')",
        [ORG1, revision],
      );
    await assert.rejects(insertProfile(9), POLICY);

    await as(pglite, "admin");
    await insertProfile(10);
    // sources·public_history 열에는 insert 열 권한이 없어 ADMIN 도 권한 오류다.
    for (const column of ["sources", "public_history"])
      await assert.rejects(
        pglite.query(
          `insert into public.company_profiles (org_id, revision, name, ${column}) values ($1, 11, '관리자 개정', '[]')`,
          [ORG1],
        ),
        /permission denied/,
      );
  });
  it("company_profiles 의 sources·public_history 는 기본 빈 배열이고 배열이 아니면 거부한다", async (t) => {
    const pglite = await solDb(t);
    await asWorker(pglite);
    const [row] = await rowsOf(
      pglite,
      "insert into public.company_profiles (org_id, revision, name) values ($1, 2, '출처 시험') returning sources, public_history",
      [ORG1],
    );
    assert.deepEqual(row, { sources: [], public_history: [] });
    for (const column of ["sources", "public_history"])
      await assert.rejects(
        pglite.query(
          `insert into public.company_profiles (org_id, revision, name, ${column}) values ($1, 3, '출처 시험', '{}')`,
          [ORG1],
        ),
        { code: "23514" },
      );
  });
  it("public의 모든 일반 테이블에 RLS가 켜져 있다", async (t) => {
    const pglite = await migratedDb(t);
    const { rows } = await pglite.query(
      "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity",
    );
    assert.deepEqual(rows, []);
  });
  it("번역 누락 결과를 검토 플래그와 함께 마감하고 알 수 없는 플래그는 거절한다", async (t) => {
    const pglite = await solDb(t);
    const startedAt = "2026-10-22T00:00:00.000Z";
    await pglite.query("update public.score_runs set status='RUNNING', started_at=$2 where id=$1", [
      RUN1,
      startedAt,
    ]);
    const flags = ["TRANSLATION_INCOMPLETE", "KEV_UNAVAILABLE"];
    const result = await rowsOf(pglite, "select public.finish_score_run($1::jsonb) id", [
      JSON.stringify({
        score_run_id: RUN1,
        org_id: ORG1,
        attempt_started_at: startedAt,
        run: { status: "PARTIAL", review_flags: flags },
      }),
    ]);
    assert.equal(result[0].id, RUN1);
    assert.deepEqual(
      (
        await rowsOf(pglite, "select status, review_flags from public.score_runs where id=$1", [
          RUN1,
        ])
      )[0],
      { status: "PARTIAL", review_flags: flags },
    );
    await rejectsWith(
      pglite.query(
        "update public.score_runs set review_flags=array['UNRECOGNIZED_FLAG'] where id=$1",
        [RUN1],
      ),
      "score_runs_review_flags_check",
    );
  });
  it("ADR047 — 출처 사본을 한 기회로 묶어도 공고·분석·사람 결정 FK와 조직 격리를 보존한다", async (t) => {
    const pglite = await solDb(t);
    const opportunity = (
      await rowsOf(
        pglite,
        "select opportunity_id from public.opportunity_notice_links where bid_id=$1",
        [BID1],
      )
    )[0].opportunity_id;
    await pglite.query("select public.link_bid_opportunity($1,$2,'DUPLICATE',$3::jsonb)", [
      BID2,
      opportunity,
      JSON.stringify({ kind: "OFFICIAL_REFERENCE", reference: "verified-copy" }),
    ]);
    assert.equal(
      (
        await rowsOf(
          pglite,
          "select count(distinct opportunity_id)::int n from public.opportunity_notice_links where bid_id in ($1,$2)",
          [BID1, BID2],
        )
      )[0].n,
      1,
    );
    assert.equal(await countOf(pglite, "bid_notices"), 2);
    assert.equal(
      (await rowsOf(pglite, "select bid_id from public.score_runs where id=$1", [RUN1]))[0].bid_id,
      BID1,
    );
    assert.equal(
      (await rowsOf(pglite, "select bid_id from public.bid_reviews where id=$1", [REVIEW1]))[0]
        .bid_id,
      BID1,
    );
    await pglite.query(
      "insert into public.ingest_runs(source,run_mode,trigger,job_key,service_key,status,summary,params) values ('g2b','LIVE','SCHEDULED','private-job','g2b-bid-notice','SUCCEEDED','{\"created\":2}','{\"credential\":\"not-public\"}')",
    );
    await as(pglite, "viewer");
    assert.equal((await rowsOf(pglite, "select * from public.opportunity_notice_links")).length, 2);
    const visible = await rowsOf(pglite, "select * from public.opportunity_list_items");
    assert.equal(visible.length, 1);
    assert.equal(visible[0].bid_id, BID1);
    assert.equal(visible[0].source_count, 2);
    assert.equal(visible[0].analysis_id, RUN1);
    const health = await rowsOf(pglite, "select * from public.procurement_source_health('live')");
    assert.equal(health.length, 1);
    assert.equal(health[0].service_key, "g2b-bid-notice");
    assert.equal(JSON.stringify(health).includes("not-public"), false);
    assert.equal("params" in health[0], false);
    assert.equal(
      (await rowsOf(pglite, "select * from public.procurement_source_health('unknown')")).length,
      0,
    );
    const summary = (
      await rowsOf(pglite, "select public.procurement_summary($1,'demo') value", [ORG1])
    )[0].value;
    assert.equal(summary.totalOpportunities, 1);
    await asWorker(pglite);
    await pglite.query(
      "insert into public.ingest_runs(source,run_mode,trigger,job_key,service_key,status,started_at) values ('kepco','LIVE','SCHEDULED','kepco-safe-status','kepco-ebid-contract','PARTIAL',now()+interval '1 second')",
    );
    await as(pglite, "viewer");
    assert.equal(
      (await rowsOf(pglite, "select * from public.latest_ingest_run('live')"))[0].status,
      "PARTIAL",
    );
    await assert.rejects(
      pglite.query("select * from public.procurement_missing_relevance_revisions(100)"),
      /permission denied/,
    );
    await assert.rejects(
      pglite.query("select public.link_bid_opportunity($1,$2,'DUPLICATE','{}')", [
        BID2,
        opportunity,
      ]),
      /permission denied/,
    );
    await assert.rejects(pglite.query("select * from public.ingest_payloads"), /permission denied/);
    await as(pglite, "outsider");
    assert.equal(await countOf(pglite, "score_runs", "org_id=$1", [ORG1]), 0);
    assert.equal(
      (await rowsOf(pglite, "select analysis_id from public.opportunity_list_items"))[0]
        .analysis_id,
      RUN2,
    );
    await asWorker(pglite);
    await pglite.query(
      "insert into public.company_profiles(org_id,revision,name) values ($1,2,'새 기업 프로필')",
      [ORG1],
    );
    await as(pglite, "viewer");
    const invalidated = (
      await rowsOf(pglite, "select analysis_id,latest_decision from public.opportunity_list_items")
    )[0];
    assert.equal(invalidated.analysis_id, null);
    assert.equal(invalidated.latest_decision, null);
    await as(pglite, "operator");
    assert.equal(
      (await rowsOf(pglite, "select * from public.procurement_source_health('live')")).length,
      0,
    );
    await asWorker(pglite);
    await pglite.query(
      "insert into public.bid_notices(source,notice_id,title,stage,status,source_url,content_hash,is_demo) values ('kepco-ebid-contract','COM01:42','실제 전력 데이터 플랫폼','NOTICE','OPEN','https://bigdata.kepco.co.kr/','live-hash',false)",
    );
    const liveBid = (
      await rowsOf(pglite, "select id from public.bid_notices where source='kepco-ebid-contract'")
    )[0].id;
    await assert.rejects(
      pglite.query("select public.link_bid_opportunity($1,$2,'DUPLICATE',$3::jsonb)", [
        liveBid,
        opportunity,
        JSON.stringify({ kind: "OFFICIAL_REFERENCE", reference: "wrong-origin" }),
      ]),
      /origin mismatch/,
    );
  });
  it("ADR047 — 재분석·단계 연결·출처 충돌·재판정에도 현재 결과와 집계가 정확하다", async (t) => {
    const db = await solDb(t);
    const [queued] = await requestRun(db, ORG1, PROFILE1, "sol-v0.1.0");
    await as(db, "viewer");
    let row = (
      await rowsOf(db, "select * from public.opportunity_list_items where bid_id=$1", [BID1])
    )[0];
    assert.equal(row.analysis_id, RUN1);
    assert.equal(row.latest_run_id, queued.id);
    assert.equal(row.latest_run_status, "QUEUED");
    assert.equal(row.latest_decision, "BID");
    const before = (await rowsOf(db, "select public.procurement_dataset_version($1) v", [ORG1]))[0]
      .v;
    await asWorker(db);
    await db.query(
      "update public.score_runs set status='COMPLETED',score=90,recommendation='BID',recommendation_basis='RULES_ONLY',input_snapshot='{}',input_snapshot_hash='new-snapshot',finished_at=now() where id=$1",
      [queued.id],
    );
    await as(db, "viewer");
    row = (
      await rowsOf(db, "select * from public.opportunity_list_items where bid_id=$1", [BID1])
    )[0];
    assert.equal(row.sol_score, 90);
    assert.equal(row.latest_decision, "BID");
    assert.notEqual(
      (await rowsOf(db, "select public.procurement_dataset_version($1) v", [ORG1]))[0].v,
      before,
    );
    await asWorker(db);
    const [left, right] = [BID1, BID2].sort();
    for (const [hash, outcome, at] of [
      ["old", "CANDIDATE", "2026-10-20T00:00:00Z"],
      ["new", "CANDIDATE", "2026-10-20T01:00:00Z"],
    ]) {
      await db.query(
        "insert into public.notice_match_candidates(left_bid_id,right_bid_id,outcome,policy_version,input_hash,created_at) values ($1,$2,$3,$4,$5,$6)",
        [left, right, outcome, "match/v0.1", hash, at],
      );
    }
    let summary = (await rowsOf(db, "select public.procurement_summary($1,'demo') v", [ORG1]))[0].v;
    assert.equal(summary.potentialDuplicateCount, 1);
    await db.query(
      "insert into public.notice_match_candidates(left_bid_id,right_bid_id,outcome,policy_version,input_hash) values ($1,$2,'DISTINCT','match/v0.1','resolved')",
      [left, right],
    );
    summary = (await rowsOf(db, "select public.procurement_summary($1,'demo') v", [ORG1]))[0].v;
    assert.equal(summary.potentialDuplicateCount, 0);
    await db.query("update public.bid_notices set stage='PLAN' where id=$1", [BID2]);
    const early = (
      await rowsOf(
        db,
        "select opportunity_id from public.opportunity_notice_links where bid_id=$1",
        [BID2],
      )
    )[0].opportunity_id;
    await db.query("select public.link_bid_opportunity($1,$2,'STAGE_LINK',$3::jsonb)", [
      BID1,
      early,
      JSON.stringify({ kind: "OFFICIAL_REFERENCE", reference: "official-stage-reference" }),
    ]);
    await as(db, "viewer");
    row = (await rowsOf(db, "select * from public.opportunity_list_items"))[0];
    assert.equal(row.bid_id, BID1);
    assert.equal(row.stage, "NOTICE");
    summary = (await rowsOf(db, "select public.procurement_summary($1,'demo') v", [ORG1]))[0].v;
    assert.equal(summary.totalOpportunities, 1);
    assert.equal(summary.earlyCount, 0);
    assert.equal(summary.bidRecommended, 1);
    await asWorker(db);
    await db.query("update public.bid_notices set stage='NOTICE',status='CANCELLED' where id=$1", [
      BID2,
    ]);
    await as(db, "viewer");
    row = (await rowsOf(db, "select * from public.opportunity_list_items"))[0];
    assert.equal(row.source_conflict, true);
    assert.equal(row.sol_score, 90);
    summary = (await rowsOf(db, "select public.procurement_summary($1,'demo') v", [ORG1]))[0].v;
    assert.equal(summary.bidRecommended, 0);
  });
  it("B3 실수집 지표 — 진행 중 WATCH·기관별 공고 수는 조직과 출처(demo·live)를 섞지 않는다", async (t) => {
    const db = await solDb(t);
    const metrics = async (org, origin, limit = 5) =>
      (
        await rowsOf(db, "select public.procurement_live_metrics($1,$2,now(),$3) v", [
          org,
          origin,
          limit,
        ])
      )[0].v;
    // 시드 공고 두 건은 DEMO(기관 "시험기관")다. ORG1 의 demo 분석을 WATCH 로 바꿔 demo WATCH 를 하나 둔다.
    await asWorker(db);
    await db.query("update public.score_runs set recommendation='WATCH' where id=$1", [RUN1]);
    const live = [];
    for (const [index, agency] of ["실제기관A", "실제기관A", "실제기관B"].entries()) {
      const [bid] = await rowsOf(
        db,
        "insert into public.bid_notices(source,notice_id,title,agency,stage,status,source_url,content_hash,deadline_at,is_demo) values ('g2b-bid-notice',$1,'실제 공고','" +
          agency +
          "','NOTICE','OPEN','https://www.g2b.go.kr/live',$2,now()+interval '10 days',false) returning id",
        [`R25BK0000000${index}`, `live-hash-${index}`],
      );
      const [rev] = await rowsOf(
        db,
        "insert into public.bid_revisions(bid_id,revision,raw_payload,normalized,checksum) values ($1,1,'{\"pubPrcrmntClsfcNm\":\"정보시스템개발서비스\"}','{}',$2) returning id",
        [bid.id, `live-sum-${index}`],
      );
      live.push({ bid: bid.id, rev: rev.id });
    }
    // live WATCH: ORG1 은 첫 공고, ORG2 는 셋째 공고. 서로의 집계에 들어가면 안 된다.
    for (const [org, profile, target] of [
      [ORG1, PROFILE1, live[0]],
      [ORG2, PROFILE2, live[2]],
    ])
      await db.query(
        `insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
           run_mode, ai_provider, status, score, recommendation, recommendation_basis, input_snapshot, input_snapshot_hash)
         values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'LIVE', 'LOCAL', 'COMPLETED', 66, 'WATCH', 'RULES_ONLY', '{}', 'live-snap')`,
        [org, target.bid, target.rev, profile],
      );

    // 출처 미확인: is_demo=false 인데 저장된 source 가 데모 수집기(fixture)다. ORG1 의 WATCH 도 하나 둔다.
    // live 지표·live 요약에는 들어가지 않고 전체(all)에만 남는다.
    const [unverified] = await rowsOf(
      db,
      "insert into public.bid_notices(source,notice_id,title,agency,stage,status,source_url,content_hash,deadline_at,is_demo) values ('fixture','DEMO-2026-0099','출처 미확인 공고','확인안된기관','NOTICE','OPEN','https://fixture.invalid/0099','unverified-hash',now()+interval '10 days',false) returning id",
    );
    const [unverifiedRev] = await rowsOf(
      db,
      "insert into public.bid_revisions(bid_id,revision,raw_payload,normalized,checksum) values ($1,1,'{}','{}','unverified-sum') returning id",
      [unverified.id],
    );
    await db.query(
      `insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
         run_mode, ai_provider, status, score, recommendation, recommendation_basis, input_snapshot, input_snapshot_hash)
       values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'MOCK', 'MOCK', 'COMPLETED', 60, 'WATCH', 'RULES_ONLY', '{}', 'unverified-snap')`,
      [ORG1, unverified.id, unverifiedRev.id, PROFILE1],
    );

    await as(db, "viewer");
    const { generatedAt, ...liveMetrics } = await metrics(ORG1, "live");
    assert.equal(typeof generatedAt, "string");
    assert.deepEqual(liveMetrics, {
      origin: "live",
      activeWatch: 1,
      topAgencies: [
        { name: "실제기관A", count: 2 },
        { name: "실제기관B", count: 1 },
      ],
    });
    const demo = await metrics(ORG1, "demo");
    assert.equal(demo.activeWatch, 1);
    assert.deepEqual(demo.topAgencies, [{ name: "시험기관", count: 2 }]);
    // 전체는 데모·실제·출처 미확인을 모두 센다. 같은 수면 기관 이름 순이고 기관 수(2)로 자른다.
    const all = await metrics(ORG1, "all", 2);
    assert.equal(all.activeWatch, 3);
    assert.deepEqual(all.topAgencies, [
      { name: "시험기관", count: 2 },
      { name: "실제기관A", count: 2 },
    ]);
    // 대시보드 요약도 같은 live 범위다: 실제 공고 3건만 세고 출처 미확인 공고는 뺀다.
    const summaryOf = async (origin) =>
      (await rowsOf(db, "select public.procurement_summary($1,$2) v", [ORG1, origin]))[0].v;
    const liveSummary = await summaryOf("live");
    assert.equal(liveSummary.totalOpportunities, 3);
    assert.equal(liveSummary.portfolio.WATCH, 1);
    assert.equal((await summaryOf("demo")).totalOpportunities, 2);
    assert.equal((await summaryOf("all")).totalOpportunities, 6);

    // 다른 조직: 자기 조직의 live WATCH 만 세고, ORG1 을 넘기면 RLS 로 0건이다.
    await as(db, "outsider");
    assert.equal((await metrics(ORG2, "live")).activeWatch, 1);
    const leaked = await metrics(ORG1, "live");
    assert.equal(leaked.activeWatch, 0);
    assert.deepEqual(leaked.topAgencies, []);

    // 마감이 지나면 진행 중이 아니다.
    await asWorker(db);
    await db.query(
      "update public.bid_notices set deadline_at=now()-interval '1 hour' where id=$1",
      [live[0].bid],
    );
    await as(db, "viewer");
    assert.equal((await metrics(ORG1, "live")).activeWatch, 0);
  });
  it("B3 마지막 정기 수집 시각 — 업무 역할에게 출처별 SCHEDULED 시작 시각 하나만 준다", async (t) => {
    const db = await solDb(t);
    const lastScheduled = async (origin) =>
      (await rowsOf(db, "select public.procurement_last_scheduled_ingest($1) v", [origin]))[0].v;
    await asWorker(db);
    await db.query(
      `insert into public.ingest_runs(source,run_mode,trigger,job_key,service_key,status,started_at) values
         ('g2b','LIVE','SCHEDULED','scheduled-1','g2b-bid-notice','SUCCEEDED','2026-10-25T01:00:00Z'),
         ('g2b','LIVE','MANUAL','manual-1','g2b-bid-notice','SUCCEEDED','2026-10-25T02:00:00Z')`,
    );
    await as(db, "viewer");
    assert.equal((await lastScheduled("live")).toISOString(), "2026-10-25T01:00:00.000Z");
    assert.equal((await lastScheduled("all")).toISOString(), "2026-10-25T01:00:00.000Z");
    // 시드의 fixture run 은 DEMO 수집이라 demo 의 정기 수집은 없다.
    assert.equal(await lastScheduled("demo"), null);
    await as(db, "operator");
    assert.equal(await lastScheduled("live"), null);
    await asAnon(db);
    await assert.rejects(lastScheduled("live"), /permission denied/);
  });
  it("B2 origin 은 출처만 고른다 — org-01 VIEWER 는 demo·live·all 어디서도 org-02 의 분석·결정을 못 본다", async (t) => {
    const db = await solDb(t);
    // 시드: DEMO 공고 BID1 에 org-02 의 분석(RUN2, BID)과 결정(REVIEW2, WATCH)이 있다.
    // 실제 공고 하나를 더 두고 org-02 만 분석(WATCH)·결정(WATCH)한다.
    await asWorker(db);
    const [bid] = await rowsOf(
      db,
      "insert into public.bid_notices(source,notice_id,title,agency,stage,status,source_url,content_hash,deadline_at,is_demo) values ('g2b-bid-notice','R25BK00000099','실제 공고','실제기관C','NOTICE','OPEN','https://www.g2b.go.kr/live-99','live-hash-99',now()+interval '10 days',false) returning id",
    );
    const [rev] = await rowsOf(
      db,
      "insert into public.bid_revisions(bid_id,revision,raw_payload,normalized,checksum) values ($1,1,'{\"pubPrcrmntClsfcNm\":\"정보시스템개발서비스\"}','{}','live-sum-99') returning id",
      [bid.id],
    );
    const [run] = await rowsOf(
      db,
      `insert into public.score_runs (org_id, bid_id, revision_id, company_profile_id, profile_revision, algorithm_version,
         run_mode, ai_provider, status, score, recommendation, recommendation_basis, input_snapshot, input_snapshot_hash)
       values ($1, $2, $3, $4, 1, 'sol-v0.1.0', 'LIVE', 'LOCAL', 'COMPLETED', 66, 'WATCH', 'RULES_ONLY', '{}', 'live-snap-99') returning id`,
      [ORG2, bid.id, rev.id, PROFILE2],
    );
    const [review] = await rowsOf(
      db,
      "insert into public.bid_reviews (org_id, bid_id, revision_id, score_run_id, decision, reason) values ($1, $2, $3, $4, 'WATCH', '격리 시험 결정 — 다른 조직') returning id",
      [ORG2, bid.id, rev.id, run.id],
    );
    const hidden = [RUN2, REVIEW2, run.id, review.id];
    // 화면 목록의 출처 조건(web/server/opportunities/repo.ts filtered)과 같다. 조직 조건은 넣지 않는다(RLS 만).
    const ORIGIN_WHERE = {
      demo: "is_demo",
      live: "not is_demo and source<>'fixture'",
      all: "true",
    };
    await as(db, "viewer");
    for (const [origin, where] of Object.entries(ORIGIN_WHERE)) {
      const rows = await rowsOf(
        db,
        `select org_id,bid_id,analysis_id,latest_run_id,latest_decision,recommendation from public.opportunity_list_items where ${where}`,
      );
      assert.ok(rows.length > 0, origin);
      assert.ok(
        rows.every((row) => row.org_id === ORG1),
        origin,
      );
      const text = JSON.stringify(rows);
      for (const id of hidden) assert.equal(text.includes(id), false, `${origin} ${id}`);
      // BID1 은 org-01 자기 결정(BID)만, 나머지는 org-01 분석·결정이 없어 비어 있다.
      for (const row of rows)
        if (row.bid_id === BID1) assert.equal(row.latest_decision, "BID", origin);
        else {
          assert.equal(row.analysis_id, null, origin);
          assert.equal(row.latest_decision, null, origin);
        }
      const mine = (
        await rowsOf(db, "select public.procurement_summary($1,$2) v", [ORG1, origin])
      )[0].v;
      assert.equal(mine.portfolio.WATCH, 0, origin);
      const theirs = (
        await rowsOf(db, "select public.procurement_summary($1,$2) v", [ORG2, origin])
      )[0].v;
      assert.equal(theirs.totalOpportunities, 0, origin);
      const metricsOf = async (org) =>
        (await rowsOf(db, "select public.procurement_live_metrics($1,$2) v", [org, origin]))[0].v;
      assert.equal((await metricsOf(ORG1)).activeWatch, 0, origin);
      const theirMetrics = await metricsOf(ORG2);
      assert.equal(theirMetrics.activeWatch, 0, origin);
      assert.deepEqual(theirMetrics.topAgencies, [], origin);
    }
  });
  describe("IT 범위(ADR-069)", () => {
    it("나라장터 공식 분류·AI 연구·행사 제외·지능형 오탐·분류 없음을 판정한다", async (t) => {
      const db = await migratedDb(t);
      const cases = [
        [
          "g2b-bid-notice",
          false,
          "2027년 남북교류협력시스템 유지관리",
          "정보시스템유지관리서비스",
          "UNCLASSIFIED",
          true,
        ],
        [
          "g2b-bid-notice",
          false,
          "건설폐기물 처리용역",
          "건설폐기물처리서비스",
          "UNCLASSIFIED",
          false,
        ],
        [
          "g2b-bid-notice",
          false,
          "익산시 인공지능산업 기본계획 수립 연구용역",
          "기타연구조사서비스",
          "CANDIDATE",
          true,
        ],
        [
          "g2b-bid-notice",
          false,
          "CES 2027 AI 혁신 포럼 행사대행",
          "전시회기획및대행서비스",
          "CANDIDATE",
          false,
        ],
        [
          "g2b-bid-notice",
          false,
          "지능형교통시스템(ITS) 통합운영 연구",
          "기타연구조사서비스",
          "UNCLASSIFIED",
          false,
        ],
        ["g2b-bid-notice", false, "사전규격 정보화 사업", null, "RELEVANT", true],
        ["kepco-ebid-contract", false, "철탑 제작", null, "UNCLASSIFIED", false],
        ["kepco-ebid-contract", false, "배전 정보시스템 고도화", null, "CANDIDATE", true],
        ["fixture", true, "FX-01", null, "UNCLASSIFIED", true],
      ];
      for (const [source, isDemo, title, cls, state, expected] of cases) {
        const r = await db.query("select public.it_scope_of($1,$2,$3,$4,$5) v", [
          source,
          isDemo,
          title,
          cls,
          state,
        ]);
        assert.equal(r.rows[0].v, expected, title);
      }
    });
    it("fixture 공고는 늘 IT 범위다", async (t) => {
      // 시드의 데모 공고 두 건은 raw_payload 에 공식 분류가 없고 관련성 판정도 없다.
      const db = await solDb(t);
      await as(db, "viewer");
      const rows = await rowsOf(
        db,
        "select bid_id,it_scope,recommend_key from public.opportunity_list_items where is_demo",
      );
      assert.equal(rows.length, 2);
      assert.ok(rows.every((row) => row.it_scope === true));
      assert.equal(
        (
          await rowsOf(
            db,
            "select count(*)::int n from public.bid_notices b where b.is_demo and not public.it_scope(b)",
          )
        )[0].n,
        0,
      );
      assert.equal(
        (await rowsOf(db, "select public.procurement_summary($1,'demo') v", [ORG1]))[0].v
          .totalOpportunities,
        2,
      );
      // BID1 은 조직 분석(82점 BID)이 있어 분석됨(0), BID2 는 분석 안 됨(2) 묶음이다.
      const keyOf = Object.fromEntries(rows.map((row) => [row.bid_id, row.recommend_key]));
      assert.equal(keyOf[BID1][0], "0");
      assert.equal(keyOf[BID2][0], "2");
    });
    it("목록 뷰와 집계 함수는 IT 범위 밖 live 공고를 세지 않는다", async (t) => {
      const db = await solDb(t);
      await asWorker(db);
      const [itAgency, otherAgency] = await rowsOf(
        db,
        "insert into public.procurement_agencies(code_namespace,agency_code,name) values ('g2b','IT-A1','정보기관'),('g2b','IT-A2','건설기관') returning id,name",
      );
      const live = {};
      for (const [key, title, cls, agency] of [
        ["si", "통합 민원시스템 유지관리", "정보시스템유지관리서비스", itAgency],
        ["ai", "생성형 AI 기반 민원 분석 연구용역", "기타연구조사서비스", itAgency],
        ["other", "건설장비 임대", "건설장비임대서비스", otherAgency],
      ]) {
        const [bid] = await rowsOf(
          db,
          "insert into public.bid_notices(source,notice_id,title,agency,procuring_agency_id,stage,status,source_url,content_hash,deadline_at,is_demo) values ('g2b-bid-notice',$1,$2,$3,$4,'NOTICE','OPEN','https://www.g2b.go.kr/live',$5,now()+interval '10 days',false) returning id",
          [`R25BK-IT-${key}`, title, agency.name, agency.id, `it-hash-${key}`],
        );
        const [rev] = await rowsOf(
          db,
          "insert into public.bid_revisions(bid_id,revision,raw_payload,normalized,checksum) values ($1,1,$2,'{}',$3) returning id",
          [bid.id, JSON.stringify({ pubPrcrmntClsfcNm: cls }), `it-sum-${key}`],
        );
        live[key] = { bid: bid.id, rev: rev.id };
      }
      // 관련성 규칙은 분류를 못 찾으면 OTHER 를 저장한다. 공식 IT 분류가 있으면 판정과 분야는 공식 분류를 따른다.
      await db.query(
        "insert into public.bid_relevance_assessments(revision_id,policy_version,input_hash,state,categories) values ($1,'relevance-v0.1','h-si','LOW_RELEVANCE','{OTHER}')",
        [live.si.rev],
      );
      await as(db, "viewer");
      const rows = Object.fromEntries(
        (
          await rowsOf(
            db,
            "select bid_id,it_scope,categories,tags,relevance_rank from public.opportunity_list_items where bid_id in ($1,$2,$3)",
            [live.si.bid, live.ai.bid, live.other.bid],
          )
        ).map(({ bid_id, ...row }) => [bid_id, row]),
      );
      assert.deepEqual(rows[live.si.bid], {
        it_scope: true,
        categories: ["SI_SW"],
        tags: ["maintenance"],
        relevance_rank: 2,
      });
      assert.deepEqual(rows[live.ai.bid], {
        it_scope: true,
        categories: ["AI_AX"],
        tags: [],
        relevance_rank: 1,
      });
      assert.equal(rows[live.other.bid].it_scope, false);
      const summaryOf = async (origin) =>
        (await rowsOf(db, "select public.procurement_summary($1,$2) v", [ORG1, origin]))[0].v;
      assert.equal((await summaryOf("live")).totalOpportunities, 2);
      assert.equal((await summaryOf("all")).totalOpportunities, 4);
      const metrics = (
        await rowsOf(db, "select public.procurement_live_metrics($1,'live') v", [ORG1])
      )[0].v;
      assert.deepEqual(metrics.topAgencies, [{ name: "정보기관", count: 2 }]);
      assert.deepEqual(
        (
          await rowsOf(
            db,
            "select b.id from public.bid_notices b where not b.is_demo and public.it_scope(b) order by b.id",
          )
        ).map((row) => row.id),
        [live.si.bid, live.ai.bid].sort(),
      );
      const options = (await rowsOf(db, "select public.procurement_filter_options('live') v"))[0].v;
      assert.deepEqual(
        options.agencies.map((agency) => agency.name),
        ["정보기관"],
      );
    });
    it("공고 고르기 뷰 bid_list_items 의 it_scope 는 목록 뷰와 같고, 관심 뷰는 IT 밖 공고도 그 값으로 돌려준다 (20261029000400)", async (t) => {
      const db = await solDb(t);
      await asWorker(db);
      const live = {};
      for (const [key, cls] of [
        ["it", "정보시스템개발서비스"],
        ["other", "건설장비임대서비스"],
      ]) {
        const [bid] = await rowsOf(
          db,
          "insert into public.bid_notices(source,notice_id,title,agency,stage,status,source_url,content_hash,deadline_at,is_demo) values ('g2b-bid-notice',$1,'실제 공고','실제기관','NOTICE','OPEN','https://www.g2b.go.kr/live',$2,now()+interval '10 days',false) returning id",
          [`R25BK-PICK-${key}`, `pick-hash-${key}`],
        );
        await db.query(
          "insert into public.bid_revisions(bid_id,revision,raw_payload,normalized,checksum) values ($1,1,$2,'{}',$3)",
          [bid.id, JSON.stringify({ pubPrcrmntClsfcNm: cls }), `pick-sum-${key}`],
        );
        live[key] = bid.id;
      }
      await as(db, "admin");
      await db.query("insert into public.bid_watches (org_id,user_id,bid_id) values ($1,$2,$3)", [
        ORG1,
        WHO.admin,
        live.other,
      ]);
      const pick = Object.fromEntries(
        (await rowsOf(db, "select id,it_scope from public.bid_list_items")).map((row) => [
          row.id,
          row.it_scope,
        ]),
      );
      const list = Object.fromEntries(
        (
          await rowsOf(
            db,
            "select bid_id,it_scope from public.opportunity_list_items where org_id=$1",
            [ORG1],
          )
        ).map((row) => [row.bid_id, row.it_scope]),
      );
      assert.deepEqual(pick, list);
      assert.equal(pick[live.it], true);
      assert.equal(pick[live.other], false);
      assert.deepEqual(await rowsOf(db, "select id,it_scope from public.watched_bid_list_items"), [
        { id: live.other, it_scope: false },
      ]);
    });
    it("AI·SI 우선 묶음과 추천순 키가 정한 순서를 만든다", async (t) => {
      const db = await migratedDb(t);
      const [tiers] = await rowsOf(
        db,
        `select public.opportunity_priority_tier(array['AI_AX','SI_SW'],'x') ai_si,
           public.opportunity_priority_tier(array['SI_SW','AI_AX'],'x') si_ai,
           public.opportunity_priority_tier('{}'::text[],'생성형 AI 플랫폼') ai_title,
           public.opportunity_priority_tier(array['SI_SW'],'x') si,
           public.opportunity_priority_tier(array['CLOUD'],'x') cloud,
           public.opportunity_priority_tier(null,'x') none`,
      );
      assert.deepEqual(tiers, { ai_si: 1, si_ai: 1, ai_title: 1, si: 2, cloud: 3, none: 3 });
      const ordered = await rowsOf(
        db,
        `select label from (values
           ('미분석 10-20', null::numeric, null::text, null::timestamptz, '2026-10-20T00:00:00Z'::timestamptz),
           ('NO_BID 90', 90, 'NO_BID', '2026-11-05T00:00:00Z', '2026-10-01T00:00:00Z'),
           ('미분석 10-29', null, null, null, '2026-10-29T00:00:00Z'),
           ('WATCH 70', 70, 'WATCH', '2026-11-05T00:00:00Z', '2026-10-01T00:00:00Z'),
           ('BID 80', 80, 'BID', '2026-11-05T00:00:00Z', '2026-10-01T00:00:00Z'),
           ('BID 80 마감 임박', 80, 'BID', '2026-11-02T00:00:00Z', '2026-10-01T00:00:00Z')
         ) v(label,score,recommendation,deadline_at,published_at)
         order by public.opportunity_recommend_key(score,recommendation,deadline_at,published_at)`,
      );
      assert.deepEqual(
        ordered.map((row) => row.label),
        ["BID 80 마감 임박", "BID 80", "WATCH 70", "NO_BID 90", "미분석 10-29", "미분석 10-20"],
      );
    });
  });
  it("목록 버전 — 뷰를 계산하지 않고 목록에 보이는 변경마다 바뀐다(20261029000500)", async (t) => {
    const db = await solDb(t);
    const version = async () =>
      (await rowsOf(db, "select public.procurement_dataset_version($1) v", [ORG1]))[0].v;
    // viewer 를 org-02 에도 넣는다. 그러면 RLS 가 아니라 p_org_id 조건이 다른 조직의 변경을 버전에서 뺀다.
    await asWorker(db);
    await db.query(
      "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'member', 'VIEWER')",
      [ORG2, WHO.viewer],
    );
    await as(db, "viewer");
    const [src] = await rowsOf(
      db,
      "select prosrc from pg_proc where proname='procurement_dataset_version'",
    );
    // 원인 재발 방지: 뷰 전체 해시는 운영 3,309건에서 2.6초가 걸렸다.
    assert.doesNotMatch(src.prosrc, /opportunity_list_items/);
    let previous = await version();
    assert.equal(await version(), previous, "바뀐 것이 없으면 같다");
    for (const [label, sql, params, changes] of [
      [
        "공고 갱신",
        "update public.bid_notices set title=title||' (정정)' where id=$1",
        [BID1],
        true,
      ],
      [
        "관련성 재판정",
        "insert into public.bid_relevance_assessments(revision_id,policy_version,input_hash,state,categories) values ($1,'relevance-v0.1','h-version','RELEVANT','{SI_SW}')",
        [REV1],
        true,
      ],
      [
        "사람 결정",
        "insert into public.bid_reviews(org_id,bid_id,revision_id,decision,reason,decided_at) values($1,$2,$3,'WATCH','목록 버전 시험 결정',now()+interval '1 second')",
        [ORG1, BID1, REV1],
        true,
      ],
      [
        "다른 조직 분석 변경",
        "update public.score_runs set status='FAILED' where id=$1 and org_id=$2",
        [RUN2, ORG2],
        false,
      ],
      [
        "다른 조직 결정",
        "insert into public.bid_reviews(org_id,bid_id,revision_id,decision,reason,decided_at) values($1,$2,$3,'WATCH','다른 조직 목록 버전 시험 결정',now()+interval '2 seconds')",
        [ORG2, BID1, REV1],
        false,
      ],
    ]) {
      await asWorker(db);
      assert.equal((await db.query(sql, params)).affectedRows, 1, label);
      await as(db, "viewer");
      const next = await version();
      if (changes) assert.notEqual(next, previous, label);
      else assert.equal(next, previous, label);
      previous = next;
    }
  });
  it("IT 범위 판정·정렬 함수는 목록 뷰에 풀려 들어가고, 집계는 공고마다 it_scope(b) 를 부르지 않는다(20261030000100)", async (t) => {
    const db = await solDb(t);
    await as(db, "viewer");
    // 함수 호출로 남으면 운영 3,324건에서 165ms, 풀려 들어가면 11ms 였다.
    const plan = (
      await rowsOf(
        db,
        "explain (verbose, costs off) select it_scope,relevance_rank,recommend_key,categories from public.opportunity_list_items",
      )
    )
      .map((row) => row["QUERY PLAN"])
      .join("\n");
    for (const name of [
      "it_scope_of",
      "it_scope_ai_title",
      "it_scope_it_class",
      "opportunity_priority_tier",
      "opportunity_recommend_key",
    ])
      assert.doesNotMatch(plan, new RegExp(name), name);
    // 공고마다 it_scope(b) 를 부르면 운영에서 중복 후보 265ms, 필터 선택지 1,729ms 였다.
    for (const { proname, prosrc } of await rowsOf(
      db,
      "select proname,prosrc from pg_proc where proname in ('procurement_summary','procurement_filter_options')",
    ))
      assert.doesNotMatch(prosrc, /public\.it_scope\(/, proname);
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
  it("운영자(profiles.is_admin)는 멤버가 아닌 조직의 SOL 표를 하나도 읽지 못한다 — 조직 표 열 개와 운영 표 셋 모두 0행이고 정책 도우미도 빈 목록이다", async (t) => {
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
  it("로그아웃한 사람(anon)은 SOL 표 열아홉 개를 읽지도 쓰지도 못하고 정책 도우미 my_sol_org_ids 도 부르지 못한다 — 모두 권한 오류", async (t) => {
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
  it("N2 audits changed roles and renewed invitations once, retaining project actions", async (t) => {
    const db = await solDb(t);
    await as(db, "admin");
    const setRole = () =>
      db.query("update public.memberships set sol_role='ANALYST' where org_id=$1 and user_id=$2", [
        ORG1,
        WHO.viewer,
      ]);
    await setRole();
    await setRole();
    await db.query(
      "insert into public.invitations(org_id,email,org_role,sol_role) values($1,'audit-invite@example.invalid','member','VIEWER')",
      [ORG1],
    );
    const renew = () =>
      db.query(
        "update public.invitations set sol_role='SALES' where org_id=$1 and email='audit-invite@example.invalid'",
        [ORG1],
      );
    await renew();
    await renew();
    const changes = await rowsOf(
      db,
      "select action,before_after from public.audit_logs where (action='USER_ROLE_CHANGE' and target_id=$1) or (action='USER_INVITE' and before_after->'before'->>'solRole'='VIEWER') order by action",
      [WHO.viewer],
    );
    assert.deepEqual(
      changes.map((row) => [
        row.action,
        row.before_after.before.solRole,
        row.before_after.after.solRole,
      ]),
      [
        ["USER_INVITE", "VIEWER", "SALES"],
        ["USER_ROLE_CHANGE", "VIEWER", "ANALYST"],
      ],
    );
    await as(db, "outsider");
    assert.equal(await countOf(db, "audit_logs", "action='USER_ROLE_CHANGE'"), 0);
    await asWorker(db);
    const [{ definition }] = await rowsOf(
      db,
      "select pg_get_constraintdef(oid) as definition from pg_constraint where conname='audit_logs_action_check'",
    );
    for (const action of ["PROJECT_OPEN", "PROJECT_STATUS_CHANGE", "PROJECT_RESULT_RECORD"])
      assert.ok(definition.includes(action), action);
    const [{ membership, invitation }] = await rowsOf(
      db,
      "select has_function_privilege('authenticated','public.log_membership_sol_role_audit()','EXECUTE') or has_function_privilege('anon','public.log_membership_sol_role_audit()','EXECUTE') as membership, has_function_privilege('authenticated','public.log_invitation_sol_role_audit()','EXECUTE') or has_function_privilege('anon','public.log_invitation_sol_role_audit()','EXECUTE') as invitation",
    );
    assert.deepEqual({ membership, invitation }, { membership: false, invitation: false });
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
  describe("N3 관심 공고와 마감 알림", () => {
    const addWatch = (db, org, user) =>
      db.query(
        "insert into public.bid_watches (org_id,user_id,bid_id) values ($1,$2,$3) on conflict do nothing",
        [org, user, BID1],
      );
    it("본인 목록·사업기회 공고 연결·조직별 관심 수와 중복 등록을 보장한다", async (t) => {
      const db = await solDb(t);
      await as(db, "admin");
      await addWatch(db, ORG1, WHO.admin);
      await addWatch(db, ORG1, WHO.admin);
      assert.equal(await countOf(db, "bid_watches"), 1);
      assert.deepEqual(
        (
          await rowsOf(
            db,
            "select bid_id from public.watched_opportunity_list_items where org_id=$1",
            [ORG1],
          )
        ).map((r) => r.bid_id),
        [BID1],
      );
      await as(db, "sales");
      assert.equal(await countOf(db, "bid_watches"), 0);
      assert.equal(await countOf(db, "watched_opportunity_list_items"), 0);
      await db.query("delete from public.bid_watches");
      await addWatch(db, ORG1, WHO.sales);
      assert.equal((await rowsOf(db, "select public.bid_watch_count($1) n", [BID1]))[0].n, 2);
      await as(db, "outsider");
      assert.equal(await countOf(db, "bid_watches"), 0);
      await addWatch(db, ORG2, WHO.outsider);
      assert.equal((await rowsOf(db, "select public.bid_watch_count($1) n", [BID1]))[0].n, 1);
      await as(db, "admin");
      assert.equal(await countOf(db, "bid_watches"), 1);
      await db.query("delete from public.bid_watches");
      assert.equal(await countOf(db, "bid_watches"), 0);
    });
    it("다른 사용자·조직으로 관심 등록할 수 없고 비회원은 조회할 수 없다", async (t) => {
      const db = await solDb(t);
      await as(db, "sales");
      await assert.rejects(addWatch(db, ORG1, WHO.admin), POLICY);
      await assert.rejects(addWatch(db, ORG2, WHO.sales), POLICY);
      await as(db, "operator");
      assert.equal(await countOf(db, "bid_watches"), 0);
      await asAnon(db);
      await assert.rejects(db.query("select * from public.bid_watches"), PERMISSION);
    });
    it("D-3·D-1 09시 이후 담당자와 관심 등록자에게 중복 없이 보내고 화면 역할 실행은 거부한다", async (t) => {
      const db = await solDb(t);
      await asWorker(db);
      await db.query(
        "update public.bid_notices set deadline_at='2026-10-25T09:00:00Z' where id=$1",
        [BID1],
      );
      await db.query(
        "insert into public.bid_reviews (org_id,bid_id,revision_id,decision,reason,assignee_id,decided_at) values ($1,$2,$3,'BID','마감 알림의 담당자와 관심 중복 검증',$4,now()+interval '1 minute')",
        [ORG1, BID1, REV1, WHO.admin],
      );
      await addWatch(db, ORG1, WHO.admin);
      await addWatch(db, ORG1, WHO.sales);
      const send = async (now) => {
        await asWorker(db);
        await db.query("select set_config('request.jwt.claims', $1, false)", [
          JSON.stringify({ role: "service_role" }),
        ]);
        return (
          await rowsOf(db, "select public.send_deadline_reminders($1::timestamptz) n", [now])
        )[0].n;
      };
      assert.equal(await send("2026-10-21T23:59:59Z"), 0);
      assert.equal(await send("2026-10-22T00:00:00Z"), 2);
      assert.equal(await send("2026-10-22T00:05:00Z"), 0);
      assert.equal(await send("2026-10-23T00:00:00Z"), 0);
      assert.equal(await send("2026-10-24T00:00:00Z"), 2);
      await as(db, "sales");
      assert.equal(await countOf(db, "notifications", "type='DEADLINE_APPROACHING'"), 2);
      await assert.rejects(
        db.query("select public.send_deadline_reminders('2026-10-24T00:05:00Z')"),
        /permission denied for function/,
      );
    });
  });

  describe("추천 분석 요청 (20261029000100)", () => {
    const EXEC = "00000000-0000-0000-0000-000000000008";
    const requestInsight = (db, fields = {}) => {
      const row = { org_id: ORG1, score_run_id: RUN1, ...fields };
      const columns = Object.keys(row);
      const values = Object.values(row);
      return rowsOf(
        db,
        `insert into public.recommendation_insights (${columns.join(", ")}) values (${values.map((_, i) => `$${i + 1}`).join(", ")}) returning id, status, requested_by`,
        values,
      );
    };
    // worker(service role) 의 마감. PENDING 행만 바꾼다.
    const close = async (db, id, set) => {
      await asWorker(db);
      return (
        await db.query(
          `update public.recommendation_insights set ${set} where id = $1 and status = 'PENDING'`,
          [id],
        )
      ).affectedRows;
    };
    it("ADMIN·SALES·ANALYST 만 자기 조직의 완료 run 에 PENDING 으로 넣는다 — EXECUTIVE·VIEWER·다른 조직·QUEUED run 은 정책 오류, 요청자·상태·결과 열과 고치기·지우기는 권한 오류", async (t) => {
      const db = await solDb(t);
      await db.query("insert into auth.users values ($1, 'executive@example.invalid')", [EXEC]);
      await db.query(
        "insert into public.memberships (org_id, user_id, org_role, sol_role) values ($1, $2, 'member', 'EXECUTIVE')",
        [ORG1, EXEC],
      );
      await as(db, "admin");
      const [queued] = await requestRun(db, ORG1, PROFILE1, "sol-v0.1.9");

      await as(db, "analyst");
      assert.deepEqual(
        (await requestInsight(db)).map(({ status, requested_by }) => ({ status, requested_by })),
        [{ status: "PENDING", requested_by: WHO.analyst }],
      );
      await assert.rejects(requestInsight(db, { score_run_id: queued.id }), POLICY, "QUEUED run");
      await assert.rejects(
        requestInsight(db, { org_id: ORG2, score_run_id: RUN2 }),
        POLICY,
        "다른 조직",
      );
      for (const fields of [
        { requested_by: WHO.admin },
        { status: "DONE" },
        { payload: INSIGHT_PAYLOAD },
      ])
        await assert.rejects(
          requestInsight(db, fields),
          /permission denied for table recommendation_insights/,
          JSON.stringify(fields),
        );
      await as(db, "viewer");
      await assert.rejects(requestInsight(db), POLICY, "VIEWER");
      await actAs(db, EXEC, "authenticated", "executive@example.invalid");
      await assert.rejects(requestInsight(db), POLICY, "EXECUTIVE");
      // 읽기 전용 역할도 결과는 읽는다.
      assert.equal(await countOf(db, "recommendation_insights"), 2);
      await as(db, "admin");
      for (const sql of [
        "update public.recommendation_insights set status = 'FAILED'",
        "delete from public.recommendation_insights",
      ])
        await assert.rejects(
          db.query(sql),
          /permission denied for table recommendation_insights/,
          sql,
        );
    });
    it("같은 run 의 PENDING 은 하나뿐이다 — 두 번째 요청은 유일 위반, worker 가 FAILED 로 닫은 뒤에는 새 PENDING 을 넣는다", async (t) => {
      const db = await solDb(t);
      await as(db, "sales");
      const [first] = await requestInsight(db);
      await as(db, "analyst");
      await assert.rejects(requestInsight(db), (error) => {
        assert.equal(error.code, "23505");
        assert.match(error.message, /recommendation_insights_one_pending/);
        return true;
      });
      assert.equal(
        await close(
          db,
          first.id,
          "status = 'FAILED', error_code = 'GATEWAY_UNAVAILABLE', finished_at = now()",
        ),
        1,
      );
      await as(db, "analyst");
      const [second] = await requestInsight(db);
      assert.notEqual(second.id, first.id);
      assert.deepEqual(
        (
          await rowsOf(
            db,
            "select status from public.recommendation_insights where score_run_id = $1 order by created_at, status",
            [RUN1],
          )
        ).map((row) => row.status),
        ["DONE", "FAILED", "PENDING"],
      );
    });
    it("상태 check — worker 가 써도 DONE 은 출처·내용·마감 시각, FAILED 는 오류 코드가 있어야 하고 대체 이유는 TEMPLATE 에만 붙는다", async (t) => {
      const db = await solDb(t);
      await as(db, "analyst");
      const [{ id }] = await requestInsight(db);
      const STATE = "recommendation_insights_state_check";
      for (const [set, constraint] of [
        ["status = 'DONE', source = 'MODEL', finished_at = now()", STATE],
        ["status = 'FAILED', finished_at = now()", STATE],
        [
          `status = 'DONE', source = 'MODEL', payload = '${INSIGHT_PAYLOAD}', fallback_reason = 'INVALID_OUTPUT', finished_at = now()`,
          "recommendation_insights_fallback_reason_check",
        ],
        [
          "status = 'FAILED', error_code = 'TIMEOUT', finished_at = now()",
          "recommendation_insights_error_code_check",
        ],
      ])
        await rejectsWith(close(db, id, set), constraint, set);
      assert.equal(
        await close(
          db,
          id,
          `status = 'DONE', source = 'MODEL', payload = '${INSIGHT_PAYLOAD}', model_name = 'qwen', prompt_hash = 'p-1', finished_at = now()`,
        ),
        1,
      );
      // 닫힌 행은 다시 닫히지 않는다.
      assert.equal(
        await close(db, id, "status = 'FAILED', error_code = 'STALE', finished_at = now()"),
        0,
      );
    });
    it("모델 설명(DONE·MODEL)이 있는 run 에는 화면 역할이 PENDING 을 직접 넣지 못한다 — DONE·TEMPLATE(INJECTION_SUSPECTED 포함)·FAILED 뒤에는 넣는다 (20261029000200)", async (t) => {
      const db = await solDb(t);
      // 시드의 DONE·TEMPLATE 뒤.
      await as(db, "analyst");
      const [first] = await requestInsight(db);
      assert.equal(
        await close(
          db,
          first.id,
          `status = 'DONE', source = 'TEMPLATE', payload = '${INSIGHT_PAYLOAD}', fallback_reason = 'INJECTION_SUSPECTED', prompt_hash = 'p-2', finished_at = now()`,
        ),
        1,
      );
      await as(db, "sales");
      const [second] = await requestInsight(db);
      assert.equal(
        await close(
          db,
          second.id,
          "status = 'FAILED', error_code = 'GATEWAY_UNAVAILABLE', finished_at = now()",
        ),
        1,
      );
      await as(db, "admin");
      const [third] = await requestInsight(db);
      assert.equal(
        await close(
          db,
          third.id,
          `status = 'DONE', source = 'MODEL', payload = '${INSIGHT_PAYLOAD}', model_name = 'qwen', prompt_hash = 'p-3', finished_at = now()`,
        ),
        1,
      );
      // 정책이 같은 표를 읽으면 재귀라 제외 제약이 막는다(23P01).
      for (const who of ["admin", "sales", "analyst"]) {
        await as(db, who);
        await assert.rejects(requestInsight(db), (error) => {
          assert.equal(error.code, "23P01", who);
          assert.match(error.message, /recommendation_insights_pending_or_model_once/);
          return true;
        });
      }
    });
  });

  describe("입찰 프로젝트 — 핵심 저장·권한·원자성", () => {
    const openProject = async (db) =>
      (await rowsOf(db, "select * from public.open_bid_project($1)", [REVIEW1]))[0].project_id;
    it("BID만 생성·중복 방지·다른 조직 격리·체크리스트 ADMIN SALES 쓰기", async (t) => {
      const db = await solDb(t);
      await as(db, "outsider");
      await assert.rejects(db.query("select public.open_bid_project($1)", [REVIEW2]), /FORBIDDEN/);
      await asWorker(db);
      await db.query("update public.memberships set sol_role='SALES' where org_id=$1", [ORG2]);
      await as(db, "outsider");
      await assert.rejects(
        db.query("select public.open_bid_project($1)", [REVIEW2]),
        /PROJECT_REQUIRES_BID_DECISION/,
      );
      await as(db, "sales");
      const id = await openProject(db);
      await assert.rejects(openProject(db), /PROJECT_ALREADY_OPEN/);
      const item = (
        await rowsOf(
          db,
          "insert into public.tasks(org_id,bid_project_id,title) values($1,$2,'제출 서류') returning id",
          [ORG1, id],
        )
      )[0].id;
      await as(db, "admin");
      await db.query("update public.tasks set status='done' where id=$1", [item]);
      await as(db, "viewer");
      assert.equal(
        (await rowsOf(db, "update public.tasks set status='todo' where id=$1 returning id", [item]))
          .length,
        0,
      );
      await assert.rejects(
        db.query("insert into public.tasks(org_id,bid_project_id,title) values($1,$2,'거절')", [
          ORG1,
          id,
        ]),
        /row-level security/,
      );
      await as(db, "outsider");
      assert.equal(
        (await rowsOf(db, "select id from public.bid_projects where id=$1", [id])).length,
        0,
      );
      await assert.rejects(
        db.query("select public.patch_bid_project($1,'SUBMITTED')", [id]),
        /NOT_FOUND/,
      );
    });
    it("혼합 PATCH 거절은 상태·담당자·마감·이력·감사를 그대로 보존하고 WATCH는 전진만 막는다", async (t) => {
      const db = await solDb(t);
      await as(db, "sales");
      const id = await openProject(db);
      const state = async () => ({
        project: (
          await rowsOf(
            db,
            "select status,owner_id,submission_due_override from public.bid_projects where id=$1",
            [id],
          )
        )[0],
        events: await countOf(db, "bid_project_events", "bid_project_id=$1", [id]),
        audits: await countOf(db, "audit_logs", "target_id=$1", [id]),
      });
      const before = await state();
      await assert.rejects(
        db.query("select public.patch_bid_project($1,'SUBMITTED',null,true,$2,true,now())", [
          id,
          WHO.outsider,
        ]),
        /OWNER_NOT_MEMBER/,
      );
      assert.deepEqual(await state(), before);
      // Constraint failure occurs AFTER the nested status/event/audit RPC and proves rollback.
      await assert.rejects(
        db.query("select public.patch_bid_project($1,'SUBMITTED',$2,true,null,true,now())", [
          id,
          "x".repeat(501),
        ]),
        /check constraint/,
      );
      assert.deepEqual(await state(), before);
      await asWorker(db);
      await db.query(
        "insert into public.bid_reviews(org_id,bid_id,revision_id,decision,reason,decided_at) values($1,$2,$3,'WATCH','최신 결정 재검토 기록입니다',now()+interval '1 second')",
        [ORG1, BID1, REV1],
      );
      await as(db, "sales");
      await assert.rejects(
        db.query("select public.patch_bid_project($1,'SUBMITTED',null,true,null,true,now())", [id]),
        /LATEST_DECISION_NOT_BID/,
      );
      assert.deepEqual(await state(), before);
      await db.query("select public.patch_bid_project($1,'CLOSED')", [id]);
      assert.equal((await state()).project.status, "CLOSED");
    });
  });

  describe("N4b 직원 추가·이동·퇴사 (20261024000400)", () => {
    const GROUP1 = "d0000000-0000-0000-0000-000000000012";
    const TEAM2 = "d0000000-0000-0000-0000-000000000013";
    const ORG2_TEAM = "d0000000-0000-0000-0000-000000000014";
    const TITLE2 = "d0000000-0000-0000-0000-000000000022";
    const MISSING_TITLE = "d0000000-0000-0000-0000-000000000029";
    const create = (db, org, name, department = DEPT1, title = TITLE1, email = null) =>
      db.query("select public.create_team_member($1,$2,$3,$4,$5) as m", [
        org,
        name,
        department,
        title,
        email,
      ]);
    const update = (db, id, department = null, title = null, status = null) =>
      db.query("select public.update_team_member($1,$2,$3,$4) as m", [
        id,
        department,
        title,
        status,
      ]);
    const editDb = async (t) => {
      const db = await solDb(t);
      await asWorker(db);
      await db.query(
        `insert into public.departments (id, org_id, code, name, kind, source_count, target_count, is_demo) values
           ($1, $4, 'SOL-G001', '시험그룹', 'GROUP', null, null, true),
           ($2, $4, 'SOL-D002', '이동부서', 'TEAM', 1, 1, true),
           ($3, $5, 'OTHER-D001', '다른부서', 'TEAM', 1, 1, true)`,
        [GROUP1, TEAM2, ORG2_TEAM, ORG1, ORG2],
      );
      await db.query(
        "insert into public.job_titles (id, org_id, code, label, sort_order) values ($1, $2, 'SOL-J004', '선임', 4)",
        [TITLE2, ORG1],
      );
      await db.query(
        "insert into public.team_member_scoring (member_id, org_id, role) values ($1, $2, 'PM')",
        [MEMBER1, ORG1],
      );
      return db;
    };
    const audits = async (db) => {
      await asWorker(db);
      return rowsOf(
        db,
        "select action, actor_id, target_id, before_after from public.audit_logs where action like 'TEAM_MEMBER_%' order by created_at, id",
      );
    };

    it("ADMIN 만 직원을 추가한다 — SOL-N 번호·비데모·재직과 감사 1건, 다른 역할 FORBIDDEN·다른 조직 NOT_FOUND·표 직접 쓰기는 권한 오류", async (t) => {
      const db = await editDb(t);
      for (const who of ["sales", "analyst", "viewer"]) {
        await as(db, who);
        await rejectsWith(create(db, ORG1, "새직원"), "FORBIDDEN", who);
      }
      await as(db, "outsider");
      await rejectsWith(create(db, ORG1, "새직원"), "NOT_FOUND", "다른 조직");
      await asAnon(db);
      await assert.rejects(create(db, ORG1, "새직원"), /permission denied for function/);
      await as(db, "admin");
      await assert.rejects(
        db.query(
          "insert into public.team_members (org_id, person_code, name, department_id, job_title_id, is_demo) values ($1, 'SOL-N0099', '직접', $2, $3, false)",
          [ORG1, DEPT1, TITLE1],
        ),
        PERMISSION,
      );
      await rejectsWith(create(db, ORG1, "새직원", ORG2_TEAM), "DEPARTMENT_NOT_FOUND");
      await rejectsWith(create(db, ORG1, "새직원", DEPT1, MISSING_TITLE), "JOB_TITLE_NOT_FOUND");
      await rejectsWith(create(db, ORG1, " "), "INVALID_INPUT");
      const created = (
        await create(db, ORG1, " Lee Gwanghui ", DEPT1, TITLE1, "gwanghui@solideos.com")
      ).rows[0].m;
      assert.equal(created.personCode, "SOL-N0001");
      assert.equal(created.name, "Lee Gwanghui");
      assert.equal(created.isDemo, false);
      assert.equal(created.employmentStatus, "ACTIVE");
      await rejectsWith(
        create(db, ORG1, "다른사람", DEPT1, TITLE1, "gwanghui@solideos.com"),
        "EMAIL_TAKEN",
      );
      // 실패한 시도는 행·감사를 남기지 않는다.
      await asWorker(db);
      assert.equal(await countOf(db, "team_members", "org_id = $1", [ORG1]), 2);
      const logged = await audits(db);
      assert.equal(logged.length, 1);
      assert.equal(logged[0].action, "TEAM_MEMBER_CREATE");
      assert.equal(logged[0].actor_id, WHO.admin);
      assert.equal(logged[0].target_id, created.id);
      assert.equal(logged[0].before_after.after.personCode, "SOL-N0001");
    });

    it("ADMIN 만 부서·직급을 옮기고 퇴사 처리한다 — 바뀔 때마다 감사, 같은 값은 감사 없음, 다른 역할 FORBIDDEN·다른 조직 NOT_FOUND", async (t) => {
      const db = await editDb(t);
      for (const who of ["sales", "analyst", "viewer"]) {
        await as(db, who);
        await rejectsWith(update(db, MEMBER1, TEAM2), "FORBIDDEN", who);
      }
      await as(db, "outsider");
      await rejectsWith(update(db, MEMBER1, TEAM2), "NOT_FOUND", "다른 조직");
      await as(db, "admin");
      await assert.rejects(
        db.query("update public.team_members set employment_status = 'LEFT' where id = $1", [
          MEMBER1,
        ]),
        PERMISSION,
      );
      await rejectsWith(update(db, MEMBER1, ORG2_TEAM), "DEPARTMENT_NOT_FOUND");
      await rejectsWith(update(db, MEMBER1, null, null, "RETIRED"), "INVALID_INPUT");
      const moved = (await update(db, MEMBER1, TEAM2, TITLE2)).rows[0].m;
      assert.deepEqual([moved.departmentId, moved.jobTitleId], [TEAM2, TITLE2]);
      await update(db, MEMBER1, TEAM2);
      const left = (await update(db, MEMBER1, null, null, "LEFT")).rows[0].m;
      assert.equal(left.employmentStatus, "LEFT");
      const logged = await audits(db);
      assert.deepEqual(
        logged.map((row) => [row.action, row.actor_id, row.target_id]),
        [
          ["TEAM_MEMBER_UPDATE", WHO.admin, MEMBER1],
          ["TEAM_MEMBER_UPDATE", WHO.admin, MEMBER1],
        ],
      );
      assert.deepEqual(logged[0].before_after, {
        before: { departmentId: DEPT1, jobTitleId: TITLE1, employmentStatus: "ACTIVE" },
        after: { departmentId: TEAM2, jobTitleId: TITLE2, employmentStatus: "ACTIVE" },
      });
      assert.equal(logged[1].before_after.after.employmentStatus, "LEFT");
    });

    it("본부·그룹에도 직원을 직접 둔다(20261028000100) — 추가·이동 모두 받고 감사가 남는다", async (t) => {
      const db = await editDb(t);
      await as(db, "admin");
      const created = (await create(db, ORG1, "그룹직원", GROUP1)).rows[0].m;
      assert.equal(created.departmentId, GROUP1);
      const moved = (await update(db, MEMBER1, GROUP1)).rows[0].m;
      assert.equal(moved.departmentId, GROUP1);
      const logged = await audits(db);
      assert.deepEqual(
        logged.map((row) => [row.action, row.target_id]),
        [
          ["TEAM_MEMBER_CREATE", created.id],
          ["TEAM_MEMBER_UPDATE", MEMBER1],
        ],
      );
    });

    it("퇴사자는 화면 역할에서 명부·점수 속성 모두 0행이고, 행·점수 속성·기존 score_runs 는 그대로며 계정 연결도 막힌다", async (t) => {
      const db = await editDb(t);
      const runs = async () => {
        await asWorker(db);
        return rowsOf(
          db,
          "select id, status, score, recommendation, input_snapshot, input_snapshot_hash, finished_at from public.score_runs order by id",
        );
      };
      const runsBefore = await runs();
      await as(db, "admin");
      await update(db, MEMBER1, TEAM2, TITLE2);
      await update(db, MEMBER1, null, null, "LEFT");
      for (const who of ["admin", "viewer"]) {
        await as(db, who);
        assert.equal(await countOf(db, "team_members", "id = $1", [MEMBER1]), 0, who);
        assert.equal(await countOf(db, "team_member_scoring", "member_id = $1", [MEMBER1]), 0, who);
      }
      await asWorker(db);
      assert.equal(await countOf(db, "team_members", "id = $1", [MEMBER1]), 1);
      assert.equal(await countOf(db, "team_member_scoring", "member_id = $1", [MEMBER1]), 1);
      assert.deepEqual(await runs(), runsBefore);
      await assert.rejects(
        db.query("update public.team_members set user_id = $1 where id = $2", [
          WHO.viewer,
          MEMBER1,
        ]),
        /member_left/,
      );
      // 재직 복귀(API)하면 다시 보인다.
      await as(db, "admin");
      await update(db, MEMBER1, null, null, "ACTIVE");
      await as(db, "viewer");
      assert.equal(await countOf(db, "team_members", "id = $1", [MEMBER1]), 1);
      assert.equal(await countOf(db, "team_member_scoring", "member_id = $1", [MEMBER1]), 1);
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

describe("프로필 사진 — 경로·권한 (20261024000200)", () => {
  const solideo = "db4c863c-cb6a-593d-93ff-709a17e0157a";
  const other = "33a80d95-1a64-5fe0-ad6d-e768657e9034";
  const department = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
  const title = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
  const otherDepartment = "10000000-0000-0000-0000-000000000001";
  const otherTitle = "10000000-0000-0000-0000-000000000002";
  const member = "5e000000-0000-0000-0000-000000000001";
  const photo = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const own = (user, n) => `users/${user}/${photo(n)}.jpg`;
  const memberPath = (id, n) => `members/${id}/${photo(n)}.jpg`;
  const putObject = (db, name) =>
    db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [name]);
  const asSystem = async (db) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims','',false)");
  };
  // users[0] = org-01 ADMIN, users[1] = org-01 VIEWER, users[2] = 조직 없음(가입 신청 전 신규 입사자).
  const setup = async (t) => {
    const db = await migratedDb(t);
    await db.exec(
      "insert into storage.buckets(id,name,public) values('profile-photos','profile-photos',false)",
    );
    await db.query(
      "insert into public.organizations (id,slug,name) values ($1,'org-01','솔리데오'),($2,'org-02','격리 조직')",
      [solideo, other],
    );
    await db.query(
      "insert into public.departments (id,org_id,code,name,source_count,target_count,is_demo) values ($1,$2,'SOL-D001','시험부서',3,4,true),($3,$4,'OTHER-D001','다른부서',1,1,true)",
      [department, solideo, otherDepartment, other],
    );
    await db.query(
      "insert into public.job_titles (id,org_id,code,label,sort_order) values ($1,$2,'SOL-J007','팀장',7),($3,$4,'OTHER-J001','다른직급',1)",
      [title, solideo, otherTitle, other],
    );
    await db.query(
      "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'owner','ADMIN'),($1,$3,'member','VIEWER')",
      [solideo, users[0], users[1]],
    );
    await db.query(
      "insert into public.team_members (id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,'SOL-P0001','김민준','MALE',$3,$4,'/demo/people/SOL-P0001.png',true)",
      [member, solideo, department, title],
    );
    return db;
  };

  it("본인은 users/<내 id>/ 에만 사진을 올리고, members/ 는 그 조직 ADMIN 만 올린다", async (t) => {
    const db = await setup(t);
    await actAs(db, users[1]);
    await putObject(db, own(users[1], 1));
    for (const name of [
      own(users[0], 2),
      memberPath(member, 3),
      `users/${users[1]}/${photo(4)}.gif`,
      `users/${users[1]}/../${photo(5)}.jpg`,
    ])
      await assert.rejects(putObject(db, name), /row-level security/);
    // 조직이 없는 신규 입사자도 가입 신청 전에 자기 사진을 올린다.
    await actAs(db, users[2]);
    await putObject(db, own(users[2], 6));
    await assert.rejects(putObject(db, memberPath(member, 7)), /row-level security/);
    await actAs(db, users[0]);
    await putObject(db, memberPath(member, 8));
    await assert.rejects(
      putObject(db, memberPath("5e000000-0000-0000-0000-000000000099", 9)),
      /row-level security/,
    );
    await actAs(db, null, "anon");
    await assert.rejects(putObject(db, own(users[1], 10)), /permission denied|row-level security/);
  });

  it("같은 조직은 명부에 연결된 사진을 읽고 다른 조직·비멤버는 0행이다", async (t) => {
    const db = await setup(t);
    await db.query(
      "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'member','VIEWER')",
      [other, users[2]],
    );
    await putObject(db, memberPath(member, 1));
    await putObject(db, memberPath(member, 2));
    await putObject(db, own(users[1], 3));
    await db.query("update public.team_members set photo_path=$1 where id=$2", [
      memberPath(member, 1),
      member,
    ]);
    const visible = async () =>
      (
        await db.query(
          "select name from storage.objects where bucket_id='profile-photos' order by name",
        )
      ).rows.map((row) => row.name);
    await actAs(db, users[0]);
    assert.deepEqual(await visible(), [memberPath(member, 1)]);
    await actAs(db, users[1]);
    assert.deepEqual(await visible(), [memberPath(member, 1), own(users[1], 3)]);
    await actAs(db, users[2]);
    assert.deepEqual(await visible(), []);
  });

  it("set_my_photo 는 내 경로만 받고 연결된 직원 행을 바꾸며 set_member_photo 는 ADMIN 만 한다", async (t) => {
    const db = await setup(t);
    const setMine = (path) => db.query("select public.set_my_photo($1)", [path]);
    const setMember = (id, path) => db.query("select public.set_member_photo($1,$2)", [id, path]);
    const state = async () => {
      await asSystem(db);
      const profile = (
        await db.query("select photo_path from public.profiles where id=$1", [users[1]])
      ).rows[0].photo_path;
      const roster = (
        await db.query("select photo_path from public.team_members where id=$1", [member])
      ).rows[0].photo_path;
      return { profile, roster };
    };
    await actAs(db, users[1]);
    await assert.rejects(setMine(own(users[0], 1)), /invalid_photo_path/);
    await setMine(own(users[1], 2));
    assert.deepEqual(await state(), { profile: own(users[1], 2), roster: null });
    await db.query("update public.team_members set user_id=$1 where id=$2", [users[1], member]);
    await actAs(db, users[1]);
    await setMine(own(users[1], 3));
    assert.deepEqual(await state(), { profile: own(users[1], 2), roster: own(users[1], 3) });
    await actAs(db, users[1]);
    await assert.rejects(setMember(member, memberPath(member, 4)), /forbidden/);
    await actAs(db, users[0]);
    await assert.rejects(
      setMember(member, memberPath("5e000000-0000-0000-0000-000000000099", 5)),
      /invalid_photo_path/,
    );
    await setMember(member, memberPath(member, 6));
    assert.deepEqual((await state()).roster, memberPath(member, 6));
    await actAs(db, users[0]);
    await setMember(member, null);
    assert.deepEqual((await state()).roster, null);
    // 웹은 사진 지우기를 p_path 생략(기본값 null, 20261024000210)으로 부른다.
    await actAs(db, users[1]);
    await setMine(own(users[1], 7));
    await db.query("select public.set_my_photo()");
    assert.deepEqual((await state()).roster, null);
    await actAs(db, null, "anon");
    await assert.rejects(setMine(null), /permission denied/);
  });

  it("비데모 직원은 한글 3자가 아니어도·같은 이름이어도·성별과 정장 사진 없이 들어가고 데모 직원 제약은 그대로다", async (t) => {
    const db = await setup(t);
    const insert = (code, name, demo, gender = null, portrait = null) =>
      db.query(
        "insert into public.team_members (org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,$3,$4,$5,$6,$7,$8)",
        [solideo, code, name, gender, department, title, portrait, demo],
      );
    await insert("SOL-N0001", "Lee Gwanghui", false);
    await insert("SOL-N0002", "Lee Gwanghui", false);
    await insert("SOL-N0003", "이광", false);
    await assert.rejects(insert("SOL-N0004", " ", false), /check constraint/);
    await assert.rejects(insert("SOL-N0005", "가".repeat(41), false), /check constraint/);
    await assert.rejects(
      insert("SOL-P0002", "Lee", true, "MALE", "/demo/people/SOL-P0002.png"),
      /check constraint/,
    );
    await assert.rejects(
      insert("SOL-P0003", "김민준", true, "MALE", "/demo/people/SOL-P0003.png"),
      /duplicate key/,
    );
    await assert.rejects(insert("SOL-P0004", "박서준", true), /check constraint/);
  });

  it("신규 입사자 번호는 조직마다 SOL-N0001 부터 이어지고 화면 역할은 직접 부르지 못한다", async (t) => {
    const db = await setup(t);
    const next = async (org) =>
      (await db.query("select public.next_new_hire_person_code($1) as code", [org])).rows[0].code;
    assert.equal(await next(solideo), "SOL-N0001");
    await db.query(
      "insert into public.team_members (org_id,person_code,name,department_id,job_title_id,is_demo) values ($1,'SOL-N0001','신규',$2,$3,false),($1,'SOL-N0009','신규',$2,$3,false)",
      [solideo, department, title],
    );
    assert.equal(await next(solideo), "SOL-N0010");
    assert.equal(await next(other), "SOL-N0001");
    await actAs(db, users[0]);
    await assert.rejects(next(solideo), /permission denied/);
  });

  // 보안 검토 L2(2026-10-25): 활동 회원이 본인 폴더에 사진을 무제한으로 쌓던 것을 막는다.
  const removeObject = async (db, name) =>
    (
      await db.query("delete from storage.objects where bucket_id='profile-photos' and name=$1", [
        name,
      ])
    ).rowCount;

  it("본인 폴더 사진은 3장까지만 올라가고 쓰지 않는 사진을 지우면 다시 올린다 (20261025000110)", async (t) => {
    const db = await setup(t);
    await actAs(db, users[1]);
    for (const n of [1, 2, 3]) await putObject(db, own(users[1], n));
    // 사용자 역할 insert 는 insert 정책이 거부한다. Storage API 는 이 거부를 403 으로 돌려준다.
    // 트리거(20261025000310)가 여기서 먼저 던지면 차례로 올린 4번째가 HTTP 500 이 된다(격리 스택 6차 실측).
    await assert.rejects(putObject(db, own(users[1], 4)), /row-level security/);
    // 상한은 사람마다 따로다.
    await actAs(db, users[2]);
    await putObject(db, own(users[2], 5));
    await actAs(db, users[1]);
    assert.equal(await removeObject(db, own(users[1], 1)), 1);
    await putObject(db, own(users[1], 4));
    // members/ 경로(ADMIN 전용)는 이 상한과 무관하게 그대로다.
    await actAs(db, users[0]);
    for (const n of [6, 7, 8, 9]) await putObject(db, memberPath(member, n));
  });

  it("본인은 아무 데서도 쓰지 않는 자기 사진만 지우고 남의 사진·쓰는 사진·members 사진은 못 지운다 (20261025000110)", async (t) => {
    const db = await setup(t);
    for (const name of [
      own(users[1], 1),
      own(users[1], 2),
      own(users[1], 3),
      own(users[0], 4),
      memberPath(member, 5),
    ])
      await putObject(db, name);
    await db.query("update public.profiles set photo_path=$1 where id=$2", [
      own(users[1], 1),
      users[1],
    ]);
    await db.query("update public.team_members set user_id=$1, photo_path=$2 where id=$3", [
      users[1],
      own(users[1], 2),
      member,
    ]);
    await actAs(db, users[1]);
    // 계정 사진·조직도 사진으로 쓰는 것, 남의 것, members/ 는 0행이다.
    for (const name of [
      own(users[1], 1),
      own(users[1], 2),
      own(users[0], 4),
      memberPath(member, 5),
    ])
      assert.equal(await removeObject(db, name), 0, name);
    assert.equal(await removeObject(db, own(users[1], 3)), 1);
    // ADMIN 도 다른 사람의 users/ 사진은 못 지운다.
    await actAs(db, users[0]);
    assert.equal(await removeObject(db, own(users[1], 1)), 0);
    // anon 은 표 권한이 있어도(Supabase 기본) 정책이 없어 0행이다.
    await actAs(db, null, "anon");
    assert.equal(await removeObject(db, own(users[1], 3)), 0);
    // 쓰지 않게 되면(사진 지우기) 본인이 지운다.
    await asSystem(db);
    await db.query("update public.profiles set photo_path=null where id=$1", [users[1]]);
    await actAs(db, users[1]);
    assert.equal(await removeObject(db, own(users[1], 1)), 1);
  });

  // Storage API 는 사용자 권한으로 insert 를 시험한 뒤 롤백하고, 실제 행은 superuser 로 쓴다(storage-api v1.79 canUpload·
  // completeUpload). 그래서 정책 안의 개수 검사는 동시 업로드를 막지 못했다(격리 스택 실측 2개 동시 → 4장).
  // 상한은 실제 insert 경로(트리거)가 지킨다. members/·다른 버킷은 상관없다.
  it("RLS 를 거치지 않는 Storage 의 실제 insert 도 본인 폴더 4번째 사진은 거부한다 (20261025000310)", async (t) => {
    const db = await setup(t);
    for (const n of [1, 2, 3]) await putObject(db, own(users[1], n));
    await assert.rejects(putObject(db, own(users[1], 4)), /photo_quota_exceeded/);
    // 다른 사람 폴더·members/ 경로는 상한과 무관하다.
    await putObject(db, own(users[2], 5));
    for (const n of [6, 7, 8, 9]) await putObject(db, memberPath(member, n));
    // 하나를 지우면 다시 들어간다.
    await removeObject(db, own(users[1], 1));
    await putObject(db, own(users[1], 4));
  });

  it("정지된 계정은 사진 자리 확인 함수를 직접 불러도 false 이고 폴더 행을 만들지 못한다 (20261025000310)", async (t) => {
    const db = await setup(t);
    await db.query("update public.profiles set status='suspended' where id=$1", [users[1]]);
    await actAs(db, users[1]);
    assert.equal(
      (
        await db.query("select public.claim_own_photo_slot('profile-photos', $1) as ok", [
          own(users[1], 1),
        ])
      ).rows[0].ok,
      false,
    );
    await asSystem(db);
    assert.equal(
      (await db.query("select count(*)::int as n from public.profile_photo_folders")).rows[0].n,
      0,
    );
  });
});

describe("가입 신청과 명부 연결 (20261024000300)", () => {
  const solideo = "db4c863c-cb6a-593d-93ff-709a17e0157a";
  const other = "33a80d95-1a64-5fe0-ad6d-e768657e9034";
  const department = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
  const department2 = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f85";
  const title = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
  const otherDepartment = "10000000-0000-0000-0000-000000000001";
  const otherTitle = "10000000-0000-0000-0000-000000000002";
  const memberA = "5e000000-0000-4000-8000-000000000001";
  const memberB = "5e000000-0000-4000-8000-000000000002";
  const otherMember = "5e000000-0000-4000-8000-000000000003";
  // users[0] = org-01 ADMIN(owner), users[1] = org-01 VIEWER, users[2]·applicant2 = 조직 없음, otherAdmin = org-02 ADMIN.
  const applicant2 = "00000000-0000-0000-0000-000000000004";
  const otherAdmin = "00000000-0000-0000-0000-000000000005";
  const photo = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const own = (user, n) => `users/${user}/${photo(n)}.jpg`;
  const asSystem = async (db) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims','',false)");
  };
  const declare = (db, id, name, dept = department) =>
    db.query(
      "update public.profiles set display_name=$2, declared_department_id=$3, declared_job_title_id=$4 where id=$1",
      [id, name, dept, title],
    );
  const setup = async (t) => {
    const db = await migratedDb(t);
    await db.exec(
      "insert into storage.buckets(id,name,public) values('profile-photos','profile-photos',false)",
    );
    for (const [id, email] of [
      [applicant2, "applicant2@example.invalid"],
      [otherAdmin, "other-admin@example.invalid"],
    ])
      await db.query("insert into auth.users values ($1, $2)", [id, email]);
    await db.query(
      "insert into public.organizations (id,slug,name) values ($1,'org-01','솔리데오'),($2,'org-02','격리 조직')",
      [solideo, other],
    );
    await db.query(
      "insert into public.departments (id,org_id,code,name,source_count,target_count,is_demo) values ($1,$2,'SOL-D001','시험부서',3,4,true),($3,$2,'SOL-D002','둘째부서',3,4,true),($4,$5,'OTHER-D001','다른부서',1,1,true)",
      [department, solideo, department2, otherDepartment, other],
    );
    await db.query(
      "insert into public.job_titles (id,org_id,code,label,sort_order) values ($1,$2,'SOL-J007','팀장',7),($3,$4,'OTHER-J001','다른직급',1)",
      [title, solideo, otherTitle, other],
    );
    await db.query(
      "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'owner','ADMIN'),($1,$3,'member','VIEWER'),($4,$5,'owner','ADMIN')",
      [solideo, users[0], users[1], other, otherAdmin],
    );
    await db.query(
      "insert into public.team_members (id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,'SOL-P0001','김민준','MALE',$3,$4,'/demo/people/SOL-P0001.png',true),($5,$2,'SOL-P0002','이서연','FEMALE',$3,$4,'/demo/people/SOL-P0002.png',true),($6,$7,'SOL-P0001','김민준','MALE',$8,$9,'/demo/people/SOL-P0001.png',true)",
      [
        memberA,
        solideo,
        department2,
        title,
        memberB,
        otherMember,
        other,
        otherDepartment,
        otherTitle,
      ],
    );
    return db;
  };
  const submit = async (db, kind, member = null, name = null) =>
    (await db.query("select public.submit_join_request($1,$2,$3) as id", [kind, member, name]))
      .rows[0].id;
  // 결정은 지금 역할이 읽은 신청 버전(updated_at, 20261025000300)과 함께 보낸다. 못 읽으면(ADMIN 이 아니면) null 이다.
  const decide = async (db, id, approve, role) => {
    const seen =
      (
        await db.query(
          "select updated_at::text as v from public.member_join_requests where id=$1",
          [id],
        )
      ).rows[0]?.v ?? null;
    return (
      await (role === undefined
        ? db.query(
            "select public.decide_join_request(p_request => $1, p_approve => $2, p_seen_updated_at => $3::timestamptz) as result",
            [id, approve, seen],
          )
        : db.query(
            "select public.decide_join_request(p_request => $1, p_approve => $2, p_seen_updated_at => $3::timestamptz, p_sol_role => $4) as result",
            [id, approve, seen, role],
          ))
    ).rows[0].result;
  };
  const memberOf = async (db, user) => {
    await asSystem(db);
    return (
      await db.query(
        "select person_code,name,is_demo,department_id,photo_path from public.team_members where user_id=$1",
        [user],
      )
    ).rows;
  };
  const membership = async (db, user) => {
    await asSystem(db);
    return (
      await db.query(
        "select org_role,sol_role from public.memberships where org_id=$1 and user_id=$2",
        [solideo, user],
      )
    ).rows;
  };
  const request = async (db, id) => {
    await asSystem(db);
    return (
      await db.query(
        "select status,sol_role,decided_by,applicant_name,applicant_photo_path from public.member_join_requests where id=$1",
        [id],
      )
    ).rows[0];
  };

  it("비멤버 신규 입사자 신청을 ADMIN 이 승인하면 VIEWER 멤버십과 SOL-N0001 비데모 직원이 생긴다", async (t) => {
    const db = await setup(t);
    await actAs(db, users[2]);
    await assert.rejects(submit(db, "NEW_HIRE"), /profile_incomplete/);
    await asSystem(db);
    await declare(db, users[2], "Lee Gwanghui");
    await declare(db, applicant2, "Lee Gwanghui");
    await actAs(db, users[2]);
    const first = await submit(db, "NEW_HIRE");
    // 대기 중에 다시 신청하면 같은 행을 고친다.
    assert.equal(await submit(db, "NEW_HIRE"), first);
    assert.equal(
      (await db.query("select count(*)::int as n from public.member_join_requests")).rows[0].n,
      1,
    );
    await actAs(db, applicant2);
    const second = await submit(db, "NEW_HIRE");
    await actAs(db, users[0]);
    assert.equal(await decide(db, first, true), "APPROVED");
    await actAs(db, users[0]);
    assert.equal(await decide(db, second, true, "VIEWER"), "APPROVED");
    assert.deepEqual(await membership(db, users[2]), [{ org_role: "member", sol_role: "VIEWER" }]);
    assert.deepEqual(await memberOf(db, users[2]), [
      {
        person_code: "SOL-N0001",
        name: "Lee Gwanghui",
        is_demo: false,
        department_id: department,
        photo_path: null,
      },
    ]);
    assert.equal((await memberOf(db, applicant2))[0].person_code, "SOL-N0002");
    assert.deepEqual(await request(db, first), {
      status: "APPROVED",
      sol_role: "VIEWER",
      decided_by: users[0],
      applicant_name: "Lee Gwanghui",
      applicant_photo_path: null,
    });
    await actAs(db, users[2]);
    await assert.rejects(submit(db, "NEW_HIRE"), /already_linked/);
  });

  it("신청 뒤 신청자가 프로필을 바꿔도 승인하면 신청 당시 이름·부서·직급으로 명부에 등록된다", async (t) => {
    const db = await setup(t);
    const title2 = "33e315b9-aee8-5ea8-96eb-f9055af4eef3";
    await db.query(
      "insert into public.job_titles (id,org_id,code,label,sort_order) values ($1,$2,'SOL-J008','책임',8)",
      [title2, solideo],
    );
    await declare(db, users[2], "신청당시이름");
    await actAs(db, users[2]);
    const id = await submit(db, "NEW_HIRE");
    // ADMIN 이 신청 내용을 본 뒤 신청자가 본인 권한으로 프로필을 바꾼다.
    await db.query(
      "update public.profiles set display_name='바꾼이름', declared_department_id=$2, declared_job_title_id=$3 where id=$1",
      [users[2], department2, title2],
    );
    await actAs(db, users[0]);
    assert.equal(await decide(db, id, true), "APPROVED");
    await asSystem(db);
    assert.deepEqual(
      (
        await db.query(
          "select name,department_id,job_title_id from public.team_members where user_id=$1",
          [users[2]],
        )
      ).rows,
      [{ name: "신청당시이름", department_id: department, job_title_id: title }],
    );
    // 연결 뒤 프로필의 부서·직급도 명부와 같다(LINK 승인과 같은 규칙).
    assert.deepEqual(
      (
        await db.query(
          "select declared_department_id,declared_job_title_id from public.profiles where id=$1",
          [users[2]],
        )
      ).rows,
      [{ declared_department_id: department, declared_job_title_id: title }],
    );
  });

  it("ADMIN 이 본 뒤 신청자가 다시 신청하거나 사진을 바꾸면 그 화면의 결정은 거부되고 새로 읽은 신청으로만 승인한다 (20261025000300)", async (t) => {
    const db = await setup(t);
    // ADMIN 화면이 읽은 신청 버전(updated_at). 마이크로초까지 같아야 하므로 문자열로 주고받는다.
    const seenVersion = async (id) => {
      await actAs(db, users[0]);
      return (
        await db.query(
          "select updated_at::text as v from public.member_join_requests where id=$1",
          [id],
        )
      ).rows[0].v;
    };
    const decideSeen = async (id, approve, version) =>
      (
        await db.query(
          "select public.decide_join_request(p_request => $1, p_approve => $2, p_sol_role => 'VIEWER', p_seen_updated_at => $3::timestamptz) as result",
          [id, approve, version],
        )
      ).rows[0].result;

    // 1. 신규 입사자: ADMIN 이 본 뒤 신청자가 이름·부서를 바꾸고 다시 신청한다(같은 신청 id 를 덮어쓴다).
    await declare(db, users[2], "처음이름");
    await actAs(db, users[2]);
    const id = await submit(db, "NEW_HIRE");
    const stale = await seenVersion(id);
    await asSystem(db);
    await declare(db, users[2], "바꾼이름", department2);
    await actAs(db, users[2]);
    assert.equal(await submit(db, "NEW_HIRE"), id);
    await actAs(db, users[0]);
    // 버전을 주지 않는 옛 호출로는 결정하지 못한다. 옛 서명은 없고, 세 번째 위치 인자는 버전(timestamptz)으로 읽힌다.
    await assert.rejects(
      db.query("select public.decide_join_request($1,$2,$3) as result", [id, true, "VIEWER"]),
      /does not exist|request_changed|invalid input syntax for type timestamp with time zone/,
    );
    await assert.rejects(decideSeen(id, true, stale), /request_changed/);
    await assert.rejects(decideSeen(id, false, stale), /request_changed/);
    assert.deepEqual(await memberOf(db, users[2]), []);
    assert.deepEqual(await membership(db, users[2]), []);
    // 새로 읽으면 ADMIN 이 지금 보는 값으로 등록된다.
    const fresh = await seenVersion(id);
    assert.equal(await decideSeen(id, true, fresh), "APPROVED");
    assert.deepEqual(
      (await memberOf(db, users[2])).map(({ name, department_id }) => ({ name, department_id })),
      [{ name: "바꾼이름", department_id: department2 }],
    );

    // 2. 기존 직원 연결: ADMIN 이 본 뒤 신청자가 연결 대상을 다른 가상 직원으로 바꾼다.
    await asSystem(db);
    await declare(db, applicant2, "Lee Gwanghui");
    await actAs(db, applicant2);
    const linkId = await submit(db, "EXISTING", memberA, "김민준");
    const linkSeen = await seenVersion(linkId);
    await actAs(db, applicant2);
    assert.equal(await submit(db, "EXISTING", memberB, "이서연"), linkId);
    await actAs(db, users[0]);
    await assert.rejects(decideSeen(linkId, true, linkSeen), /request_changed/);
    await asSystem(db);
    assert.deepEqual(
      (
        await db.query(
          "select count(*)::int as n from public.team_members where id = any($1) and user_id is not null",
          [[memberA, memberB]],
        )
      ).rows[0].n,
      0,
    );

    // 3. 사진: ADMIN 이 본 뒤 신청자가 사진을 바꾸면 그 화면으로는 승인하지 못하고, 새로 읽은 사진이 명부에 들어간다.
    const photoSeen = await seenVersion(linkId);
    await actAs(db, applicant2);
    await db.query("select public.set_my_photo($1)", [own(applicant2, 7)]);
    await actAs(db, users[0]);
    await assert.rejects(decideSeen(linkId, true, photoSeen), /request_changed/);
    assert.equal(await decideSeen(linkId, true, await seenVersion(linkId)), "APPROVED");
    await asSystem(db);
    assert.deepEqual(
      (await db.query("select photo_path from public.team_members where id=$1", [memberB])).rows,
      [{ photo_path: own(applicant2, 7) }],
    );
  });

  it("VIEWER·다른 조직 ADMIN 은 결정하지 못하고 이미 결정된 신청은 다시 결정하지 못한다", async (t) => {
    const db = await setup(t);
    await declare(db, users[2], "박신입");
    await actAs(db, users[2]);
    const id = await submit(db, "NEW_HIRE");
    const visibleTo = async (user) => {
      await actAs(db, user);
      return (await db.query("select count(*)::int as n from public.member_join_requests")).rows[0]
        .n;
    };
    assert.deepEqual(
      [await visibleTo(users[0]), await visibleTo(users[1]), await visibleTo(otherAdmin)],
      [1, 0, 0],
    );
    for (const user of [users[1], otherAdmin, users[2]]) {
      await actAs(db, user);
      await assert.rejects(decide(db, id, true), /forbidden/);
    }
    await actAs(db, users[0]);
    await assert.rejects(
      db.query("update public.member_join_requests set status='APPROVED' where id=$1", [id]),
      /permission denied/,
    );
    await assert.rejects(decide(db, id, true, "OWNER"), /invalid_sol_role/);
    assert.equal(await decide(db, id, false), "REJECTED");
    await actAs(db, users[0]);
    await assert.rejects(decide(db, id, true), /request_not_pending/);
    assert.deepEqual(await membership(db, users[2]), []);
    assert.deepEqual(await memberOf(db, users[2]), []);
    // 반려된 사람은 다시 신청한다.
    await actAs(db, users[2]);
    assert.notEqual(await submit(db, "NEW_HIRE"), id);
  });

  it("같은 가상 직원에 대한 신청 둘은 먼저 승인된 것만 연결되고 두 번째는 member_taken 이다", async (t) => {
    const db = await setup(t);
    await declare(db, users[2], "김민준");
    await declare(db, applicant2, "김민준");
    await db.query("update public.profiles set photo_path=$2 where id=$1", [
      users[2],
      own(users[2], 1),
    ]);
    await actAs(db, users[2]);
    await assert.rejects(submit(db, "EXISTING", memberA, "김민"), /invalid_member/);
    await assert.rejects(submit(db, "EXISTING", otherMember, "김민준"), /invalid_member/);
    await assert.rejects(submit(db, "EXISTING"), /invalid_member/);
    const first = await submit(db, "EXISTING", memberA, " 김민준 ");
    await actAs(db, applicant2);
    const second = await submit(db, "EXISTING", memberA, "김민준");
    await actAs(db, users[0]);
    assert.equal(await decide(db, first, true), "APPROVED");
    await actAs(db, users[0]);
    await assert.rejects(decide(db, second, true), /member_taken/);
    assert.equal((await request(db, second)).status, "PENDING");
    assert.deepEqual(await memberOf(db, users[2]), [
      {
        person_code: "SOL-P0001",
        name: "김민준",
        is_demo: true,
        department_id: department2,
        photo_path: own(users[2], 1),
      },
    ]);
    // 승인되면 부서·직급은 명부 값을 따른다(U6).
    assert.equal(
      (await db.query("select declared_department_id from public.profiles where id=$1", [users[2]]))
        .rows[0].declared_department_id,
      department2,
    );
    assert.deepEqual(await memberOf(db, applicant2), []);
    await actAs(db, applicant2);
    await assert.rejects(submit(db, "EXISTING", memberA, "김민준"), /invalid_member/);
  });

  it("find_unlinked_member 는 부서·이름이 정확히 맞는 미연결 데모 직원 하나만 주고 anon 은 거부한다", async (t) => {
    const db = await setup(t);
    await db.query(
      "insert into public.team_members (org_id,person_code,name,department_id,job_title_id,is_demo) values ($1,'SOL-N0001','김민준',$2,$3,false)",
      [solideo, department2, title],
    );
    const find = async (dept, name) =>
      (await db.query("select * from public.find_unlinked_member($1,$2)", [dept, name])).rows;
    await actAs(db, users[2]);
    const hit = [
      { id: memberA, person_code: "SOL-P0001", name: "김민준", job_title_label: "팀장" },
    ];
    assert.deepEqual(await find("SOL-D002", "김민준"), hit);
    assert.deepEqual(await find("SOL-D002", " 김민준 "), hit);
    assert.deepEqual(await find("SOL-D001", "김민준"), []);
    assert.deepEqual(await find("SOL-D002", "김민"), []);
    assert.deepEqual(await find("OTHER-D001", "김민준"), []);
    await asSystem(db);
    await db.query("update public.team_members set user_id=$1 where id=$2", [users[1], memberA]);
    await actAs(db, users[2]);
    assert.deepEqual(await find("SOL-D002", "김민준"), []);
    await actAs(db, null, "anon");
    await assert.rejects(find("SOL-D002", "김민준"), /permission denied/);
  });

  it("find_unlinked_member 는 퇴사(LEFT) 직원을 찾지 않는다 (N4b 20261024000410)", async (t) => {
    const db = await setup(t);
    const find = async () =>
      (await db.query("select id from public.find_unlinked_member('SOL-D002','김민준')")).rows;
    await asSystem(db);
    await db.query("update public.team_members set employment_status='LEFT' where id=$1", [
      memberA,
    ]);
    await actAs(db, users[2]);
    assert.deepEqual(await find(), []);
    await asSystem(db);
    await db.query("update public.team_members set employment_status='ACTIVE' where id=$1", [
      memberA,
    ]);
    await actAs(db, users[2]);
    assert.deepEqual(await find(), [{ id: memberA }]);
  });

  it("ADMIN 은 대기 신청자의 사진을 읽고 다른 사람은 읽지 못한다", async (t) => {
    const db = await setup(t);
    await declare(db, users[2], "박신입");
    const put = (name) =>
      db.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [name]);
    const visible = async (user) => {
      await actAs(db, user);
      return (
        await db.query(
          "select name from storage.objects where bucket_id='profile-photos' order by name",
        )
      ).rows.map((row) => row.name);
    };
    await actAs(db, users[2]);
    await put(own(users[2], 1));
    await db.query("select public.set_my_photo($1)", [own(users[2], 1)]);
    const id = await submit(db, "NEW_HIRE");
    assert.equal((await request(db, id)).applicant_photo_path, own(users[2], 1));
    assert.deepEqual(await visible(users[0]), [own(users[2], 1)]);
    assert.deepEqual(await visible(users[1]), []);
    assert.deepEqual(await visible(otherAdmin), []);
    // 신청 뒤에 사진을 바꾸면 신청의 사진도 따라간다.
    await actAs(db, users[2]);
    await put(own(users[2], 2));
    await db.query("select public.set_my_photo($1)", [own(users[2], 2)]);
    assert.equal((await request(db, id)).applicant_photo_path, own(users[2], 2));
    assert.deepEqual(await visible(users[0]), [own(users[2], 2)]);
    await actAs(db, users[0]);
    await decide(db, id, false);
    assert.deepEqual(await visible(users[0]), []);
  });

  it("ADMIN 은 신청을 EXECUTIVE 로 승인할 수 있고 멤버십·신청 행에 그 역할이 남는다", async (t) => {
    const db = await setup(t);
    await declare(db, applicant2, "Lee Gwanghui");
    await actAs(db, applicant2);
    const id = await submit(db, "NEW_HIRE");
    await actAs(db, users[0]);
    assert.equal(await decide(db, id, true, "EXECUTIVE"), "APPROVED");
    assert.deepEqual(await membership(db, applicant2), [
      { org_role: "member", sol_role: "EXECUTIVE" },
    ]);
    assert.equal((await request(db, id)).sol_role, "EXECUTIVE");
  });

  it("이미 멤버인 계정의 신청 승인은 멤버십·업무 역할을 바꾸지 않고 연결만 한다", async (t) => {
    const db = await setup(t);
    await declare(db, users[0], "이광희");
    await declare(db, users[1], "이서연");
    await actAs(db, users[0]);
    const mine = await submit(db, "NEW_HIRE");
    await actAs(db, users[0]);
    assert.equal(await decide(db, mine, true, "VIEWER"), "APPROVED");
    assert.deepEqual(await membership(db, users[0]), [{ org_role: "owner", sol_role: "ADMIN" }]);
    assert.equal((await memberOf(db, users[0]))[0].person_code, "SOL-N0001");
    await actAs(db, users[1]);
    const viewer = await submit(db, "EXISTING", memberB, "이서연");
    await actAs(db, users[0]);
    assert.equal(await decide(db, viewer, true, "SALES"), "APPROVED");
    assert.deepEqual(await membership(db, users[1]), [{ org_role: "member", sol_role: "VIEWER" }]);
    assert.equal((await memberOf(db, users[1]))[0].person_code, "SOL-P0002");
    assert.equal((await request(db, viewer)).sol_role, "VIEWER");
  });
});

describe("가입 약관 동의 기록 (20261027000600)", () => {
  const solideo = "db4c863c-cb6a-593d-93ff-709a17e0157a";
  const department = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
  const title = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";
  const alice = "00000000-0000-4000-8000-0000000000a1";
  const bob = "00000000-0000-4000-8000-0000000000b2";
  const agreed = { terms: true, privacy: true, age_over_14: true, marketing: false };
  // 이메일 가입 화면이 보내는 가입 정보(sign-up-schema.ts toSignUpRequest)와 같은 모양이다.
  const signUp = (db, id, extra) =>
    db.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)", [
      id,
      `${id}@example.invalid`,
      JSON.stringify({
        name: "가입자",
        department_code: "SOL-D001",
        job_title_code: "SOL-J007",
        ...extra,
      }),
    ]);
  const setup = async (t) => {
    const db = await migratedDb(t);
    await db.query(
      "insert into public.organizations (id,slug,name) values ($1,'org-01','솔리데오')",
      [solideo],
    );
    await db.query(
      "insert into public.departments (id,org_id,code,name,source_count,target_count,is_demo) values ($1,$2,'SOL-D001','시험부서',1,1,true)",
      [department, solideo],
    );
    await db.query(
      "insert into public.job_titles (id,org_id,code,label,sort_order) values ($1,$2,'SOL-J007','팀장',7)",
      [title, solideo],
    );
    return db;
  };
  const countFor = async (db, table, column, id) =>
    (await db.query(`select count(*)::int as n from ${table} where ${column} = $1`, [id])).rows[0]
      .n;

  it("이메일 가입은 필수 동의 셋이 모두 true 가 아니면 계정을 만들지 않는다", async (t) => {
    const db = await setup(t);
    // 화면을 거치지 않고 동의를 빼거나(키 없음) 하나를 거짓으로 보낸 가입.
    for (const extra of [{}, { consents: { ...agreed, age_over_14: false } }])
      await assert.rejects(signUp(db, alice, extra), /consent_required/);
    assert.equal(await countFor(db, "auth.users", "id", alice), 0);
    assert.equal(await countFor(db, "public.profiles", "id", alice), 0);
    assert.equal(await countFor(db, "public.user_consents", "user_id", alice), 0);
  });

  it("필수 동의를 하면 항목별 시각을 남기고, 마케팅은 동의했을 때만 시각이 있다", async (t) => {
    const db = await setup(t);
    await signUp(db, alice, { consents: { ...agreed, marketing: true } });
    await signUp(db, bob, { consents: agreed });
    const { rows } = await db.query(
      `select user_id, terms_agreed_at is not null as terms, privacy_agreed_at is not null as privacy,
         age_confirmed_at is not null as age, marketing_agreed_at is not null as marketing
       from public.user_consents order by user_id`,
    );
    assert.deepEqual(rows, [
      { user_id: alice, terms: true, privacy: true, age: true, marketing: true },
      { user_id: bob, terms: true, privacy: true, age: true, marketing: false },
    ]);
    const profile = await db.query(
      "select declared_department_id, declared_job_title_id from public.profiles where id = $1",
      [alice],
    );
    assert.deepEqual(profile.rows, [
      { declared_department_id: department, declared_job_title_id: title },
    ]);
  });

  it("본인 기록만 읽고, 본인도 service_role 도 동의 기록을 고치거나 지우지 못한다", async (t) => {
    const db = await setup(t);
    await signUp(db, alice, { consents: agreed });
    await signUp(db, bob, { consents: agreed });
    await actAs(db, alice);
    assert.deepEqual(
      (await db.query("select user_id from public.user_consents")).rows.map((row) => row.user_id),
      [alice],
    );
    await assert.rejects(
      db.query("update public.user_consents set terms_agreed_at = now() where user_id = $1", [
        alice,
      ]),
      /permission denied for table user_consents/,
    );
    await assert.rejects(
      db.query("delete from public.user_consents where user_id = $1", [alice]),
      /permission denied for table user_consents/,
    );
    await db.exec("reset role");
    await db.exec("set role service_role");
    await assert.rejects(
      db.query("update public.user_consents set terms_agreed_at = now() where user_id = $1", [
        alice,
      ]),
      /permission denied for table user_consents/,
    );
    await db.exec("reset role");
  });
});
