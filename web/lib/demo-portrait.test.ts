import { describe, expect, it } from "vitest";
import { isDisplayablePortrait } from "./demo-portrait";

describe("isDisplayablePortrait", () => {
  it("정장 사진은 그 사람의 것만, 그 밖에는 https·로컬 Supabase 주소만 그린다", () => {
    expect(isDisplayablePortrait("/demo/people/SOL-P0001.png", "SOL-P0001")).toBe(true);
    expect(isDisplayablePortrait("/demo/people/SOL-P0002.png", "SOL-P0001")).toBe(false);
    expect(
      isDisplayablePortrait(
        "https://x.supabase.co/storage/v1/object/sign/profile-photos/users/a/b.jpg?token=t",
        "SOL-N0001",
      ),
    ).toBe(true);
    expect(
      isDisplayablePortrait("http://127.0.0.1:54321/storage/v1/object/sign/a.jpg", "SOL-N0001"),
    ).toBe(true);
    expect(isDisplayablePortrait("http://evil.example/a.jpg", "SOL-N0001")).toBe(false);
    expect(isDisplayablePortrait("javascript:alert(1)", "SOL-P0001")).toBe(false);
    expect(isDisplayablePortrait("//evil.example/a.jpg", "SOL-P0001")).toBe(false);
  });
});
