import { spawnSync } from "node:child_process";
import { z } from "zod";
import { SEED_ACCOUNTS, SEED_PASSWORD, type SeedRole } from "./seed";

// 시험 데이터 준비 — 화면으로 만들면 오래 걸리거나 시험의 목적이 아닌 데이터(쪽을 넘길 만큼의 작업, 편집·삭제할 작업 하나)를
// Supabase REST 로 넣고 치운다. 시드처럼 그 사람으로 로그인해 넣는다(anon 키 + 그 사람의 토큰이라 RLS 를 거친다).
// 관리 키(service_role)는 읽지 않는다. 주소와 anon 키는 `supabase status` 에서 읽고, 로컬 주소가 아니면 멈춘다.
// 키·토큰은 출력하지 않고 파일에도 남기지 않는다.

// mailboxUrl 은 로컬 메일함(Mailpit)의 주소다. 로컬 주소가 아니거나 없으면 null 이다.
type LocalSupabase = { apiUrl: string; anonKey: string; mailboxUrl: string | null };

const STATUS_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;
const unquote = (value: string): string =>
  value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]
    ? value.slice(1, -1)
    : value;

// 이 컴퓨터나 같은 네트워크(사설 대역)의 주소인가. 시드(scripts/local-env.mjs 의 isLocalUrl)와 같은 기준이다.
const isLocalHost = (host: string): boolean =>
  host === "localhost" ||
  host === "[::1]" ||
  /^127\./.test(host) ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host);

