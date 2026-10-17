import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { freshDb, migratedDb, migrations } from "../database-test-support.mjs";
import { applyMigrations } from "../supabase-pglite.mjs";
import { catalogUuid, orgUuid, personUuid, seedLocalPeople, seedSolideoPeople } from "./seed.mjs";

const fixtures = Object.fromEntries(
  await Promise.all(
    [
      ["departments", "departments"],
      ["jobTitles", "job-titles"],
      ["people", "people"],
    ].map(async ([key, file]) => [
      key,
      JSON.parse(
        await readFile(
          new URL(`../../fixtures/people/solideo.${file}.json`, import.meta.url),
          "utf8",
        ),
      ),
    ]),
  ),
);

const sqlClient = (db) => ({
  async upsert(table, rows, conflictColumn) {
    assert.equal(conflictColumn, table === "team_member_scoring" ? "member_id" : "id");
    for (const row of rows) {
      const columns = Object.keys(row);
      await db.query(
        `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, i) => "$" + (i + 1)).join(",")}) on conflict (${conflictColumn}) do update set ${columns
          .filter((column) => column !== conflictColumn)
          .map((column) => `${column}=excluded.${column}`)
          .join(",")}`,
        columns.map((column) =>
          typeof row[column] === "object" && row[column] !== null
            ? JSON.stringify(row[column])
            : row[column],
        ),
      );
    }
  },
});
const insertOrg = (db) =>
  db.query("insert into public.organizations(id,slug,name) values ($1,'org-01','솔리데오')", [
    orgUuid("org-01"),
  ]);
const roster = async (db) =>
  (
    await db.query(
      "select id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo,created_at from public.team_members order by id",
    )
  ).rows;
const scoring = async (db) =>
  (
    await db.query(
      "select member_id,org_id,role,grade,skills,availability,created_at from public.team_member_scoring order by member_id",
    )
  ).rows;

it("계층 카탈로그와 운영 200명·점수 27명을 두 번 넣어도 동일 UUID·값이며 Auth를 호출하지 않는다", async (t) => {
  assert.equal(personUuid("SOL-P0001"), "591e9ea0-0946-5534-89ea-5b4ad722a820");
  const fresh = await migratedDb(t);
  await insertOrg(fresh);
  const client = sqlClient(fresh);
  Object.defineProperty(client, "auth", {
    get() {
      throw new Error("Auth not allowed");
    },
  });
  // Children occur first in the fixture; the seed must order parents before referencing them.
  const shuffled = structuredClone(fixtures);
  shuffled.departments.departments.reverse();
  const authBefore = (await fresh.query("select id from auth.users order by id")).rows;
  assert.deepEqual(
    await seedSolideoPeople({ client, orgId: orgUuid("org-01"), fixtures: shuffled }),
    { peopleCount: 200 },
  );
  const before = await roster(fresh);
  const scoresBefore = await scoring(fresh);
  await seedSolideoPeople({ client, orgId: orgUuid("org-01"), fixtures: shuffled });
  assert.equal(before.length, 200);
  assert.deepEqual(await roster(fresh), before);
  assert.deepEqual(await scoring(fresh), scoresBefore);
  assert.equal(scoresBefore.length, 27);
  assert.deepEqual(
    (
      await fresh.query(
        "select kind,count(*)::int as count from public.departments group by kind order by kind",
      )
    ).rows,
    [
      { kind: "DIVISION", count: 6 },
      { kind: "GROUP", count: 4 },
      { kind: "TEAM", count: 38 },
    ],
  );
  assert.equal(
    (await fresh.query("select * from public.departments where parent_id is not null")).rows.length,
    13,
  );
  assert.equal((await fresh.query("select * from public.job_titles")).rows.length, 12);
  assert.deepEqual(
    (
      await fresh.query(
        "select gender,count(*)::int as count from public.team_members group by gender order by gender",
      )
    ).rows,
    [
      { gender: "FEMALE", count: 100 },
      { gender: "MALE", count: 100 },
    ],
  );
  assert.deepEqual((await fresh.query("select id from auth.users order by id")).rows, authBefore);
  const columns = (
    await fresh.query(
      "select column_name from information_schema.columns where table_schema='public' and table_name='team_members'",
    )
  ).rows.map((row) => row.column_name);
  for (const column of ["scoring_eligible", "role", "grade", "skills", "availability"])
    assert.ok(!columns.includes(column));
  assert.ok(columns.includes("updated_at"));
  assert.deepEqual(
    scoresBefore.map(({ member_id, org_id, role, grade, skills, availability }) => ({
      member_id,
      org_id,
      role,
      grade,
      skills,
      availability,
    })),
    fixtures.people.people
      .filter((person) => person.scoringEligible)
      .map((person) => ({
        member_id: personUuid(person.personId),
        org_id: orgUuid("org-01"),
        role: person.role,
        grade: person.grade,
        skills: person.skills,
        availability: person.availability,
      }))
      .sort((a, b) => a.member_id.localeCompare(b.member_id)),
  );
});

