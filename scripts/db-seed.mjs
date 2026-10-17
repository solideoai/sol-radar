#!/usr/bin/env node
import { readLocalStatus } from "./local-test-target.mjs";
// db-seed.mjs — 로컬 Supabase 에 시드 계정과 데이터를 넣는다. 로그인 뒤 화면을 사람 손 없이 확인하고 시험하려고 쓴다.
//
//   pnpm db:seed                 시드를 (다시) 넣는다. 계정 목록과 비밀번호를 출력한다
//   pnpm -C web test:e2e:auth    시드를 넣고 로그인 E2E 를 돈다
//
// 로컬 전용이다. 주소·키는 `supabase status` 에서 읽고, 로컬이 아닌 주소면 아무것도 하지 않는다.
// 다시 돌려도 기존 다섯 계정·개인 조직·템플릿 팀을 보존한다. 시드 작업·초대는 시험용 초기 상태로 갱신한다.
//
// 데이터는 그 사람으로 로그인해 넣는다(anon 키 + 그 사람의 토큰). RLS 를 거치고, 활동 기록에 행위자가 남는다.
// 관리 키(service_role)는 카탈로그·명부 upsert, 시험 계정 생성·갱신, 시드 작업·초대 갱신, 날짜를 옮기는 일,
// 운영자(profiles.is_admin)를 켜는 일에만 쓴다. is_admin 은 화면 역할이 바꾸지 못한다(권한과 protect_is_admin 트리거 — 관리 키는 통과시킨다).
// 키 값은 화면에 찍지 않는다. 비밀번호는 로컬 시험 계정용이라 출력한다.
//
// 계정·팀·대시보드 수치는 로그인 E2E(web/e2e-auth/support/seed.ts 와 dashboard·tasks-view·admin 시험)에 옮겨 적혀 있다. 바꾸면 같이 고친다.
// 스펙: polaris/specs/done/seed-and-auth-e2e.md

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { catalogUuid, seedLocalPeople, refuseNonLocal } from "./people/seed.mjs";
export { refuseNonLocal };

// ── 1. 시드 계획(순수) ─────────────────────────────────────────

// 로컬 Supabase 에서만 쓰는 시험용 비밀번호다. 운영 DB 에는 시드를 넣지 않는다.
export const SEED_PASSWORD = "seed-password-1234";

// 만드는 순서대로 가입 시각이 늦어진다 — 관리자 화면(최근 가입 순)에서는 운영자가 맨 위, 소유자가 맨 아래다.
// 운영자(admin)는 서비스 운영자다(profiles.is_admin). 어느 팀에도 속하지 않고 개인 공간만 있다.
export const SEED_ACCOUNTS = {
  owner: { email: "seed-owner@example.test", displayName: "김소유" },
  member: { email: "seed-member@example.test", displayName: "이멤버" },
  outsider: { email: "seed-outsider@example.test", displayName: "박외부" },
  invitee: { email: "seed-invitee@example.test", displayName: "최초대" },
  admin: { email: "seed-admin@example.test", displayName: "정운영" },
};

export const SEED_TEAM = { name: "시드 팀", slug: "seed-team" };

