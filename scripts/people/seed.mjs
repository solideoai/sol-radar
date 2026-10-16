import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isLocalUrl, parseStatusEnv } from "../local-env.mjs";

const DNS_NAMESPACE = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
const uuidV5 = (name) => {
  const bytes = createHash("sha1").update(DNS_NAMESPACE).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const orgUuid = (orgCode) => uuidV5(`sol-radar:${orgCode}`);
export const personUuid = (personId) => uuidV5(`sol-radar:org-01:${personId}`);
export const catalogUuid = (code) => uuidV5(`sol-radar:org-01:${code}`);

export const refuseNonLocal = (apiUrl) =>
  isLocalUrl(apiUrl)
    ? null
    : `로컬 Supabase 주소가 아닙니다(${apiUrl || "비어 있음"}). 시드는 로컬에만 넣습니다.`;

export const loadPeopleFixtures = async () => {
  const json = async (name) =>
    JSON.parse(
      await readFile(
        new URL(`../../fixtures/people/solideo.${name}.json`, import.meta.url),
        "utf8",
      ),
    );
  const [departments, jobTitles, people] = await Promise.all([
    json("departments"),
    json("job-titles"),
    json("people"),
  ]);
  return { departments, jobTitles, people };
};

// Auth 인터페이스를 받지 않는다. 승인 JSON의 카탈로그·명부만 upsert한다.
export const seedSolideoPeople = async ({ client, orgId, fixtures }) => {
  if (orgId !== orgUuid("org-01")) throw new Error("솔리데오 고정 조직만 seed할 수 있습니다");
  await client.upsert(
    "departments",
    fixtures.departments.departments.map((department) => ({
      id: catalogUuid(department.id),
      org_id: orgId,
      code: department.id,
      name: department.name,
      source_count: department.sourceCount,
      target_count: department.targetCount,
      is_demo: true,
    })),
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
  );
  return { peopleCount: fixtures.people.people.length };
};

export const seedLocalPeople = async ({ apiUrl, serviceKey, fixtures }) => {
  const refusal = refuseNonLocal(apiUrl);
  if (refusal) throw new Error(refusal);
  const client = {
    async upsert(table, rows) {
      const response = await fetch(`${apiUrl}/rest/v1/${table}?on_conflict=id`, {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });
      // 서버 응답에는 요청/데이터가 실릴 수 있어 키·명부를 오류에 덧붙이지 않는다.
      if (!response.ok) throw new Error(`인력 seed ${table}: HTTP ${response.status}`);
    },
  };
  await client.upsert("organizations", [
    {
      id: orgUuid("org-01"),
      slug: "org-01",
      name: "솔리데오",
      personal_owner_id: null,
      is_demo: true,
    },
    {
      id: orgUuid("org-02"),
      slug: "org-02",
      name: "격리 확인 조직",
      personal_owner_id: null,
      is_demo: true,
    },
  ]);
  return seedSolideoPeople({
    client,
    orgId: orgUuid("org-01"),
    fixtures: fixtures ?? (await loadPeopleFixtures()),
  });
};

const main = async () => {
  const result = spawnSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) throw new Error("로컬 Supabase 상태를 읽지 못했습니다");
  const status = parseStatusEnv(result.stdout);
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!serviceKey) throw new Error("로컬 관리 키가 없습니다");
  const seeded = await seedLocalPeople({ apiUrl: status.API_URL, serviceKey });
  console.log(
    `✓ 가상 인력 ${seeded.peopleCount}명과 부서·직급을 upsert했습니다(Auth 계정 생성 없음).`,
  );
};

if (
  process.argv[1] &&
  (await realpath(process.argv[1]).catch(() => null)) === fileURLToPath(import.meta.url)
) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
