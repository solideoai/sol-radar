import { expect, test as setup } from "@playwright/test";
import { SEED_ACCOUNTS, SEED_PASSWORD, SEED_ROLES, authFileOf } from "./support/seed";

// 역할마다 로그인 화면(/auth/login)으로 로그인하고 로그인 상태(쿠키)를 파일로 남긴다. 다른 시험은 이 파일로 로그인한 채 시작한다.
// 시드는 실행마다 계정을 지우고 다시 만들어서 지난 실행의 파일은 쓸 수 없다. 늘 새로 로그인한다.
// 로그인한 사람은 계정 화면에 머물지 않고 개인 조직의 대시보드로 간다(app/auth/login/page.tsx).
// 로그아웃은 하지 않는다 — 세션을 서버에서 지워 이 파일을 쓰는 다른 시험의 로그인까지 풀린다.
for (const role of SEED_ROLES) {
  setup(`${SEED_ACCOUNTS[role].name}(${role}) 로 로그인해 상태를 저장한다`, async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("이메일").fill(SEED_ACCOUNTS[role].email);
    await page.getByLabel("비밀번호", { exact: true }).fill(SEED_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();

    // 개인 조직의 주소는 가입 때 무작위 8자로 정해진다.
    await expect(page).toHaveURL(/\/[a-z0-9]{8}\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
    await expect(page.getByRole("button", { name: "조직 전환" })).toContainText("개인");

    await page.context().storageState({ path: authFileOf(role) });
  });
}
