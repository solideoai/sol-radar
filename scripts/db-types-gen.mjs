#!/usr/bin/env node
// db-types-gen.mjs — supabase/migrations 에서 웹·앱의 DB 타입(lib/database.types.ts)을 만든다.
//
//   pnpm db:types         생성
//   pnpm check:db-types   생성물이 마이그레이션과 어긋나는지만 검사 (게이트·CI용, --check)
//
// 디자인 토큰(tokens-gen.mjs)과 같은 '정본 → 생성물' 방식이다. 스키마의 정본은 마이그레이션이고,
// 타입은 마이그레이션을 Supabase 흉내 DB(supabase-pglite.mjs)에 적용한 뒤 public 스키마의 카탈로그를
// 읽어 만든다. 실제 DB·네트워크·Docker·Supabase CLI 에 기대지 않으므로 커밋 게이트·CI 에서도 같은
// 결과가 나온다. 모양은 `supabase gen types typescript` 출력과 같아서 supabase-js 의 제네릭
// (createClient<Database>)이 그대로 받는다.
//
// 시험용 인자: --root <폴더>(생성물을 둘 저장소 루트), --migrations <폴더>(기본: <root>/supabase/migrations)
// 이 스크립트가 만든 파일은 손으로 고치지 않는다 — 다음 생성에서 덮이고, 그 전에 게이트가 막는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyMigrations, createSupabaseDb, loadMigrations } from "./supabase-pglite.mjs";

// ── 1. 카탈로그 읽기 ──────────────────────────────────────────────

// 화면이 PostgREST 로 닿는 것은 public 스키마뿐이다. auth 등 다른 스키마는 타입에 넣지 않는다.
const SCHEMA = "public";

const TYPES_SQL = `
  select t.oid::int as oid, t.typname as name, n.nspname as schema, t.typtype as kind, t.typcategory as category,
         t.typelem::int as elem, t.typbasetype::int as base, r.relkind as rel_kind
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  left join pg_class r on r.oid = t.typrelid`;

const ENUM_LABELS_SQL =
  "select e.enumtypid::int as type, e.enumlabel as label from pg_enum e order by e.enumtypid, e.enumsortorder";

// 20 = UPDATE(4) + DELETE(16) 비트. postgres-meta(Supabase 타입 생성기)와 같은 기준으로 '고칠 수 있는 뷰'를 가른다.
const RELATIONS_SQL = `
  select c.oid::int as oid, c.relname as name, c.relkind as kind,
         (pg_relation_is_updatable(c.oid, false) & 20) = 20 as updatable
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm')`;

const COLUMNS_SQL = `
  select a.attrelid::int as rel, a.attname as name, a.atttypid::int as type, a.attnotnull as not_null,
         a.atthasdef as has_default, a.attidentity as identity, a.attgenerated as generated,
         pg_column_is_updatable(a.attrelid, a.attnum, false) as updatable
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = $1 and c.relkind in ('r', 'p', 'v', 'm') and a.attnum > 0 and not a.attisdropped`;

// 외래 키는 양쪽이 모두 public 인 것만. auth.users 를 가리키는 키는 화면에서 따라갈 수 없다.
// isOneToOne: 키 열 묶음이 그 표에서 유일(기본 키·unique)하면 한 행이 한 행만 가리킨다.
const FOREIGN_KEYS_SQL = `
  select con.conname as name, src.relname as "table", tgt.relname as referenced,
         array(select a.attname from unnest(con.conkey) with ordinality k(num, ord)
               join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.num order by k.ord) as columns,
         array(select a.attname from unnest(con.confkey) with ordinality k(num, ord)
               join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.num order by k.ord) as referenced_columns,
         exists (select 1 from pg_index i
                 where i.indrelid = con.conrelid and i.indisunique and i.indpred is null and i.indexprs is null
                   and (select array_agg(x order by x) from unnest(i.indkey::int2[]) x)
                     = (select array_agg(x order by x) from unnest(con.conkey) x)) as one_to_one
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid join pg_namespace sn on sn.oid = src.relnamespace
  join pg_class tgt on tgt.oid = con.confrelid join pg_namespace tn on tn.oid = tgt.relnamespace
  where con.contype = 'f' and sn.nspname = $1 and tn.nspname = $1`;

