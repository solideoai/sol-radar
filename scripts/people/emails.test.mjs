import assert from "node:assert/strict";
import test from "node:test";
import { freshDb, migrations } from "../database-test-support.mjs";
import { applyMigrations } from "../supabase-pglite.mjs";
import { assignEmails } from "./emails.mjs";
import { loadPeopleFixtures, orgUuid, seedSolideoPeople } from "./seed.mjs";

const version = "20261024000100";
const fixture = await loadPeopleFixtures();
const upgrade = migrations.find((migration) => migration.version === version);

test("같은 이름+성이 다시 나오면 직원 번호 순으로 2부터 붙인다", () => {
  const people = assignEmails([
    { personId: "A", name: "김민준" },
    { personId: "B", name: "이민준" },
    { personId: "C", name: "김민준" },
    { personId: "D", name: "김민준" },
  ]);
  assert.deepEqual(
    people.map((person) => person.email),
    [
      "minjunkim@solideos.com",
      "minjunlee@solideos.com",
      "minjunkim2@solideos.com",
      "minjunkim3@solideos.com",
    ],
  );
  assert.throws(() => assignEmails([{ personId: "E", name: "남궁민" }]), /Unknown synthetic name/);
});

test("클라우드 업그레이드는 기존 데모 200명에 메일을 채우고 다른 조직은 건드리지 않는다", async (t) => {
  const db = await freshDb(t);
  await applyMigrations(
    db,
    migrations.filter((migration) => migration.version < version),
  );
  await db.query(
    "insert into public.organizations(id,slug,name,is_demo) values ($1,'org-01','솔리데오',true),($2,'org-02','Other',true)",
    [orgUuid("org-01"), orgUuid("org-02")],
  );
  await seedSolideoPeople({
    orgId: orgUuid("org-01"),
    fixtures: fixture,
    client: {
      async upsert(table, rows, key) {
        if (table === "team_member_scoring") return;
        for (const row of rows) {
          // 업그레이드 전 스키마에는 메일·재직 상태(20261024000400) 열이 없다.
          const columns = Object.keys(row).filter(
            (column) => column !== "email" && column !== "employment_status",
          );
          await db.query(
            `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, index) => "$" + (index + 1)).join(",")}) on conflict (${key}) do nothing`,
            columns.map((column) => row[column]),
          );
        }
      },
    },
  });
  const foreignMember = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  await db.query(
    "insert into public.departments(id,org_id,code,name,kind,source_count,target_count) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',$1,'OTHER-D001','외부팀','TEAM',1,1)",
    [orgUuid("org-02")],
  );
  await db.query(
    "insert into public.job_titles(id,org_id,code,label,sort_order) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',$1,'OTHER-J001','담당',1)",
    [orgUuid("org-02")],
  );
  await db.query(
    "insert into public.team_members(id,org_id,person_code,name,gender,department_id,job_title_id,portrait_path,is_demo) values ($1,$2,'SOL-P0001','김민준','MALE','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','dddddddd-dddd-4ddd-8ddd-dddddddddddd','/demo/people/SOL-P0001.png',true)",
    [foreignMember, orgUuid("org-02")],
  );

  await applyMigrations(db, [upgrade]);

  const rows = (
    await db.query(
      "select person_code,email from public.team_members where org_id=$1 order by person_code",
      [orgUuid("org-01")],
    )
  ).rows;
  assert.deepEqual(
    rows,
    fixture.people.people.map((person) => ({
      person_code: person.personId,
      email: person.email,
    })),
  );
  assert.equal(new Set(rows.map((row) => row.email)).size, 200);
  assert.deepEqual(
    (await db.query("select email from public.team_members where id=$1", [foreignMember])).rows,
    [{ email: null }],
  );
  await assert.rejects(
    db.query(
      "update public.team_members set email=$1 where org_id=$2 and person_code='SOL-P0002'",
      [fixture.people.people[0].email, orgUuid("org-01")],
    ),
    /team_members_org_email_key/,
  );
  await assert.rejects(
    db.query("update public.team_members set email='MinjunKim@solideos.com' where id=$1", [
      foreignMember,
    ]),
    /team_members_email_format/,
  );
});
