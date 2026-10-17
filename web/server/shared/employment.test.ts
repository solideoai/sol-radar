import { describe, expect, it } from "vitest";
import { employmentInputSchema } from "./employment";

const input = { name: " 홍길동 ", departmentId: "SOL-D001", jobTitleId: "SOL-J007" };

describe("employment DTO", () => {
  it.each(["userId", "orgId", "is_admin", "profileComplete"])("rejects injected %s", (key) => {
    expect(employmentInputSchema.safeParse({ ...input, [key]: "forged" }).success).toBe(false);
  });
  it("accepts 1 through 40 character real names, trims, and rejects blank or unknown selection", () => {
    expect(employmentInputSchema.parse(input).name).toBe("홍길동");
    expect(employmentInputSchema.safeParse({ ...input, name: "가" }).success).toBe(true);
    expect(employmentInputSchema.safeParse({ ...input, name: "가".repeat(40) }).success).toBe(true);
    expect(employmentInputSchema.safeParse({ ...input, name: "가".repeat(41) }).success).toBe(
      false,
    );
    expect(employmentInputSchema.safeParse({ ...input, name: " " }).success).toBe(false);
    expect(employmentInputSchema.safeParse({ ...input, departmentId: "" }).success).toBe(false);
  });
});
