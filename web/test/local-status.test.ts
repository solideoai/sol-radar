import { expect, it, vi } from "vitest";
import { readLocalStatus } from "@/e2e-auth/support/local-status";
const env = {
  SOL_RADAR_TEST_SUPABASE_WORKDIR: "/tmp/isolated/project",
  SOL_RADAR_TEST_SUPABASE_API_URL: "http://127.0.0.1:65421",
};
const stdout =
  'API_URL="http://127.0.0.1:65421"\nANON_KEY="public-test"\nSERVICE_ROLE_KEY="private-sentinel"';
it("passes the exact isolated workdir, retaining output only in memory", () => {
  const run = vi.fn(() => ({ status: 0, stdout }));
  expect(readLocalStatus({ env, run }).API_URL).toBe(env.SOL_RADAR_TEST_SUPABASE_API_URL);
  expect(run.mock.calls).toEqual([
    [
      "supabase",
      ["status", "-o", "env", "--workdir", env.SOL_RADAR_TEST_SUPABASE_WORKDIR],
      expect.objectContaining({ stdio: ["ignore", "pipe", "pipe"] }),
    ],
  ]);
});
it.each([
  { SOL_RADAR_TEST_SUPABASE_WORKDIR: env.SOL_RADAR_TEST_SUPABASE_WORKDIR },
  { SOL_RADAR_TEST_SUPABASE_API_URL: env.SOL_RADAR_TEST_SUPABASE_API_URL },
  { ...env, SOL_RADAR_TEST_SUPABASE_WORKDIR: "relative" },
  { ...env, SOL_RADAR_TEST_SUPABASE_API_URL: "https://cloud.test" },
  { ...env, SOL_RADAR_TEST_SUPABASE_API_URL: "http://private-sentinel@127.0.0.1:65421" },
  { ...env, SOL_RADAR_TEST_SUPABASE_API_URL: "" },
])("rejects incomplete or invalid context before CLI", (invalid) => {
  const run = vi.fn(() => ({ status: 0, stdout }));
  expect(() => readLocalStatus({ env: invalid, run })).toThrow("격리");
  expect(run).not.toHaveBeenCalled();
});
it("rejects mismatched origin with no fallback", () => {
  const run = vi.fn(() => ({ status: 0, stdout: stdout.replace("65421", "54321") }));
  expect(() => readLocalStatus({ env, run })).toThrow("일치");
  expect(run).toHaveBeenCalledTimes(1);
});
it("ordinary default command remains unchanged", () => {
  const run = vi.fn(() => ({ status: 0, stdout }));
  readLocalStatus({ env: {}, run });
  expect(run.mock.calls[0]).toContainEqual(["status", "-o", "env"]);
});
it.each([
  () => {
    throw Object.assign(new Error("private-sentinel"), { stdout, stderr: stdout });
  },
  () => ({ status: 1, stdout, error: new Error("private-sentinel") }),
  () => ({ status: 0, stdout: 'API_URL="private-sentinel"' }),
])("sanitizes every status failure", (run) => {
  try {
    readLocalStatus({ env, run });
    expect.fail("must reject");
  } catch (error) {
    expect(String(error) + JSON.stringify(error)).not.toContain("private-sentinel");
    expect(error).not.toHaveProperty("cause");
  }
});