// 팀의 작업. 날짜는 오늘(서울)에서 며칠 떨어졌는지로 적는다 — 언제 돌려도 대시보드 수치가 같다.
//   by        만든 사람(그 사람으로 로그인해 넣는다)
//   assignee  담당자(owner·member·null)
//   due       마감일, 오늘에서 며칠(null 은 마감일 없음)
//   created   며칠 전에 만들었나
//   completed 며칠 전에 완료했나(완료한 작업만)
// 대시보드(소유자로 볼 때): 열린 작업 8 · 기한 지남 2 · 이번 주 완료 2(둘 다 오늘) · 내 담당 3.
// 기한 표(마감일 있는 열린 작업, 마감일 순 5개): 분기 보고서 초안 → 고객 인터뷰 정리 → 릴리스 노트 작성 → 디자인 검토 회의 → 온보딩 문서 갱신.
export const SEED_TEAM_TASKS = [
  {
    title: "분기 보고서 초안",
    by: "owner",
    assignee: "owner",
    status: "todo",
    due: -3,
    created: 12,
  },
  {
    title: "고객 인터뷰 정리",
    by: "member",
    assignee: "member",
    status: "in_progress",
    due: -1,
    created: 9,
  },
  {
    title: "릴리스 노트 작성",
    by: "owner",
    assignee: "owner",
    status: "in_progress",
    due: 0,
    created: 6,
  },
  {
    title: "디자인 검토 회의",
    by: "member",
    assignee: "owner",
    status: "todo",
    due: 2,
    created: 4,
  },
  {
    title: "온보딩 문서 갱신",
    by: "owner",
    assignee: "member",
    status: "todo",
    due: 5,
    created: 3,
  },
  { title: "버그 분류", by: "member", assignee: null, status: "todo", due: null, created: 2 },
  {
    title: "API 응답 시간 측정",
    by: "owner",
    assignee: null,
    status: "in_progress",
    due: 10,
    created: 1,
  },
  {
    title: "랜딩 문구 다듬기",
    by: "member",
    assignee: "member",
    status: "todo",
    due: null,
    created: 0,
  },
  {
    title: "로그인 오류 수정",
    by: "owner",
    assignee: "member",
    status: "done",
    due: -2,
    created: 11,
    completed: 0,
  },
  {
    title: "팀 회의록 공유",
    by: "member",
    assignee: "owner",
    status: "done",
    due: null,
    created: 8,
    completed: 0,
  },
  {
    title: "지난 스프린트 회고",
    by: "owner",
    assignee: "owner",
    status: "done",
    due: null,
    created: 13,
    completed: 10,
  },
];

// 소유자의 개인 공간 작업.
export const SEED_PERSONAL_TASKS = [
  { title: "개인 메모 정리", status: "todo" },
  { title: "읽을 글 고르기", status: "in_progress" },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// 서울 날짜(YYYY-MM-DD).
export const seoulDate = (now) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(now);

// YYYY-MM-DD 에 며칠을 더한다(달력 계산이라 서머타임과 상관없다).
export const addDays = (date, days) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * DAY_MS).toISOString().slice(0, 10);
};

// 며칠 전의 서울 날짜 안에 드는 시각. "지금에서 n×24시간 전"으로 잡으면 자정 직후에 돌릴 때 하루 앞 날짜로 넘어간다.
// 그래서 오늘 서울 0시에서 지금까지 흐른 시간의 절반을 그날 0시에 더한다 — 늘 그 날짜 안이고, 오늘이면 지금보다 앞이다.
// 서울은 서머타임이 없어 0시는 늘 +09:00 이다.
export const daysAgo = (now, days) => {
  const midnight = Date.parse(`${seoulDate(now)}T00:00:00+09:00`);
  const intoDay = Math.floor((now.getTime() - midnight) / 2);
  return new Date(midnight - days * DAY_MS + intoDay).toISOString();
};

// 시드 계획 → 넣을 행. 날짜는 now 를 기준으로 푼다.
export const planTeamTasks = (now) => {
  const today = seoulDate(now);
  return SEED_TEAM_TASKS.map((task) => ({
    ...task,
    dueDate: task.due === null ? null : addDays(today, task.due),
    createdAt: daysAgo(now, task.created),
    completedAt: task.status === "done" ? daysAgo(now, task.completed) : null,
  }));
};

// ── 2. HTTP ───────────────────────────────────────────────────

// 실패하면 상태 코드와 서버의 짧은 이유만 담아 던진다(키·토큰은 싣지 않는다).
const createClient =
  (apiUrl) =>
  async (method, path, { apiKey, token, body, prefer } = {}) => {
    const response = await fetch(`${apiUrl}${path}`, {
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
    if (!response.ok) {
      let reason = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text);
        reason = parsed.msg ?? parsed.message ?? parsed.error_description ?? parsed.error ?? reason;
      } catch {
        // JSON 이 아니면 본문 앞부분을 그대로 쓴다.
      }
      throw new Error(`${method} ${path.split("?")[0]} → ${response.status}: ${reason}`);
    }
    return text === "" ? null : JSON.parse(text);
  };

// ── 3. 시드 넣기 ──────────────────────────────────────────────

const listSeedUsers = async (call, serviceKey) => {
  const emails = new Set(Object.values(SEED_ACCOUNTS).map((account) => account.email));
  const found = [];
  for (let page = 1; ; page += 1) {
    const result = await call("GET", `/auth/v1/admin/users?page=${page}&per_page=200`, {
      apiKey: serviceKey,
    });
    const users = result?.users ?? [];
    found.push(...users.filter((user) => emails.has(user.email)));
    if (users.length < 200) return found;
  }
};

