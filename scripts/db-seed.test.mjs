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
