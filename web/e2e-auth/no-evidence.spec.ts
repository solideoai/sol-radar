import { expect, test } from "@playwright/test";
import { readWorkContext, storageOf } from "./support/work-fixtures";

// G4(11 §3): 근거가 없는 공고(FX-04, 첨부·자격 문구 없음)는 자격을 지어내지 않고 "확인 필요"로 두고 권고는 WATCH 다.
// 09 고정 "근거 부족" 문장(필수 자격)이 보이고, "수주 확률"·"낙찰 확률"은 부정문 밖에서 나오지 않는다.
const NO_EVIDENCE_TEXT =
  "근거를 확인하지 못했습니다. 이 필수 자격을 확인하기 전에는 점수가 높아도 추천이 나오지 않습니다.";

test.use({ storageState: storageOf("sales") });

test("G4 FX-04 는 자격 확인 필요·권고 보류와 근거 부족 문장을 보이고 수주·낙찰 확률을 말하지 않는다", async ({
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
  await expect(qualification.getByText(NO_EVIDENCE_TEXT).first()).toBeVisible();

  const rail = page.getByRole("complementary", { name: "참여 판단" });
  await expect(rail).toContainText(/권고\s*보류/);

  // 09: "수주 확률"·"낙찰 확률"은 "아님·아닙니다"와 같은 문장 안에서만 나온다.
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.match(/수주\s?확률(?![^.]*아)/g) ?? []).toEqual([]);
  expect(text.match(/낙찰\s?확률(?![^.]*아)/g) ?? []).toEqual([]);
});
