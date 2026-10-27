import assert from "node:assert/strict";
import { test } from "node:test";
import { RestError } from "../demo/rest-client.mjs";
import { orgUuid } from "../people/seed.mjs";
import {
  applyCompanyProfileRevision,
  describeFailure,
  findSourceProblems,
  planCompanyProfileRevision,
  summarizeRow,
} from "./company-profile.mjs";

const ORG_ID = orgUuid("org-01");
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";

const documentFor = (patch = {}) => ({
  note: "공개 자료 기준 프로필",
  profile: {
    revision: 1,
    name: "솔리데오",
    isDemo: false,
    technologies: [{ name: "Java", sourceIds: ["s1"] }],
    technologiesComplete: false,
    licenses: [],
    industryCodes: [],
    pastProjects: [
      {
        id: "pp-1",
        name: "정부24",
        domain: "민원",
        amountKrw: null,
        completedAt: null,
        sourceIds: ["s1"],
      },
    ],
    financials: { fiscalYear: 2025, annualRevenueKrw: "100", sourceIds: ["s1"] },
    preferences: null,
    ...patch,
  },
  sources: [
    {
      id: "s1",
      kind: "PUBLIC",
      title: "홈페이지",
      url: "https://example.com",
      retrievedAt: "2026-10-27",
    },
  ],
  publicHistory: [{ year: 2000, kind: "REGISTRATION", name: "등록", sourceIds: ["s1"] }],
});

const clientFor = ({ slug = "org-01", memberRole = "ADMIN", previous = [] } = {}) => {
  const writes = [];
  const client = {
    select: async (table, { filters = {} } = {}) => {
      if (table === "organizations")
        return filters.id === ORG_ID ? [{ id: ORG_ID, slug, is_demo: false }] : [];
      if (table === "profiles")
        return filters.email === "admin@example.com"
          ? [{ id: ADMIN_ID, email: filters.email }]
          : [];
      if (table === "memberships")
        return filters.org_id === ORG_ID && filters.user_id === ADMIN_ID
          ? [{ user_id: ADMIN_ID, sol_role: memberRole }].filter(
              (row) => row.sol_role === filters.sol_role,
            )
          : [];
      if (table === "company_profiles") return previous;
      throw new Error(`예상하지 못한 표: ${table}`);
    },
    insert: async (table, rows) => {
      writes.push({ table, rows });
      return [{ id: "new-id", revision: rows[0].revision }];
    },
  };
  return { client, writes };
};

const previousRow = {
  revision: 3,
  technologies: [{ name: "Java" }, { name: "Spring" }],
  licenses: [],
  past_projects: [{ id: "pp-0", name: "옛 사업" }],
  financials: { fiscalYear: 2024 },
};

test("dry-run 은 다음 revision 을 계산하고 아무것도 쓰지 않는다", async () => {
  const { client, writes } = clientFor({
    previous: [previousRow, { ...previousRow, revision: 2 }],
  });
  const plan = await planCompanyProfileRevision({
    client,
    document: documentFor(),
    createdByEmail: "Admin@Example.com",
  });
  assert.equal(plan.orgId, ORG_ID);
  assert.equal(plan.nextRevision, 4);
  assert.equal(plan.createdBy, ADMIN_ID);
  assert.deepEqual(plan.changes.technologies, { added: [], removed: ["Spring"] });
  assert.deepEqual(plan.changes.pastProjects, { added: ["정부24"], removed: ["옛 사업"] });
  assert.equal(plan.changes.financials, true);
  assert.deepEqual(writes, []);
});

test("apply 는 org-01 에 is_demo=false·revision max+1·sources·public_history 로 넣는다", async () => {
  const { client, writes } = clientFor({ previous: [previousRow] });
  const document = documentFor();
  const plan = await planCompanyProfileRevision({
    client,
    document,
    createdByEmail: "admin@example.com",
  });
  const result = await applyCompanyProfileRevision({ client, plan });
  assert.deepEqual(result, { id: "new-id", revision: 4 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].table, "company_profiles");
  const [row] = writes[0].rows;
  assert.equal(row.org_id, ORG_ID);
  assert.equal(row.is_demo, false);
  assert.equal(row.revision, 4);
  assert.equal(row.created_by, ADMIN_ID);
  assert.equal(row.name, "솔리데오");
  assert.equal(row.note, "공개 자료 기준 프로필");
  assert.deepEqual(row.sources, document.sources);
  assert.deepEqual(row.public_history, document.publicHistory);
  assert.deepEqual(row.technologies, document.profile.technologies);
  assert.deepEqual(row.past_projects, document.profile.pastProjects);
  assert.equal(row.technologies_complete, false);
});

