// 마이그레이션을 직접 pg로 적용한다(대시보드 직접 SQL 아님).
// `supabase db push`는 무료 티어 Session pooler에서 인증이 완결되지 않아(psql·pg는 됨) 쓰지 못한다.
//
// 적용한 파일은 이력 표(supabase_migrations.schema_migrations)에 버전을 남기고, 다음부터는 건너뛴다.
// Supabase CLI 가 쓰는 것과 같은 표라서 나중에 CLI 로 옮겨도 이력이 이어진다.
// public 스키마가 아니라서 anon 키 API 로는 보이지 않는다.
//
// 파일 하나가 트랜잭션 하나다. 중간에 실패하면 그 파일은 통째로 되돌아가고 이력에도 남지 않는다.
// 앞서 성공한 파일은 그대로 남는다. 그래서 트랜잭션 안에서 못 도는 문장(create index concurrently 등)은 쓰지 않는다.
//
// 이력 표가 생기기 전에 이 스크립트로 적용한 DB 는 첫 실행 때 모든 파일을 한 번 더 돌리고 이력에 남긴다.
// 그때까지의 파일은 재실행에 안전하게 쓰는 것이 규칙이었으므로 문제없다.
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { collectMigrations, pendingMigrations } from "./migrations.mjs";

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error("❌ SUPABASE_DB_URL 이 없습니다. .env.local 에 Session pooler URI 를 넣으세요.");
  process.exit(1);
}

const dir = "supabase/migrations";
const { migrations, problems } = collectMigrations(await readdir(dir));
if (problems.length > 0) {
  console.error("❌ 마이그레이션 파일에 문제가 있어 아무것도 적용하지 않았습니다:");
  problems.forEach((problem) => console.error(`   - ${problem}`));
  process.exit(1);
}
if (migrations.length === 0) {
  console.error("❌ supabase/migrations 에 .sql 이 없습니다.");
  process.exit(1);
}

// Supabase CLI 와 같은 모양이다. CLI 가 이미 만들어 둔 표가 있으면 그대로 쓴다.
const HISTORY = "supabase_migrations.schema_migrations";
const ENSURE_HISTORY = `
  create schema if not exists supabase_migrations;
  create table if not exists ${HISTORY} (version text primary key);
  alter table ${HISTORY} add column if not exists name text;
`;

const errorMessage = (e) => (e instanceof Error ? e.message : String(e));

// 파일 내용과 이력 기록을 한 트랜잭션에 넣는다. 둘 다 되거나 둘 다 안 된다.
const apply = async (client, migration) => {
  const sql = await readFile(join(dir, migration.file), "utf8");
  await client.query("begin");
  try {
    await client.query(sql); // 단순 쿼리 프로토콜: 여러 문장·$$ 함수 본문 그대로 실행
    await client.query(`insert into ${HISTORY} (version, name) values ($1, $2)`, [
      migration.version,
      migration.name,
    ]);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw new Error(
      `${migration.file} — ${errorMessage(e)} (이 파일은 통째로 되돌렸고 이력에도 남기지 않았습니다)`,
    );
  }
};

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: true },
  connectionTimeoutMillis: 10_000,
  statement_timeout: 120_000,
});
try {
  await client.connect();
  await client.query("select pg_advisory_lock(736428119)");
  await client.query(ENSURE_HISTORY);
  const { rows } = await client.query(`select version from ${HISTORY}`);
  const pending = pendingMigrations(
    migrations,
    rows.map((row) => row.version),
  );
  const skipped = migrations.length - pending.length;

  if (pending.length === 0)
    console.log(`  새로 적용할 마이그레이션이 없습니다 (이미 적용 ${skipped}개)`);
  else if (skipped > 0) console.log(`  이미 적용된 ${skipped}개는 건너뜁니다`);

  // 사전 질의(ADR-032 D3, 3e 병합 게이트 권고): 20261019000011 은 score_runs.idempotency_key 에 조직 접두어
  // check 를 not valid 로 건다. 접두어 없는 행이 남아 있으면 finish_score_run 이 그 run 에 쓰지 못하므로,
  // 그 파일을 적용하기 전에 상태와 관계없이 0행인지 확인하고 아니면 아무것도 적용하지 않는다.
  const IDEMPOTENCY_CHECK_VERSION = "20261019000011";
  if (pending.some((migration) => migration.version === IDEMPOTENCY_CHECK_VERSION)) {
    const table = await client.query("select to_regclass('public.score_runs') as rel");
    if (table.rows[0]?.rel) {
      const bad = await client.query(
        "select status, count(*)::int as n from public.score_runs where idempotency_key is not null and not starts_with(idempotency_key, org_id::text || ':') group by status",
      );
      if (bad.rows.length > 0)
        throw new Error(
          `score_runs 에 조직 접두어 없는 idempotency_key 행이 있습니다(${bad.rows
            .map((row) => `${row.status}=${row.n}`)
            .join(
              ", ",
            )}). 정리하거나 validate 계획을 세운 뒤 다시 실행하세요. 아무것도 적용하지 않았습니다.`,
        );
      console.log("  ✓ 사전 질의: 조직 접두어 없는 idempotency_key 행 0");
    }
  }

  if (process.argv.includes("--check")) {
    console.log(
      `  --check: 적용하지 않습니다. 미적용 ${pending.length}개${
        pending.length ? `: ${pending.map((migration) => migration.file).join(", ")}` : ""
      }`,
    );
  } else {
    for (const migration of pending) {
      await apply(client, migration);
      console.log("  ✓", migration.file);
    }
  }
} catch (e) {
  console.error("❌ 적용 실패:", errorMessage(e));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