// 트리거 함수는 rpc 로 부를 수 없으니 뺀다. 확장이 깐 함수도 우리 스키마가 아니라서 뺀다.
const FUNCTIONS_SQL = `
  select p.proname as name, p.prorettype::int as returns, p.proretset as returns_set,
         p.proargtypes::oid[] as in_types, p.proallargtypes as all_types, p.proargmodes as modes,
         p.proargnames as names, p.pronargdefaults as defaults
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = $1 and p.prokind = 'f'
    and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    and not exists (select 1 from pg_depend d
                    where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')`;

// 독립 복합 타입(create type ... as (...))만. 표·뷰의 행 타입은 Tables·Views 가 이미 담는다.
const COMPOSITE_ATTRIBUTES_SQL = `
  select t.typname as type, a.attname as name, a.atttypid::int as attr_type
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_class c on c.oid = t.typrelid and c.relkind = 'c'
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = $1 and t.typtype = 'c'`;

const rowsOf = async (pglite, sql, params = []) => (await pglite.query(sql, params)).rows;

// 마이그레이션을 적용한 DB → 렌더링에 필요한 것만 담은 순수한 값.
export const readSchema = async (pglite) => {
  const [types, enumLabels, relations, columns, foreignKeys, functions, compositeAttributes] =
    await Promise.all([
      rowsOf(pglite, TYPES_SQL),
      rowsOf(pglite, ENUM_LABELS_SQL),
      rowsOf(pglite, RELATIONS_SQL, [SCHEMA]),
      rowsOf(pglite, COLUMNS_SQL, [SCHEMA]),
      rowsOf(pglite, FOREIGN_KEYS_SQL, [SCHEMA]),
      rowsOf(pglite, FUNCTIONS_SQL, [SCHEMA]),
      rowsOf(pglite, COMPOSITE_ATTRIBUTES_SQL, [SCHEMA]),
    ]);
  return { types, enumLabels, relations, columns, foreignKeys, functions, compositeAttributes };
};

// ── 2. PostgreSQL 타입 → TypeScript 타입 ─────────────────────────

// supabase-js 의 select 파서(postgrest-js)와 같은 대응을 쓴다. 날짜·시간은 PostgREST 가 문자열로 돌려준다.
const BASE_TYPES = new Map([
  ...["bool"].map((name) => [name, "boolean"]),
  ...["int2", "int4", "int8", "float4", "float8", "numeric", "oid"].map((name) => [name, "number"]),
  ...[
    "text",
    "varchar",
    "bpchar",
    "char",
    "name",
    "citext",
    "uuid",
    "bytea",
    "date",
    "time",
    "timetz",
    "timestamp",
    "timestamptz",
    "interval",
    "inet",
    "cidr",
    "macaddr",
    "macaddr8",
    "money",
    "bit",
    "varbit",
    "xml",
    "tsvector",
    "tsquery",
    "vector",
  ].map((name) => [name, "string"]),
  ...["json", "jsonb"].map((name) => [name, "Json"]),
  ["void", "undefined"],
  ["record", "Record<string, unknown>"],
]);

const quote = (text) => JSON.stringify(text);
// 식별자로 쓸 수 있는 이름은 따옴표 없이, 아니면 따옴표로 감싼다(supabase gen types 와 같다).
const key = (name) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name));
// 로캘에 따라 순서가 바뀌지 않게 코드 포인트로 비교한다. 출력이 어느 컴퓨터에서나 같아야 --check 가 믿을 만하다.
const byText = (pick) => (a, b) => (pick(a) < pick(b) ? -1 : pick(a) > pick(b) ? 1 : 0);
const byName = byText((item) => item.name);
const groupBy = (items, pick) =>
  items.reduce(
    (groups, item) => groups.set(pick(item), [...(groups.get(pick(item)) ?? []), item]),
    new Map(),
  );
