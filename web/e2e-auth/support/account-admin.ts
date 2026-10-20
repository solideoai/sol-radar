import { readLocalStatus } from "./local-status";
import { z } from "zod";
import { declarationMetadata, SOLIDEO_ORG_ID, uniqueTag } from "./seed";

// 마이페이지 쓰기 시험(settings-account.write.spec.ts)이 쓰는 계정 준비 — 로그아웃(모든 기기)·탈퇴는 시드 계정에 하면
// 같은 실행의 다른 시험이 깨진다(auth.setup.ts). 그래서 시험마다 따로 계정을 만들고 끝나면 지운다.
// 계정 만들기·지우기, 팀 만들기, 남은 팀 치우기에만 관리 키(service_role)를 쓴다. 시드(scripts/db-seed.mjs)와 같은 방식이다 —
// 이 로컬은 가입 메일 확인이 켜져 있어(supabase/config.toml) anon 키로 가입하면 로그인할 수 없고,
// 팀 만들기는 서비스 운영자만 할 수 있다(ADR-026, 마이그레이션 20261019000008. createTeamOwnedBy 참고).
// 초대·수락처럼 화면 역할이 하는 일은 그 사람으로 로그인해(anon 키 + 그 사람의 토큰) RLS 를 거친다.
// 주소와 키는 `supabase status` 에서 읽고, 로컬 주소가 아니면 멈춘다. 키·토큰·비밀번호는 출력하지 않고 파일에도 남기지 않는다.

type LocalAdmin = { apiUrl: string; anonKey: string; serviceKey: string };

const readLocalAdmin = (): LocalAdmin => {
  const env = readLocalStatus();
  const apiUrl = env.API_URL;
  const anonKey = env.ANON_KEY || env.PUBLISHABLE_KEY || "";
  const serviceKey = env.SERVICE_ROLE_KEY || env.SECRET_KEY || "";
  if (!anonKey || !serviceKey)
    throw new Error("supabase status 출력에 anon·service_role 키가 없습니다.");
  return { apiUrl, anonKey, serviceKey };
};

// 한 작업자(worker) 안에서 `supabase status` 를 한 번만 부른다.
const cache: { value?: LocalAdmin } = {};
const localAdmin = (): LocalAdmin => (cache.value ??= readLocalAdmin());

// 오류 응답은 JSON 이 아닐 수 있다(게이트웨이의 글자 응답). 그때는 글자 그대로 둔다.
const parseBody = (text: string): unknown => {
  if (text === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

type CallOptions = { as: "service" | "anon" | { token: string }; body?: unknown; prefer?: string };
type Reply = { status: number; body: unknown };

// 응답을 그대로 돌려준다(실패도). 키·토큰은 결과에 싣지 않는다.
const send = async (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  { as, body, prefer }: CallOptions,
): Promise<Reply> => {
  const { apiUrl, anonKey, serviceKey } = localAdmin();
  const apiKey = as === "service" ? serviceKey : anonKey;
  const bearer = typeof as === "object" ? as.token : apiKey;
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: parseBody(text) };
};

// 성공해야 하는 호출. 실패하면 상태 코드와 서버의 짧은 이유만 담아 던진다.
const call = async (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: CallOptions,
): Promise<unknown> => {
  const reply = await send(method, path, options);
  if (reply.status >= 400) {
    throw new Error(
      `${method} ${path.split("?")[0]} → ${reply.status}: ${JSON.stringify(reply.body).slice(0, 200)}`,
    );
  }
  return reply.body;
};

export type TestAccount = { id: string; email: string; password: string };

const createdUserSchema = z.object({ id: z.string() });

// 메일 확인을 마친 계정을 만든다. 가입 트리거는 프로필만 만든다. 업무 멤버십은 시험이 명시적으로 준비한다.
// 주소에 seed- 를 넣지 않는다 — 시드가 지우는 계정, 관리자 시험이 고정된 수로 세는 검색어(seed-)와 섞이지 않게 한다.
export const createTestAccount = async ({
  incomplete = false,
}: { incomplete?: boolean } = {}): Promise<TestAccount> => {
  const tag = uniqueTag();
  const email = `e2e-account-${tag}@example.test`;
  const password = `e2e-pw-${uniqueTag()}`;
  const created = createdUserSchema.parse(
    await call("POST", "/auth/v1/admin/users", {
      as: "service",
      body: {
        email,
        password,
        email_confirm: true,
        user_metadata: declarationMetadata("시험 계정", incomplete),
      },
    }),
  );
  return { id: created.id, email, password };
};

const membershipRowsSchema = z.array(z.object({ org_id: z.string(), user_id: z.string() }));
const inList = (values: readonly string[]) => `in.(${values.join(",")})`;

// 시험 계정과, 시험 계정만 멤버인 조직(개인 공간·시험이 만든 팀)을 지운다. 시드의 removePreviousSeed 와 같은 순서다.
// 이미 지워진 계정(탈퇴 시험)은 건너뛴다. 시험이 실패해도 finally 에서 부른다.
export const removeTestAccounts = async (accounts: readonly TestAccount[]): Promise<void> => {
  if (accounts.length === 0) return;
  const ids = new Set(accounts.map((account) => account.id));
  const mine = membershipRowsSchema.parse(
    await call("GET", `/rest/v1/memberships?select=org_id,user_id&user_id=${inList([...ids])}`, {
      as: "service",
    }),
  );
  const orgIds = [...new Set(mine.map((row) => row.org_id))];
  if (orgIds.length > 0) {
    const members = membershipRowsSchema.parse(
      await call("GET", `/rest/v1/memberships?select=org_id,user_id&org_id=${inList(orgIds)}`, {
        as: "service",
      }),
    );
    const shared = new Set(members.filter((row) => !ids.has(row.user_id)).map((row) => row.org_id));
    const onlyOurs = orgIds.filter((id) => !shared.has(id));
    if (onlyOurs.length > 0) {
      await call("DELETE", `/rest/v1/organizations?id=${inList(onlyOurs)}`, { as: "service" });
    }
  }
  for (const id of ids) {
    const reply = await send("DELETE", `/auth/v1/admin/users/${id}`, { as: "service" });
    if (reply.status >= 400 && reply.status !== 404) {
      throw new Error(`시험 계정을 지우지 못했습니다 → ${reply.status}`);
    }
  }
};

// 계정이 아직 있는가(관리 키로 본다). 탈퇴했으면 false.
export const accountExists = async (account: TestAccount): Promise<boolean> => {
  const reply = await send("GET", `/auth/v1/admin/users/${account.id}`, { as: "service" });
  if (reply.status === 404) return false;
  if (reply.status === 200) return true;
  throw new Error(`계정을 찾지 못했습니다 → ${reply.status}`);
};

const sessionSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  user: z.object({ id: z.string() }),
});
export type ApiSession = { userId: string; token: string };

