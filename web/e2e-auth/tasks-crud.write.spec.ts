import { expect, type Page, test } from "@playwright/test";
import {
  createTask,
  deleteTasksTitled,
  orgIdOf,
  type SeedSession,
  signInAs,
} from "./support/local-supabase";
import { SEED_ACCOUNTS, SEED_TEAM, authFileOf, seoulDay, uniqueTag } from "./support/seed";
import { taskRows } from "./support/tasks-page";

// 시드 팀에서 멤버(이멤버)가 작업을 추가·편집·상태 변경·삭제한다. 시드 팀을 바꾸므로 2단계(시드를 읽는 시험이 끝난 뒤)에 돈다.
// 시험마다 이름이 겹치지 않는 작업만 다룬다. 추가 말고는 시작할 작업을 REST 로 넣고(그 멤버의 로그인으로), 끝나면 지운다.
// 저장된 효과는 새로 고친 뒤에도 남는지로 본다.
test.use({ storageState: authFileOf("member") });

const TASKS = `/${SEED_TEAM.slug}/tasks`;
const { owner, member } = SEED_ACCOUNTS;

const fixture: { member?: SeedSession; orgId?: string } = {};
const ready = async () => {
  fixture.member ??= await signInAs("member");
  fixture.orgId ??= await orgIdOf(fixture.member, SEED_TEAM.slug);
  return { session: fixture.member, orgId: fixture.orgId };
};

// 이 시험이 만든 작업을 치운다(이미 지웠으면 아무것도 하지 않는다).
const cleanUp = async (...titles: string[]) => {
  const { session, orgId } = await ready();
  for (const title of titles) await deleteTasksTitled(session, orgId, title);
};

const rowOf = (page: Page, title: string) =>
  taskRows(page).filter({ has: page.getByRole("button", { name: title, exact: true }) });

const pickOption = async (page: Page, label: string, option: string) => {
  await page.getByRole("dialog").getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

test("작업 추가 대화상자로 담당자·마감일을 정해 작업을 만들면 목록에 생기고 새로 고쳐도 남는다", async ({
  page,
}) => {
  const title = `E2E 추가 ${uniqueTag()}`;
  try {
    await page.goto(TASKS);
    await page.getByRole("button", { name: "작업 추가", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "작업 추가" });
    await expect(dialog.getByText("시드 팀의 멤버 모두에게 보입니다.")).toBeVisible();
    await dialog.getByLabel("제목").fill(title);
    await dialog.getByLabel("설명").fill("로그인 E2E 가 만든 작업입니다.");
    await pickOption(page, "담당자", owner.name);
    await dialog.getByLabel("마감일").fill(seoulDay(0).iso);
    await dialog.getByRole("button", { name: "추가", exact: true }).click();

    await expect(page.getByText("작업을 추가했습니다")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    // 새 작업은 할 일로 시작한다. 같은 단계의 다른 시험도 작업을 넣어서 몇째 줄인지는 보지 않는다.
    const row = rowOf(page, title);
    await expect(row.getByRole("button", { name: `${title} 상태: 할 일` })).toBeVisible();
    await expect(row).toContainText(owner.name);
    await expect(row).toContainText(`${seoulDay(0).label} · 오늘`);

    await page.reload();
    await expect(rowOf(page, title)).toContainText(owner.name);
  } finally {
    await cleanUp(title);
  }
});

test("작업 편집 대화상자로 제목·담당자를 바꾸면 목록에 바뀐 값이 보이고 새로 고쳐도 남는다", async ({
  page,
}) => {
  const tag = uniqueTag();
  const before = `E2E 편집 전 ${tag}`;
  const after = `E2E 편집 후 ${tag}`;
  const { session, orgId } = await ready();
  await createTask(session, { orgId, title: before });
  try {
    await page.goto(TASKS);
    // 제목 단추가 편집 대화상자를 연다.
    await page.getByRole("button", { name: before, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "작업 편집" });
    await expect(dialog.getByLabel("제목")).toHaveValue(before);
    await dialog.getByLabel("제목").fill(after);
    await pickOption(page, "담당자", `${member.name} (나)`);
    await dialog.getByRole("button", { name: "저장", exact: true }).click();

    await expect(page.getByText("작업을 저장했습니다")).toBeVisible();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: before, exact: true })).toHaveCount(0);
    await expect(rowOf(page, after)).toContainText(`${member.name}(나)`);

    await page.reload();
    await expect(page.getByRole("button", { name: before, exact: true })).toHaveCount(0);
    await expect(rowOf(page, after)).toContainText(`${member.name}(나)`);
  } finally {
    await cleanUp(before, after);
  }
});

test("상태 메뉴로 할 일을 완료로 바꾸면 바로 저장되고 새로 고쳐도 완료다", async ({ page }) => {
  const title = `E2E 상태 ${uniqueTag()}`;
  const { session, orgId } = await ready();
  await createTask(session, { orgId, title });
  try {
    await page.goto(TASKS);
    await page.getByRole("button", { name: `${title} 상태: 할 일`, exact: true }).click();
    await page.getByRole("menuitemradio", { name: "완료" }).click();

    await expect(page.getByText("상태를 완료로 바꿨습니다")).toBeVisible();
    await expect(
      page.getByRole("button", { name: `${title} 상태: 완료`, exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("button", { name: `${title} 상태: 완료`, exact: true }),
    ).toBeVisible();
    // 완료한 작업은 상태로 거르면 완료 쪽에 있다.
    await page.goto(`${TASKS}?status=done`);
    await expect(rowOf(page, title)).toHaveCount(1);
  } finally {
    await cleanUp(title);
  }
});

test("관리 메뉴의 삭제를 확인하면 작업이 목록에서 사라지고 새로 고쳐도 없다", async ({ page }) => {
  const title = `E2E 삭제 ${uniqueTag()}`;
  const { session, orgId } = await ready();
  await createTask(session, { orgId, title });
  try {
    await page.goto(TASKS);
    await page.getByRole("button", { name: `${title} 관리`, exact: true }).click();
    await page.getByRole("menuitem", { name: "삭제" }).click();

    const dialog = page.getByRole("dialog", { name: "작업을 삭제할까요?" });
    await expect(dialog).toContainText(title);
    await dialog.getByRole("button", { name: "삭제", exact: true }).click();

    await expect(page.getByText("작업을 삭제했습니다")).toBeVisible();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole("heading", { name: "작업 목록" })).toBeVisible();
    await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
  } finally {
    await cleanUp(title);
  }
});
