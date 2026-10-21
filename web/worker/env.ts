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

// data.go.kr 포털은 일반 인증키를 Encoding 키(URL 인코딩된 값)로만 제공한다. env 에는 그 값을
// 그대로 넣고, 여기서 decodeURIComponent 로 한 번 디코딩해 Decoding 키로 만든다. Connector 는
// 이 반환값을 요청에 넣을 때 한 번만 URL 인코딩한다. Decoding 키(% 가 없는 원문)를 넣어도
// 디코딩이 값을 바꾸지 않으므로 결과는 같다. 오류에는 env 이름만 싣고 값은 싣지 않는다.
export function readG2bServiceKey(
  env: Record<string, string | undefined>,
  envName: string,
): string {
  const encoded = env[envName]?.trim();
  if (!encoded) {
    throw new Error(`worker env 누락: ${envName}`);
  }
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new Error(`worker env 형식 오류: ${envName} (URL 인코딩이 깨졌다)`);
  }
}

const EXTERNAL_KEY_ENVS = new Set([
  "KWATER_BID_NOTICE_SERVICE_KEY",
  "KWATER_PROCUREMENT_PLAN_SERVICE_KEY",
  "LH_BID_NOTICE_SERVICE_KEY",
  "LH_PRE_SPECIFICATION_SERVICE_KEY",
  "G2B_PROCUREMENT_REQUEST_SERVICE_KEY",
  "KEPCO_EBID_CONTRACT_SERVICE_KEY",
]);
/** KEPCO는 data.go.kr 키와 별개다. 공유 fallback 키는 활용승인 증거가 없으므로 추측하지 않는다. */
export function readExternalServiceKey(
  env: Record<string, string | undefined>,
  envName: string,
): string {
  if (!EXTERNAL_KEY_ENVS.has(envName))
    throw new Error("외부 API 인증 환경변수 이름이 허용되지 않았습니다");
  if (envName !== "KEPCO_EBID_CONTRACT_SERVICE_KEY") return readG2bServiceKey(env, envName);
  const key = env[envName]?.trim();
  if (!key || key.length !== 40 || /\s/.test(key))
    throw new Error(`worker env 형식 오류: ${envName} (40자리 키 필요)`);
  return key;
}
