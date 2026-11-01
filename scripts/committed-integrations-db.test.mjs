import assert from "node:assert/strict";
import { it } from "node:test";
import { migratedDb, users } from "./database-test-support.mjs";
import { actAs } from "./supabase-pglite.mjs";

it("durable Kakao claims serialize organizations and test-event retries without exposing the ledger to users", async (t) => {
  const db = await migratedDb(t);
  const orgs = ["11000000-0000-4000-8000-000000000001", "11000000-0000-4000-8000-000000000002"];
  const bid = "21000000-0000-4000-8000-000000000001";
  await db.query(
    "insert into public.organizations(id,slug,name) values ($1,'claim-one','첫 조직'),($2,'claim-two','둘째 조직')",
    orgs,
  );
  await db.query(
    "insert into public.memberships(org_id,user_id,org_role,sol_role) values ($1,$3,'owner','ADMIN'),($2,$3,'owner','ADMIN')",
    [...orgs, users[0]],
  );
  await db.query(
    "insert into public.bid_notices(id,source,notice_id,title,stage,status,source_url,content_hash,is_demo) values ($1,'fixture','claim-core','공고','NOTICE','OPEN','https://example.invalid/notice','hash',true)",
    [bid],
  );
  const ids = [];
  for (const org of orgs)
    ids.push(
      (
        await db.query(
          "insert into public.notifications(org_id,user_id,type,channel,idempotency_key,payload) values ($1,$2,'BID_RECOMMENDED','KAKAO',$4,$3) returning id",
          [org, users[0], JSON.stringify({ bidId: bid }), org],
        )
      ).rows[0].id,
    );
  const claimed = await Promise.all(
    ids.map((id) => db.query("select public.claim_kakao_notification($1) claimed", [id])),
  );
  assert.equal(claimed.filter((r) => r.rows[0].claimed).length, 1);
  const receipt = (
    await db.query(
      "select id,status,error from public.notifications where status='DEAD' and error='TIMEOUT_UNKNOWN'",
    )
  ).rows;
  assert.equal(receipt.length, 1);
  // A lost final result or an old worker changing FAILED cannot release the immutable intention.
  await db.query("update public.notifications set status='FAILED',error=null where id=$1", [
    receipt[0].id,
  ]);
  assert.equal(
    (await db.query("select public.claim_kakao_notification($1) claimed", [receipt[0].id])).rows[0]
      .claimed,
    false,
  );
  const testEvent = (
    await db.query(
      "insert into public.outbox_events(aggregate_type,aggregate_id,event_type,payload,idempotency_key) values ('kakao_notify_link',$1,'KAKAO_TEST',$2,'claim-test') returning id",
      [users[0], JSON.stringify({ userId: users[0] })],
    )
  ).rows[0].id;
  assert.equal(
    (await db.query("select public.claim_kakao_test($1) claimed", [testEvent])).rows[0].claimed,
    true,
  );
  assert.equal(
    (await db.query("select public.claim_kakao_test($1) claimed", [testEvent])).rows[0].claimed,
    false,
  );
  await actAs(db, users[0]);
  await assert.rejects(db.query("select * from public.kakao_send_claims"), /permission denied/);
  await assert.rejects(
    db.query("select public.claim_kakao_notification($1)", [ids[1]]),
    /permission denied/,
  );
});

it("Kakao connection RPCs expose only the caller's safe columns and keep encrypted tokens private", async (t) => {
  const db = await migratedDb(t);
  await actAs(db, users[0]);
  await db.query(
    "select public.save_kakao_notify_link('v1.synthetic-access','v1.synthetic-refresh',now()+interval '1 hour',now()+interval '1 day')",
  );
  assert.equal(
    (await db.query("select enabled,status from public.kakao_notify_links")).rows.length,
    1,
  );
  await assert.rejects(
    db.query("select access_token_enc from public.kakao_notify_links"),
    /permission denied/,
  );
  await actAs(db, users[1]);
  assert.equal(
    (await db.query("select enabled,status from public.kakao_notify_links")).rows.length,
    0,
  );
  await db.query("select public.disconnect_kakao_notify()");
  await actAs(db, users[0]);
  assert.equal((await db.query("select enabled from public.kakao_notify_links")).rows.length, 1);
  await actAs(db, null, "anon");
  await assert.rejects(
    db.query("select enabled from public.kakao_notify_links"),
    /permission denied/,
  );
});