test("created-by 가 org-01 ADMIN 이 아니면 거부", async () => {
  await assert.rejects(
    planCompanyProfileRevision({
      client: clientFor({ memberRole: "SALES" }).client,
      document: documentFor(),
      createdByEmail: "admin@example.com",
    }),
    /ADMIN/,
  );
  await assert.rejects(
    planCompanyProfileRevision({
      client: clientFor().client,
      document: documentFor(),
      createdByEmail: "nobody@example.com",
    }),
    /프로필/,
  );
});

test("profile.isDemo 가 true 이거나 조직 slug 가 org-01 이 아니면 거부", async () => {
  await assert.rejects(
    planCompanyProfileRevision({
      client: clientFor().client,
      document: documentFor({ isDemo: true }),
      createdByEmail: "admin@example.com",
    }),
    /isDemo/,
  );
  await assert.rejects(
    planCompanyProfileRevision({
      client: clientFor({ slug: "org-02" }).client,
      document: documentFor(),
      createdByEmail: "admin@example.com",
    }),
    /org-01/,
  );
});

const withSources = (document, sources) => ({ ...document, sources });
const license = (patch = {}) => ({
  code: "L1",
  name: "SW사업자",
  status: "HELD",
  sourceIds: ["s2"],
  ...patch,
});
const publicSource = (patch = {}) => ({
  id: "s2",
  kind: "PUBLIC",
  title: "공시",
  url: "https://example.com/2",
  retrievedAt: "2026-10-27",
  ...patch,
});
const confirmedSource = (patch = {}) => ({
  id: "s2",
  kind: "COMPANY_CONFIRMED",
  title: "회사 확인",
  url: null,
  retrievedAt: "2026-10-27",
  ...patch,
});
const withLicense = (kind, entry, source, extra = {}) => {
  const base = documentFor({ [kind]: [entry], ...extra });
  return withSources(base, [...base.sources, source]);
};

test("findSourceProblems: 정상 문서는 문제 없음", () => {
  assert.deepEqual(findSourceProblems(documentFor()), []);
});

test("findSourceProblems: sourceIds 빈 기술·없는 출처 실적·재무 sourceIds 없음", () => {
  const empty = documentFor({ technologies: [{ name: "HTML5", sourceIds: [] }] });
  assert.deepEqual(findSourceProblems(empty), ["기술 HTML5: sourceIds 없음"]);
  const unknown = documentFor({
    pastProjects: [{ id: "pp-1", name: "정부24", domain: "민원", sourceIds: ["s9"] }],
  });
  assert.deepEqual(findSourceProblems(unknown), ["실적 정부24: 없는 출처 s9"]);
  const noFinancialIds = documentFor({ financials: { fiscalYear: 2025 } });
  assert.deepEqual(findSourceProblems(noFinancialIds), ["재무: sourceIds 없음"]);
});

test("findSourceProblems: HELD 자격은 quote 있는 PUBLIC 또는 confirmedBy 있는 COMPANY_CONFIRMED 만 근거", () => {
  assert.deepEqual(findSourceProblems(withLicense("licenses", license(), publicSource())), [
    "자격 SW사업자: HELD 근거 없음",
  ]);
  assert.deepEqual(
    findSourceProblems(withLicense("licenses", license(), publicSource({ quote: "원문" }))),
    [],
  );
  assert.deepEqual(
    findSourceProblems(
      withLicense("licenses", license(), confirmedSource({ confirmedBy: "대표 홍길동" })),
    ),
    [],
  );
  assert.deepEqual(findSourceProblems(withLicense("industryCodes", license(), confirmedSource())), [
    "업종 SW사업자: HELD 근거 없음",
  ]);
});

test("findSourceProblems: http·https 가 아닌 출처 url", () => {
  const document = documentFor();
  document.sources[0].url = "javascript:x";
  assert.deepEqual(findSourceProblems(document), ["출처 s1: url 스킴은 http·https 만"]);
});

test("findSourceProblems: 공개 이력 sourceIds 가 비었거나 없는 출처를 가리킴", () => {
  const empty = documentFor();
  empty.publicHistory = [{ year: 2000, kind: "REGISTRATION", name: "등록", sourceIds: [] }];
  assert.deepEqual(findSourceProblems(empty), ["이력 2000 등록: sourceIds 없음"]);
  const unknown = documentFor();
  unknown.publicHistory = [{ year: 2000, kind: "REGISTRATION", name: "등록", sourceIds: ["s9"] }];
  assert.deepEqual(findSourceProblems(unknown), ["이력 2000 등록: 없는 출처 s9"]);
});