// 브라우저와 따로인 세션으로 로그인한다(데이터 준비용).
export const signInByApi = async (account: TestAccount): Promise<ApiSession> => {
  const session = sessionSchema.parse(
    await call("POST", "/auth/v1/token?grant_type=password", {
      as: "anon",
      body: { email: account.email, password: account.password },
    }),
  );
  return { userId: session.user.id, token: session.access_token };
};

const errorCodeSchema = z.object({ error_code: z.string() }).partial();

// refresh token 으로 세션을 갱신해 본다. 성공하면 새 토큰의 주인, 실패하면 Supabase Auth 의 오류 코드를 돌려준다.
// 다른 기기의 세션이 서버에서 끊겼는지는 이것으로 본다(이미 받은 access token 은 만료까지 서명이 맞다).
export const refreshSession = async (
  refreshToken: string,
): Promise<{ status: number; userId: string | null; errorCode: string | null }> => {
  const reply = await send("POST", "/auth/v1/token?grant_type=refresh_token", {
    as: "anon",
    body: { refresh_token: refreshToken },
  });
  const session = sessionSchema.safeParse(reply.body);
  return {
    status: reply.status,
    userId: session.success ? session.data.user.id : null,
    errorCode: errorCodeSchema.safeParse(reply.body).data?.error_code ?? null,
  };
};

const idRowsSchema = z.array(z.object({ id: z.string() }));
const teamOwnerRowsSchema = z
  .array(
    z.object({
      org_id: z.string(),
      user_id: z.string(),
      org_role: z.literal("owner"),
      sol_role: z.literal("ADMIN"),
    }),
  )
  .length(1);