const createAccount = async (call, keys, account, existing) => {
  const metadata = {
    name: account.displayName,
    department_code: "SOL-D001",
    job_title_code: "SOL-J007",
  };
  const created = await call(
    existing ? "PUT" : "POST",
    existing ? `/auth/v1/admin/users/${existing.id}` : "/auth/v1/admin/users",
    {
      apiKey: keys.service,
      body: {
        email: account.email,
        password: SEED_PASSWORD,
        email_confirm: true,
        user_metadata: metadata,
      },
    },
  );
  const session = await call("POST", "/auth/v1/token?grant_type=password", {
    apiKey: keys.anon,
    body: { email: account.email, password: SEED_PASSWORD },
  });
  const as = { apiKey: keys.anon, token: session.access_token };
  await call("PATCH", `/rest/v1/profiles?id=eq.${created.id}`, {
    ...as,
    body: {
      display_name: account.displayName,
      declared_department_id: catalogUuid(metadata.department_code),
      declared_job_title_id: catalogUuid(metadata.job_title_code),
    },
  });
  return { id: created.id, as };
};

const insertTask = async (call, as, row) => {
  const [inserted] = await call("POST", "/rest/v1/tasks?select=id", {
    ...as,
    body: row,
    prefer: "return=representation",
  });
  return inserted.id;
};

export const seed = async ({ apiUrl, anonKey, serviceKey, now = new Date() }) => {
  const refusal = refuseNonLocal(apiUrl);
  if (refusal) throw new Error(refusal);
  await seedLocalPeople({ apiUrl, serviceKey });
  const call = createClient(apiUrl);
  const keys = { anon: anonKey, service: serviceKey };

  const existingUsers = await listSeedUsers(call, serviceKey);

  const people = {};
  for (const [role, account] of Object.entries(SEED_ACCOUNTS)) {
    people[role] = await createAccount(
      call,
      keys,
      account,
      existingUsers.find((user) => user.email === account.email),
    );
  }
  const { owner, member, admin } = people;

  // 운영자: 화면 역할에는 is_admin 의 쓰기 권한이 없어 관리 키로 켠다. 켜졌는지 돌려받아 확인한다 —
  // 행이 없거나 트리거가 되돌렸으면 오류 없이 지나가 관리자 시험이 엉뚱한 곳에서 실패한다.
  const promoted = await call("PATCH", `/rest/v1/profiles?id=eq.${admin.id}&select=is_admin`, {
    apiKey: serviceKey,
    body: { is_admin: true },
    prefer: "return=representation",
  });
  if (promoted?.[0]?.is_admin !== true) {
    throw new Error(`${SEED_ACCOUNTS.admin.email} 을 운영자로 켜지 못했습니다`);
  }

  // 기존 템플릿 팀은 그대로 두고 시드가 소유하는 작업·초대 상태만 갱신한다.
  const [existingTeam] = await call(
    "GET",
    `/rest/v1/organizations?select=id&slug=eq.${SEED_TEAM.slug}`,
    owner.as,
  );
  if (!existingTeam) {
    await call("POST", "/rest/v1/organizations", {
      ...owner.as,
      body: SEED_TEAM,
      prefer: "return=minimal",
    });
  }
  const [team] = await call(
    "GET",
    `/rest/v1/organizations?select=id&slug=eq.${SEED_TEAM.slug}`,
    owner.as,
  );
  const asService = { apiKey: serviceKey };
  // slug만으로 팀의 소유권을 판단하지 않는다. 비시드 회원이 있으면 초대 수락 복원도 하지 않는다.
  const teamMemberships = await call(
    "GET",
    `/rest/v1/memberships?select=user_id&org_id=eq.${team.id}`,
    asService,
  );
  const seedUserIds = new Set(Object.values(people).map((person) => person.id));
  if (teamMemberships.some((membership) => !seedUserIds.has(membership.user_id))) {
    throw new Error("시드 계정 외 회원이 있는 팀의 초기화를 거부합니다.");
  }
  // 초대 수락 E2E가 남긴 이 연결만 초기화한다. owner 승격·다른 조직/사용자는 보존한다.
  await call(
    "DELETE",
    `/rest/v1/memberships?org_id=eq.${team.id}&user_id=eq.${people.invitee.id}&org_role=eq.member`,
    owner.as,
  );
  await call("DELETE", `/rest/v1/tasks?org_id=eq.${team.id}`, asService);
  await call("DELETE", `/rest/v1/invitations?org_id=eq.${team.id}`, asService);
  const members = await call(
    "GET",
    `/rest/v1/memberships?select=user_id&org_id=eq.${team.id}&user_id=eq.${member.id}`,
    member.as,
  );
  for (const email of [
    ...(members.length ? [] : [SEED_ACCOUNTS.member.email]),
    SEED_ACCOUNTS.invitee.email,
  ]) {
    await call("POST", "/rest/v1/invitations", {
      ...owner.as,
      body: { org_id: team.id, email, org_role: "member" },
      prefer: "return=minimal",
    });
  }
  if (!members.length) {
    await call("POST", "/rest/v1/memberships", {
      ...member.as,
      body: { org_id: team.id, user_id: member.id, org_role: "member" },
      prefer: "return=minimal",
    });
  }

  // 작업: 만든 사람으로 넣는다. 완료한 작업은 할 일로 넣고 완료로 바꿔 "완료함" 활동이 남게 한다.
  for (const task of planTeamTasks(now)) {
    const as = people[task.by].as;
    const id = await insertTask(call, as, {
      org_id: team.id,
      title: task.title,
      status: task.status === "done" ? "todo" : task.status,
      due_date: task.dueDate,
      assignee_id: task.assignee === null ? null : people[task.assignee].id,
    });
    if (task.status === "done") {
      await call("PATCH", `/rest/v1/tasks?id=eq.${id}`, {
        ...as,
        body: { status: "done" },
        prefer: "return=minimal",
      });
    }
    // 만든 날·완료한 날을 과거로 옮긴다. 화면 역할에는 이 열의 쓰기 권한이 없어 관리 키로 한다.
    await call("PATCH", `/rest/v1/tasks?id=eq.${id}`, {
      apiKey: serviceKey,
      body: { created_at: task.createdAt, completed_at: task.completedAt },
      prefer: "return=minimal",
    });
  }

  const [personal] = await call(
    "GET",
    `/rest/v1/organizations?select=id&personal_owner_id=eq.${owner.id}`,
    owner.as,
  );
  // ADR-021 이후 가입에는 개인 공간이 없다. 이전 계정에 남아 있는 공간만 갱신한다.
  if (personal) {
    await call("DELETE", `/rest/v1/tasks?org_id=eq.${personal.id}`, asService);
    for (const task of SEED_PERSONAL_TASKS) {
      await insertTask(call, owner.as, {
        org_id: personal.id,
        title: task.title,
        status: task.status,
      });
    }
  }

  return { removed: 0, teamSlug: SEED_TEAM.slug };
};

