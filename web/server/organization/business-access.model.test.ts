import { describe, expect, it } from "vitest";
import { solRoleSchema } from "./business-access.model";

describe("solRoleSchema", () => {
  it("업무 역할 값을 받는다", () => {
    expect(solRoleSchema.parse("SALES")).toBe("SALES");
  });

  it("조직 역할 OWNER 는 업무 역할이 아니다", () => {
    expect(solRoleSchema.safeParse("OWNER").success).toBe(false);
  });
});
