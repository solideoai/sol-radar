import { describe, expect, it } from "vitest";
import { canRunIngestion } from "./empty-state";

// 공고 0건 빈 상태의 [수집 실행] 단추를 누가 보는지(06 §5.3, 미결정 26-6). /admin/ingestion 이 들여보내는 역할과 같다.
describe("canRunIngestion", () => {
  it("ADMIN 만 수집을 돌릴 수 있다", () => {
    expect(canRunIngestion("ADMIN")).toBe(true);
  });

  it.each(["SALES", "ANALYST", "VIEWER"] as const)("%s 는 수집을 돌릴 수 없다", (role) => {
    expect(canRunIngestion(role)).toBe(false);
  });
});