// ── 4. 명령 ───────────────────────────────────────────────────

export async function seedSelectedLocal({ env = process.env, run, write = seed } = {}) {
  const status = readLocalStatus({ env, ...(run ? { run } : {}) });
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;
  if (!anonKey || !serviceKey) throw new Error("로컬 seed 인증 키가 없습니다.");
  return write({ apiUrl: status.API_URL, anonKey, serviceKey });
}

const main = async () => {
  console.log("▶ 시드 넣기 (로컬 Supabase)");
  try {
    await seedSelectedLocal();
  } catch (error) {
    console.error(`❌ 시드를 넣지 못했습니다: ${error.message}`);
    console.error("   마이그레이션이 밀렸으면 pnpm db:start 로 따라잡은 뒤 다시 실행하세요.");
    return 1;
  }

  console.log("✓ 시드를 넣었습니다. 비밀번호는 모두 " + SEED_PASSWORD);
  console.log(`  소유자        ${SEED_ACCOUNTS.owner.email}   (팀 /${SEED_TEAM.slug} 의 owner)`);
  console.log(`  멤버          ${SEED_ACCOUNTS.member.email}  (팀의 member)`);
  console.log(`  조직 밖 사람  ${SEED_ACCOUNTS.outsider.email} (팀과 관계없음)`);
  console.log(`  초대받은 사람 ${SEED_ACCOUNTS.invitee.email}  (팀 초대를 받아 둔 상태)`);
  console.log(`  운영자        ${SEED_ACCOUNTS.admin.email}    (서비스 운영자, /admin. 팀 없음)`);
  return 0;
};

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (process.argv[1] && isMain()) {
  process.exit(await main());
}
