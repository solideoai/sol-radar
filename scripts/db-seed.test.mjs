// 시드(scripts/db-seed.mjs)의 순수 부분 시험. 실행: 루트에서 `pnpm test`
//
// 로컬이 아닌 주소를 거부하는지, 시드 계획이 언제 돌려도 같은 대시보드 수치를 내는지, 운영자 계정이 팀 밖에 있는지 고정한다.
// 실제로 넣는 일은 로컬 Supabase 가 있어야 해서 `pnpm -C web test:e2e:auth` 가 본다.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SEED_ACCOUNTS,
  SEED_TEAM_TASKS,
  addDays,
  daysAgo,
  planTeamTasks,
  refuseNonLocal,
  seoulDate,
} from "./db-seed.mjs";

// 서울 시각 문자열 → Date.
const seoul = (text) => new Date(`${text}+09:00`);

// 대시보드 집계 함수(task_dashboard_stats)와 같은 규칙으로 센다. 기준은 소유자.
const dashboardOf = (now) => {
  const today = seoulDate(now);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 월요일 0
  const weekStart = addDays(today, -weekday);
  const tasks = planTeamTasks(now);
  const open = tasks.filter((task) => task.status !== "done");
  return {
    open: open.length,
    overdue: open.filter((task) => task.dueDate !== null && task.dueDate < today).length,
    completedThisWeek: tasks.filter((task) => {
      if (task.completedAt === null) return false;
      const day = seoulDate(new Date(task.completedAt));
      return day >= weekStart && day <= today;
    }).length,
    mine: open.filter((task) => task.assignee === "owner").length,
  };
};

describe("시드 주소 검사", () => {
  it("로컬 주소는 통과시킨다", () => {
    assert.equal(refuseNonLocal("http://127.0.0.1:54321"), null);
    assert.equal(refuseNonLocal("http://localhost:54321"), null);
  });

  it("클라우드 주소·빈 값은 거부한다", () => {
    assert.match(refuseNonLocal("https://abcd.supabase.co"), /로컬 Supabase 주소가 아닙니다/);
    assert.match(refuseNonLocal(""), /비어 있음/);
    assert.match(refuseNonLocal(undefined), /비어 있음/);
  });
});

describe("시드 날짜", () => {
  it("서울 날짜로 가르고 달을 넘겨 더한다", () => {
    assert.equal(seoulDate(seoul("2026-10-15T00:00:30")), "2026-10-15");
    assert.equal(seoulDate(seoul("2026-10-14T23:59:59")), "2026-10-14");
    assert.equal(addDays("2026-10-30", 3), "2026-11-02");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });

  // 자정 직후에 돌려도 "오늘"이 어제로 넘어가지 않아야 한다(지금에서 24시간 단위로 빼면 넘어간다).
  it("n 일 전의 시각은 자정 직후·직전에도 그 서울 날짜 안이고, 오늘이면 지금보다 앞이다", () => {
    for (const text of ["2026-10-15T00:00:01", "2026-10-15T12:00:00", "2026-10-15T23:59:59"]) {
      const now = seoul(text);
      for (const days of [0, 1, 10, 13]) {
        const at = new Date(daysAgo(now, days));
        assert.equal(seoulDate(at), addDays("2026-10-15", -days), `${text} 의 ${days}일 전`);
        assert.ok(at.getTime() <= now.getTime());
      }
    }
  });
});

