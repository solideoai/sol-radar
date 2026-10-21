// 시험 전용 도우미(C7 G2 시험의 실제 DB 쪽). 제품 코드가 import 하지 않는다.
// PGlite(scripts/supabase-pglite.mjs)에 실제 마이그레이션을 올리고, 실제 supabase-js 클라이언트의 요청을 그 DB 로 잇는 다리를 둔다.
// 다리는 worker 처럼 service role 로 돈다(화면 역할을 벗고 service_role claim 을 싣는다 — scripts/database.test.mjs 와 같은 흉내).
//   GET    /<표>        표 전체를 읽어 요청의 필터·정렬·limit·select 를 적용한다(필터 흉내는 outbox.test-support). numeric·bigint 는 JSON 수다.
//   POST   /<표>        행마다 insert. on_conflict 와 Prefer resolution=ignore-duplicates 면 on conflict do nothing,
//                       merge-duplicates 면 on conflict do update(PostgREST upsert 와 같다).
//   PATCH  /<표>        필터에 맞는 행(id)만 본문으로 update.
//   POST   /rpc/<함수>  select * from public.<함수>(p::jsonb).
// DB 오류는 PostgREST 처럼 { code, message } 400(23505 는 409)으로 답한다. 실제 네트워크·Supabase 는 부르지 않는다.
import { fileURLToPath } from "node:url";
import {
  applyMigrations,
  createSupabaseDb,
  loadMigrations,
} from "@test-harness/supabase-pglite.mjs";
import {
  bodyRows,
  conflictColumns,
  fakeSupabase,
  filteredReply,
  matchOrReply,
  projectedReply,
  type FakeRow,
  type PostgrestCall,
  type PostgrestReply,
} from "./outbox.test-support";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

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

/** worker 자리 — 화면 역할을 벗고 service_role claim 을 싣는다. */
export async function asServiceRole(db: SqlDb): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
}

/** JWT 없는 관리 작업(seed 자리). auth.uid() 가 null 이다. */
export async function asAdminTask(db: SqlDb): Promise<void> {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', '', false)");
}

const NAME = /^[a-z_]+$/;
const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

/** PostgREST 가 JSON 수로 내보내는 열 타입. PGlite 는 이 값을 글자로 준다. */
const NUMBER_TYPES = new Set(["bigint", "numeric"]);

/**
 * PGlite 값 → PostgREST JSON 값. 시각(Date)은 ISO 문자열이다. 열 타입을 알면(types) numeric·bigint 글자를 수로 바꾼다
 * (budget_krw numeric(18, 0) 등 — PostgREST 처럼).
 */
const toJsonRow = (row: Record<string, unknown>, types?: Map<string, string>): FakeRow =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => {
      if (value instanceof Date) return [key, value.toISOString()];
      const type = types?.get(key);
      if (type !== undefined && NUMBER_TYPES.has(type) && typeof value === "string") {
        return [key, Number(value)];
      }
      return [key, value];
    }),
  );

async function columnTypes(db: SqlDb, table: string): Promise<Map<string, string>> {
  const { rows } = await db.query<{ column_name: string; data_type: string }>(
    "select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1",
    [table],
  );
  if (rows.length === 0) throw new Error(`public.${table} 표가 없다`);
  return new Map(rows.map((row) => [row.column_name, row.data_type]));
}

/** JSON 값을 열 타입에 맞춰 넣는다. jsonb 는 JSON 문자열, null 은 SQL NULL. */
const toParam = (type: string | undefined, value: unknown): unknown => {
  if (value === null || value === undefined) return null;
  return type === "jsonb" ? JSON.stringify(value) : value;
};

const dbErrorReply = (error: unknown): PostgrestReply => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "XX000";
  const message = error instanceof Error ? error.message : "db error";
  return {
    status: code === "23505" ? 409 : 400,
    body: { code, message, details: null, hint: null },
  };
};

