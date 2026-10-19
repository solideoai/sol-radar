// 명시적으로 실행하는 실제 PostgreSQL 동시성 회귀 검증.
// 캐시된 postgres:17.11-alpine을 쓰는 임시 컨테이너만 만들고 finally에서 제거한다.
// 공유 DB·env 파일은 사용하지 않는다. node scripts/p1-last-admin-concurrency.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { actAs, applyMigrations, loadMigrations, mimicSupabase } from "./supabase-pglite.mjs";

const name = `sol-radar-codex-p1-pg-${randomUUID()}`;
const clients = [];
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const adapter = (client) => ({
  exec: (sql) => client.query(sql),
  query: (sql, values) => client.query(sql, values),
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const users = [1, 2, 3].map((id) => `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`);
const org = "00000000-0000-4000-8000-000000000004";
let started = false;

try {
  docker(
    "run",
    "--pull=never",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "-p",
    "127.0.0.1::5432",
    "postgres:17.11-alpine",
  );
  started = true;
  const port = Number(
    docker(
      "inspect",
      "--format",
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      name,
    ),
  );
  const connect = async () => {
    const client = new pg.Client({
      host: "127.0.0.1",
      port,
      user: "postgres",
      database: "postgres",
      connectionTimeoutMillis: 1000,
    });
    await client.connect();
    clients.push(client);
    await client.query("set statement_timeout='10s'");
    return client;
  };
  let admin;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      admin = await connect();
      break;
    } catch {
      await sleep(100);
    }
  }
  assert.ok(admin, "임시 PostgreSQL 기동 실패");
  await mimicSupabase(adapter(admin));
  await applyMigrations(
    adapter(admin),
    await loadMigrations(fileURLToPath(new URL("../supabase/migrations/", import.meta.url))),
  );
  for (const [index, user] of users.entries())
    await admin.query("insert into auth.users (id,email) values ($1,$2)", [
      user,
      `p1-${index}@example.invalid`,
    ]);
  await admin.query(
    "insert into public.organizations (id,slug,name) values ($1,'race-admin','동시성 회귀')",
    [org],
  );
  await admin.query(
    "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'owner','ADMIN'),($1,$3,'member','VIEWER')",
    [org, users[1], users[2]],
  );
  await admin.query(
    "insert into public.invitations (org_id,email,org_role,sol_role,invited_by) values ($1,'p1-0@example.invalid','member','ADMIN',$2)",
    [org, users[1]],
  );

  const blocker = await connect();
  const deleter = await connect();
  const joiner = await connect();
  const otherAdmin = await connect();
  await actAs(adapter(deleter), users[0], "authenticated", "p1-0@example.invalid");
  await actAs(adapter(joiner), users[0], "authenticated", "p1-0@example.invalid");
  await actAs(adapter(otherAdmin), users[1], "authenticated", "p1-1@example.invalid");
  const deletionPid = (await deleter.query("select pg_backend_pid() pid")).rows[0].pid;
  await blocker.query("begin");
  await blocker.query("select id from auth.users where id=$1 for update", [users[0]]);
  const deletion = deleter.query("select public.delete_my_account()").then(
    () => ({ ok: true }),
    (error) => ({ ok: false, hint: error.hint }),
  );
  let waiting = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    waiting = (
      await admin.query(
        "select exists(select 1 from pg_locks where pid=$1 and not granted) waiting",
        [deletionPid],
      )
    ).rows[0].waiting;
    if (waiting) break;
    await sleep(10);
  }
  assert.equal(waiting, true, "탈퇴 트랜잭션이 지정한 잠금에서 기다려야 한다");
  await joiner.query(
    "insert into public.memberships (org_id,user_id,org_role) values ($1,$2,'member')",
    [org, users[0]],
  );
  await otherAdmin.query(
    "update public.memberships set sol_role='VIEWER' where org_id=$1 and user_id=$2",
    [org, users[1]],
  );
  await blocker.query("commit");
  const result = await deletion;
  assert.deepEqual(
    result,
    { ok: false, hint: "last_admin" },
    "새 멤버십까지 다시 검사해 마지막 ADMIN 탈퇴를 거절해야 한다",
  );
  assert.equal(
    (
      await admin.query(
        "select count(*)::int n from public.memberships where org_id=$1 and sol_role='ADMIN'",
        [org],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await admin.query("select count(*)::int n from auth.users where id=$1", [users[0]])).rows[0].n,
    1,
  );
  console.log(
    "PASS: 동시 ADMIN 초대 수락·기존 ADMIN 강등·계정 탈퇴에서도 마지막 ADMIN과 계정이 보존된다",
  );

  // 이번에는 검사 뒤 auth.users DELETE 트리거에서 멈춘다.
  // auth.users만 잠그고 profiles FK 삽입을 잠그지 않는 불완전한 수정도 검출한다.
  const lateUser = "00000000-0000-4000-8000-000000000005";
  const lateOrg = "00000000-0000-4000-8000-000000000006";
  await admin.query("insert into auth.users (id,email) values ($1,'late@example.invalid')", [
    lateUser,
  ]);
  await admin.query(
    "insert into public.organizations (id,slug,name) values ($1,'late-admin','검사 이후 가입')",
    [lateOrg],
  );
  await admin.query(
    "insert into public.memberships (org_id,user_id,org_role,sol_role) values ($1,$2,'owner','ADMIN'),($1,$3,'member','VIEWER')",
    [lateOrg, users[1], users[2]],
  );
  await admin.query(
    "insert into public.invitations (org_id,email,org_role,sol_role,invited_by) values ($1,'late@example.invalid','member','ADMIN',$2)",
    [lateOrg, users[1]],
  );
  await admin.query(`create function auth.pause_test_deletion() returns trigger language plpgsql as $$
    begin
      if old.id = '${lateUser}'::uuid then perform pg_advisory_xact_lock(804219); end if;
      return old;
    end; $$;
    create trigger pause_test_deletion before delete on auth.users for each row execute function auth.pause_test_deletion();`);
  await blocker.query("select pg_advisory_lock(804219)");
  await actAs(adapter(deleter), lateUser, "authenticated", "late@example.invalid");
  await actAs(adapter(joiner), lateUser, "authenticated", "late@example.invalid");
  const lateDeletion = deleter.query("select public.delete_my_account()").then(
    () => ({ ok: true }),
    (error) => ({ ok: false, code: error.code }),
  );
  let paused = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    paused = (
      await admin.query(
        "select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted) waiting",
        [deletionPid],
      )
    ).rows[0].waiting;
    if (paused) break;
    await sleep(10);
  }
  assert.equal(paused, true, "계정 검사가 끝난 뒤 삭제 트리거에서 기다려야 한다");
  const joinPid = (await joiner.query("select pg_backend_pid() pid")).rows[0].pid;
  let joined = false;
  const lateJoin = joiner
    .query("insert into public.memberships (org_id,user_id,org_role) values ($1,$2,'member')", [
      lateOrg,
      lateUser,
    ])
    .then(
      () => {
        joined = true;
        return { ok: true };
      },
      (error) => ({ ok: false, code: error.code }),
    );
  let joinWaiting = false;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    joinWaiting = (
      await admin.query(
        "select exists(select 1 from pg_locks where pid=$1 and not granted) waiting",
        [joinPid],
      )
    ).rows[0].waiting;
    if (joinWaiting || joined) break;
    await sleep(10);
  }
  // 잠금이 불완전하면 가입이 끝나고 기존 ADMIN 강등도 통과한다.
  if (joined)
    await otherAdmin.query(
      "update public.memberships set sol_role='VIEWER' where org_id=$1 and user_id=$2",
      [lateOrg, users[1]],
    );
  await blocker.query("select pg_advisory_unlock(804219)");
  assert.deepEqual(await lateDeletion, { ok: true });
  const joinResult = await lateJoin;
  assert.equal(joinWaiting, true, "검사 이후 멤버십 삽입은 profiles FK 잠금에서 기다려야 한다");
  assert.deepEqual(joinResult, { ok: false, code: "23503" });
  assert.equal(
    (
      await admin.query(
        "select count(*)::int n from public.memberships where org_id=$1 and sol_role='ADMIN'",
        [lateOrg],
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS: 검사 이후 초대 수락은 프로필 잠금에 대기한 뒤 FK 거절되고 기존 ADMIN이 보존된다",
  );
} finally {
  await Promise.allSettled(
    clients.map(async (client) => {
      await client.query("rollback");
      await client.end();
    }),
  );
  if (started) docker("stop", "--time", "1", name);
}