describe("시드 계획", () => {
  it("이메일과 작업 제목이 겹치지 않는다", () => {
    const emails = Object.values(SEED_ACCOUNTS).map((account) => account.email);
    assert.equal(new Set(emails).size, emails.length);
    const titles = SEED_TEAM_TASKS.map((task) => task.title);
    assert.equal(new Set(titles).size, titles.length);
  });

  // 관리자 화면 시험(web/e2e-auth/admin.spec.ts)이 기대한다. 운영자는 시드 팀의 작업을 만들거나 맡지 않는다.
  it("운영자 계정은 seed-admin(정운영)이고 팀 작업에 나오지 않는다", () => {
    assert.deepEqual(SEED_ACCOUNTS.admin, {
      email: "seed-admin@example.test",
      displayName: "정운영",
    });
    for (const task of SEED_TEAM_TASKS) {
      assert.notEqual(task.by, "admin", task.title);
      assert.notEqual(task.assignee, "admin", task.title);
    }
  });

  // 시드는 이 순서로 계정을 만든다 — 관리자 화면(최근 가입 순)의 순서가 이것을 거꾸로 한 것이다.
  it("계정은 소유자·멤버·조직 밖 사람·초대받은 사람·운영자 순서로 만든다", () => {
    assert.deepEqual(Object.keys(SEED_ACCOUNTS), [
      "owner",
      "member",
      "outsider",
      "invitee",
      "admin",
    ]);
  });

  it("만든 날·완료한 날은 최근 14일 안이고, 완료는 만든 뒤다", () => {
    const now = seoul("2026-10-15T09:00:00");
    for (const task of planTeamTasks(now)) {
      assert.ok(task.created >= 0 && task.created <= 13, task.title);
      if (task.status === "done") assert.ok(task.completed <= task.created, task.title);
      else assert.equal(task.completedAt, null, task.title);
    }
  });

  // 파일 머리 주석과 로그인 E2E 가 기대하는 수치다. 요일·시각과 상관없이 같아야 한다.
  it("대시보드 수치는 어느 요일 어느 시각에 돌려도 열린 8 · 기한 지남 2 · 이번 주 완료 2 · 내 담당 3 이다", () => {
    const expected = { open: 8, overdue: 2, completedThisWeek: 2, mine: 3 };
    // 2026-10-12 가 월요일이다. 월~일, 자정 직후·한낮·자정 직전.
    for (let offset = 0; offset < 7; offset += 1) {
      const day = addDays("2026-10-12", offset);
      for (const time of ["00:00:01", "12:00:00", "23:59:59"]) {
        assert.deepEqual(dashboardOf(seoul(`${day}T${time}`)), expected, `${day} ${time}`);
      }
    }
  });
});

for (const hasPersonal of [true, false]) {
  it(`개인 조직 ${hasPersonal ? "기존" : "없음"}: 재시드는 다섯 계정·팀을 보존하고 개인 공간을 만들지 않는다`, async (t) => {
    const { seed, SEED_TEAM } = await import("./db-seed.mjs");
    const calls = [];
    const existing = Object.values(SEED_ACCOUNTS).map((account, index) => ({
      id: `00000000-0000-0000-0000-00000000000${index + 1}`,
      email: account.email,
    }));
    t.mock.method(globalThis, "fetch", async (url, init) => {
      const path = new URL(url).pathname;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ path, search: new URL(url).search, method: init.method, body });
      let data = null;
      if (path === "/auth/v1/admin/users" && init.method === "GET") data = { users: existing };
      else if (path === "/auth/v1/admin/users" && init.method === "POST")
        data = existing.find((user) => user.email === body.email);
      else if (path.startsWith("/auth/v1/admin/users/") && init.method === "PUT")
        data = existing.find((user) => path.endsWith(user.id));
      else if (path === "/auth/v1/token") data = { access_token: "local-test-token" };
      else if (path === "/rest/v1/profiles" && init.method === "PATCH") data = [{ is_admin: true }];
      else if (path === "/rest/v1/organizations" && init.method === "GET")
        data =
          !hasPersonal && url.includes("personal_owner_id")
            ? []
            : [
                {
                  id: url.includes("personal_owner_id") ? "personal-org" : "template-team",
                  slug: SEED_TEAM.slug,
                },
              ];
      else if (path === "/rest/v1/memberships" && init.method === "GET")
        data = [{ org_id: "template-team", user_id: existing[1].id }];
      else if (path === "/rest/v1/tasks" && init.method === "POST") data = [{ id: "task-id" }];
      return new Response(JSON.stringify(data), { status: 200 });
    });
    await seed({
      apiUrl: "http://127.0.0.1:54321",
      anonKey: "local-test-anon",
      serviceKey: "local-test-service",
    });
    assert.equal(
      calls.filter(
        (call) =>
          call.method === "DELETE" &&
          (call.path.startsWith("/auth/") || call.path === "/rest/v1/organizations"),
      ).length,
      0,
    );
    assert.equal(
      calls.filter((call) => call.method === "POST" && call.path === "/auth/v1/admin/users").length,
      0,
    );
    const authIndex = calls.findIndex((call) => call.path.startsWith("/auth/"));
    assert.ok(calls.findIndex((call) => call.path === "/rest/v1/departments") < authIndex);
    assert.ok(calls.findIndex((call) => call.path === "/rest/v1/job_titles") < authIndex);
    const scoringIndex = calls.findIndex((call) => call.path === "/rest/v1/team_member_scoring");
    assert.ok(scoringIndex >= 0 && scoringIndex < authIndex);
    assert.equal(calls[scoringIndex].body.length, 27);
    const declarations = calls.filter(
      (call) =>
        call.method === "PATCH" &&
        call.path === "/rest/v1/profiles" &&
        call.body.declared_department_id,
    );
    assert.equal(declarations.length, 5);
    const personalTasks = calls.filter(
      (call) =>
        call.path === "/rest/v1/tasks" &&
        call.method === "POST" &&
        call.body.org_id === "personal-org",
    );
    assert.equal(personalTasks.length, hasPersonal ? 2 : 0);
    assert.equal(
      calls.filter(
        (call) =>
          call.path === "/rest/v1/tasks" &&
          call.method === "DELETE" &&
          call.search.includes("personal-org"),
      ).length,
      hasPersonal ? 1 : 0,
    );
    assert.ok(!calls.some((call) => call.search.includes("undefined")));
    assert.ok(
      !calls.some(
        (call) =>
          call.path === "/rest/v1/organizations" &&
          call.method === "POST" &&
          call.body.personal_owner_id,
      ),
    );
  });
}

