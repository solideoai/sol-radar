import { randomUUID } from "node:crypto";
import { readLocalStatus } from "./local-status";
import { z } from "zod";
import { declarationMetadata } from "./seed";

// 관리자 E2E 의 시험 계정 — 정지·해제처럼 시드 계정에 하면 같은 실행의 다른 시험이 깨지는 일은 시험 안에서 만든 계정에 한다.
// 관리 키(service_role)는 세 가지 준비에만 쓴다. 시험하는 동작(정지·해제·로그인·/api)에는 쓰지 않는다.
//   1. 계정 만들기 — 로컬도 가입 확인 메일을 거쳐야 해서(supabase/config.toml enable_confirmations) 시드처럼 관리 API 로 확인된 계정을 만든다.
//   2. 운영자 켜기 — 화면 역할은 is_admin 을 바꾸지 못한다(권한과 protect_is_admin 트리거). "다른 운영자" 줄을 보려고만 켠다.
//   3. 계정 지우기 — 정지된 채 끝나도 지워야 한다. 정지된 회원은 스스로 탈퇴하지 못한다(delete_my_account 의 suspended).
// 주소·키는 `supabase status` 에서 읽고, 로컬 주소가 아니면 멈춘다. 키·토큰·비밀번호는 출력하지 않고 파일에도 남기지 않는다.
// 이메일은 e2e-admin-<이름>-<꼬리표>@example.test 다. 시드 검색어(seed-)에 걸리지 않고, 정리하지 못하고 남아도 다음 실행과 겹치지 않는다.

type LocalAuth = { apiUrl: string; anonKey: string; serviceKey: string };

const readLocalAuth = (): LocalAuth => {
  const env = readLocalStatus();
  const apiUrl = env.API_URL;
  const anonKey = env.ANON_KEY || env.PUBLISHABLE_KEY || "";
  const serviceKey = env.SERVICE_ROLE_KEY || env.SECRET_KEY || "";
  if (!anonKey || !serviceKey)
    throw new Error("supabase status 출력에 anon·service_role 키가 없습니다.");
  return { apiUrl, anonKey, serviceKey };
};

// 한 작업자(worker) 안에서 `supabase status` 를 한 번만 부른다.
const cache: { value?: LocalAuth } = {};
const localAuth = (): LocalAuth => (cache.value ??= readLocalAuth());

type Reply = { status: number; body: unknown };

