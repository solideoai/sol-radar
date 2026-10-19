import { describe, expect, it } from "vitest";
import { toReadiness, type Readiness } from "./health.model";

const checks = (overrides: Partial<Readiness["checks"]> = {}): Readiness["checks"] => ({
  db: "ok",
  redis: "ok",
  storage: "ok",
  ai: "mock",
  ...overrides,
});

describe("toReadiness", () => {
  it("모두 정상이고 ai 가 mock 이면 200 ok", () => {
    const result = toReadiness(checks());
    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("ok");
  });

  it("ai 만 unavailable 이면 200 degraded", () => {
    const result = toReadiness(checks({ ai: "unavailable" }));
    expect(result.httpStatus).toBe(200);
    expect(result.body.status).toBe("degraded");
    expect(result.body.checks.ai).toBe("unavailable");
  });

  it("ai 가 local·hosted 여도 정상이다", () => {
    expect(toReadiness(checks({ ai: "local" })).body.status).toBe("ok");
    expect(toReadiness(checks({ ai: "hosted" })).body.status).toBe("ok");
  });

  it("redis 가 unavailable 이면 503 unavailable", () => {
    const result = toReadiness(checks({ redis: "unavailable" }));
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("unavailable");
  });

  it("storage 가 unavailable 이면 503 unavailable", () => {
    const result = toReadiness(checks({ storage: "unavailable" }));
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("unavailable");
  });

  it("db 가 unavailable 이면 503 이고 ai 상태는 그대로 남는다", () => {
    const result = toReadiness(checks({ db: "unavailable", ai: "mock" }));
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("unavailable");
    expect(result.body.checks.ai).toBe("mock");
  });

  it("db 와 ai 가 함께 unavailable 이어도 503 unavailable (degraded 아님)", () => {
    const result = toReadiness(checks({ db: "unavailable", ai: "unavailable" }));
    expect(result.httpStatus).toBe(503);
    expect(result.body.status).toBe("unavailable");
  });

  it("입력 checks 를 본문에 그대로 담는다", () => {
    const input = checks({ ai: "local" });
    expect(toReadiness(input).body.checks).toEqual(input);
  });
});
