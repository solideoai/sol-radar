import assert from "node:assert/strict";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import { freshDb, migrations } from "../database-test-support.mjs";
import { applyMigrations } from "../supabase-pglite.mjs";
import { assignmentsOf, foldAssignmentsIntoAvailability } from "./availability.mjs";
import { catalogUuid, loadPeopleFixtures, orgUuid, seedSolideoPeople } from "./seed.mjs";

const version = "20261021000600";
const fixture = await loadPeopleFixtures();
const upgrade = migrations.find((migration) => migration.version === version);
// 20261021000600 이 운영 DB 에 넣은 v1 값. 수행 이력은 20261029001000 이 v2 로, 등급·수행 이력은 20261030001000 이 v3 로 바꾼다.
const v1Rows = JSON.parse(upgrade.sql.match(/\$profiles\$(.*)\$profiles\$/s)[1]);
const historyVersion = "20261029001000";
const history = migrations.find((migration) => migration.version === historyVersion);
const v2Rows = new Map(
  JSON.parse(history.sql.match(/\$projects\$(.*)\$projects\$/s)[1]).map((row) => [
    row.person_code,
    row,
  ]),
);
const alignVersion = "20261030001000";
const align = migrations.find((migration) => migration.version === alignVersion);

test("cloud upgrade enriches all 200 existing demo rows, preserves identities and never rewrites another org", async (t) => {
  const db = await freshDb(t);
  await applyMigrations(
    db,
    migrations.filter((migration) => migration.version < version),
  );
  await db.query(
    "insert into public.organizations(id,slug,name,is_demo) values ($1,'org-01','솔리데오',true)",
    [orgUuid("org-01")],
  );
  const legacyIds = new Set(
    Array.from(
      { length: 27 },
      (_, index) => fixture.people.people[(index * 37 + 11) % 200].personId,
    ),
  );
  // 000600 이전 운영의 27행은 v1 등급이었다. fixture 등급은 v3(직급 기준)라 그때 값으로 되돌려 넣는다.
  const v1Grades = new Map(
    fixture.people.people.map((person, index) => [
      personUuidFor(person.personId),
      v1Rows[index].grade,
    ]),
  );
  await seedSolideoPeople({
    orgId: orgUuid("org-01"),
    fixtures: fixture,
    client: {
      async upsert(table, rows, key) {
        const selected =
          table === "team_member_scoring"
            ? rows.filter((row) =>
                fixture.people.people.some(
                  (person) =>
                    legacyIds.has(person.personId) &&
                    row.member_id === personUuidFor(person.personId),
                ),
              )
            : rows;
        for (const original of selected) {
          const row =
            table === "team_member_scoring"
              ? { ...original, grade: v1Grades.get(original.member_id) }
              : original;
          const columns = Object.keys(row).filter(
            (column) =>
              ![
                "email",
                "certifications",
                "past_projects",
                "capability_source",
                "capability_version",
                "employment_status",
              ].includes(column),
          );
          await db.query(
            `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, index) => "$" + (index + 1)).join(",")}) on conflict (${key}) do nothing`,
            columns.map((column) =>
              typeof row[column] === "object" && row[column] !== null
                ? JSON.stringify(row[column])
                : row[column],
            ),
          );
        }
      },
    },
  });
  const oldRows = (
    await db.query(
      "select member_id,role,grade,skills,availability,created_at from public.team_member_scoring order by member_id",
    )
  ).rows;
  assert.equal(oldRows.length, 27);
  const other = orgUuid("org-02");
  await db.query(
    "insert into public.organizations(id,slug,name,is_demo) values ($1,'org-02','Other',true)",
    [other],
  );
  const foreignMember = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.query(
    "insert into public.departments(id,org_id,code,name,kind,source_count,target_count) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,'OTHER-D001','외부팀','TEAM',1,1)",
    [other],
  );
  await db.query(
    "insert into public.job_titles(id,org_id,code,label,sort_order) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',$1,'OTHER-J001','담당',1)",
    [other],
  );
  await db.query(
    "insert into public.team_members(id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,'SOL-P0001','외부인','MALE','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','/demo/people/SOL-P0001.png',true)",
    [foreignMember, other],
  );
  await db.query(
    "insert into public.team_member_scoring(member_id,org_id,role,skills,availability) values ($1,$2,'EXTERNAL','[\"KeepExternalSkill\"]'::jsonb,'[]'::jsonb)",
    [foreignMember, other],
  );
  const foreignBefore = (
    await db.query(
      "select member_id,org_id,role,grade,skills,availability,created_at from public.team_member_scoring where member_id=$1",
      [foreignMember],
    )
  ).rows;
  const identities = (await db.query("select * from public.team_members order by id")).rows;
  const authBefore = (await db.query("select * from auth.users order by id")).rows;
  await applyMigrations(db, [upgrade]);
  const updated = (
    await db.query(
      "select m.person_code,s.* from public.team_member_scoring s join public.team_members m on m.id=s.member_id where s.org_id=$1 order by m.person_code",
      [orgUuid("org-01")],
    )
  ).rows;
  assert.equal(updated.length, 200);
  assert.deepEqual(
    (await db.query("select * from public.team_members order by id")).rows,
    identities,
  );
  assert.deepEqual(
    (
      await db.query(
        "select member_id,role,grade,skills,availability,created_at from public.team_member_scoring where member_id = any($1::uuid[]) order by member_id",
        [oldRows.map((row) => row.member_id)],
      )
    ).rows,
    oldRows,
  );
  for (const [index, row] of updated.entries()) {
    const person = fixture.people.people[index];
    assert.equal(row.person_code, person.personId);
    assert.equal(row.capability_source, "SYNTHETIC");
    assert.equal(row.capability_version, v1Rows[index].capability_version);
    assert.equal(row.role, person.role);
    assert.equal(row.grade, v1Rows[index].grade);
    assert.deepEqual(row.skills, person.skills);
    assert.deepEqual(row.certifications, person.certifications);
    assert.deepEqual(row.past_projects, v1Rows[index].past_projects);
    assert.deepEqual(
      row.availability,
      foldAssignmentsIntoAvailability(
        person.availability,
        assignmentsOf(fixture.people.assignments, person.personId),
      ),
    );
  }
  assert.deepEqual((await db.query("select * from auth.users order by id")).rows, authBefore);
  assert.deepEqual(
    (
      await db.query(
        "select member_id,org_id,role,grade,skills,availability,created_at from public.team_member_scoring where member_id=$1",
        [foreignMember],
      )
    ).rows,
    foreignBefore,
  );
  assert.deepEqual(
    (
      await db.query(
        "select certifications,past_projects,capability_source,capability_version from public.team_member_scoring where member_id=$1",
        [foreignMember],
      )
    ).rows,
    [
      {
        certifications: [],
        past_projects: [],
        capability_source: "UNSPECIFIED",
        capability_version: null,
      },
    ],
  );
});