it("구 스키마의 실제 200행을 업그레이드하면서 eligible 27행의 모든 점수 값을 검증·backfill한다", async (t) => {
  const db = await freshDb(t);
  await applyMigrations(
    db,
    migrations.filter((migration) => migration.version < "20261016000003"),
  );
  await insertOrg(db);
  const client = sqlClient(db);
  const orgId = orgUuid("org-01");
  await client.upsert(
    "departments",
    fixtures.departments.departments
      .filter((department) => (department.kind ?? "TEAM") === "TEAM")
      .map((department) => ({
        id: catalogUuid(department.id),
        org_id: orgId,
        code: department.id,
        name: department.name,
        source_count: department.sourceCount,
        target_count: department.targetCount,
        is_demo: true,
      })),
    "id",
  );
  await client.upsert(
    "job_titles",
    fixtures.jobTitles.jobTitles.map((title) => ({
      id: catalogUuid(title.id),
      org_id: orgId,
      code: title.id,
      label: title.label,
      sort_order: title.sortOrder,
    })),
    "id",
  );
  await client.upsert(
    "team_members",
    fixtures.people.people.map((person) => ({
      id: personUuid(person.personId),
      org_id: orgId,
      person_code: person.personId,
      name: person.name,
      gender: person.gender,
      department_id: catalogUuid(person.departmentId),
      job_title_id: catalogUuid(person.jobTitleId),
      portrait_path: person.portraitPath,
      is_demo: person.isDemo,
      scoring_eligible: person.scoringEligible,
      role: person.role,
      grade: person.grade,
      skills: person.skills,
      availability: person.availability,
    })),
    "id",
  );
  const before = await roster(db);
  const eligible = (
    await db.query(
      "select id as member_id,org_id,role,grade,skills,availability,created_at from public.team_members where scoring_eligible order by id",
    )
  ).rows;
  assert.equal(eligible.length, 27);
  assert.ok(eligible.some((row) => row.skills.length > 0 && row.availability.length > 0));
  // A conflicting partial backfill must abort transactionally, never erase the old input.
  await db.exec(
    "create table public.team_member_scoring as select id as member_id,org_id,role || '_CORRUPT' as role,grade,skills,availability,created_at from public.team_members where scoring_eligible; alter table public.team_member_scoring add primary key(member_id)",
  );
  await assert.rejects(
    applyMigrations(
      db,
      migrations.filter((migration) => migration.version >= "20261016000003"),
    ),
    /people_scoring_backfill_mismatch/,
  );
  assert.deepEqual(
    (
      await db.query(
        "select id as member_id,org_id,role,grade,skills,availability,created_at from public.team_members where scoring_eligible order by id",
      )
    ).rows,
    eligible,
  );
  assert.equal(
    (
      await db.query(
        "select column_name from information_schema.columns where table_schema='public' and table_name='departments' and column_name='kind'",
      )
    ).rows.length,
    0,
  );
  await db.exec("drop table public.team_member_scoring");
  await applyMigrations(
    db,
    migrations.filter((migration) => migration.version >= "20261016000003"),
  );
  assert.deepEqual(await roster(db), before);
  assert.deepEqual(await scoring(db), eligible);
  await seedSolideoPeople({ client, orgId, fixtures });
  await seedSolideoPeople({ client, orgId, fixtures });
  assert.deepEqual(await roster(db), before);
  assert.deepEqual(await scoring(db), eligible);
});

it("잘못된 계층은 두 seed 진입점 모두 조직을 포함한 쓰기 전에 거절한다", async (t) => {
  const invalid = structuredClone(fixtures);
  invalid.departments.departments[0].parentId = invalid.departments.departments[0].id;
  let writes = 0;
  const client = {
    async upsert() {
      writes++;
    },
  };
  t.mock.method(globalThis, "fetch", async () => {
    writes++;
    return new Response(null, { status: 201 });
  });
  await assert.rejects(
    seedSolideoPeople({ client, orgId: orgUuid("org-01"), fixtures: invalid }),
    /hierarchy/i,
  );
  await assert.rejects(
    seedLocalPeople({ apiUrl: "http://127.0.0.1:54321", serviceKey: "unused", fixtures: invalid }),
    /hierarchy/i,
  );
  assert.equal(writes, 0);
});

it("로컬 HTTP adapter는 점수에 member_id 충돌 키를 쓰고 카탈로그를 명부보다 먼저 전송한다", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url: new URL(url), rows: JSON.parse(options.body) });
    return new Response(null, { status: 201 });
  });
  assert.deepEqual(
    await seedLocalPeople({ apiUrl: "http://127.0.0.1:54321", serviceKey: "unused", fixtures }),
    { peopleCount: 200 },
  );
  assert.equal(requests[0].url.pathname, "/rest/v1/organizations");
  for (const request of requests)
    assert.equal(
      request.url.searchParams.get("on_conflict"),
      request.url.pathname.endsWith("team_member_scoring") ? "member_id" : "id",
    );
  assert.equal(requests.at(-2).url.pathname, "/rest/v1/team_members");
  assert.equal(requests.at(-1).url.pathname, "/rest/v1/team_member_scoring");
  assert.equal(requests.at(-1).rows.length, 27);
});

it("people seed는 비로컬 요청을 HTTP 전에 거절한다", async () => {
  await assert.rejects(
    seedLocalPeople({ apiUrl: "https://remote.supabase.co", serviceKey: "unused", fixtures }),
    /로컬/,
  );
});
