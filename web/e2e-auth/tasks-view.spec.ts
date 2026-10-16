import { expect, test } from "@playwright/test";
import { SEED_TEAM, authFileOf } from "./support/seed";
import { expectSelected, expectTaskTitles, listStatus } from "./support/tasks-page";

// 시드 팀의 작업 화면을 소유자로 보며 거르고 정렬한다. 거르기·정렬은 URL 쿼리에 남아 주소만으로 같은 조건이 열린다.
// 읽기만 한다. 순서는 시드의 만든 날(며칠 전)과 마감일로 정해진다(scripts/db-seed.mjs 의 SEED_TEAM_TASKS).
test.use({ storageState: authFileOf("owner") });

const TASKS = `/${SEED_TEAM.slug}/tasks`;

// 최근 만든 순(기본). 시드의 created(며칠 전)가 작은 것부터.
const BY_CREATED = [
  "랜딩 문구 다듬기",
  "API 응답 시간 측정",
  "버그 분류",
  "온보딩 문서 갱신",
  "디자인 검토 회의",
  "릴리스 노트 작성",
  "팀 회의록 공유",
  "고객 인터뷰 정리",
  "로그인 오류 수정",
  "분기 보고서 초안",
  "지난 스프린트 회고",
];

test("조건 없이 열면 시드 팀의 작업 11개를 최근 만든 순으로 보여 준다", async ({ page }) => {
  await page.goto(TASKS);
  await expect(page.getByRole("heading", { level: 1, name: "작업" })).toBeVisible();
  await expect(
    page.getByRole("main").getByText("시드 팀의 멤버가 함께 보는 작업입니다."),
  ).toBeVisible();
  await expect(listStatus(page)).toHaveText("작업 11개 중 1–11번째를 보여 줍니다.");
  await expectTaskTitles(page, BY_CREATED);
  // 20개가 안 되면 쪽 줄이 없다.
  await expect(page.getByRole("navigation", { name: "쪽 이동" })).toHaveCount(0);
});

test("도구 줄에서 상태·담당자·정렬을 고르면 주소에 조건이 남고 목록이 그 조건으로 바뀐다", async ({
  page,
}) => {
  await page.goto(TASKS);

  await page.getByRole("combobox", { name: "상태" }).click();
  await page.getByRole("option", { name: "완료", exact: true }).click();
  await expect(page).toHaveURL(/\/seed-team\/tasks\?status=done$/);
  await expectTaskTitles(page, ["팀 회의록 공유", "로그인 오류 수정", "지난 스프린트 회고"]);

  await page.getByRole("combobox", { name: "담당자" }).click();
  await page.getByRole("option", { name: "김소유 (나)", exact: true }).click();
  await expect(page).toHaveURL(/\/seed-team\/tasks\?status=done&assignee=[0-9a-f-]{36}$/);
  await expectTaskTitles(page, ["팀 회의록 공유", "지난 스프린트 회고"]);
  await expect(listStatus(page)).toHaveText("작업 2개 중 1–2번째를 보여 줍니다.");

  // 같은 주소를 새로 열어도(복사한 주소) 같은 조건과 같은 목록이다.
  await page.reload();
  await expectSelected(page, "상태", "완료");
  await expectSelected(page, "담당자", "김소유 (나)");
  await expectTaskTitles(page, ["팀 회의록 공유", "지난 스프린트 회고"]);

  // 뒤로 가기는 바로 앞의 조건(완료만)으로 간다.
  await page.goBack();
  await expect(page).toHaveURL(/\/seed-team\/tasks\?status=done$/);
  await expectTaskTitles(page, ["팀 회의록 공유", "로그인 오류 수정", "지난 스프린트 회고"]);

  // 조건 지우기는 기본 주소와 전체 목록으로 돌아간다.
  await page.getByRole("link", { name: "조건 지우기" }).click();
  await expect(page).toHaveURL(/\/seed-team\/tasks$/);
  await expectTaskTitles(page, BY_CREATED);
  await expect(page.getByRole("link", { name: "조건 지우기" })).toHaveCount(0);
});

test("주소로 연 마감일 순 정렬은 마감일이 이른 것부터, 마감일 없는 작업은 맨 뒤에 둔다", async ({
  page,
}) => {
  await page.goto(`${TASKS}?status=todo&sort=due`);
  await expectSelected(page, "상태", "할 일");
  await expectSelected(page, "정렬", "마감일 순");
  // 마감일: 분기 보고서(-3) → 디자인 검토(+2) → 온보딩(+5) → 없음(최근 만든 순: 랜딩 문구, 버그 분류).
  await expectTaskTitles(page, [
    "분기 보고서 초안",
    "디자인 검토 회의",
    "온보딩 문서 갱신",
    "랜딩 문구 다듬기",
    "버그 분류",
  ]);
});

test("주소로 연 담당자 없음 조건은 담당자가 비어 있는 작업만 보여 준다", async ({ page }) => {
  await page.goto(`${TASKS}?assignee=none`);
  await expectSelected(page, "담당자", "담당자 없음");
  await expectTaskTitles(page, ["API 응답 시간 측정", "버그 분류"]);
});

test("주소의 잘못된 조건은 그 조건만 기본값으로 읽는다", async ({ page }) => {
  await page.goto(`${TASKS}?status=bogus&assignee=nobody&sort=due&page=abc`);
  await expectSelected(page, "상태", "전체");
  await expectSelected(page, "담당자", "전체");
  await expectSelected(page, "정렬", "마감일 순");
  await expect(listStatus(page)).toHaveText("작업 11개 중 1–11번째를 보여 줍니다.");
});
