import { spawnSync } from "node:child_process";
import { isAbsolute, normalize } from "node:path";
const isLocalUrl = (value: string) => {
  const host = new URL(value).hostname;
  if (host === "localhost" || host === "[::1]") return true;
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(host)) return false;
  const parts = host.split(".").map(Number);
  if (parts.some((part) => part > 255)) return false;
  const [first, second] = parts;
  return (
    first === 127 ||
    first === 10 ||
    (first === 192 && second === 168) ||
    (first === 172 && second >= 16 && second <= 31)
  );
};
const parseStatusEnv = (text: string): Record<string, string> =>
  Object.fromEntries(
    text.split(/\r?\n/).flatMap((line) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
      if (!match) return [];
      const value = match[2];
      return [
        [
          match[1],
          value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.at(-1) === value[0]
            ? value.slice(1, -1)
            : value,
        ],
      ];
    }),
  );
type RunStatus = (
  command: string,
  args: string[],
  options: { encoding: "utf8"; stdio: ["ignore", "pipe", "pipe"]; shell: boolean },
) => { status: number | null; stdout: string; error?: Error };

const originOf = (value: string | undefined) => {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) &&
      isLocalUrl(value ?? "") &&
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

export function readLocalStatus({
  env = process.env,
  run = spawnSync,
}: { env?: Record<string, string | undefined>; run?: RunStatus } = {}) {
  const workdir = env.SOL_RADAR_TEST_SUPABASE_WORKDIR;
  const expected = env.SOL_RADAR_TEST_SUPABASE_API_URL;
  const isolated = workdir !== undefined || expected !== undefined;
  if (
    isolated &&
    (!workdir || !isAbsolute(workdir) || normalize(workdir) !== workdir || !originOf(expected))
  )
    throw new Error("격리 Supabase 작업 경로와 로컬 API origin을 함께 정확히 지정하세요.");
  const args = ["status", "-o", "env", ...(isolated ? ["--workdir", workdir!] : [])];
  // CLI failures may embed credentials in message, stdout, stderr, or cause.
  const result = (() => {
    try {
      return run("supabase", args, {
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
