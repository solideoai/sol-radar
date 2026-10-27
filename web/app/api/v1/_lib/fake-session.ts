// 업무 Route Handler 계약 시험용 가짜 Supabase 전송(people `team-members/route.test.ts` 방식).
// 인증(getClaims)·가입 완료(profiles)·업무 조직(memberships + sol_role) 코드는 진짜를 그대로 돌리고,
// SDK 가 서버와 주고받는 자리만 바꾼다. 업무 표(notifications 등)는 시험이 넣은 행을 eq·is·in·not(is) 로 걸러 돌려준다.
// SQL·RLS 는 흉내 내지 않는다(정책은 scripts/database.test.mjs 가 본다).
//
// 쓰는 법(시험 파일 머리, vi.mock 은 끌어올려지므로 이 모듈은 factory 안에서 동적으로 부른다):
//   vi.mock("next/headers", async () => (await import("@/app/api/v1/_lib/fake-session")).fakeNextHeaders);
//   vi.mock("@supabase/ssr", async () => ({
//     createServerClient: (await import("@/app/api/v1/_lib/fake-session")).fakeCookieClient,
//   }));
//   vi.mock("@supabase/supabase-js", async (original) => ({
//     ...(await original<typeof import("@supabase/supabase-js")>()),
//     createClient: (await import("@/app/api/v1/_lib/fake-session")).fakeBearerClient,
//   }));
// 이 모듈은 @supabase/supabase-js 를 런타임으로 부르지 않는다(위 vi.mock 과 순환하지 않게).

export const FAKE_SUPABASE_URL = "https://test.supabase.co";

// 가입 카탈로그의 실제 부서·직급 id(people 계약 시험과 같은 값). 가입 완료 판정이 이 둘을 본다.
const DEPARTMENT_ID = "a6c0f1fc-aeba-5e54-a20c-f6f4d1609f84";
const JOB_TITLE_ID = "33e315b9-aee8-5ea8-96eb-f9055af4eef2";

export const ORG_01 = "0f000000-0000-4000-8000-000000000001";
export const ORG_02 = "0f000000-0000-4000-8000-000000000002";

export type FakeUser = {
  token: string;
  id: string;
  email: string;
  orgId: string;
  solRole: "ADMIN" | "SALES" | "ANALYST" | "EXECUTIVE" | "VIEWER";
};

// 가상 계정. org-02 VIEWER 는 11 G5 조직 격리 시험의 "다른 조직" 이다.
export const FAKE_USERS = {
  admin: {
    token: "token-admin",
    id: "10000000-0000-4000-8000-000000000001",
    email: "admin@solideo.invalid",
    orgId: ORG_01,
    solRole: "ADMIN",
  },
  sales: {
    token: "token-sales",
    id: "10000000-0000-4000-8000-000000000002",
    email: "sales@solideo.invalid",
    orgId: ORG_01,
    solRole: "SALES",
  },
  analyst: {
    token: "token-analyst",
    id: "10000000-0000-4000-8000-000000000003",
    email: "analyst@solideo.invalid",
    orgId: ORG_01,
    solRole: "ANALYST",
  },
  viewer: {
    token: "token-viewer",
    id: "10000000-0000-4000-8000-000000000004",
    email: "viewer@solideo.invalid",
    orgId: ORG_01,
    solRole: "VIEWER",
  },
  executive: {
    token: "token-executive",
    id: "10000000-0000-4000-8000-000000000005",
    email: "executive@solideo.invalid",
    orgId: ORG_01,
    solRole: "EXECUTIVE",
  },
  otherViewer: {
    token: "token-other-viewer",
    id: "20000000-0000-4000-8000-000000000001",
    email: "viewer@other.invalid",
    orgId: ORG_02,
    solRole: "VIEWER",
  },
} as const satisfies Record<string, FakeUser>;

type Row = Record<string, unknown>;

export const fakeSession = {
  // next/headers 의 headers() 가 돌려줄 값. fakeRequest 가 요청의 헤더로 맞춘다.
  headers: new Headers(),
  // 쿠키 세션의 access token. null 이면 로그인하지 않은 브라우저다.
  cookie: null as string | null,
  // 업무 조직 수(0 = 조직 없음, 2 = 여러 조직)
  orgCount: 1,
  // profiles.status. "suspended" 면 운영자가 정지한 계정이다(토큰은 아직 유효).
  profileStatus: "active",
  // true 면 첫 조직이 그 사용자의 개인 조직(personal_owner_id = 사용자 id)이다.
  personalOrg: false,
  // 업무 표 이름 → 행. 질의가 eq·is 로 거르고, update 는 걸린 행을 고친다.
  tables: {} as Record<string, Row[]>,
  // 서비스 운영자(profiles.is_admin = true)로 둘 사용자 id. 비어 있으면 아무도 운영자가 아니다(기본).
  operatorIds: [] as string[],
};

export function resetFakeSession(): void {
  fakeSession.headers = new Headers();
  fakeSession.cookie = null;
  fakeSession.orgCount = 1;
  fakeSession.profileStatus = "active";
  fakeSession.personalOrg = false;
  fakeSession.tables = {};
  fakeSession.operatorIds = [];
}

// 요청을 만들고 next/headers 가 같은 헤더를 보게 한다.
export function fakeRequest(path: string, init: RequestInit = {}): Request {
  const request = new Request(`https://app.example${path}`, init);
  fakeSession.headers = request.headers;
  return request;
}