test("출처 규칙 위반 문서는 DB 를 조회하기 전에 throw", async () => {
  let selects = 0;
  const client = {
    select: async () => {
      selects += 1;
      return [];
    },
  };
  await assert.rejects(
    planCompanyProfileRevision({
      client,
      document: documentFor({ technologies: [{ name: "HTML5", sourceIds: [] }] }),
      createdByEmail: "admin@example.com",
    }),
    /출처 규칙 위반 1건: 기술 HTML5: sourceIds 없음/,
  );
  assert.equal(selects, 0);
});

test("note 가 없거나 빈 문자열이면 throw", async () => {
  for (const note of [undefined, "", "  "]) {
    await assert.rejects(
      planCompanyProfileRevision({
        client: clientFor().client,
        document: { ...documentFor(), note },
        createdByEmail: "admin@example.com",
      }),
      /note/,
    );
  }
});

test("summarizeRow: 큰 배열은 개수로, 나머지는 그대로", async () => {
  const { client } = clientFor();
  const plan = await planCompanyProfileRevision({
    client,
    document: documentFor(),
    createdByEmail: "admin@example.com",
  });
  const summary = summarizeRow(plan.row);
  assert.equal(summary.technologies, 1);
  assert.equal(summary.licenses, 0);
  assert.equal(summary.industry_codes, 0);
  assert.equal(summary.past_projects, 1);
  assert.equal(summary.sources, 1);
  assert.equal(summary.public_history, 1);
  assert.equal(summary.note, "공개 자료 기준 프로필");
  assert.equal(summary.revision, 1);
  assert.equal(summary.created_by, ADMIN_ID);
  assert.equal(summary.is_demo, false);
});

test("차이에 업종 코드가 들어간다", async () => {
  const { client } = clientFor({
    previous: [{ ...previousRow, industry_codes: [{ name: "옛 업종" }] }],
  });
  const plan = await planCompanyProfileRevision({
    client,
    document: documentFor(),
    createdByEmail: "admin@example.com",
  });
  assert.deepEqual(plan.changes.industryCodes, { added: [], removed: ["옛 업종"] });
});

test("revision 중복(23505)은 안내 메시지로, 다른 오류는 그대로 던진다", async () => {
  const plan = { row: { revision: 1 } };
  const failing = (error) => ({
    insert: async () => {
      throw error;
    },
  });
  await assert.rejects(
    applyCompanyProfileRevision({
      client: failing(Object.assign(new Error("dup"), { code: "23505" })),
      plan,
    }),
    /revision 중복\(23505\)/,
  );
  const other = Object.assign(new Error("boom"), { code: "42501" });
  await assert.rejects(
    applyCompanyProfileRevision({ client: failing(other), plan }),
    (error) => error === other,
  );
});

test("항목 모양이 어긋난 문서는 DB 를 조회하기 전에 throw", async () => {
  const project = { id: "pp-1", name: "정부24", domain: "민원", sourceIds: ["s1"] };
  const cases = [
    [{ technologies: [{ name: " ", sourceIds: ["s1"] }] }, /technologies\[0\]\.name/],
    [{ pastProjects: [{ ...project, name: "", amountKrw: null, completedAt: null }] }, /name/],
    [{ pastProjects: [{ ...project, amountKrw: "12억", completedAt: null }] }, /amountKrw/],
    [{ pastProjects: [{ ...project, amountKrw: 100, completedAt: null }] }, /amountKrw/],
    [{ pastProjects: [{ ...project, amountKrw: null, completedAt: "2025/01/01" }] }, /completedAt/],
    [{ pastProjects: [{ ...project, amountKrw: null }] }, /completedAt/],
  ];
  for (const [patch, pattern] of cases) {
    let selects = 0;
    const client = {
      select: async () => {
        selects += 1;
        return [];
      },
    };
    await assert.rejects(
      planCompanyProfileRevision({
        client,
        document: documentFor(patch),
        createdByEmail: "admin@example.com",
      }),
      pattern,
    );
    assert.equal(selects, 0);
  }
});

test("describeFailure: RestError 만 메시지를 보인다", () => {
  const rest = new RestError({
    method: "GET",
    path: "/rest/v1/x",
    status: 401,
    code: "PGRST301",
    reason: "JWT expired",
  });
  assert.match(describeFailure(rest), /^PGRST301: GET \/rest\/v1\/x → 401 PGRST301: JWT expired$/);
  assert.equal(describeFailure(Object.assign(new Error("boom"), { code: "42501" })), "42501");
  assert.equal(describeFailure(new Error("입력 오류")), "입력 오류");
});
