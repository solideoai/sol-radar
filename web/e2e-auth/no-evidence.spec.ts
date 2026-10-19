import { expect, test } from "@playwright/test";
import { readWorkContext, storageOf } from "./support/work-fixtures";

// G4(11 §3): 근거가 없는 공고(FX-04, 첨부·자격 문구 없음)는 자격을 지어내지 않고 "확인 필요"로 두고 권고는 WATCH 다.
// 09 고정 INSUFFICIENT_DATA 문장이 보이고, "수주 확률"·"낙찰 확률"은 부정문 밖에서 나오지 않는다.
const INSUFFICIENT_DATA_TEXT =
  "근거를 확인할 수 없어 INSUFFICIENT_DATA로 표시합니다. 이 항목은 점수에 반영하지 않았습니다.";

test.use({ storageState: storageOf("sales") });

test("G4 FX-04 는 자격 확인 필요·권고 WATCH 와 INSUFFICIENT_DATA 문장을 보이고 수주·낙찰 확률을 말하지 않는다", async ({
  page,
}) => {
  const { bids } = readWorkContext();
  await page.goto(`/bids/${bids["FX-04"]}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const qualification = page.locator("section", {
    has: page.getByRole("heading", { level: 2, name: /^필수자격/ }),
  });
  await expect(qualification.getByRole("heading", { level: 2 })).toContainText("확인 필요");
  await expect(qualification.getByText("확인 필요", { exact: true }).first()).toBeVisible();
  await expect(qualification.getByText(INSUFFICIENT_DATA_TEXT).first()).toBeVisible();

  const rail = page.getByRole("complementary", { name: "참여 판단" });
  await expect(rail).toContainText(/권고\s*WATCH/);

  // 09: "수주 확률"·"낙찰 확률"은 "아님·아닙니다"와 같은 문장 안에서만 나온다.
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.match(/수주\s?확률(?![^.]*아)/g) ?? []).toEqual([]);
  expect(text.match(/낙찰\s?확률(?![^.]*아)/g) ?? []).toEqual([]);
});
