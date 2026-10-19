import { describe, expect, it } from "vitest";
import { checkReadiness } from "@/worker/readiness";

const ok = () => Promise.resolve();

describe("checkReadiness", () => {
  it("둘 다 되면 통과한다", async () => {
    await expect(checkReadiness({ pingRedis: ok, pingSupabase: ok })).resolves.toBeUndefined();
  });

  it("redis 실패는 redis 만 이름으로 알린다", async () => {
    const pingRedis = () => Promise.reject(new Error("redis://user:pw@host 거부"));
    const error = await checkReadiness({ pingRedis, pingSupabase: ok }).catch((e: unknown) => e);
    expect(String(error)).toContain("redis");
    expect(String(error)).not.toContain("pw");
  });

  it("supabase 실패는 supabase 로 알린다", async () => {
    const pingSupabase = () => Promise.reject(new Error("boom"));
    await expect(checkReadiness({ pingRedis: ok, pingSupabase })).rejects.toThrow(/supabase/);
  });

  it("제한 시간을 넘기면 실패한다", async () => {
    const never = () => new Promise<void>(() => undefined);
    await expect(checkReadiness({ pingRedis: never, pingSupabase: ok }, 20)).rejects.toThrow(
      /redis/,
    );
  });
});
