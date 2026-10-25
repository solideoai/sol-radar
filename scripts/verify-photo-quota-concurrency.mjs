// 사진 상한(20261025000110)의 동시 업로드 검증. opt-in 이고 verify·CI 에는 넣지 않는다.
//   node scripts/verify-photo-quota-concurrency.mjs
// PGlite 는 연결이 하나라 두 트랜잭션의 경합을 재현하지 못한다. 그래서 일회용 PostgreSQL 컨테이너를 직접 띄우고,
// 시험과 같은 흉내(mimicSupabase)와 마이그레이션 전부를 적용한 뒤 연결 두 개로 경합을 만든다.
// 연결 주소를 인자로 받지 않고 .env 를 읽지 않는다. 띄운 컨테이너만 이름으로 지운다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import pg from "pg";
import { applyMigrations, loadMigrations, mimicSupabase } from "./supabase-pglite.mjs";

assert.equal(process.argv.length, 2, "이 검증은 연결 인자를 받지 않는다");

const IMAGE = "postgres:17-alpine";
const container = `sol-radar-photoquota-${randomUUID().slice(0, 8)}`;
const password = randomUUID();
const user = "00000000-0000-4000-8000-0000000000a1";
const photo = (n) => `users/${user}/00000000-0000-4000-8000-${String(n).padStart(12, "0")}.jpg`;

const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();

// mimicSupabase·applyMigrations 는 PGlite 의 exec/query 를 쓴다. pg Client 를 같은 모양으로 감싼다.
const asPglite = (client) => ({
  exec: (sql) => client.query(sql),
  query: (sql, params) => client.query(sql, params),
});

const connect = async (port) => {
  const client = new pg.Client({
    host: "127.0.0.1",
    port,
    user: "postgres",
    password,
    database: "postgres",
  });
  await client.connect();
  return client;
};

const waitForPostgres = async (port) => {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const client = await connect(port);
      await client.query("select 1");
      return client;
    } catch {
      await pause(500);
    }
  }
  throw new Error("일회용 PostgreSQL 이 30초 안에 뜨지 않았다");
};

// 화면 역할로 트랜잭션을 연다(웹 요청과 같은 JWT claim).
const beginAsUser = async (client, isolation) => {
  await client.query(`begin isolation level ${isolation}`);
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: user, role: "authenticated" }),
  ]);
  await client.query("set local role authenticated");
};

const insertPhoto = (client, name) =>
  client.query("insert into storage.objects(bucket_id,name) values('profile-photos',$1)", [name]);

const countPhotos = async (admin) =>
  (
    await admin.query(
      "select count(*)::int as n from storage.objects where bucket_id='profile-photos' and name like $1",
      [`users/${user}/%`],
    )
  ).rows[0].n;

const isWaitingOnLock = async (admin, pid) =>
  (await admin.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0]
    ?.wait_event_type === "Lock";

// 폴더에 2장이 있는 상태에서 두 트랜잭션이 3번째·4번째를 동시에 올린다. 결과(B 의 오류 또는 null)와 최종 개수를 돌려준다.
const race = async (admin, port, isolation) => {
  await admin.query("delete from storage.objects where bucket_id='profile-photos'");
  await admin.query(
    "insert into storage.objects(bucket_id,name) values('profile-photos',$1),('profile-photos',$2)",
    [photo(1), photo(2)],
  );
  const a = await connect(port);
  const b = await connect(port);
  try {
    await beginAsUser(a, isolation);
    await beginAsUser(b, isolation);
    await insertPhoto(a, photo(3));
    const bPid = (await b.query("select pg_backend_pid() as pid")).rows[0].pid;
    const pending = insertPhoto(b, photo(4)).then(
      () => null,
      (error) => error,
    );
    await pause(500);
    const blocked = await isWaitingOnLock(admin, bPid);
    await a.query("commit");
    const bError = await pending;
    await b.query(bError ? "rollback" : "commit");
    return { blocked, bError, count: await countPhotos(admin) };
  } finally {
    await a.end();
    await b.end();
  }
};

const run = async () => {
  docker(
    "run",
    "-d",
    "--rm",
    "--name",
    container,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    IMAGE,
  );
  const port = Number(docker("port", container, "5432/tcp").split(":").pop());
  const admin = await waitForPostgres(port);
  try {
    await mimicSupabase(asPglite(admin));
    const migrations = await loadMigrations(
      new URL("../supabase/migrations", import.meta.url).pathname,
    );
    await applyMigrations(asPglite(admin), migrations);
    console.log(`마이그레이션 ${migrations.length}개 적용(실제 PostgreSQL ${IMAGE})`);
    await admin.query("insert into auth.users values ($1, $2)", [user, "quota@example.invalid"]);
    await admin.query(
      "insert into storage.buckets(id,name,public) values('profile-photos','profile-photos',false)",
    );

    for (const isolation of ["read committed", "repeatable read"]) {
      const { blocked, bError, count } = await race(admin, port, isolation);
      console.log(
        `${isolation}: B 대기=${blocked}, B 결과=${bError ? bError.message : "성공"}, 최종 ${count}장`,
      );
      assert.equal(blocked, true, `${isolation}: 두 번째 업로드가 폴더 잠금을 기다려야 한다`);
      assert.ok(bError, `${isolation}: 두 번째 업로드는 실패해야 한다`);
      assert.match(bError.message, /row-level security|could not serialize/);
      assert.equal(count, 3, `${isolation}: 상한 3장을 넘으면 안 된다`);
    }

    // 대조군: 폴더 잠금을 뺀 함수로 바꾸면 같은 경합에서 4장이 된다(이 검증이 경합을 실제로 잡는다는 증거).
    await admin.query(`
      create or replace function public.claim_own_photo_slot(p_bucket text, p_name text)
      returns boolean language plpgsql volatile security definer set search_path = '' as $$
      declare own_folder text := 'users/' || auth.uid()::text || '/'; used integer;
      begin
        if p_bucket is distinct from 'profile-photos' or left(p_name, length(own_folder)) <> own_folder then
          return false;
        end if;
        select count(*) into used from storage.objects o
        where o.bucket_id = 'profile-photos' and left(o.name, length(own_folder)) = own_folder;
        return used < 3;
      end; $$;`);
    const control = await race(admin, port, "read committed");
    console.log(
      `대조군(잠금 없음): B 결과=${control.bError ? control.bError.message : "성공"}, 최종 ${control.count}장`,
    );
    assert.equal(control.count, 4, "대조군은 경합으로 상한을 넘어야 한다");
    console.log("통과: 동시 업로드로 상한을 넘지 못한다");
  } finally {
    await admin.end();
  }
};

try {
  await run();
} finally {
  execFileSync("docker", ["rm", "-f", container], { stdio: "ignore" });
}
