import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { PersonAvatar } from "@/components/people/person-avatar";

const mounted: Root[] = [];
const render = (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(node);
};
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});

describe("PersonAvatar", () => {
  it("loads an approved portrait with an accessible name", async () => {
    render(<PersonAvatar personId="SOL-P0001" name="김민준" size="lg" />);
    const portrait = page.getByRole("img", { name: "김민준 프로필 사진", exact: true });
    await expect.element(portrait).toBeVisible();
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/demo/people/SOL-P0001.png");
    expect(document.querySelector("img")?.naturalWidth).toBeGreaterThan(0);
    expect(document.querySelector('[data-slot="avatar"]')?.getAttribute("data-size")).toBe("lg");
  });

  it.each([undefined, "SOL-P0201"])(
    "uses name initials for absent or unknown ID: %s",
    async (personId) => {
      render(<PersonAvatar personId={personId} name="직원" />);
      await expect
        .element(page.getByRole("img", { name: "직원 프로필 사진 없음", exact: true }))
        .toBeVisible();
      expect(document.querySelector("img")).toBeNull();
      expect(document.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe("직");
    },
  );

  it("honors explicit null portrait URL", async () => {
    render(<PersonAvatar personId="SOL-P0001" portraitUrl={null} name="김민준" />);
    await expect
      .element(page.getByRole("img", { name: "김민준 프로필 사진 없음", exact: true }))
      .toBeVisible();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe("김");
  });
  it("shows initials after a real image decode failure", async () => {
    render(<PersonAvatar personId="SOL-P0200" name="이서준" />);
    await expect.poll(() => document.querySelector("img")).not.toBeNull();
    const img = document.querySelector("img");
    if (!img) throw new Error("image missing");
    img.src = "data:image/png;base64,aW52YWxpZA==";
    await expect
      .element(page.getByRole("img", { name: "이서준 프로필 사진 없음", exact: true }))
      .toBeVisible();
    expect(document.querySelector('[data-slot="avatar-fallback"]')?.textContent).toBe("이");
  });
  it("uses native lazy loading offscreen rather than BaseUI eager preloader", async () => {
    render(
      <div style={{ marginTop: 15000 }}>
        <PersonAvatar personId="SOL-P0199" name="박서연" />
      </div>,
    );
    await expect.poll(() => document.querySelector("img")).not.toBeNull();
    const img = document.querySelector("img");
    if (!img) throw new Error("image missing");
    expect(img.loading).toBe("lazy");
    expect(img.decoding).toBe("async");
    expect(img.naturalWidth).toBe(0);
    img.scrollIntoView();
    await expect
      .element(page.getByRole("img", { name: "박서연 프로필 사진", exact: true }))
      .toBeVisible();
    await expect.poll(() => img.naturalWidth).toBeGreaterThan(0);
  });
});
