import { expect, test } from "@playwright/test";
import { createTeam, createTask, signInAs } from "./support/local-supabase";
import { authFileOf, uniqueTag } from "./support/seed";
import { expectTaskTitles, listStatus } from "./support/tasks-page";

// 작업이 한 쪽(20개)을 넘으면 쪽 줄이 생기고, 쪽도 주소(?page=)에 남는다. 시드 팀은 11개라 쪽이 없다.
// 시드 팀을 건드리지 않도록 조직 밖 사람이 이 시험만의 팀을 만들어 작업 23개를 넣는다(REST, 그 사람의 로그인으로).
// 팀은 실행마다 새로 만들어 다시 돌려도 수가 같다. 시드 계정만 멤버인 조직이라 다음 `pnpm db:seed` 가 지운다.
test.use({ storageState: authFileOf("outsider") });

const TASK_COUNT = 23;
const titleOf = (index: number) => `쪽 작업 ${String(index).padStart(2, "0")}`;
// 최근 만든 순이라 마지막에 넣은 작업이 맨 위다.
const newestFirst = Array.from({ length: TASK_COUNT }, (_, index) => titleOf(TASK_COUNT - index));

const team = { slug: "" };

test.beforeAll(async () => {
  const tag = uniqueTag();
  const outsider = await signInAs("outsider");
  team.slug = `e2e-paging-${tag}`;
  const orgId = await createTeam(outsider, { name: `쪽 시험 ${tag}`, slug: team.slug });
  // 하나씩 넣는다. 한 요청에 몰아 넣으면 만든 시각이 같아 순서가 정해지지 않는다.
  for (let index = 1; index <= TASK_COUNT; index += 1) {
    await createTask(outsider, { orgId, title: titleOf(index) });
  }
});

test("작업이 20개를 넘으면 쪽 줄로 다음 쪽에 가고, 주소에 쪽이 남으며, 뒤로 가기가 앞 쪽으로 간다", async ({
  page,
}) => {
  await page.goto(`/${team.slug}/tasks`);
  await expect(listStatus(page)).toHaveText(`작업 ${TASK_COUNT}개 중 1–20번째를 보여 줍니다.`);
  await expectTaskTitles(page, newestFirst.slice(0, 20));
  const pager = page.getByRole("navigation", { name: "쪽 이동" });
  // 첫 쪽에서 "이전"은 꺼진 단추다(링크가 아니다).
  await expect(pager.getByRole("button", { name: "이전" })).toBeDisabled();
  await expect(page.getByText("2쪽 중 1쪽")).toBeAttached();

  await pager.getByRole("link", { name: "다음" }).click();
  await expect(page).toHaveURL(new RegExp(`/${team.slug}/tasks\\?page=2$`));
  await expect(listStatus(page)).toHaveText(`작업 ${TASK_COUNT}개 중 21–23번째를 보여 줍니다.`);
  await expectTaskTitles(page, newestFirst.slice(20));
  await expect(pager.getByRole("button", { name: "다음" })).toBeDisabled();
  // 쪽을 옮기면 초점이 표 제목으로 간다(새 쪽을 처음부터 읽게).
  await expect(page.getByRole("heading", { name: "작업 목록" })).toBeFocused();

  // 주소를 새로 열어도 같은 쪽이다.
  await page.reload();
  await expectTaskTitles(page, newestFirst.slice(20));

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${team.slug}/tasks$`));
  await expectTaskTitles(page, newestFirst.slice(0, 20));
});

test("범위를 넘는 쪽을 주소로 열면 첫 쪽을 보여 준다", async ({ page }) => {
  await page.goto(`/${team.slug}/tasks?page=9`);
  await expect(listStatus(page)).toHaveText(`작업 ${TASK_COUNT}개 중 1–20번째를 보여 줍니다.`);
  await expectTaskTitles(page, newestFirst.slice(0, 20));
});
