import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppPage } from "./app-page";

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

const sizeOf = (selector: string) =>
  getComputedStyle(document.querySelector(selector) as Element).fontSize;

const render = async (typeScale?: "dashboard") => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(
    <AppPage title="제목" description="설명" typeScale={typeScale}>
      <p className="type-body" data-probe="body">
        본문
      </p>
    </AppPage>,
  );
  await expect.poll(() => document.querySelector("h1")).not.toBeNull();
};

describe("AppPage typeScale", () => {
  it("dashboard 범위에서 본문 14->17, 제목 30->33 이다", async () => {
    await render("dashboard");
    expect(document.querySelector("main")?.getAttribute("data-type-scale")).toBe("dashboard");
    expect(sizeOf('[data-probe="body"]')).toBe("17px");
    expect(sizeOf("h1")).toBe("33px");
  });

  it("속성이 없으면 기존 눈금 그대로다", async () => {
    await render();
    expect(document.querySelector("main")?.hasAttribute("data-type-scale")).toBe(false);
    expect(sizeOf('[data-probe="body"]')).toBe("14px");
    expect(sizeOf("h1")).toBe("30px");
  });
});