it("빈 DB(시드 팀 없음): 팀은 관리 키로 만들고 소유자 멤버십을 직접 넣는다 — ADR-026 으로 팀 만들기가 운영자만이라 소유자 토큰이면 RLS 403 이다", async (t) => {
  const { seed, SEED_TEAM } = await import("./db-seed.mjs");
  const calls = [];
  const existing = Object.values(SEED_ACCOUNTS).map((account, index) => ({
    id: `00000000-0000-0000-0000-00000000000${index + 1}`,
    email: account.email,
  }));
  const [owner] = existing;
  let teamCreated = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ path, method: init.method, body, authorization: init.headers.Authorization });
    let data = null;
    if (path === "/auth/v1/admin/users" && init.method === "GET") data = { users: existing };
    else if (path.startsWith("/auth/v1/admin/users/") && init.method === "PUT")
      data = existing.find((user) => path.endsWith(user.id));
    else if (path === "/auth/v1/token") data = { access_token: "local-test-token" };
    else if (path === "/rest/v1/profiles" && init.method === "PATCH") data = [{ is_admin: true }];
    else if (path === "/rest/v1/organizations" && init.method === "POST") {
      // 운영자가 아닌 사람의 토큰이면 정책 "팀 만들기"(20261019000008)가 거절한다.
      if (init.headers.Authorization !== "Bearer local-test-service")
        return new Response(JSON.stringify({ message: "new row violates row-level security" }), {
          status: 403,
        });
      // 명부 seed 의 데모 조직 upsert(org-01·org-02, 배열 본문)는 시드 팀이 아니다.
      if (!Array.isArray(body) && body.slug === SEED_TEAM.slug) {
        teamCreated = true;
        data = [{ id: "template-team", slug: SEED_TEAM.slug }];
      } else data = Array.isArray(body) ? body : [body];
    } else if (path === "/rest/v1/organizations" && init.method === "GET")
      data =
        url.includes("personal_owner_id") || !teamCreated
          ? []
          : [{ id: "template-team", slug: SEED_TEAM.slug }];
    else if (path === "/rest/v1/memberships" && init.method === "GET")
      data = teamCreated ? [{ org_id: "template-team", user_id: owner.id }] : [];
    else if (path === "/rest/v1/tasks" && init.method === "POST") data = [{ id: "task-id" }];
    return new Response(JSON.stringify(data), { status: 200 });
  });
  await seed({
    apiUrl: "http://127.0.0.1:54321",
    anonKey: "local-test-anon",
    serviceKey: "local-test-service",
  });
  const teamPosts = calls.filter(
    (call) =>
      call.path === "/rest/v1/organizations" &&
      call.method === "POST" &&
      !Array.isArray(call.body) &&
      call.body.slug === SEED_TEAM.slug,
  );
  assert.equal(teamPosts.length, 1);
  assert.equal(teamPosts[0].authorization, "Bearer local-test-service");
  assert.deepEqual(teamPosts[0].body, SEED_TEAM);
  const ownerMembership = calls.find(
    (call) => call.path === "/rest/v1/memberships" && call.method === "POST",
  );
  assert.deepEqual(ownerMembership?.body, {
    org_id: "template-team",
    user_id: owner.id,
    org_role: "owner",
    sol_role: "ADMIN",
  });
  assert.equal(ownerMembership.authorization, "Bearer local-test-service");
  assert.ok(calls.findIndex((call) => call === ownerMembership) > calls.indexOf(teamPosts[0]));
  // 팀을 만든 뒤의 작업·초대는 여전히 소유자 토큰으로 간다(활동 기록의 행위자).
  assert.ok(
    calls.some(
      (call) =>
        call.path === "/rest/v1/tasks" &&
        call.method === "POST" &&
        call.authorization === "Bearer local-test-token",
    ),
  );
});

