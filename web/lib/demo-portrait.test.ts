import { describe, expect, it } from "vitest";
import { demoPortraitPath } from "@/lib/demo-portrait";

describe("demoPortraitPath", () => {
  it("maps every approved roster ID to its fixed public PNG", () => {
    for (let number = 1; number <= 200; number++) {
      const id = `SOL-P${String(number).padStart(4, "0")}`;
      expect(demoPortraitPath(id)).toBe(`/demo/people/${id}.png`);
    }
  });

  it.each([
    undefined,
    null,
    "",
    "SOL-P0000",
    "SOL-P0201",
    "SOL-P9999",
    "SOL-P1",
    "sol-p0001",
    " SOL-P0001",
    "SOL-P0001\n",
    "SOL-P0001.png",
    "../SOL-P0001",
    "https://example.com/avatar.png",
  ])("rejects missing, out-of-range, and noncanonical IDs: %s", (id) =>
    expect(demoPortraitPath(id)).toBeNull(),
  );
});