// 팀을 만들고 owner 를 그 팀의 소유자로 붙인다. 팀 id 를 돌려준다.
// 팀 만들기는 서비스 운영자만 한다(ADR-026, 20261019000008) — 시험 계정은 운영자가 아니므로 시드(scripts/db-seed.mjs)처럼
// 관리 키로 만든다. 관리 키로 만든 팀에는 add_team_owner 트리거가 멤버십을 만들지 않으므로(JWT 의 사용자가 없다),
// 트리거가 팀을 만든 사람에게 주던 값(owner + 업무 역할 ADMIN, 20261019000001)을 직접 넣고 돌려받아 확인한다.
// 끝으로 그 사람의 토큰으로 팀이 보이는지(RLS) 읽어 멤버십이 붙었는지 본다. 제품 정책은 바꾸지 않는다.
const createTeamOwnedBy = async (
  owner: ApiSession,
  team: { name: string; slug: string },
): Promise<string> => {
  const [org] = idRowsSchema.length(1).parse(
    await call("POST", "/rest/v1/organizations?select=id", {
      as: "service",
      body: team,
      prefer: "return=representation",
    }),
  );
  try {
    teamOwnerRowsSchema.parse(
      await call("POST", "/rest/v1/memberships?select=org_id,user_id,org_role,sol_role", {
        as: "service",
        body: { org_id: org.id, user_id: owner.userId, org_role: "owner", sol_role: "ADMIN" },
        prefer: "return=representation",
      }),
    );
  } catch (error) {
    // 멤버가 없는 팀은 removeTestAccounts 가 찾지 못한다. 여기서 치우고 원래 오류를 그대로 올린다.
    await call("DELETE", `/rest/v1/organizations?id=eq.${org.id}`, { as: "service" });
    throw error;
  }
  idRowsSchema.length(1).parse(
    await call("GET", `/rest/v1/organizations?select=id&id=eq.${org.id}`, {
      as: { token: owner.token },
    }),
  );
  return org.id;
};

// owner 가 팀의 소유자가 되고(createTeamOwnedBy), member 를 초대해 수락시킨다. 팀은 removeTestAccounts 가 함께 지운다.
// label 은 팀 이름의 머리말이다. 이름 끝에 실행마다 다른 꼬리표가 붙는다.
export const createTeamWithMember = async (
  owner: TestAccount,
  member: TestAccount,
  label = "E2E 탈퇴 팀",
): Promise<{ name: string; slug: string }> => {
  const tag = uniqueTag();
  const team = { name: `${label} ${tag}`, slug: `e2e-${tag}` };
  const ownerSession = await signInByApi(owner);
  const orgId = await createTeamOwnedBy(ownerSession, team);
  await call("POST", "/rest/v1/invitations", {
    as: { token: ownerSession.token },
    body: { org_id: orgId, email: member.email, org_role: "member" },
    prefer: "return=minimal",
  });
  const memberSession = await signInByApi(member);
  await call("POST", "/rest/v1/memberships", {
    as: { token: memberSession.token },
    body: { org_id: orgId, user_id: memberSession.userId, org_role: "member" },
    prefer: "return=minimal",
  });
  return team;
};

// Only the exact disposable signup email is selected; paginated results are never
// printed. Also handles failure before email confirmation so cleanup is reliable.
export const findTestAccount = async (
  email: string,
  password: string,
): Promise<TestAccount | null> => {
  if (!/^e2e-signup-[a-z0-9]+@example\.test$/.test(email))
    throw new Error("시험 가입 주소만 찾을 수 있습니다");
  const usersSchema = z.object({
    users: z.array(z.object({ id: z.string(), email: z.string().optional() })),
  });
  for (let page = 1; ; page++) {
    const { users } = usersSchema.parse(
      await call("GET", `/auth/v1/admin/users?page=${page}&per_page=100`, { as: "service" }),
    );
    const user = users.find((user) => user.email === email);
    if (user) return { id: user.id, email, password };
    if (users.length < 100) return null;
  }
};

// Existing-account precompletion is prepared through the user's real column
// grants/RLS, not by weakening production guards or changing Auth metadata.
export const clearEmployment = async (session: ApiSession): Promise<void> => {
  await call("PATCH", `/rest/v1/profiles?id=eq.${session.userId}`, {
    as: { token: session.token },
    body: { declared_department_id: null, declared_job_title_id: null },
    prefer: "return=minimal",
  });
};

export const readOwnPeopleAccess = async (session: ApiSession) => {
  const rows = z.array(z.object({ id: z.string() }));
  const memberships = z.array(z.object({ org_id: z.string() }));
  return {
    organizations: rows.parse(
      await call("GET", `/rest/v1/organizations?select=id&id=eq.${SOLIDEO_ORG_ID}`, {
        as: { token: session.token },
      }),
    ),
    people: rows.parse(
      await call("GET", `/rest/v1/team_members?select=id&org_id=eq.${SOLIDEO_ORG_ID}`, {
        as: { token: session.token },
      }),
    ),
    memberships: memberships.parse(
      await call("GET", `/rest/v1/memberships?select=org_id&org_id=eq.${SOLIDEO_ORG_ID}`, {
        as: { token: session.token },
      }),
    ),
  };
};

// Explicit fixture provisioning, never an implicit signup side effect.
export const createOwnedTeam = async (account: TestAccount, name = "E2E 업무 조직") => {
  const team = { name, slug: `e2e-${uniqueTag()}` };
  const id = await createTeamOwnedBy(await signInByApi(account), team);
  return { ...team, id };
};
