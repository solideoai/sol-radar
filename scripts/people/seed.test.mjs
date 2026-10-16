import assert from "node:assert/strict";
import { it } from "node:test";
import { readFile } from "node:fs/promises";
import { migratedDb } from "../database-test-support.mjs";

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

it("상위 카탈로그도 구 스키마에는 팀만 넣고 같은 명부를 두 번 넣어도 200명·동일 UUID이며 Auth를 호출하지 않는다", async (t) => {
  const { personUuid, orgUuid, seedSolideoPeople } = await import("./seed.mjs");
  assert.equal(personUuid("SOL-P0001"), "591e9ea0-0946-5534-89ea-5b4ad722a820");
  const fresh = await migratedDb(t);
  const orgId = orgUuid("org-01");
  await fresh.query(
    "insert into public.organizations(id,slug,name) values ($1,'org-01','솔리데오')",
    [orgId],
  );
  let authCalls = 0;
  const client = {
    get auth() {
      authCalls++;
      throw new Error("Auth not allowed");
    },
    async upsert(table, rows) {
      for (const row of rows) {
        const columns = Object.keys(row);
        await fresh.query(
          `insert into public.${table} (${columns.join(",")}) values (${columns.map((_, i) => "$" + (i + 1)).join(",")}) on conflict (id) do update set ${columns
            .filter((c) => c !== "id")
            .map((c) => `${c}=excluded.${c}`)
            .join(",")}`,
          columns.map((c) =>
            typeof row[c] === "object" && row[c] !== null ? JSON.stringify(row[c]) : row[c],
          ),
        );
      }
    },
  };
  const augmentedFixtures = structuredClone(fixtures);
  augmentedFixtures.departments.departments.push({
    id: "SOL-D999",
    name: "합성본부",
    kind: "DIVISION",
    targetCount: null,
    sourceCount: null,
  });
  const authBefore = (await fresh.query("select id from auth.users order by id")).rows;
  assert.deepEqual(await seedSolideoPeople({ client, orgId, fixtures: augmentedFixtures }), {
    peopleCount: 200,
  });
  const before = (await fresh.query("select id,person_code from public.team_members order by id"))
    .rows;
  await seedSolideoPeople({ client, orgId, fixtures: augmentedFixtures });
  assert.equal(before.length, 200);
  assert.deepEqual(
    (await fresh.query("select id,person_code from public.team_members order by id")).rows,
    before,
  );
  assert.equal((await fresh.query("select * from public.departments")).rows.length, 38);
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
  assert.equal(
    (await fresh.query("select * from public.team_members where scoring_eligible")).rows.length,
    27,
  );
  assert.deepEqual((await fresh.query("select id from auth.users order by id")).rows, authBefore);
  assert.equal(authCalls, 0);
});
it("people seed는 비로컬 요청을 HTTP 전에 거절한다", async () => {
  const { seedLocalPeople } = await import("./seed.mjs");
  await assert.rejects(
    seedLocalPeople({ apiUrl: "https://remote.supabase.co", serviceKey: "unused", fixtures }),
    /로컬/,
  );
});