const arrayOf = (type) => (/[ |&]/.test(type) && !/^[{(]/.test(type) ? `(${type})[]` : `${type}[]`);
const schemaRef = (section, name, suffix = "") =>
  `Database[${quote(SCHEMA)}][${quote(section)}][${quote(name)}]${suffix}`;

const makeTypeMapper = ({ types, enumLabels }) => {
  const typeByOid = new Map(types.map((type) => [type.oid, type]));
  const labelsByType = groupBy(enumLabels, (row) => row.type);
  const tsType = (oid) => {
    const type = typeByOid.get(oid);
    if (!type) return "unknown";
    if (type.kind === "d") return tsType(type.base);
    if (type.category === "A" && type.elem) return arrayOf(tsType(type.elem));
    if (type.kind === "e") {
      if (type.schema === SCHEMA) return schemaRef("Enums", type.name);
      const labels = (labelsByType.get(oid) ?? []).map((row) => quote(row.label));
      return labels.length > 0 ? labels.join(" | ") : "never";
    }
    if (type.kind === "c" && type.schema === SCHEMA) {
      if (type.rel_kind === "c") return schemaRef("CompositeTypes", type.name);
      if (["r", "p"].includes(type.rel_kind)) return schemaRef("Tables", type.name, '["Row"]');
      if (["v", "m"].includes(type.rel_kind)) return schemaRef("Views", type.name, '["Row"]');
    }
    return BASE_TYPES.get(type.name) ?? "unknown";
  };
  return tsType;
};

// ── 3. 렌더링 ────────────────────────────────────────────────────
// 줄 배열로 만들고 들여쓰기를 덧붙인다. 값이 여러 줄이면 첫 줄은 키 바로 뒤에 붙는다.

const indent = (lines) => lines.map((line) => `  ${line}`);
const member = (name, valueLines) => [`${name}: ${valueLines[0]}`, ...valueLines.slice(1)];
const object = (lines) => ["{", ...indent(lines), "}"];
// 비어 있는 묶음은 supabase gen types 처럼 "키가 하나도 없는 객체"로 둔다.
const section = (lines) => object(lines.length > 0 ? lines : ["[_ in never]: never"]);
const inlineObject = (fields) =>
  fields.length > 0 ? `{ ${fields.join("; ")} }` : "Record<PropertyKey, never>";
// unknown 은 이미 null 을 품는다. "unknown | null" 은 같은 뜻이라 줄여 쓴다.
const nullable = (type, isNullable) => (isNullable && type !== "unknown" ? `${type} | null` : type);

// 항상 DB 가 채우는 열(identity always·generated)은 넣거나 고칠 수 없다.
const isGeneratedAlways = (column) => column.identity === "a" || column.generated !== "";

const rowField = (tsType) => (column) =>
  `${key(column.name)}: ${nullable(tsType(column.type), !column.not_null)}`;
const insertField = (tsType) => (column) => {
  if (isGeneratedAlways(column)) return `${key(column.name)}?: never`;
  // 기본값·null 허용·identity 가 있으면 DB 가 채워 주므로 넣지 않아도 된다.
  const optional = !column.not_null || column.has_default || column.identity !== "";
  return `${key(column.name)}${optional ? "?" : ""}: ${nullable(tsType(column.type), !column.not_null)}`;
};
const updateField = (tsType) => (column) =>
  isGeneratedAlways(column)
    ? `${key(column.name)}?: never`
    : `${key(column.name)}?: ${nullable(tsType(column.type), !column.not_null)}`;
// 고칠 수 있는 뷰라도 계산된 열은 고칠 수 없다.
const viewWriteField = (tsType) => (column) =>
  column.updatable
    ? `${key(column.name)}?: ${nullable(tsType(column.type), !column.not_null)}`
    : `${key(column.name)}?: never`;

const relationshipLines = (foreignKeys) => {
  if (foreignKeys.length === 0) return ["[]"];
  const items = [...foreignKeys]
    .sort(byText((fk) => `${fk.name}\u0000${fk.referenced}`))
    .flatMap((fk) => [
      ...object([
        `foreignKeyName: ${quote(fk.name)}`,
        `columns: [${fk.columns.map(quote).join(", ")}]`,
        `isOneToOne: ${fk.one_to_one}`,
        `referencedRelation: ${quote(fk.referenced)}`,
        `referencedColumns: [${fk.referenced_columns.map(quote).join(", ")}]`,
      ]).map((line, i, lines) => (i === lines.length - 1 ? `${line},` : line)),
    ]);
  return ["[", ...indent(items), "]"];
};

const relationLines = (schema, tsType) => {
  const columnsByRel = groupBy(schema.columns, (column) => column.rel);
  const keysByTable = groupBy(schema.foreignKeys, (fk) => fk.table);
  const render = (relation, parts) =>
    member(key(relation.name), object(parts.flatMap(([name, lines]) => member(name, lines))));
  const columnsOf = (relation) => [...(columnsByRel.get(relation.oid) ?? [])].sort(byName);
  const relations = [...schema.relations].sort(byName);

  const tables = relations
    .filter((relation) => ["r", "p"].includes(relation.kind))
    .flatMap((table) =>
      render(table, [
        ["Row", object(columnsOf(table).map(rowField(tsType)))],
        ["Insert", object(columnsOf(table).map(insertField(tsType)))],
        ["Update", object(columnsOf(table).map(updateField(tsType)))],
        ["Relationships", relationshipLines(keysByTable.get(table.name) ?? [])],
      ]),
    );

  // 뷰는 외래 키가 없다. 고칠 수 없는 뷰(구체화된 뷰 포함)는 Row 만 둔다.
  const views = relations
    .filter((relation) => ["v", "m"].includes(relation.kind))
    .flatMap((view) =>
      render(view, [
        ["Row", object(columnsOf(view).map(rowField(tsType)))],
        ...(view.kind === "v" && view.updatable
          ? [
              ["Insert", object(columnsOf(view).map(viewWriteField(tsType)))],
              ["Update", object(columnsOf(view).map(viewWriteField(tsType)))],
            ]
          : []),
        ["Relationships", ["[]"]],
      ]),
    );

  return { tables, views };
};

// 인자 없는 함수는 Args: never 로 둔다. postgrest-js 의 rpc(name) 이 인자 없이 부를 때 이 모양을 고른다.
const functionLines = (schema, tsType) => {
  const signature = (fn) => {
    const allTypes = fn.all_types ?? fn.in_types;
    const modes = fn.modes ?? allTypes.map(() => "i");
    const params = allTypes.map((type, i) => ({ type, mode: modes[i], name: fn.names?.[i] ?? "" }));
    const inputs = params.filter((param) => ["i", "b", "v"].includes(param.mode));
    const outputs = params.filter((param) => ["o", "b", "t"].includes(param.mode));
    // 기본값은 뒤쪽 입력 인자부터 붙는다.
    const firstOptional = inputs.length - fn.defaults;
    const args = inputs
      .map((param, i) => ({
        name: param.name,
        field: `${key(param.name)}${i >= firstOptional ? "?" : ""}: ${tsType(param.type)}`,
      }))
      .sort(byName)
      .map((arg) => arg.field);
    // returns table(...) 이나 out 인자가 여럿이면 한 행이 객체다. out 인자가 하나면 그 값 자체가 반환값이다.
    const rowFields = [...outputs]
      .sort(byName)
      .map((param) => `${key(param.name)}: ${tsType(param.type)}`);
    const row =
      modes.includes("t") || outputs.length > 1 ? inlineObject(rowFields) : tsType(fn.returns);
    return {
      args: args.length > 0 ? inlineObject(args) : "never",
      returns: fn.returns_set ? arrayOf(row) : row,
    };
  };
  return [...groupBy(schema.functions, (fn) => fn.name)]
    .sort(byText(([name]) => name))
    .flatMap(([name, overloads]) => {
      const signatures = overloads
        .map(signature)
        .sort(byText((sig) => `${sig.args}\u0000${sig.returns}`));
      if (signatures.length === 1)
        return member(
          key(name),
          object([`Args: ${signatures[0].args}`, `Returns: ${signatures[0].returns}`]),
        );
      // 같은 이름의 함수가 여럿이면(오버로드) 합집합으로 둔다. rpc 가 넘긴 인자로 하나를 고른다.
      return [
        `${key(name)}:`,
        ...indent(signatures.map((sig) => `| { Args: ${sig.args}; Returns: ${sig.returns} }`)),
      ];
    });
};

const enumLines = (schema) => {
  const publicEnums = schema.types
    .filter((type) => type.kind === "e" && type.schema === SCHEMA)
    .sort(byName);
  const labelsByType = groupBy(schema.enumLabels, (row) => row.type);
  return publicEnums.map((type) => {
    const labels = (labelsByType.get(type.oid) ?? []).map((row) => quote(row.label));
    return `${key(type.name)}: ${labels.length > 0 ? labels.join(" | ") : "never"}`;
  });
};

// 복합 타입의 속성은 null 이 될 수 있다(PostgreSQL 은 속성에 not null 을 걸 수 없다).
const compositeLines = (schema, tsType) =>
  [...groupBy(schema.compositeAttributes, (attr) => attr.type)]
    .sort(byText(([name]) => name))
    .flatMap(([name, attrs]) =>
      member(
        key(name),
        object(
          [...attrs]
            .sort(byName)
            .map((attr) => `${key(attr.name)}: ${tsType(attr.attr_type)} | null`),
        ),
      ),
    );

const BANNER = `// 생성물 — 손으로 고치지 말 것 (pnpm db:types).
// 정본은 supabase/migrations 다. 마이그레이션을 PGlite 에 적용해 public 스키마에서 만든다(scripts/db-types-gen.mjs).
// 모양은 \`supabase gen types typescript\` 출력과 같다. 코드에서는 SupabaseClient<Database> 로 쓴다.`;

const JSON_TYPE = `export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]`;

// supabase gen types 가 함께 내는 도우미 타입. Tables<"profiles"> 처럼 행·입력·수정 타입을 꺼낸다.
const HELPERS = `type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never`;

// readSchema 의 값 → database.types.ts 내용. 같은 스키마면 항상 같은 글자가 나온다.
export const renderTypes = (schema) => {
  const tsType = makeTypeMapper(schema);
  const { tables, views } = relationLines(schema, tsType);
  const publicSchema = member(
    key(SCHEMA),
    object([
      ...member("Tables", section(tables)),
      ...member("Views", section(views)),
      ...member("Functions", section(functionLines(schema, tsType))),
      ...member("Enums", section(enumLines(schema))),
      ...member("CompositeTypes", section(compositeLines(schema, tsType))),
    ]),
  );
  return [
    BANNER,
    "",
    JSON_TYPE,
    "",
    "export type Database = {",
    ...indent(publicSchema),
    "}",
    "",
    HELPERS,
    "",
  ].join("\n");
};

// 마이그레이션 폴더 → database.types.ts 내용. 매번 빈 흉내 DB 에서 처음부터 적용한다.
export const generateTypes = async (migrationsDir) => {
  const migrations = await loadMigrations(migrationsDir);
  const pglite = await createSupabaseDb();
  try {
    await applyMigrations(pglite, migrations);
    return renderTypes(await readSchema(pglite));
  } finally {
    await pglite.close();
  }
};

// ── 4. 실행 ──────────────────────────────────────────────────────

// 웹·앱 중 한쪽만 쓰는 프로젝트도 있다. package.json 이 없는 폴더의 생성물은 만들지도 검사하지도 않는다.
const OUTPUTS = [
  ["web", "web/lib/database.types.ts"],
  ["mobile", "mobile/lib/database.types.ts"],
];

const optionValue = (args, name) => {
  const at = args.indexOf(name);
  if (at === -1) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} 뒤에 폴더 경로를 적으세요`);
  return resolve(value);
};

const run = async (args) => {
  const check = args.includes("--check");
  const root = optionValue(args, "--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..");
  const migrationsDir = optionValue(args, "--migrations") ?? join(root, "supabase/migrations");
  const targets = OUTPUTS.filter(([folder]) => existsSync(join(root, folder, "package.json"))).map(
    ([, rel]) => rel,
  );

  if (targets.length === 0) {
    console.log("- web/·mobile/ 이 없어 DB 타입 생성을 건너뜁니다");
    return 0;
  }
  if (!existsSync(migrationsDir)) {
    console.error(`❌ 마이그레이션 폴더가 없습니다: ${migrationsDir}`);
    return 1;
  }

  const content = await generateTypes(migrationsDir);
  const drift = targets.filter((rel) => {
    const path = join(root, rel);
    return !existsSync(path) || readFileSync(path, "utf8") !== content;
  });

  if (check) {
    if (drift.length > 0) {
      console.error("❌ DB 타입 생성물이 마이그레이션과 어긋납니다:");
      drift.forEach((rel) => console.error(`   ${rel}`));
      console.error(
        "   마이그레이션을 추가했으면 `pnpm db:types` 를 돌려 생성물을 갱신하고 함께 커밋하세요.",
      );
      console.error(
        "   생성물을 직접 고쳤다면 그 수정은 새 마이그레이션(supabase/migrations)으로 옮겨야 합니다.",
      );
      return 1;
    }
    console.log("✓ DB 타입 일치 — 정본 supabase/migrations");
    return 0;
  }

  targets.forEach((rel) => {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
    console.log(`생성: ${rel}`);
  });
  return 0;
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await run(process.argv.slice(2));
  } catch (error) {
    console.error(`❌ DB 타입을 만들지 못했습니다: ${error.message}`);
    process.exitCode = 1;
  }
}
