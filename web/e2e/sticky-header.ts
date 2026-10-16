import { expect, type Locator, type Page } from "@playwright/test";

export const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("화면에 그려지지 않은 요소의 자리를 재려 했다");
  return box;
};

// 첫 화면의 머리말은 화면 위에 붙어 있다(sticky). 구역으로 옮겨 간 뒤 대상이 머리말 밑에 깔리지 않았는지 본다.
export const expectBelowHeader = async (page: Page, target: Locator) => {
  await expect(target).toBeInViewport();
  const header = await boxOf(page.getByRole("banner"));
  const box = await boxOf(target);
  expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
};