// 상태 코드와 본문을 그대로 돌려준다. 거절을 단언하는 시험이 있어 여기서 던지지 않는다.
const send = async (
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  {
    key,
    token,
    body,
    prefer,
  }: { key: "anon" | "service"; token?: string; body?: unknown; prefer?: string },
): Promise<Reply> => {
  const auth = localAuth();
  const apiKey = key === "service" ? auth.serviceKey : auth.anonKey;
  const response = await fetch(`${auth.apiUrl}${path}`, {
    method,
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${token ?? apiKey}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
};

// 준비 단계의 실패는 상태 코드와 서버의 짧은 이유만 담아 던진다(키·토큰은 싣지 않는다).
const expectOk = (reply: Reply, what: string): unknown => {
  if (reply.status >= 200 && reply.status < 300) return reply.body;
  throw new Error(`${what} → ${reply.status}: ${JSON.stringify(reply.body).slice(0, 200)}`);
};

export type TestAccount = { id: string; email: string; password: string; name: string };

const createdSchema = z.object({ id: z.string() });
const profileSchema = z.array(
  z.object({ display_name: z.string().nullable(), is_admin: z.boolean() }),
);

/**
 * 확인된 이메일 계정을 만든다. 표시 이름은 가입 트리거가 메타데이터(name)에서 채운다(20261015000001).
 * 가입 트리거는 프로필만 만든다. 업무 조직은 필요한 시험이 명시적으로 준비한다.
 */
export const createTestAccount = async ({
  label,
  tag,
  name,
  isAdmin = false,
  incomplete = false,
}: {
  label: string;
  tag: string;
  name: string;
  isAdmin?: boolean;
  incomplete?: boolean;
}): Promise<TestAccount> => {
  const email = `e2e-admin-${label}-${tag}@example.test`;
  const password = `e2e-${randomUUID()}`;
  const { id } = createdSchema.parse(
    expectOk(
      await send("POST", "/auth/v1/admin/users", {
        key: "service",
        body: {
          email,
          password,
          email_confirm: true,
          user_metadata: declarationMetadata(name, incomplete),
        },
      }),
      "시험 계정 만들기",
    ),
  );
  const account = { id, email, password, name };
  const path = `/rest/v1/profiles?id=eq.${id}&select=display_name,is_admin`;
  // 운영자는 관리 키로 켜고, 켜졌는지 돌려받아 본다 — 행이 없거나 트리거가 되돌렸으면 오류 없이 지나간다.
  const [profile] = profileSchema.length(1).parse(
    expectOk(
      isAdmin
        ? await send("PATCH", path, {
            key: "service",
            body: { is_admin: true },
            prefer: "return=representation",
          })
        : await send("GET", path, { key: "service" }),
      "시험 계정 프로필 읽기",
    ),
  );
  if (profile.display_name !== name || profile.is_admin !== isAdmin) {
    await deleteTestAccount(account);
    throw new Error(`시험 계정 ${email} 의 프로필이 예상과 다릅니다(표시 이름·운영자 여부).`);
  }
  return account;
};

/** 계정을 지운다. 프로필·멤버십·개인 조직·세션이 함께 지워진다. 이미 없으면 아무것도 하지 않는다. */
export const deleteTestAccount = async (account: Pick<TestAccount, "id" | "email">) => {
  const reply = await send("DELETE", `/auth/v1/admin/users/${account.id}`, { key: "service" });
  if (reply.status !== 404) expectOk(reply, `시험 계정 ${account.email} 지우기`);
};

const sessionSchema = z.object({ access_token: z.string(), refresh_token: z.string() });
const authErrorSchema = z.object({ error_code: z.string().optional() });

export type SignIn =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; status: number; errorCode: string | undefined };

const toSignIn = (reply: Reply): SignIn => {
  if (reply.status === 200) {
    const session = sessionSchema.parse(reply.body);
    return { ok: true, accessToken: session.access_token, refreshToken: session.refresh_token };
  }
  const parsed = authErrorSchema.safeParse(reply.body);
  return {
    ok: false,
    status: reply.status,
    errorCode: parsed.success ? parsed.data.error_code : undefined,
  };
};

/** 앱(supabase-js)이 하는 것과 같은 비밀번호 로그인. 브라우저의 로그인과 따로인 세션이다. */
export const passwordSignIn = async (account: TestAccount): Promise<SignIn> =>
  toSignIn(
    await send("POST", "/auth/v1/token?grant_type=password", {
      key: "anon",
      body: { email: account.email, password: account.password },
    }),
  );

/** 로그인되어야 하는 자리. 거절되면 상태 코드와 오류 코드로 실패한다. */
export const signInOrThrow = async (
  account: TestAccount,
): Promise<{ accessToken: string; refreshToken: string }> => {
  const result = await passwordSignIn(account);
  if (!result.ok) {
    throw new Error(
      `${account.email} 로 로그인하지 못했습니다(${result.status} ${result.errorCode ?? ""}).`,
    );
  }
  return result;
};

/** 토큰 갱신. 정지하면 세션과 그 refresh token 이 지워져 실패해야 한다. */
export const refreshSession = async (refreshToken: string): Promise<SignIn> =>
  toSignIn(
    await send("POST", "/auth/v1/token?grant_type=refresh_token", {
      key: "anon",
      body: { refresh_token: refreshToken },
    }),
  );

const orgRowsSchema = z.array(z.object({ org_id: z.string() }));

/** 그 사람의 토큰으로 RLS 를 거쳐 읽은 내 멤버십 수. 정지되면 정책 도우미(my_org_ids)가 비어 0 이다. */
export const visibleMembershipCount = async (accessToken: string): Promise<number> =>
  orgRowsSchema.parse(
    expectOk(
      await send("GET", "/rest/v1/memberships?select=org_id", { key: "anon", token: accessToken }),
      "멤버십 읽기",
    ),
  ).length;
