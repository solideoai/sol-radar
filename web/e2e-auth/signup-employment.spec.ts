import { expect, test } from "@playwright/test";
import { z } from "zod";
import { SEED_ACCOUNTS, SEED_PASSWORD, SEED_EMPLOYMENT } from "./support/seed";
import { horizontalOverflow, signInThroughForm } from "./support/account-page";

// Read stage: no seed profile/account/membership mutations. Actual Auth creation,
// completion and confirmation belong to chromium-write below.
for (const width of [1440, 1280]) {
  test(`이메일 가입 ${width}px: 필수 오류와 키보드 선택, 긴 표시명에 가로 넘침이 없다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { departments } = z
      .object({ departments: z.array(z.object({ label: z.string() })) })
      .parse(await (await page.request.get("/api/v1/signup-options")).json());
    const longestIndex = departments.reduce(
      (best, item, index) => (item.label.length > departments[best].label.length ? index : best),
      0,
    );
    await page.goto("/auth/sign-up");
    await expect(page.getByRole("heading", { name: "회원가입", exact: true })).toBeVisible();
    await expect(page.getByText("솔리데오", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    const name = page.getByRole("textbox", { name: "이름 (필수)" });
    await expect(name).toBeFocused();
    await name.fill("실제 가입자는 세 글자 제한 없음");
    await name.press("Tab");
    const department = page.getByRole("combobox", { name: "부서 (필수)" });
    await expect(department).toBeFocused();
    await department.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Home");
    for (let index = 0; index < longestIndex; index++) await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(department).toBeFocused();
    await expect(department).toContainText(departments[longestIndex].label);
    await department.press("Tab");
    const title = page.getByRole("combobox", { name: "직급/직책 (필수)" });
    await expect(title).toBeFocused();
    await title.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(title).toBeFocused();
    await title.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(title).not.toContainText("직급/직책을 선택해 주세요");
    expect(await horizontalOverflow(page)).toBe(0);
    await page.screenshot({ path: test.info().outputPath(`signup-${width}.png`), fullPage: true });
  });
}

test.describe("기존 완성 계정", () => {
  test("저장된 신고 정보를 읽고 보완 화면을 반복하지 않는다", async ({ page }) => {
    await signInThroughForm(page, { email: SEED_ACCOUNTS.owner.email, password: SEED_PASSWORD });
    const response = await page.request.get("/api/v1/me/employment");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      profileComplete: true,
      employment: SEED_EMPLOYMENT,
    });
    await page.goto("/auth/complete-profile");
    await expect(page).toHaveURL(/\/seed-team\/dashboard$/);
    await expect(page.getByRole("heading", { level: 1, name: "대시보드" })).toBeVisible();
  });
});