const userOf = (token: string | null): FakeUser | null =>
  Object.values(FAKE_USERS).find((user) => user.token === token) ?? null;

function profileOf(user: FakeUser): Row {
  return {
    email: user.email,
    is_admin: fakeSession.operatorIds.includes(user.id),
    display_name: "가상직원",
    avatar_url: null,
    status: fakeSession.profileStatus,
    created_at: "2026-10-18",
    declared_department_id: DEPARTMENT_ID,
    declared_job_title_id: JOB_TITLE_ID,
  };
}

function membershipsOf(user: FakeUser, columns: string, filters: Map<string, unknown>): Row[] {
  if (filters.get("user_id") !== user.id) return [];
  // business-access.repo: 지금 조직의 sol_role 한 행
  if (columns === "sol_role") {
    return filters.get("org_id") === user.orgId ? [{ sol_role: user.solRole }] : [];
  }
  // organization.repo: 내 조직 목록. personalOrg 면 첫 조직이 개인 조직이다.
  return Array.from({ length: fakeSession.orgCount }, (_, index) => ({
    org_role: "member",
    organization: {
      id: index === 0 ? user.orgId : `0f000000-0000-4000-8000-00000000009${index}`,
      slug: index === 0 ? "solideo" : `extra-${index}`,
      name: "솔리데오",
      personal_owner_id: fakeSession.personalOrg && index === 0 ? user.id : null,
    },
  }));
}

function query(token: string | null, table: string) {
  const user = userOf(token);
  const filters = new Map<string, unknown>();
  // eq·is 밖의 조건(in·not is). 행 하나를 받아 남길지 정한다.
  const predicates: ((row: Row) => boolean)[] = [];
  let columns = "*";
  let patch: Row | null = null;
  let limit: number | null = null;

  const rowsOf = (): Row[] => {
    if (user === null) return [];
    if (table === "profiles") return filters.get("id") === user.id ? [profileOf(user)] : [];
    if (table === "memberships") return membershipsOf(user, columns, filters);
    const matched = (fakeSession.tables[table] ?? []).filter(
      (row) =>
        [...filters].every(([key, value]) => row[key] === value) &&
        predicates.every((keep) => keep(row)),
    );
    if (patch !== null) for (const row of matched) Object.assign(row, patch);
    return matched.map((row) => ({ ...row }));
  };
  const run = () => {
    const rows = rowsOf();
    return { data: limit === null ? rows : rows.slice(0, limit), error: null };
  };

  const builder = {
    select: (value = "*") => {
      columns = value;
      return builder;
    },
    eq: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    is: (key: string, value: unknown) => {
      filters.set(key, value);
      return builder;
    },
    in: (key: string, values: readonly unknown[]) => {
      predicates.push((row) => values.includes(row[key]));
      return builder;
    },
    // not(열, "is", null) 만 흉내 낸다. 다른 연산자는 조용히 무시하지 않고 시험을 깨뜨린다.
    not: (key: string, operator: string, value: unknown) => {
      if (operator !== "is" || value !== null)
        throw new Error(`fake-session: not(${operator}) 은 흉내 내지 않는다`);
      predicates.push((row) => row[key] !== null && row[key] !== undefined);
      return builder;
    },
    // 키셋 커서·정렬은 흉내 내지 않는다(저장소 시험이 본다).
    or: () => builder,
    order: () => builder,
    limit: (count: number) => {
      limit = count;
      return builder;
    },
    update: (values: Row) => {
      patch = values;
      return builder;
    },
    maybeSingle: async () => {
      const result = run();
      return { data: result.data[0] ?? null, error: null };
    },
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject),
  };
  return builder;
}

export function fakeSupabaseClient(token: string | null) {
  const user = userOf(token);
  return {
    auth: {
      getSession: async () => ({
        data: { session: token ? { access_token: token } : null },
        error: null,
      }),
      // 모르는 토큰은 발급자가 다른 클레임으로 돌려준다 → toAuthClaims 가 null(로그인 안 함).
      getClaims: async () => ({
        data: {
          claims: {
            sub: user?.id ?? "00000000-0000-4000-8000-000000000000",
            email: user?.email ?? "unknown@example.invalid",
            role: "authenticated",
            aud: "authenticated",
            iss: user ? `${FAKE_SUPABASE_URL}/auth/v1` : "https://other.invalid/auth/v1",
            exp: Math.floor(Date.now() / 1000) + 3600,
          },
        },
        error: null,
      }),
    },
    from: (table: string) => query(token, table),
    // 가입 카탈로그 변환(resolve_solideo_employment)
    rpc: async () => ({
      data: [
        {
          department_id: DEPARTMENT_ID,
          department_code: "SOL-D001",
          department_name: "팀",
          job_title_id: JOB_TITLE_ID,
          job_title_code: "SOL-J007",
          job_title_label: "팀장",
        },
      ],
      error: null,
    }),
  };
}

export const fakeNextHeaders = {
  headers: async () => fakeSession.headers,
  cookies: async () => ({ getAll: () => [], set: () => {} }),
};

// @supabase/ssr createServerClient 자리: 쿠키 세션의 토큰을 쓴다.
export const fakeCookieClient = () => fakeSupabaseClient(fakeSession.cookie);

// @supabase/supabase-js createClient 자리: Authorization: Bearer 의 토큰을 쓴다.
export const fakeBearerClient = (
  _url: string,
  _key: string,
  options: { global: { headers: { Authorization: string } } },
) => fakeSupabaseClient(options.global.headers.Authorization.slice("Bearer ".length));
