import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { Logo } from "@/components/logo";

// 새 로고(인용 표식 마크 + 글자 이름)가 장식·이름 구분을 지키고, 48px 관리자 머리 막대에 들어가는지 진짜 브라우저로 본다.

const mounted: Root[] = [];

afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const renderLogo = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  root.render(node);
  mounted.push(root);
  await expect.element(page.getByText("SOL RADAR", { exact: true })).toBeVisible();
};

describe("Logo", () => {
  it("마크는 장식이고, 이름은 글자로 읽힌다", async () => {
    await renderLogo(<Logo />);
    expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll("svg path")).toHaveLength(2);
    expect(document.querySelectorAll("svg circle")).toHaveLength(1);
  });

  it("관리자 머리 막대(48px) 안에 들어가고 넘치지 않는다", async () => {
    await renderLogo(
      <div className="flex min-h-12 w-80 items-center">
        <Logo className="min-w-0" />
      </div>,
    );
    const logo = document.querySelector("span");
    expect(logo).not.toBeNull();
    if (!logo) return;
    expect(logo.getBoundingClientRect().height).toBeLessThanOrEqual(28);
    expect(logo.scrollWidth).toBeLessThanOrEqual(logo.clientWidth + 1);
  });
});