for (const sharedWithNonSeed of [false, true]) {
  it(
    sharedWithNonSeed
      ? "비시드 회원이 있는 팀은 초대 수락 복원 전 거절하고 모든 팀 데이터를 보존한다"
      : "수락된 시드 초대는 두 번 재시드해도 미수락 상태로 복원하고 다른 멤버십을 보존한다",
    async (t) => {
      const { seed, SEED_TEAM } = await import("./db-seed.mjs");
      const existing = Object.values(SEED_ACCOUNTS).map((account, index) => ({
        id: `00000000-0000-0000-0000-00000000000${index + 1}`,
        email: account.email,
      }));
      const [owner, member, outsider, invitee] = existing;
      const preservedMemberships = [
        { org_id: "template-team", user_id: owner.id, org_role: "owner" },
        { org_id: "template-team", user_id: member.id, org_role: "member" },
        { org_id: "template-team", user_id: outsider.id, org_role: "member" },
        { org_id: "other-team", user_id: invitee.id, org_role: "member" },
        { org_id: "owned-team", user_id: invitee.id, org_role: "owner" },
      ];
      let memberships = [
        ...preservedMemberships,
        { org_id: "template-team", user_id: invitee.id, org_role: "member" },
      ];
      const nonSeedUser = { id: "unrelated-user", email: "private@example.test" };
      const calls = [];
      const organizations = [{ id: "template-team", slug: SEED_TEAM.slug }];
      let tasks = [];
      let invitations = [];
      if (sharedWithNonSeed) {
        existing.push(nonSeedUser);
        memberships.push({
          org_id: "template-team",
          user_id: nonSeedUser.id,
          org_role: "member",
          created_at: "2026-09-10T03:00:00Z",
        });
        tasks.push({
          id: "unrelated-task",
          org_id: "template-team",
          created_by: nonSeedUser.id,
          title: "보존할 작업",
          status: "in_progress",
          assignee_id: nonSeedUser.id,
          due_date: "2026-10-21",
          created_at: "2026-09-11T04:00:00Z",
          completed_at: null,
        });
        invitations.push({
          id: "unrelated-invitation",
          org_id: "template-team",
          email: "another-private@example.test",
          org_role: "member",
          invited_by: nonSeedUser.id,
          accepted_at: null,
          expires_at: "2026-10-31T00:00:00Z",
          created_at: "2026-10-16T05:00:00Z",
        });
      }
      const before = structuredClone({ existing, organizations, memberships, tasks, invitations });
      const matchesFilters = (row, searchParams) =>
        [...searchParams].every(([column, filter]) =>
          column === "select" ? true : filter === `eq.${row[column]}`,
        );
      t.mock.method(globalThis, "fetch", async (url, init) => {
        const { pathname: path, searchParams } = new URL(url);
        const body = init.body ? JSON.parse(init.body) : null;
        calls.push({ path, search: searchParams.toString(), method: init.method, body });
        let data = null;
        if (path === "/auth/v1/admin/users" && init.method === "GET") data = { users: existing };
        else if (path.startsWith("/auth/v1/admin/users/") && init.method === "PUT")
          data = existing.find((user) => path.endsWith(user.id));
        else if (path === "/auth/v1/token") {
          const account = existing.find((user) => user.email === body.email);
          data = { access_token: `session-${account.id}` };
        } else if (path === "/rest/v1/profiles" && init.method === "PATCH")
          data = [{ is_admin: true }];
        else if (path === "/rest/v1/organizations" && init.method === "GET")
          data = [
            {
              id: searchParams.has("personal_owner_id") ? "personal-org" : "template-team",
              slug: SEED_TEAM.slug,
            },
          ];
        else if (path === "/rest/v1/memberships" && init.method === "GET") {
          assert.equal(searchParams.get("select"), "user_id");
          assert.equal(searchParams.get("org_id"), "eq.template-team");
          if (searchParams.has("user_id")) {
            assert.equal(searchParams.size, 3);
            assert.equal(searchParams.get("user_id"), `eq.${member.id}`);
            assert.equal(init.headers.apikey, "local-test-anon");
            assert.equal(init.headers.Authorization, `Bearer session-${member.id}`);
          } else {
            assert.equal(searchParams.size, 2);
            assert.equal(init.headers.apikey, "local-test-service");
            assert.equal(init.headers.Authorization, "Bearer local-test-service");
          }
          data = memberships.filter((row) => matchesFilters(row, searchParams));
        } else if (path === "/rest/v1/memberships" && init.method === "DELETE") {
          assert.equal(init.headers.apikey, "local-test-anon");
          assert.equal(init.headers.Authorization, `Bearer session-${owner.id}`);
          memberships = memberships.filter((row) => !matchesFilters(row, searchParams));
        } else if (path === "/rest/v1/invitations" && init.method === "DELETE") {
          invitations = invitations.filter((row) => !matchesFilters(row, searchParams));
        } else if (path === "/rest/v1/invitations" && init.method === "POST") {
          const invited = existing.find((user) => user.email === body.email);
          if (memberships.some((row) => row.org_id === body.org_id && row.user_id === invited.id))
            return new Response(JSON.stringify({ message: "이미 멤버입니다" }), { status: 400 });
          invitations.push(body);
        } else if (path === "/rest/v1/tasks" && init.method === "POST") {
          const task = { id: `task-${tasks.length + 1}`, ...body };
          tasks.push(task);
          data = [{ id: task.id }];
        } else if (path === "/rest/v1/tasks" && init.method === "DELETE") {
          tasks = tasks.filter((row) => !matchesFilters(row, searchParams));
        } else if (path === "/rest/v1/tasks" && init.method === "PATCH") {
          tasks = tasks.map((row) =>
            matchesFilters(row, searchParams) ? { ...row, ...body } : row,
          );
        } else if (!(
          [
            "organizations",
            "departments",
            "job_titles",
            "team_members",
            "team_member_scoring",
          ].some((table) => path === `/rest/v1/${table}`) && init.method === "POST"
        ))
          throw new Error(`Unexpected fixture operation: ${init.method} ${path}`);
        return new Response(JSON.stringify(data), { status: 200 });
      });
      const runSeed = () =>
        seed({
          apiUrl: "http://127.0.0.1:54321",
          anonKey: "local-test-anon",
          serviceKey: "local-test-service",
        });
      if (sharedWithNonSeed) {
        const outcome = await runSeed().then(
          () => ({ status: "fulfilled" }),
          (error) => ({ status: "rejected", message: error.message }),
        );
        const teamMutations = calls.filter(
          (call) =>
            ["DELETE", "POST", "PATCH"].includes(call.method) &&
            (["memberships", "tasks", "invitations"].some(
              (table) => call.path === `/rest/v1/${table}`,
            ) ||
              (call.path === "/rest/v1/organizations" &&
                (!Array.isArray(call.body) ||
                  call.body.some(
                    (row) => row.id === "template-team" || row.slug === SEED_TEAM.slug,
                  )))),
        );
        assert.deepEqual(teamMutations, [], "거절 전 팀 데이터를 변경하면 안 된다");
        assert.deepEqual({ existing, organizations, memberships, tasks, invitations }, before);
        assert.equal(outcome.status, "rejected", "공유 팀의 재시드는 명시적으로 거절해야 한다");
        assert.match(outcome.message, /시드.*팀.*초기화.*거부/);
        for (const privateValue of [
          nonSeedUser.id,
          nonSeedUser.email,
          "another-private@example.test",
        ])
          assert.ok(!outcome.message.includes(privateValue));
        assert.ok(
          !calls.some(
            (call) =>
              call.path.startsWith("/auth/v1/admin/users") &&
              ["POST", "DELETE"].includes(call.method),
          ),
        );
        return;
      }
      for (let iteration = 0; iteration < 2; iteration++) {
        const callStart = calls.length;
        await runSeed();
        const iterationCalls = calls.slice(callStart);
        const ownershipRead = iterationCalls.findIndex(
          (call) =>
            call.path === "/rest/v1/memberships" &&
            call.method === "GET" &&
            call.search === "select=user_id&org_id=eq.template-team",
        );
        const firstReset = iterationCalls.findIndex((call) => call.method === "DELETE");
        assert.ok(ownershipRead >= 0 && ownershipRead < firstReset);
        assert.equal(tasks.filter((task) => task.org_id === "template-team").length, 11);
        assert.deepEqual(existing, before.existing);
        assert.deepEqual(organizations, before.organizations);
        assert.deepEqual(memberships, preservedMemberships);
        assert.deepEqual(invitations, [
          { org_id: "template-team", email: invitee.email, org_role: "member" },
        ]);
      }
      // 승격된 소유자를 지워 초기 상태로 위장하지 않는다. 기존 초대 검증이 실패해야 한다.
      memberships.push({ org_id: "template-team", user_id: invitee.id, org_role: "owner" });
      await assert.rejects(runSeed(), /이미 멤버입니다/);
      assert.deepEqual(memberships, [
        ...preservedMemberships,
        { org_id: "template-team", user_id: invitee.id, org_role: "owner" },
      ]);
    },
  );
}