test("project history upgrade rewrites only synthetic demo rows of the fixed org, keeps scoring inputs and repeats", async (t) => {
  const db = await freshDb(t);
  await applyMigrations(
    db,
    migrations.filter((migration) => migration.version < historyVersion),
  );
  const solideo = orgUuid("org-01");
  const other = orgUuid("org-02");
  await db.query(
    "insert into public.organizations(id,slug,name,is_demo) values ($1,'org-01','솔리데오',true),($2,'org-02','Other',true)",
    [solideo, other],
  );
  await seedSolideoPeople({
    orgId: solideo,
    fixtures: fixture,
    client: {
      async upsert(table, rows, key) {
        for (const row of rows) {
          const columns = Object.keys(row);
          await db.query(
            `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, index) => "$" + (index + 1)).join(",")}) on conflict (${key}) do nothing`,
            columns.map((column) =>
              typeof row[column] === "object" && row[column] !== null
                ? JSON.stringify(row[column])
                : row[column],
            ),
          );
        }
      },
    },
  });
  // 운영 DB 처럼 v1 수행 이력으로 되돌린다.
  await db.query(
    "update public.team_member_scoring s set past_projects=p.past_projects, capability_version=p.capability_version from jsonb_to_recordset($1::jsonb) as p(person_code text, past_projects jsonb, capability_version text), public.team_members m where m.id=s.member_id and m.person_code=p.person_code",
    [JSON.stringify(v1Rows)],
  );
  // 다른 조직의 같은 사번 데모 직원, 가입 승인·N4b 입사자(비데모), 데모였다가 비데모가 된 직원, 출처가 SYNTHETIC 이 아닌 행.
  const foreign = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const hire = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const nonDemo = personUuidFor("SOL-P0005");
  const unspecified = personUuidFor("SOL-P0007");
  await db.query(
    "insert into public.departments(id,org_id,code,name,kind,source_count,target_count) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,'OTHER-D001','외부팀','TEAM',1,1)",
    [other],
  );
  await db.query(
    "insert into public.job_titles(id,org_id,code,label,sort_order) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',$1,'OTHER-J001','담당',1)",
    [other],
  );
  await db.query(
    "insert into public.team_members(id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,'SOL-P0001','외부인','MALE','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','/demo/people/SOL-P0001.png',true)",
    [foreign, other],
  );
  await db.query(
    "insert into public.team_member_scoring(member_id,org_id,role,grade,skills,availability,certifications,past_projects,capability_source,capability_version) select $1,$2,role,grade,skills,availability,certifications,past_projects,capability_source,capability_version from public.team_member_scoring where member_id=$3",
    [foreign, other, personUuidFor("SOL-P0001")],
  );
  await db.query(
    "insert into public.team_members(id,org_id,person_code,name,department_id,job_title_id,is_demo) values ($1,$2,'SOL-N0001','신규입사',$3,$4,false)",
    [hire, solideo, catalogUuid("SOL-D001"), catalogUuid("SOL-J011")],
  );
  await db.query(
    "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEVELOPER')",
    [hire, solideo],
  );
  await db.query("update public.team_members set is_demo=false where id=$1", [nonDemo]);
  await db.query(
    "update public.team_member_scoring set capability_source='UNSPECIFIED' where member_id=$1",
    [unspecified],
  );
  const scoring = async () =>
    (
      await db.query(
        "select m.person_code,s.* from public.team_member_scoring s join public.team_members m on m.id=s.member_id order by s.org_id,m.person_code",
      )
    ).rows;
  const members = async () =>
    (await db.query("select * from public.team_members order by id")).rows;
  const people = new Map(fixture.people.people.map((person) => [person.personId, person]));
  const expected = (rows, skipped) =>
    rows.map((row) =>
      row.org_id === solideo && people.has(row.person_code) && !skipped.includes(row.member_id)
        ? {
            ...row,
            past_projects: v2Rows.get(row.person_code).past_projects,
            capability_version: "synthetic-people/v2",
          }
        : row,
    );
  const before = await scoring();
  const membersBefore = await members();
  assert.equal(before.length, 202);
  await applyMigrations(db, [history]);
  const after = await scoring();
  assert.deepEqual(after, expected(before, [nonDemo, unspecified]));
  assert.equal(after.filter((row, index) => !isDeepStrictEqual(row, before[index])).length, 198);
  assert.deepEqual(await members(), membersBefore);

  // 데모 직원으로 되돌리면 200명 모두 바뀌고, 다시 돌려도 결과가 같다.
  await db.query("update public.team_members set is_demo=true where id=$1", [nonDemo]);
  await db.query(
    "update public.team_member_scoring set capability_source='SYNTHETIC' where member_id=$1",
    [unspecified],
  );
  const restored = await scoring();
  await applyMigrations(db, [history]);
  const once = await scoring();
  assert.deepEqual(once, expected(restored, []));
  assert.equal(
    once.filter((row) => row.org_id === solideo && row.capability_version === "synthetic-people/v2")
      .length,
    200,
  );
  await applyMigrations(db, [history]);
  assert.deepEqual(await scoring(), once);
});

