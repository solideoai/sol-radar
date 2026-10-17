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
    "uses a neutral accessible person icon for absent or unknown ID: %s",
    async (personId) => {
      render(<PersonAvatar personId={personId} name="직원" />);
      await expect
        .element(page.getByRole("img", { name: "직원 프로필 사진 없음", exact: true }))
        .toBeVisible();
      expect(document.querySelector("img")).toBeNull();
      expect(document.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    },
  );

  it("shows the neutral fallback when the image cannot be decoded", async () => {
    // A real browser request receives invalid PNG bytes; Avatar handles the resulting image error.
    const originalImage = window.Image;
    let hasImageError = false;
    window.Image = class extends originalImage {
      constructor() {
        super();
        this.addEventListener("error", () => {
          hasImageError = true;
        });
      }
      set src(value: string) {
        super.src = value.includes("/demo/people/") ? "data:image/png;base64,aW52YWxpZA==" : value;
      }
      get src() {
        return super.src;
      }
    };
    try {
      render(<PersonAvatar personId="SOL-P0200" name="직원" />);
      await expect
        .element(page.getByRole("img", { name: "직원 프로필 사진 없음", exact: true }))
        .toBeVisible();
      await expect.poll(() => hasImageError).toBe(true);
      expect(document.querySelector("img")).toBeNull();
    } finally {
      window.Image = originalImage;
    }
  });
});
