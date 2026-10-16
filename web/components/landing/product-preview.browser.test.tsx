import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import { DEMO_BIDS } from "@/components/landing/demo-bids";
import { ProductPreview } from "@/components/landing/product-preview";

// 랜딩의 분석 미리보기를 진짜 브라우저로 그려, 고르면 분석이 바뀌는지·키보드로 되는지·1280px 에서 넘치지 않는지 본다.

const [first, second] = DEMO_BIDS;
const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

// 랜딩처럼 마케팅 단(max-w-320 + px-10) 안에 넣는다. 1280 넘침 시험이 실제 판 폭을 재게 한다.
const render = async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(
    <main className="mx-auto w-full max-w-320 px-10">
      <ProductPreview />
    </main>,
  );
  mounted.push(root);
  await expect.element(page.getByRole("tablist")).toBeInTheDocument();
};

const tabOf = (title: string) => page.getByRole("tab", { name: new RegExp(title) });

describe("ProductPreview", () => {
  it("처음에는 대표 예시(82점·WATCH)를 보여 주고 점수 옆에 수주 확률이 아니라는 안내가 있다", async () => {
    await page.viewport(1280, 900);
    await render();
    const panel = page.getByRole("tabpanel");
    await expect.element(panel.getByRole("heading", { name: first.title })).toBeVisible();
    await expect
      .element(panel.getByRole("meter", { name: "SOL Score" }))
      .toHaveAttribute("aria-valuenow", "82");
    await expect
      .element(panel.getByText("SOL Score는 사업 적합도이며 수주 확률이 아닙니다."))
      .toBeVisible();
    await expect.element(panel.getByText("WATCH", { exact: true })).toBeVisible();
    await expect.element(panel.getByText("BID", { exact: true })).not.toBeInTheDocument();
    await expect.element(panel.getByText("충족 2 · 확인 필요 1 · 미충족 0")).toBeVisible();
    await expect.element(page.getByText("예시 데이터").first()).toBeVisible();
  });

  it("목록에서 다른 공고를 누르면 분석이 그 공고로 바뀐다", async () => {
    await render();
    await tabOf(second.title).click();
    const panel = page.getByRole("tabpanel");
    await expect.element(panel.getByRole("heading", { name: second.title })).toBeVisible();
    await expect
      .element(panel.getByRole("meter", { name: "SOL Score" }))
      .toHaveAttribute("aria-valuenow", String(second.score));
    await expect.element(panel.getByText("BID", { exact: true })).toBeVisible();
  });

  it("방향키로 목록을 옮기면 선택과 분석이 같이 바뀐다", async () => {
    await render();
    await tabOf(first.title).click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(tabOf(second.title)).toHaveAttribute("aria-selected", "true");
    await expect
      .element(page.getByRole("tabpanel").getByRole("heading", { name: second.title }))
      .toBeVisible();
  });

  it("Tab 으로 목록에 들어오면 선택된 공고에 초점이 서고, 방향키로 옮겨도 초점이 보인다", async () => {
    await render();
    await userEvent.keyboard("{Tab}");
    await expect.element(tabOf(first.title)).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(tabOf(second.title)).toHaveFocus();
    await expect.element(tabOf(second.title)).toHaveAttribute("aria-selected", "true");
    const focused = document.activeElement;
    if (focused === null) throw new Error("초점이 선 요소가 없습니다");
    expect(focused.matches(":focus-visible")).toBe(true);
  });

  it("자격 항목마다 공고문 쪽수와 인용이 보이고, 판에는 링크가 없다", async () => {
    await render();
    const panel = page.getByRole("tabpanel");
    await expect.element(panel.getByText("「소프트웨어사업자로 신고한 자」")).toBeVisible();
    await expect.element(panel.getByText("공고문 p.4")).toBeVisible();
    expect(document.querySelectorAll("a")).toHaveLength(0);
  });

  it("결재란에 시스템 권고와 담당자 결정 대기가 나란히 있다", async () => {
    await render();
    const panel = page.getByRole("tabpanel");
    await expect.element(panel.getByText("시스템 권고")).toBeVisible();
    await expect.element(panel.getByText("담당자 결정")).toBeVisible();
    await expect.element(panel.getByText("대기", { exact: true })).toBeVisible();
  });

  it("1280px 에서 화면 폭을 넘지 않는다", async () => {
    await page.viewport(1280, 900);
    await render();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      document.documentElement.clientWidth,
    );
    // 루트가 overflow-hidden 이라 문서 폭만 재면 안쪽 넘침을 못 잡는다. 패널과 목록 안쪽도 잰다.
    const panel = document.querySelector('[role="tabpanel"]');
    if (panel === null) throw new Error("선택된 tabpanel 을 찾지 못했습니다");
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    const list = document.querySelector('[role="tablist"]');
    if (list === null) throw new Error("tablist 를 찾지 못했습니다");
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth);
  });
});
