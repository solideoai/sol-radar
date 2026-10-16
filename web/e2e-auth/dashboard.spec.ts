import { expect, test } from "@playwright/test";
import { SEED_TEAM, authFileOf, escapeRegExp, seoulDay } from "./support/seed";
import { expectSelected } from "./support/tasks-page";

// 시드 팀의 대시보드를 소유자로 본다. 수치는 시드(scripts/db-seed.mjs 의 SEED_TEAM_TASKS)에서 손으로 셌다 —
// 시드가 날짜를 "오늘에서 며칠"로 넣어 언제 돌려도 같다. 시드 팀을 바꾸는 시험은 이 시험이 끝난 뒤에 돈다(playwright.auth.config.ts).
test.use({ storageState: authFileOf("owner") });

const DASHBOARD = `/${SEED_TEAM.slug}/dashboard`;

// 시드 팀의 작업이 며칠 전에 만들어지고 완료됐는지(오늘 = 0). 차트 14칸의 기대값을 여기서 센다.
const CREATED_DAYS_AGO = [12, 9, 6, 4, 3, 2, 1, 0, 11, 8, 13];
const COMPLETED_DAYS_AGO = [0, 0, 10];
const countOf = (days: number[], daysAgo: number) => days.filter((day) => day === daysAgo).length;

test("요약 카드 넷이 시드의 수치(열린 8 · 기한 지남 2 · 이번 주 완료 2 · 내 담당 3)를 보여 준다", async ({
  page,
}) => {
  await page.goto(DASHBOARD);
  await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("시드 팀의 작업 진행 상황을 한눈에 봅니다."),
  ).toBeVisible();

  // 카드마다 이름 줄과 값 줄이 있다. 이름과 값만 골라 화면 순서대로 짝을 본다(곁들임 글은 빼고).
  const summary = page.getByRole("region", { name: "요약" });
  await expect(
    summary
      .getByRole("paragraph")
      .filter({ hasText: /^(열린 작업|기한 지남|이번 주 완료|내 담당|\d+)$/ }),
  ).toHaveText(["열린 작업", "8", "기한 지남", "2", "이번 주 완료", "2", "내 담당", "3"]);
});

test("최근 14일 차트가 날짜별 추가·완료 수를 시드대로 그린다", async ({ page }) => {
  await page.goto(DASHBOARD);

  // 범례의 합계 — 시드 작업 11개는 모두 최근 14일 안에 만들었고, 그중 3개를 완료했다.
  await expect(page.getByRole("listitem").filter({ hasText: /^추가\s*11개$/ })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: /^완료\s*3개$/ })).toBeVisible();

  // 막대 그림은 화면 낭독기에서 숨기고 같은 값을 표로 읽어 준다. 그 표로 14칸을 하나씩 본다(오래된 날부터).
  const table = page.getByRole("table", { name: "최근 14일 날짜별 작업 추가 수와 완료 수" });
  const expected = Array.from({ length: 14 }, (_, index) => {
    const daysAgo = 13 - index;
    const label = escapeRegExp(seoulDay(-daysAgo).label);
    const added = countOf(CREATED_DAYS_AGO, daysAgo);
    const completed = countOf(COMPLETED_DAYS_AGO, daysAgo);
    return new RegExp(`^${label}\\s*${added}개\\s*${completed}개$`);
  });
  await expect(table.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveText(expected);
});

test("기한이 가까운 작업 표가 마감일 순 5개를 담당자·지남·오늘 표기와 함께 보여 준다", async ({
  page,
}) => {
  await page.goto(DASHBOARD);

  const table = page.getByRole("table", { name: "기한이 가까운 작업" });
  // 좁은 단에서는 담당자가 제목 아래로 내려가도 글자는 같은 줄(행) 안에 있다.
  await expect(table.getByRole("row").filter({ has: page.getByRole("cell") })).toHaveText([
    /^분기 보고서 초안.*김소유.*\(나\).*· 지남$/,
    /^고객 인터뷰 정리.*이멤버.*· 지남$/,
    /^릴리스 노트 작성.*김소유.*\(나\).*· 오늘$/,
    new RegExp(`^디자인 검토 회의.*김소유.*\\(나\\).*${escapeRegExp(seoulDay(2).label)}$`),
    new RegExp(`^온보딩 문서 갱신.*이멤버.*${escapeRegExp(seoulDay(5).label)}$`),
  ]);

  // "모두 보기"는 같은 순서(마감일 순)의 작업 화면으로 간다.
  await page.getByRole("link", { name: "모두 보기" }).click();
  await expect(page).toHaveURL(`/${SEED_TEAM.slug}/tasks?sort=due`);
  await expectSelected(page, "정렬", "마감일 순");
});

test("최근 활동 피드가 시드가 남긴 기록 중 최근 10개를 최신순으로 보여 준다", async ({ page }) => {
  await page.goto(DASHBOARD);

  // 시드는 초대 둘 → 멤버 들어옴 → 작업 11개(완료한 작업은 만들고 바로 완료) 순으로 넣었다. 최근 10개는 작업 기록이다.
  const feed = page.getByRole("list", { name: "최근 활동" });
  const sentences = [
    "김소유 님이 ‘지난 스프린트 회고’ 작업을 완료했습니다.",
    "김소유 님이 ‘지난 스프린트 회고’ 작업을 만들었습니다.",
    "이멤버 님이 ‘팀 회의록 공유’ 작업을 완료했습니다.",
    "이멤버 님이 ‘팀 회의록 공유’ 작업을 만들었습니다.",
    "김소유 님이 ‘로그인 오류 수정’ 작업을 완료했습니다.",
    "김소유 님이 ‘로그인 오류 수정’ 작업을 만들었습니다.",
    "이멤버 님이 ‘랜딩 문구 다듬기’ 작업을 만들었습니다.",
    "김소유 님이 ‘API 응답 시간 측정’ 작업을 만들었습니다.",
    "이멤버 님이 ‘버그 분류’ 작업을 만들었습니다.",
    "김소유 님이 ‘온보딩 문서 갱신’ 작업을 만들었습니다.",
  ];
  // 줄마다 아바타(숨김)·문장·기록한 시각이 있다. 시각은 시드를 넣은 때라 보지 않고 문장만 본다.
  await expect(feed.getByRole("listitem").getByRole("paragraph")).toHaveText(sentences);
});