async function insert(db: SqlDb, table: string, call: PostgrestCall): Promise<PostgrestReply> {
  const types = await columnTypes(db, table);
  const onConflict = conflictColumns(call);
  const ignore = call.prefer.includes("resolution=ignore-duplicates");
  const merge = call.prefer.includes("resolution=merge-duplicates");
  const inserted: FakeRow[] = [];
  for (const body of bodyRows(call)) {
    const entries = Object.entries(body).filter(([, value]) => value !== undefined);
    const columns = entries.map(([column]) => column);
    if (!columns.every((column) => types.has(column))) {
      return { status: 400, body: { code: "PGRST204", message: "없는 열" } };
    }
    const params = entries.map(([column, value]) => toParam(types.get(column), value));
    const target = onConflict.map(quoteIdent).join(", ");
    const updates = columns
      .filter((column) => !onConflict.includes(column))
      .map((column) => `${quoteIdent(column)} = excluded.${quoteIdent(column)}`)
      .join(", ");
    const conflict =
      onConflict.length === 0 || !(ignore || merge)
        ? ""
        : ignore
          ? ` on conflict (${target}) do nothing`
          : ` on conflict (${target}) do update set ${updates}`;
    const { rows } = await db.query(
      `insert into public.${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) values (${columns
        .map((_, index) => `$${index + 1}`)
        .join(", ")})${conflict} returning *`,
      params,
    );
    inserted.push(...rows.map((row) => toJsonRow(row, types)));
  }
  return call.prefer.includes("return=representation")
    ? projectedReply(call, inserted, 201)
    : { status: 201 };
}

async function update(db: SqlDb, table: string, call: PostgrestCall): Promise<PostgrestReply> {
  const types = await columnTypes(db, table);
  const all = (await db.query(`select * from public.${quoteIdent(table)}`)).rows.map((row) =>
    toJsonRow(row, types),
  );
  const matched = matchOrReply(call, all);
  if ("reply" in matched) return matched.reply;
  const patch = Object.entries(bodyRows(call)[0] ?? {}).filter(([, value]) => value !== undefined);
  const ids = matched.rows.map((row) => row.id);
  let changed: FakeRow[] = [];
  if (ids.length > 0 && patch.length > 0) {
    const params: unknown[] = patch.map(([column, value]) => toParam(types.get(column), value));
    params.push(ids);
    const sets = patch.map(([column], index) => `${quoteIdent(column)} = $${index + 1}`);
    const { rows } = await db.query(
      `update public.${quoteIdent(table)} set ${sets.join(", ")} where id = any($${params.length}) returning *`,
      params,
    );
    changed = rows.map((row) => toJsonRow(row, types));
  }
  return call.prefer.includes("return=representation")
    ? projectedReply(call, changed)
    : { status: 204 };
}

async function rpc(db: SqlDb, name: string, call: PostgrestCall): Promise<PostgrestReply> {
  const body = call.body;
  const p = typeof body === "object" && body !== null && "p" in body ? body.p : null;
  const { rows } = await db.query(`select * from public.${quoteIdent(name)}($1::jsonb)`, [
    JSON.stringify(p),
  ]);
  return { status: 200, body: rows.map((row) => toJsonRow(row)) };
}

/** PGlite 를 PostgREST 처럼 답하는 실제 supabase-js 클라이언트. 요청 기록(calls)도 함께 돌려준다. */
export function pgliteSupabase(db: SqlDb) {
  return fakeSupabase(async (call) => {
    await asServiceRole(db);
    try {
      if (call.table.startsWith("rpc/")) {
        const name = call.table.slice("rpc/".length);
        if (!NAME.test(name) || call.method !== "POST") return undefined;
        return await rpc(db, name, call);
      }
      if (!NAME.test(call.table)) return undefined;
      if (call.method === "GET") {
        const types = await columnTypes(db, call.table);
        const { rows } = await db.query(`select * from public.${quoteIdent(call.table)}`);
        return filteredReply(
          call,
          rows.map((row) => toJsonRow(row, types)),
        );
      }
      if (call.method === "POST") return await insert(db, call.table, call);
      if (call.method === "PATCH") return await update(db, call.table, call);
      return undefined;
    } catch (error) {
      return dbErrorReply(error);
    }
  });
}
