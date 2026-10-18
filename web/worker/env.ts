export type WorkerEnv = {
  redisUrl: string;
  heartbeatFile: string;
};

const REQUIRED_KEYS = [
  "REDIS_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export const DEFAULT_HEARTBEAT_FILE = "/tmp/sol-worker-heartbeat";

// 오류에는 키 이름만 싣는다. 값(service role 키 등)이 로그로 새지 않게 한다.
export function readWorkerEnv(env: Record<string, string | undefined>): WorkerEnv {
  const missing = REQUIRED_KEYS.filter((key) => !env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`worker env 누락: ${missing.join(", ")}`);
  }
  return {
    redisUrl: env.REDIS_URL?.trim() ?? "",
    heartbeatFile: env.WORKER_HEARTBEAT_FILE?.trim() || DEFAULT_HEARTBEAT_FILE,
  };
}
