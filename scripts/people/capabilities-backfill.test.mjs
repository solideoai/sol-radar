import assert from "node:assert/strict";
import test from "node:test";
import { freshDb, migrations } from "../database-test-support.mjs";
import { applyMigrations } from "../supabase-pglite.mjs";
import { assignmentsOf, foldAssignmentsIntoAvailability } from "./availability.mjs";
import { loadPeopleFixtures, orgUuid, seedSolideoPeople } from "./seed.mjs";

const version = "20261021000600";
const fixture = await loadPeopleFixtures();
const upgrade = migrations.find((migration) => migration.version === version);

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
        for (const row of selected) {
          const columns = Object.keys(row).filter(
            (column) =>
              ![
                "email",
                "certifications",
                "past_projects",
                "capability_source",
                "capability_version",
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
    assert.equal(row.capability_version, person.capabilityVersion);
    assert.equal(row.role, person.role);
    assert.equal(row.grade, person.grade);
    assert.deepEqual(row.skills, person.skills);
    assert.deepEqual(row.certifications, person.certifications);
    assert.deepEqual(row.past_projects, person.pastProjects);
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

// Use the production deterministic identifier, rather than a second UUID implementation.
import { personUuid as personUuidFor } from "./seed.mjs";