test("grade alignment rewrites only synthetic demo rows whose job title matches, keeps scoring computation inputs and repeats", async (t) => {
  const db = await freshDb(t);
  await applyMigrations(
    db,
    migrations.filter((migration) => migration.version < alignVersion),
  );
  const solideo = orgUuid("org-01");
  const other = orgUuid("org-02");
  await db.query(
    "insert into public.organizations(id,slug,name,is_demo) values ($1,'org-01','솔리데오',true),($2,'org-02','Other',true)",
    [solideo, other],
  );
  await seedSolideoPeople({
    orgId: solideo,
    fixtures: fixture,
    client: {
      async upsert(table, rows, key) {
        for (const row of rows) {
          const columns = Object.keys(row);
          await db.query(
            `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, index) => "$" + (index + 1)).join(",")}) on conflict (${key}) do nothing`,
            columns.map((column) =>
              typeof row[column] === "object" && row[column] !== null
                ? JSON.stringify(row[column])
                : row[column],
            ),
          );
        }
      },
    },
  });
  // 운영 DB 처럼 v1 등급·v2 수행 이력으로 되돌린다.
  await db.query(
    "update public.team_member_scoring s set grade=p.grade, past_projects=h.past_projects, capability_version=h.capability_version from jsonb_to_recordset($1::jsonb) as p(person_code text, grade text), jsonb_to_recordset($2::jsonb) as h(person_code text, past_projects jsonb, capability_version text), public.team_members m where m.id=s.member_id and m.person_code=p.person_code and h.person_code=p.person_code",
    [JSON.stringify(v1Rows), JSON.stringify([...v2Rows.values()])],
  );
  // 다른 조직의 같은 사번 데모 직원, 가입 승인·N4b 입사자(비데모), 데모였다가 비데모가 된 직원,
  // 출처가 SYNTHETIC 이 아닌 행, 운영에서 직급을 바꾼 직원.
  const foreign = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  const hire = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const nonDemo = personUuidFor("SOL-P0005");
  const unspecified = personUuidFor("SOL-P0007");
  const retitled = personUuidFor("SOL-P0001");
  const retitledFrom = fixture.people.people.find((person) => person.personId === "SOL-P0001");
  const retitledTo = retitledFrom.jobTitleId === "SOL-J011" ? "SOL-J010" : "SOL-J011";
  await db.query(
    "insert into public.departments(id,org_id,code,name,kind,source_count,target_count) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,'OTHER-D001','외부팀','TEAM',1,1)",
    [other],
  );
  await db.query(
    "insert into public.job_titles(id,org_id,code,label,sort_order) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',$1,$2,'팀장',1)",
    [other, retitledFrom.jobTitleId],
  );
  await db.query(
    "insert into public.team_members(id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,'SOL-P0002','외부인','MALE','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','/demo/people/SOL-P0002.png',true)",
    [foreign, other],
  );
  await db.query(
    "insert into public.team_member_scoring(member_id,org_id,role,grade,skills,availability,certifications,past_projects,capability_source,capability_version) select $1,$2,role,grade,skills,availability,certifications,past_projects,capability_source,capability_version from public.team_member_scoring where member_id=$3",
    [foreign, other, personUuidFor("SOL-P0002")],
  );
  await db.query(
    "insert into public.team_members(id,org_id,person_code,name,department_id,job_title_id,is_demo) values ($1,$2,'SOL-N0001','신규입사',$3,$4,false)",
    [hire, solideo, catalogUuid("SOL-D001"), catalogUuid("SOL-J011")],
  );
  await db.query(
    "insert into public.team_member_scoring(member_id,org_id,role) values ($1,$2,'DEVELOPER')",
    [hire, solideo],
  );
  await db.query("update public.team_members set is_demo=false where id=$1", [nonDemo]);
  await db.query(
    "update public.team_member_scoring set capability_source='UNSPECIFIED' where member_id=$1",
    [unspecified],
  );
  await db.query("update public.team_members set job_title_id=$1 where id=$2", [
    catalogUuid(retitledTo),
    retitled,
  ]);
  const scoring = async () =>
    (
      await db.query(
        "select m.person_code,s.* from public.team_member_scoring s join public.team_members m on m.id=s.member_id order by s.org_id,m.person_code",
      )
    ).rows;
  const members = async () =>
    (await db.query("select * from public.team_members order by id")).rows;
  const people = new Map(fixture.people.people.map((person) => [person.personId, person]));
  const expected = (rows, skipped) =>
    rows.map((row) =>
      row.org_id === solideo && people.has(row.person_code) && !skipped.includes(row.member_id)
        ? {
            ...row,
            grade: people.get(row.person_code).grade,
            past_projects: people.get(row.person_code).pastProjects,
            capability_version: "synthetic-people/v3",
          }
        : row,
    );
  const before = await scoring();
  const membersBefore = await members();
  assert.equal(before.length, 202);
  assert.ok(before.some((row) => row.grade !== people.get(row.person_code)?.grade));
  await applyMigrations(db, [align]);
  const after = await scoring();
  assert.deepEqual(after, expected(before, [nonDemo, unspecified, retitled]));
  assert.equal(after.filter((row, index) => !isDeepStrictEqual(row, before[index])).length, 197);
  assert.deepEqual(await members(), membersBefore);
  // 점수 계산이 읽는 열(role·skills·availability)과 자격은 한 행도 바뀌지 않는다.
  const computed = (rows) =>
    rows.map(({ member_id, role, skills, availability, certifications }) => ({
      member_id,
      role,
      skills,
      availability,
      certifications,
    }));
  assert.deepEqual(computed(after), computed(before));

  // 직급을 되돌리고 데모·SYNTHETIC 으로 돌리면 200명 모두 바뀌고, 다시 돌려도 결과가 같다.
  await db.query("update public.team_members set job_title_id=$1 where id=$2", [
    catalogUuid(retitledFrom.jobTitleId),
    retitled,
  ]);
  await db.query("update public.team_members set is_demo=true where id=$1", [nonDemo]);
  await db.query(
    "update public.team_member_scoring set capability_source='SYNTHETIC' where member_id=$1",
    [unspecified],
  );
  const restored = await scoring();
  await applyMigrations(db, [align]);
  const once = await scoring();
  assert.deepEqual(once, expected(restored, []));
  assert.equal(
    once.filter((row) => row.org_id === solideo && row.capability_version === "synthetic-people/v3")
      .length,
    200,
  );
  await applyMigrations(db, [align]);
  assert.deepEqual(await scoring(), once);
});

// Use the production deterministic identifier, rather than a second UUID implementation.
import { personUuid as personUuidFor } from "./seed.mjs";
