import { spawnSync } from "node:child_process";
import { isAbsolute, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { isLocalUrl, parseStatusEnv } from "./local-env.mjs";

const originOf = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      isLocalUrl(value) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
      ? url.origin
      : null;
  } catch {
    return null;
  }
};

/**
 * @param {import("./local-test-target.d.mts").LocalStatusOptions} [options]
 * @returns {Record<string, string>}
 */
export function readLocalStatus({ env = process.env, run = spawnSync } = {}) {
  const workdir = env.SOL_RADAR_TEST_SUPABASE_WORKDIR;
  const expected = env.SOL_RADAR_TEST_SUPABASE_API_URL;
  const isolated = workdir !== undefined || expected !== undefined;
  if (
    isolated &&
    (!workdir || !isAbsolute(workdir) || normalize(workdir) !== workdir || !originOf(expected))
  )
    throw new Error("격리 Supabase 작업 경로와 로컬 API origin을 함께 정확히 지정하세요.");
  const args = ["status", "-o", "env", ...(isolated ? ["--workdir", workdir] : [])];
  // CLI failures may embed credentials in message, stdout, stderr, or cause.
  const result = (() => {
    try {
      return run("supabase", args, {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
    } catch {
      throw new Error("로컬 Supabase 상태를 읽지 못했습니다.");
    }
  })();
  if (result.error || result.status !== 0 || typeof result.stdout !== "string")
    throw new Error("로컬 Supabase 상태를 읽지 못했습니다.");
  const status = parseStatusEnv(result.stdout);
  const actual = originOf(status.API_URL);
  if (!actual) throw new Error("로컬 Supabase API origin이 올바르지 않습니다.");
  if (isolated && actual !== originOf(expected))
    throw new Error("격리 Supabase API origin이 요청한 대상과 일치하지 않습니다.");
  return status;
}
