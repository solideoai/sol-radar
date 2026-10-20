import { afterEach, describe, expect, it, vi } from "vitest";
import { workDeps } from "./work-deps";

// 커서 비밀의 길이 하한(O9)은 env 를 읽는 이 자리에서 건다. Route Handler 는 받은 값을 그대로 서비스에 넘긴다.
describe("workDeps 커서 비밀", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("32자 이상이면 앞뒤 공백을 뗀 값을 쓴다", () => {
    vi.stubEnv("API_CURSOR_SECRET", ` ${"s".repeat(32)} `);
    expect(workDeps().cursorSecret).toBe("s".repeat(32));
  });

  it("없거나 32자 미만이면 null 이다(목록은 503 {component:cursor})", () => {
    for (const value of ["", "s".repeat(31), " ".repeat(40)]) {
      vi.stubEnv("API_CURSOR_SECRET", value);
      expect(workDeps().cursorSecret, JSON.stringify(value)).toBeNull();
    }
  });
});
