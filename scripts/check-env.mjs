import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { loadRunModeRules, resolveRunMode } from "./run-mode.mjs";

const DEFAULT_ROOT = fileURLToPath(new URL("../", import.meta.url));

const INFRA_FILE = "infra/.env";
const WEB_FILE = "web/.env.local";
const ROOT_FILE = ".env.local";

const INFRA_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "REDIS_PASSWORD",
  "MINIO_ROOT_USER",
  "MINIO_ROOT_PASSWORD",
];
const AI_REQUIRED = ["QWEN_BASE_URL", "KEV_BASE_URL", "KEV_API_KEY"];
const HOSTED_REQUIRED = ["HOSTED_API_BASE_URL", "HOSTED_API_KEY"];
const WEB_REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "REDIS_URL",
  "MINIO_ENDPOINT",
  "AI_GATEWAY_URL",
];
const WEB_FORBIDDEN = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "G2B_BID_NOTICE_SERVICE_KEY",
  "G2B_PRE_SPEC_SERVICE_KEY",
  "G2B_ORDER_PLAN_SERVICE_KEY",
  "G2B_INDUSTRY_MASTER_SERVICE_KEY",
];

const isPlaceholder = (value) => value.includes("CHANGE_ME") || value === "minioadmin";
// 대소문자를 구분하지 않고 비교한다(NEXT_PUBLIC_service_role 같은 변형도 막는다).
const isForbiddenWebKey = (key) => {
  const upper = key.toUpperCase();
  return (
    WEB_FORBIDDEN.includes(upper) ||
    (upper.startsWith("NEXT_PUBLIC_") && (upper.includes("SERVICE_ROLE") || upper.includes("G2B")))
  );
};

/** env 파일을 읽는다. 파일이 없으면 null. */
async function readEnvFile(root, relative) {
  try {
    return parseEnv(await readFile(path.join(root, relative), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

const missingKeys = (values, keys) =>
  keys.filter((key) => values[key] === undefined || values[key] === "");

const placeholderProblems = (file, values) =>
  Object.entries(values)
    .filter(([, value]) => isPlaceholder(value))
    .map(([key]) => ({ file, key, code: "PLACEHOLDER" }));

/** infra/.env 의 필수 키 목록. 모드를 모르면(null) 모드에 따른 키는 보지 않는다. */
function requiredInfraKeys(resolved, rules) {
  if (resolved.mode === null) return INFRA_REQUIRED;
  return [
    ...INFRA_REQUIRED,
    ...rules.modes[resolved.mode].requiredSecrets,
    ...(resolved.mode === "mock" ? [] : AI_REQUIRED),
    ...(resolved.effective.AI_PROVIDER === rules.hostedApproval.provider ? HOSTED_REQUIRED : []),
  ];
}

/** 파일 내용만 보고 env 를 검사한다(process.env 는 쓰지 않는다). */
export async function checkEnv({ root = DEFAULT_ROOT } = {}) {
  const rules = loadRunModeRules();
  const [infra, web, rootLocal] = await Promise.all([
    readEnvFile(root, INFRA_FILE),
    readEnvFile(root, WEB_FILE),
    readEnvFile(root, ROOT_FILE),
  ]);
  const problems = [];
  const missingFile = (file) => problems.push({ file, key: "*", code: "MISSING_FILE" });

  const resolved = resolveRunMode(infra ?? {}, rules);
  if (infra === null) {
    missingFile(INFRA_FILE);
  } else {
    for (const { key, reason } of resolved.violations) {
      problems.push({ file: INFRA_FILE, key, code: reason });
    }
    for (const key of missingKeys(infra, requiredInfraKeys(resolved, rules))) {
      problems.push({ file: INFRA_FILE, key, code: "MISSING_KEY" });
    }
    problems.push(...placeholderProblems(INFRA_FILE, infra));
  }

  if (web === null) {
    missingFile(WEB_FILE);
  } else {
    for (const key of missingKeys(web, WEB_REQUIRED)) {
      problems.push({ file: WEB_FILE, key, code: "MISSING_KEY" });
    }
    for (const key of Object.keys(web).filter(isForbiddenWebKey)) {
      problems.push({ file: WEB_FILE, key, code: "FORBIDDEN_KEY" });
    }
    problems.push(...placeholderProblems(WEB_FILE, web));
  }

  if (rootLocal !== null) problems.push(...placeholderProblems(ROOT_FILE, rootLocal));

  const count = (codes) => problems.filter((p) => codes.includes(p.code)).length;
  return {
    ok: problems.length === 0,
    mode: resolved.mode,
    counts: {
      placeholder: count(["PLACEHOLDER"]),
      contradiction: count([
        "UNKNOWN_MODE",
        "CONTRADICTS_MODE",
        "FORBIDDEN_IN_MODE",
        "HOSTED_NOT_APPROVED",
      ]),
      missing: count(["MISSING_FILE", "MISSING_KEY"]),
      forbidden: count(["FORBIDDEN_KEY"]),
    },
    problems,
  };
}

function parseRoot(argv) {
  const index = argv.indexOf("--root");
  return index === -1 ? DEFAULT_ROOT : path.resolve(argv[index + 1] ?? "");
}

async function main() {
  const result = await checkEnv({ root: parseRoot(process.argv.slice(2)) });
  // 값은 쓰지 않는다. 파일·키·코드만 알린다.
  for (const { file, key, code } of result.problems) {
    console.error(`FAIL ${file} ${key} ${code}`);
  }
  const { counts } = result;
  if (result.ok) {
    console.log(
      `check:env 통과: 실행 모드 ${result.mode}, placeholder ${counts.placeholder}건, 모드 모순 ${counts.contradiction}건`,
    );
    return;
  }
  console.log(
    `check:env 실패: 실행 모드 ${result.mode ?? "알 수 없음"}, placeholder ${counts.placeholder}건, 모드 모순 ${counts.contradiction}건, 누락 ${counts.missing}건, 금지 ${counts.forbidden}건`,
  );
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