it("public programs allow active members to read notices while all client writes and private run reads stay closed", async (t) => {
  const db = await migratedDb(t);
  await db.query(
    "insert into public.program_notices(source,source_notice_id,title,source_url,dedupe_key,fetched_at) values ('mss','1','사업공고','https://mss.go.kr/notice/1','program-1',now())",
  );
  // 과기정통부(msit)는 두 표 모두 받고, 목록에 없는 출처는 거부한다.
  await db.query(
    "insert into public.program_notices(source,source_notice_id,title,source_url,dedupe_key,fetched_at) values ('msit','3186001','신규과제 공모','https://www.msit.go.kr/bbs/view.do?nttSeqNo=3186001','program-2',now())",
  );
  await db.query(
    "insert into public.program_notice_runs(source,run_mode,status) values ('msit','LIVE','SUCCEEDED')",
  );
  await assert.rejects(
    db.query(
      "insert into public.program_notices(source,source_notice_id,title,source_url,dedupe_key,fetched_at) values ('ntis','1','x','https://www.ntis.go.kr/1','program-3',now())",
    ),
    /program_notices_source_check/,
  );
  await actAs(db, users[0]);
  assert.equal((await db.query("select title from public.program_notices")).rows.length, 2);
  await assert.rejects(
    db.query("update public.program_notices set title='바꿈'"),
    /permission denied/,
  );
  await assert.rejects(db.query("select * from public.program_notice_runs"), /permission denied/);
  await actAs(db, null, "anon");
  await assert.rejects(db.query("select title from public.program_notices"), /permission denied/);
});

it("score completion preserves organization and attempt guards, the translation flag, and one recommendation event per bid", async (t) => {
  const db = await migratedDb(t);
  const org = "10000000-0000-4000-8000-000000000001";
  const otherOrg = "10000000-0000-4000-8000-000000000002";
  const bid = "20000000-0000-4000-8000-000000000001";
  const revision = "30000000-0000-4000-8000-000000000001";
  const profile = "40000000-0000-4000-8000-000000000001";
  const start = "2026-10-22T03:00:00.000Z";
  await db.query(
    "insert into public.organizations(id,slug,name) values ($1,'kakao-integration','테스트 조직'),($2,'kakao-other','격리 조직')",
    [org, otherOrg],
  );
  await db.query(
    "insert into public.memberships(org_id,user_id,org_role,sol_role) values ($1,$2,'owner','ADMIN')",
    [org, users[0]],
  );
  await db.query(
    "insert into public.bid_notices(id,source,notice_id,title,stage,status,source_url,content_hash,is_demo) values ($1,'fixture','notification-integration','공고','NOTICE','OPEN','https://example.invalid/notice','hash',true)",
    [bid],
  );
  await db.query(
    "insert into public.bid_revisions(id,bid_id,revision,raw_payload,normalized,checksum,fetched_at) values ($1,$2,1,'{}','{}','hash',now())",
    [revision, bid],
  );
  await db.query(
    "insert into public.company_profiles(id,org_id,revision,name) values ($1,$2,1,'회사')",
    [profile, org],
  );
  for (const algorithm of ["notification-core-1", "notification-core-2"]) {
    const run = (
      await db.query(
        "insert into public.score_runs(org_id,bid_id,revision_id,company_profile_id,profile_revision,algorithm_version,run_mode,ai_provider,status,started_at,requested_by) values ($1,$2,$3,$4,1,$5,'MOCK','MOCK','RUNNING',$6,$7) returning id",
        [org, bid, revision, profile, algorithm, start, users[0]],
      )
    ).rows[0].id;
    const payload = {
      score_run_id: run,
      org_id: org,
      attempt_started_at: start,
      run: {
        status: "PARTIAL",
        recommendation: "WATCH",
        review_flags: ["TRANSLATION_INCOMPLETE"],
        input_snapshot: {},
        input_snapshot_hash: "synthetic-snapshot",
        finished_at: start,
      },
    };
    await assert.rejects(
      db.query("select public.finish_score_run($1::jsonb)", [
        JSON.stringify({ ...payload, org_id: otherOrg }),
      ]),
      /SCORE_RUN_NOT_FOUND/,
    );
    await assert.rejects(
      db.query("select public.finish_score_run($1::jsonb)", [
        JSON.stringify({ ...payload, attempt_started_at: "2026-10-22T02:00:00.000Z" }),
      ]),
      /SCORE_RUN_NOT_RUNNING/,
    );
    await db.query("select public.finish_score_run($1::jsonb)", [JSON.stringify(payload)]);
    assert.deepEqual(
      (await db.query("select review_flags from public.score_runs where id=$1", [run])).rows[0]
        .review_flags,
      ["TRANSLATION_INCOMPLETE"],
    );
  }
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.outbox_events where event_type='BID_RECOMMENDED' and org_id=$1",
        [org],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.outbox_events where event_type='ANALYSIS_COMPLETE' and org_id=$1",
        [org],
      )
    ).rows[0].n,
    2,
  );
});