const readLocalSupabase = (): LocalSupabase => {
  const run = spawnSync("supabase", ["status", "-o", "env"], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (run.error || run.status !== 0) {
    throw new Error(
      "로컬 Supabase 상태를 읽지 못했습니다. 꺼져 있거나 Supabase CLI 가 없습니다. pnpm db:start 로 켠 뒤 다시 실행하세요.",
    );
  }
  // 출력에는 관리 키도 들어 있다. 주소와 anon 키만 꺼낸다.
  const env = new Map(
    run.stdout.split(/\r?\n/).flatMap((line) => {
      const match = STATUS_LINE.exec(line);
      return match ? [[match[1], unquote(match[2])] as const] : [];
    }),
  );
  const apiUrl = env.get("API_URL") ?? "";
  const anonKey = env.get("ANON_KEY") || env.get("PUBLISHABLE_KEY") || "";
  const host = URL.canParse(apiUrl) ? new URL(apiUrl).hostname : "";
  if (!isLocalHost(host)) {
    throw new Error(
      `로컬 Supabase 주소가 아닙니다(${apiUrl || "비어 있음"}). 시험 데이터는 로컬에만 넣습니다.`,
    );
  }
  if (anonKey === "") throw new Error("supabase status 출력에 anon 키가 없습니다.");
  // CLI 버전에 따라 이름이 다르다(Mailpit 이전은 Inbucket).
  const mailboxUrl = env.get("MAILPIT_URL") || env.get("INBUCKET_URL") || "";
  const mailboxHost = URL.canParse(mailboxUrl) ? new URL(mailboxUrl).hostname : "";
  return { apiUrl, anonKey, mailboxUrl: isLocalHost(mailboxHost) ? mailboxUrl : null };
};

// 한 작업자(worker) 안에서 `supabase status` 를 한 번만 부른다.
const cache: { value?: LocalSupabase } = {};
const localSupabase = (): LocalSupabase => (cache.value ??= readLocalSupabase());

// 로컬 메일함(Mailpit) 주소. 초대 메일 시험(support/mailbox.ts)이 쓴다.
export const localMailboxUrl = (): string => {
  const { mailboxUrl } = localSupabase();
  if (!mailboxUrl) {
    throw new Error(
      "supabase status 출력에 로컬 메일함 주소(MAILPIT_URL)가 없습니다. pnpm db:start 로 켠 로컬 Supabase 가 필요합니다.",
    );
  }
  return mailboxUrl;
};

// 실패하면 상태 코드와 서버의 짧은 이유만 담아 던진다(키·토큰은 싣지 않는다).
const call = async (
  method: "GET" | "POST" | "DELETE",
  path: string,
  { token, body, prefer }: { token?: string; body?: unknown; prefer?: string } = {},
): Promise<unknown> => {
  const { apiUrl, anonKey } = localSupabase();
  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token ?? anonKey}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path.split("?")[0]} → ${response.status}: ${text.slice(0, 200)}`);
  }
  return text === "" ? null : JSON.parse(text);
};

export type SeedSession = { userId: string; token: string };

const sessionSchema = z.object({ access_token: z.string(), user: z.object({ id: z.string() }) });
const idRowsSchema = z.array(z.object({ id: z.string() }));

// 시드 계정으로 로그인한다. 브라우저의 로그인과 따로인 세션이라 서로의 로그인을 풀지 않는다.
export const signInAs = async (role: SeedRole): Promise<SeedSession> => {
  const session = sessionSchema.parse(
    await call("POST", "/auth/v1/token?grant_type=password", {
      body: { email: SEED_ACCOUNTS[role].email, password: SEED_PASSWORD },
    }),
  );
  return { userId: session.user.id, token: session.access_token };
};

export const orgIdOf = async (session: SeedSession, slug: string): Promise<string> => {
  const [org] = idRowsSchema
    .length(1)
    .parse(await call("GET", `/rest/v1/organizations?select=id&slug=eq.${slug}`, session));
  return org.id;
};

// 팀을 만든다. 만든 사람이 owner 가 된다(트리거). 시험 중에 치우려면 deleteTeam 을 부른다 —
// 남겨 두어도 시드 계정만 멤버인 조직이라 다음 `pnpm db:seed` 가 지운다(스펙 5장).
export const createTeam = async (
  session: SeedSession,
  team: { name: string; slug: string },
): Promise<string> => {
  await call("POST", "/rest/v1/organizations", {
    token: session.token,
    body: team,
    prefer: "return=minimal",
  });
  return orgIdOf(session, team.slug);
};

// 팀을 지운다(owner 의 토큰이라 팀 owner 만 지우는 정책을 거친다). 멤버십·초대·작업·활동이 함께 지워진다.
// 시험이 이미 지웠으면 0행이라 아무것도 하지 않는다. 시험이 실패해도 finally 에서 부른다.
export const deleteTeam = async (session: SeedSession, orgId: string): Promise<void> => {
  await call("DELETE", `/rest/v1/organizations?id=eq.${orgId}`, session);
};

// 대기 중인 초대를 하나 만든다(owner 의 토큰). 화면의 "다시 초대"를 시험할 때 쓴다. 메일은 보내지 않는다.
export const createInvitation = async (
  session: SeedSession,
  invitation: { orgId: string; email: string },
): Promise<void> => {
  await call("POST", "/rest/v1/invitations", {
    token: session.token,
    body: { org_id: invitation.orgId, email: invitation.email, org_role: "member" },
    prefer: "return=minimal",
  });
};

type NewTask = {
  orgId: string;
  title: string;
  status?: "todo" | "in_progress" | "done";
  assigneeId?: string | null;
  dueDate?: string | null;
};

// 작업 하나를 넣고 id 를 돌려준다. 하나씩 넣어야 만든 시각이 갈려 "최근 만든 순"이 정해진다.
export const createTask = async (session: SeedSession, task: NewTask): Promise<string> => {
  const [row] = idRowsSchema.length(1).parse(
    await call("POST", "/rest/v1/tasks?select=id", {
      token: session.token,
      body: {
        org_id: task.orgId,
        title: task.title,
        status: task.status ?? "todo",
        assignee_id: task.assigneeId ?? null,
        due_date: task.dueDate ?? null,
      },
      prefer: "return=representation",
    }),
  );
  return row.id;
};

// 제목으로 지운다. 화면으로 만든 작업은 id 를 모른다. 이미 지워졌으면 아무것도 하지 않는다.
export const deleteTasksTitled = async (
  session: SeedSession,
  orgId: string,
  title: string,
): Promise<void> => {
  await call(
    "DELETE",
    `/rest/v1/tasks?org_id=eq.${orgId}&title=eq.${encodeURIComponent(title)}`,
    session,
  );
};
