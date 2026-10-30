import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { createElement, type ComponentProps } from "react";
import { page, userEvent } from "vitest/browser";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/landing/hero";
import { WorkDemo } from "@/components/landing/work-demo";
import { ProductPreviewSection } from "@/components/landing/product-preview-section";
import { ComparisonSection } from "@/components/landing/comparison-section";
import { FeaturesSection } from "@/components/landing/features-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { PrinciplesSection } from "@/components/landing/principles-section";
import { FaqSection } from "@/components/landing/faq-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { ServicesMarquee, SourcesMarquee } from "@/components/landing/showcase-marquees";
import { DEMO_BIDS } from "@/components/landing/demo-bids";

vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ unoptimized, ...props }: ComponentProps<"img"> & { unoptimized?: boolean }) =>
    createElement("img", { ...props, "data-unoptimized": unoptimized }),
}));

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
});

it("모바일 랜딩은 가로로 넘치지 않고 메뉴와 예시 공고를 직접 조작할 수 있다", async () => {
  await page.viewport(360, 800);
  root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(
    <>
      <SiteHeader startHref="/auth/sign-up" />
      <main className="break-keep">
        <Hero startHref="/auth/sign-up" />
        <ServicesMarquee />
        <SourcesMarquee />
        <WorkDemo />
        <ProductPreviewSection />
        <ComparisonSection />
        <FeaturesSection />
        <HowItWorksSection />
        <PrinciplesSection />
        <FaqSection />
        <FinalCtaSection startHref="/auth/sign-up" />
      </main>
      <SiteFooter />
    </>,
  );
  const menu = page.getByRole("button", { name: "메뉴 열기" });
  await expect.element(menu).toBeVisible();
  const menuElement = document.querySelector('[aria-label="메뉴 열기"]');
  expect(menuElement?.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await menu.click();
  await expect.element(page.getByRole("dialog", { name: "둘러보기" })).toBeVisible();
  await expect
    .element(page.getByRole("dialog", { name: "둘러보기" }))
    .not.toHaveAttribute("data-starting-style");
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog", { name: "둘러보기" })).not.toBeInTheDocument();
  const second = DEMO_BIDS[1];
  await page.getByRole("tab", { name: new RegExp(second.title) }).click();
  await expect
    .element(page.getByRole("tabpanel").getByRole("heading", { name: second.title }))
    .toBeVisible();
  await expect
    .element(page.getByRole("tabpanel").getByRole("meter", { name: "SOL Score" }))
    .toHaveAttribute("aria-valuenow", String(second.score));
  for (const width of [360, 390, 768, 1280]) {
    await page.viewport(width, 800);

    await expect
      .poll(() => document.documentElement.scrollWidth)
      .toBeLessThanOrEqual(document.documentElement.clientWidth);
    const panel = document.querySelector('[role="tabpanel"]');
    if (panel === null) throw new Error("분석 패널이 없습니다");
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  }
});
