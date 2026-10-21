import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkEnv } from "./check-env.mjs";
import { resolveRunMode } from "./run-mode.mjs";

const CLI = fileURLToPath(new URL("./check-env.mjs", import.meta.url));

const INFRA_BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
  SUPABASE_SERVICE_ROLE_KEY: "svc-fake-1",
  REDIS_PASSWORD: "redisfake1",
  MINIO_ROOT_USER: "minio-user-1",
  MINIO_ROOT_PASSWORD: "minio-pass-1",
};
const WEB_BASE = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.test",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-fake-1",
  REDIS_URL: "redis://redis:6379",
  MINIO_ENDPOINT: "http://minio:9000",
  AI_GATEWAY_URL: "http://ai-gateway:8000",
  API_CURSOR_SECRET: "c".repeat(32),
};

test("checkEnv: frontend requires HTTPS service API, not Redis TCP/MinIO/AI direct URLs", async () => {
  const web = {
    NEXT_PUBLIC_SUPABASE_URL: WEB_BASE.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: WEB_BASE.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    API_CURSOR_SECRET: WEB_BASE.API_CURSOR_SECRET,
    SOL_DEPLOYMENT_ROLE: "frontend",
    REDIS_API_BASE_URL: "https://acropolissg.com/redis",
    REDIS_API_TOKEN: "test-only-service-token-0123456789-abcdefghijklmnopqrstuvwxyz",
  };
  await withRoot({ web }, async (root) => {
    assert.equal((await checkEnv({ root })).ok, true);
  });
  await withRoot(
    {
      web: {
        ...web,
        REDIS_URL: "redis://redis:6379",
        NEXT_PUBLIC_REDIS_API_TOKEN: "test-only-never-public",
      },
    },
    async (root) => {
      const result = await checkEnv({ root });
      assert.ok(result.problems.some((p) => p.key === "REDIS_URL" && p.code === "FORBIDDEN_KEY"));
      assert.ok(
        result.problems.some(
          (p) => p.key === "NEXT_PUBLIC_REDIS_API_TOKEN" && p.code === "FORBIDDEN_KEY",
        ),
      );
    },
  );
});

test("checkEnv: redis-api needs a server token and rejects an unknown role", async () => {
  await withRoot({ web: { ...WEB_BASE, SOL_DEPLOYMENT_ROLE: "redis-api" } }, async (root) => {
    assert.ok((await checkEnv({ root })).problems.some((p) => p.key === "REDIS_API_TOKEN"));
  });
  await withRoot({ web: { ...WEB_BASE, SOL_DEPLOYMENT_ROLE: "made-up-role" } }, async (root) => {
    assert.ok((await checkEnv({ root })).problems.some((p) => p.key === "SOL_DEPLOYMENT_ROLE"));
  });
});

// web 의 SOL_RUN_MODE 는 infra 모드와 같아야 한다(D2). 모드가 mock 이 아닌 시험은 이 web 을 쓴다.
const webFor = (mode) => ({ ...WEB_BASE, SOL_RUN_MODE: mode });

const toEnvText = (values) =>
  Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";

/** 임시 root 에 가짜 env 파일을 쓴다. null 이면 파일을 만들지 않는다. */
async function makeRoot({ infra = INFRA_BASE, web = WEB_BASE, rootLocal = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "check-env-"));
  const put = async (relative, values) => {
    if (values === null) return;
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, toEnvText(values));
  };
  await put("infra/.env", infra);
  await put("web/.env.local", web);
  await put(".env.local", rootLocal);
  return root;
}

async function withRoot(options, run) {
  const root = await makeRoot(options);
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("resolveRunMode: 미지정이면 mock", () => {
  const result = resolveRunMode({});
  assert.equal(result.mode, "mock");
  assert.equal(result.effective.AI_PROVIDER, "mock");
  assert.deepEqual(result.violations, []);
});

test("resolveRunMode: 빈 문자열은 미지정과 같다", () => {
  const empty = resolveRunMode({ SOL_RUN_MODE: "" });
  assert.equal(empty.mode, "mock");
  assert.deepEqual(empty.violations, []);
  const provider = resolveRunMode({ SOL_RUN_MODE: "live", AI_PROVIDER: "" });
  assert.equal(provider.effective.AI_PROVIDER, "local");
  assert.deepEqual(provider.violations, []);
});

test("resolveRunMode: 정상 조합 통과", () => {
  const cases = [
    { SOL_RUN_MODE: "live" },
    { SOL_RUN_MODE: "fixture", AI_PROVIDER: "local" },
    { SOL_RUN_MODE: "mock", KEV_ENABLED: "true" },
    { SOL_RUN_MODE: "fixture", AI_PROVIDER: "hosted", AI_HOSTED_APPROVED: "true" },
  ];
  for (const env of cases) {
    assert.deepEqual(resolveRunMode(env).violations, [], JSON.stringify(env));
  }
});

test("resolveRunMode: 모순은 키 이름으로 알린다", () => {
  const cases = [
    [{ SOL_RUN_MODE: "live", AI_PROVIDER: "mock" }, "AI_PROVIDER", "CONTRADICTS_MODE"],
    [
      { SOL_RUN_MODE: "live", AI_FALLBACK_TO_MOCK: "true" },
      "AI_FALLBACK_TO_MOCK",
      "FORBIDDEN_IN_MODE",
    ],
    [
      { SOL_RUN_MODE: "live", KEV_ALLOW_KO_STATE: "true" },
      "KEV_ALLOW_KO_STATE",
      "FORBIDDEN_IN_MODE",
    ],
    [{ SOL_RUN_MODE: "mock", DEMO_MODE: "false" }, "DEMO_MODE", "CONTRADICTS_MODE"],
    [{ SOL_RUN_MODE: "fixture", AI_PROVIDER: "mock" }, "AI_PROVIDER", "CONTRADICTS_MODE"],
    [{ SOL_RUN_MODE: "mock", AI_PROVIDER: "hosted" }, "AI_PROVIDER", "CONTRADICTS_MODE"],
    [
      { SOL_RUN_MODE: "fixture", AI_PROVIDER: "hosted" },
      "AI_HOSTED_APPROVED",
      "HOSTED_NOT_APPROVED",
    ],
    [{ SOL_RUN_MODE: "LIVE" }, "SOL_RUN_MODE", "UNKNOWN_MODE"],
    [{ SOL_RUN_MODE: " mock" }, "SOL_RUN_MODE", "UNKNOWN_MODE"],
  ];
  for (const [env, key, reason] of cases) {
    assert.deepEqual(resolveRunMode(env).violations, [{ key, reason }], JSON.stringify(env));
  }
});

const RUN_MODES = ["live", "fixture", "mock"];

test("resolveRunMode: 세 모드 모두 KEV_ENABLED=false 를 허용한다", () => {
  for (const mode of RUN_MODES) {
    const result = resolveRunMode({ SOL_RUN_MODE: mode, KEV_ENABLED: "false" });
    assert.deepEqual(result.violations, [], mode);
    assert.equal(result.effective.KEV_ENABLED, "false", mode);
  }
});

test("resolveRunMode: KEV_ENABLED 미지정이면 세 모드 모두 true", () => {
  for (const mode of RUN_MODES) {
    assert.equal(resolveRunMode({ SOL_RUN_MODE: mode }).effective.KEV_ENABLED, "true", mode);
  }
});

test("resolveRunMode: KEV_ENABLED 대소문자·공백 변형은 모순", () => {
  for (const mode of RUN_MODES) {
    for (const value of ["False", " false"]) {
      const env = { SOL_RUN_MODE: mode, KEV_ENABLED: value };
      assert.deepEqual(
        resolveRunMode(env).violations,
        [{ key: "KEV_ENABLED", reason: "CONTRADICTS_MODE" }],
        JSON.stringify(env),
      );
    }
  }
});

// M2: AI_PROVIDER 실효값 hosted 와 KEV_ALLOW_KO_STATE=true 는 모든 모드에서 함께 쓸 수 없다.
// 판정 순서는 forbidden 다음, hosted 승인 앞. Python(services/ai/tests/test_run_mode.py)과 같은 입력·기대값.
test("resolveRunMode: M2 fixture 의 hosted + 한국어 state 는 FORBIDDEN_WITH_HOSTED", () => {
  const result = resolveRunMode({
    SOL_RUN_MODE: "fixture",
    AI_PROVIDER: "hosted",
    AI_HOSTED_APPROVED: "true",
    KEV_ALLOW_KO_STATE: "true",
  });
  assert.deepEqual(result.violations, [
    { key: "KEV_ALLOW_KO_STATE", reason: "FORBIDDEN_WITH_HOSTED" },
  ]);
});

test("resolveRunMode: M2 live 는 모드 금지 → hosted 금지 → 승인 순서", () => {
  const result = resolveRunMode({
    SOL_RUN_MODE: "live",
    AI_PROVIDER: "hosted",
    KEV_ALLOW_KO_STATE: "true",
  });
  assert.deepEqual(result.violations, [
    { key: "KEV_ALLOW_KO_STATE", reason: "FORBIDDEN_IN_MODE" },
    { key: "KEV_ALLOW_KO_STATE", reason: "FORBIDDEN_WITH_HOSTED" },
    { key: "AI_HOSTED_APPROVED", reason: "HOSTED_NOT_APPROVED" },
  ]);
});

test("resolveRunMode: M2 mock 에 hosted 값 + 한국어 state", () => {
  const result = resolveRunMode({
    SOL_RUN_MODE: "mock",
    AI_PROVIDER: "hosted",
    KEV_ALLOW_KO_STATE: "true",
  });
  assert.deepEqual(result.violations, [
    { key: "AI_PROVIDER", reason: "CONTRADICTS_MODE" },
    { key: "KEV_ALLOW_KO_STATE", reason: "FORBIDDEN_WITH_HOSTED" },
  ]);
});

test("resolveRunMode: M2 fixture 의 local + 한국어 state 는 위반 없음", () => {
  const result = resolveRunMode({ SOL_RUN_MODE: "fixture", KEV_ALLOW_KO_STATE: "true" });
  assert.deepEqual(result.violations, []);
});

test("resolveRunMode: 알 수 없는 모드는 mode·effective 가 null", () => {
  const result = resolveRunMode({ SOL_RUN_MODE: "LIVE", AI_PROVIDER: "mock" });
  assert.equal(result.mode, null);
  assert.equal(result.effective, null);
  assert.equal(result.violations.length, 1);
});

test("resolveRunMode: 금지 키는 값이 금지 값과 정확히 같을 때만 위반", () => {
  const result = resolveRunMode({ SOL_RUN_MODE: "live", AI_FALLBACK_TO_MOCK: "false" });
  assert.deepEqual(result.violations, []);
});

test("checkEnv: infra/.env 가 없으면 MISSING_FILE", async () => {
  await withRoot({ infra: null }, async (root) => {
    const result = await checkEnv({ root });
    assert.equal(result.ok, false);
    assert.ok(result.problems.some((p) => p.file === "infra/.env" && p.code === "MISSING_FILE"));
    assert.equal(result.counts.missing >= 1, true);
  });
});

test("checkEnv: 정상 mock 구성은 통과", async () => {
  await withRoot({}, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.mode, "mock");
  });
});

test("checkEnv: CHANGE_ME 와 minioadmin 을 placeholder 로 센다", async () => {
  const infra = {
    ...INFRA_BASE,
    REDIS_PASSWORD: "CHANGE_ME_redis",
    MINIO_ROOT_PASSWORD: "minioadmin",
  };
  await withRoot({ infra }, async (root) => {
    const result = await checkEnv({ root });
    assert.equal(result.counts.placeholder, 2);
    assert.equal(result.counts.missing, 0);
    assert.equal(result.ok, false);
  });
});

test("checkEnv: web/.env.local 의 SUPABASE_SERVICE_ROLE_KEY 는 FORBIDDEN_KEY", async () => {
  const web = {
    ...WEB_BASE,
    SUPABASE_SERVICE_ROLE_KEY: "svc-fake-2",
    NEXT_PUBLIC_G2B_THING: "x",
  };
  await withRoot({ web }, async (root) => {
    const result = await checkEnv({ root });
    const forbidden = result.problems.filter((p) => p.code === "FORBIDDEN_KEY");
    assert.deepEqual(forbidden.map((p) => [p.file, p.key]).sort(), [
      ["web/.env.local", "NEXT_PUBLIC_G2B_THING"],
      ["web/.env.local", "SUPABASE_SERVICE_ROLE_KEY"],
    ]);
    assert.equal(result.counts.forbidden, 2);
  });
});

const G2B_KEYS = [
  "G2B_BID_NOTICE_SERVICE_KEY",
  "G2B_PRE_SPEC_SERVICE_KEY",
  "G2B_ORDER_PLAN_SERVICE_KEY",
  "G2B_INDUSTRY_MASTER_SERVICE_KEY",
];

const LIVE_INFRA = {
  ...INFRA_BASE,
  SOL_RUN_MODE: "live",
  DEMO_MODE: "false",
  QWEN_BASE_URL: "http://qwen:8000",
  // C5-A S3: local(실추론)은 QWEN_API_KEY 필수(03 §3·09)
  QWEN_API_KEY: "qwen-fake-1",
  KEV_BASE_URL: "http://kev:8009",
  KEV_API_KEY: "kev-fake-1",
  ...Object.fromEntries(G2B_KEYS.map((key) => [key, "g2b-fake-1"])),
};

test("checkEnv: live 인데 빠진 서비스키마다 MISSING_KEY, mock 은 통과", async () => {
  const live = LIVE_INFRA;
  await withRoot({ infra: live, web: webFor("live") }, async (root) => {
    const result = await checkEnv({ root });
    assert.equal(result.mode, "live");
    assert.deepEqual(result.problems, []);
  });
  await withRoot(
    { infra: { ...live, G2B_PRE_SPEC_SERVICE_KEY: "" }, web: webFor("live") },
    async (root) => {
      const result = await checkEnv({ root });
      assert.deepEqual(
        result.problems.map((p) => [p.file, p.key, p.code]),
        [["infra/.env", "G2B_PRE_SPEC_SERVICE_KEY", "MISSING_KEY"]],
      );
    },
  );
  await withRoot({}, async (root) => {
    assert.equal((await checkEnv({ root })).ok, true);
  });
});

test("checkEnv: web/.env.local 의 서비스키 4종은 FORBIDDEN_KEY", async () => {
  const web = { ...WEB_BASE, ...Object.fromEntries(G2B_KEYS.map((key) => [key, "x"])) };
  await withRoot({ web }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems
        .filter((p) => p.code === "FORBIDDEN_KEY")
        .map((p) => p.key)
        .sort(),
      [...G2B_KEYS].sort(),
    );
  });
});

test("checkEnv: infra 가 fixture 인데 web 에 SOL_RUN_MODE 가 없으면 CONTRADICTS_MODE", async () => {
  await withRoot(
    { infra: { ...INFRA_BASE, SOL_RUN_MODE: "fixture", AI_PROVIDER: "local" } },
    async (root) => {
      const result = await checkEnv({ root });
      assert.ok(
        result.problems.some(
          (p) =>
            p.file === "web/.env.local" &&
            p.key === "SOL_RUN_MODE" &&
            p.code === "CONTRADICTS_MODE",
        ),
        JSON.stringify(result.problems),
      );
      assert.equal(result.counts.contradiction >= 1, true);
    },
  );
});

test("checkEnv: web SOL_RUN_MODE 가 infra 와 같으면 통과한다", async () => {
  await withRoot(
    {
      infra: { ...INFRA_BASE, SOL_RUN_MODE: "fixture", AI_PROVIDER: "local" },
      web: { ...WEB_BASE, SOL_RUN_MODE: "fixture" },
    },
    async (root) => {
      const result = await checkEnv({ root });
      assert.equal(
        result.problems.some((p) => p.key === "SOL_RUN_MODE"),
        false,
        JSON.stringify(result.problems),
      );
    },
  );
});

test("checkEnv: 알 수 없는 모드면 모드별 필수 키를 보지 않는다", async () => {
  await withRoot({ infra: { ...INFRA_BASE, SOL_RUN_MODE: "LIVE" } }, async (root) => {
    const result = await checkEnv({ root });
    assert.equal(result.mode, null);
    assert.deepEqual(
      result.problems.map((p) => [p.file, p.key, p.code]),
      [["infra/.env", "SOL_RUN_MODE", "UNKNOWN_MODE"]],
    );
    assert.equal(result.counts.contradiction, 1);
  });
});

test("checkEnv: 필수 키가 빈 문자열이면 MISSING_KEY", async () => {
  await withRoot({ infra: { ...INFRA_BASE, REDIS_PASSWORD: "" } }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map((p) => [p.key, p.code]),
      [["REDIS_PASSWORD", "MISSING_KEY"]],
    );
  });
});

test("checkEnv: 루트 .env.local 은 있으면 placeholder 만 센다", async () => {
  await withRoot({ rootLocal: { ANY_KEY: "CHANGE_ME" } }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map((p) => [p.file, p.key, p.code]),
      [[".env.local", "ANY_KEY", "PLACEHOLDER"]],
    );
  });
});

const runCli = (root) => spawnSync(process.execPath, [CLI, "--root", root], { encoding: "utf8" });

test("CLI: 통과하면 exit 0 과 정해진 마지막 줄", async () => {
  await withRoot({}, async (root) => {
    const result = runCli(root);
    assert.equal(result.status, 0);
    const lines = result.stdout.trim().split("\n");
    assert.equal(lines.at(-1), "check:env 통과: 실행 모드 mock, placeholder 0건, 모드 모순 0건");
  });
});

test("CLI: 실패하면 exit 1 과 요약 줄", async () => {
  await withRoot({ infra: { ...INFRA_BASE, SOL_RUN_MODE: "LIVE" } }, async (root) => {
    const result = runCli(root);
    assert.equal(result.status, 1);
    assert.equal(
      result.stdout.trim().split("\n").at(-1),
      "check:env 실패: 실행 모드 알 수 없음, placeholder 0건, 모드 모순 1건, 누락 0건, 금지 0건",
    );
    assert.match(result.stderr, /FAIL infra\/\.env SOL_RUN_MODE UNKNOWN_MODE/);
  });
});

test("CLI 출력에 비밀값이 없다", async () => {
  const infra = {
    ...INFRA_BASE,
    SUPABASE_SERVICE_ROLE_KEY: "sk-test-SECRET-123",
    REDIS_PASSWORD: "pw-SECRET-456",
    MINIO_ROOT_PASSWORD: "CHANGE_ME_SECRET",
    SOL_RUN_MODE: "live",
    AI_PROVIDER: "mock",
  };
  const web = { ...WEB_BASE, SUPABASE_SERVICE_ROLE_KEY: "sk-test-SECRET-123" };
  await withRoot({ infra, web }, async (root) => {
    const result = runCli(root);
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(output.split("SECRET").length - 1, 0);
  });
});

test("resolveRunMode: 위반 여러 건은 판정 순서대로 나온다", () => {
  const live = resolveRunMode({
    SOL_RUN_MODE: "live",
    DEMO_MODE: "true",
    AI_PROVIDER: "mock",
    KEV_ENABLED: "off",
    KEV_ALLOW_KO_STATE: "true",
    AI_FALLBACK_TO_MOCK: "true",
  });
  assert.deepEqual(live.violations, [
    { key: "DEMO_MODE", reason: "CONTRADICTS_MODE" },
    { key: "AI_PROVIDER", reason: "CONTRADICTS_MODE" },
    { key: "KEV_ENABLED", reason: "CONTRADICTS_MODE" },
    { key: "AI_FALLBACK_TO_MOCK", reason: "FORBIDDEN_IN_MODE" },
    { key: "KEV_ALLOW_KO_STATE", reason: "FORBIDDEN_IN_MODE" },
  ]);
  const fixture = resolveRunMode({
    SOL_RUN_MODE: "fixture",
    DEMO_MODE: "false",
    AI_PROVIDER: "hosted",
  });
  assert.deepEqual(fixture.violations, [
    { key: "DEMO_MODE", reason: "CONTRADICTS_MODE" },
    { key: "AI_HOSTED_APPROVED", reason: "HOSTED_NOT_APPROVED" },
  ]);
});

const FIXTURE_INFRA = {
  ...INFRA_BASE,
  SOL_RUN_MODE: "fixture",
  QWEN_BASE_URL: "http://qwen:8000",
  QWEN_API_KEY: "qwen-fake-1",
  KEV_BASE_URL: "http://kev:8009",
  KEV_API_KEY: "kev-fake-1",
};

test("checkEnv: fixture 에서 QWEN_API_KEY 가 빠지거나 비면 MISSING_KEY", async () => {
  const { QWEN_API_KEY: _omitted, ...missing } = FIXTURE_INFRA;
  for (const infra of [missing, { ...FIXTURE_INFRA, QWEN_API_KEY: "" }]) {
    await withRoot({ infra, web: webFor("fixture") }, async (root) => {
      const result = await checkEnv({ root });
      assert.deepEqual(
        result.problems.map((p) => [p.file, p.key, p.code]),
        [["infra/.env", "QWEN_API_KEY", "MISSING_KEY"]],
      );
    });
  }
});

test("checkEnv: live 에서 QWEN_API_KEY 가 빠지면 MISSING_KEY", async () => {
  const { QWEN_API_KEY: _omitted, ...infra } = LIVE_INFRA;
  await withRoot({ infra, web: webFor("live") }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map((p) => [p.file, p.key, p.code]),
      [["infra/.env", "QWEN_API_KEY", "MISSING_KEY"]],
    );
  });
});

test("checkEnv: fixture 에서 KEV_API_KEY 가 빠지면 MISSING_KEY", async () => {
  const { KEV_API_KEY: _omitted, ...infra } = FIXTURE_INFRA;
  await withRoot({ infra: FIXTURE_INFRA, web: webFor("fixture") }, async (root) => {
    assert.deepEqual((await checkEnv({ root })).problems, []);
  });
  await withRoot({ infra, web: webFor("fixture") }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map((p) => [p.file, p.key, p.code]),
      [["infra/.env", "KEV_API_KEY", "MISSING_KEY"]],
    );
  });
});

test("checkEnv: 승인된 hosted 에서 HOSTED_API_* 가 빠지면 MISSING_KEY", async () => {
  const hosted = { ...FIXTURE_INFRA, AI_PROVIDER: "hosted", AI_HOSTED_APPROVED: "true" };
  await withRoot({ infra: hosted, web: webFor("fixture") }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(result.problems.map((p) => [p.key, p.code]).sort(), [
      ["HOSTED_API_BASE_URL", "MISSING_KEY"],
      ["HOSTED_API_KEY", "MISSING_KEY"],
    ]);
  });
  const full = { ...hosted, HOSTED_API_BASE_URL: "http://h.test", HOSTED_API_KEY: "h-fake-1" };
  await withRoot({ infra: full, web: webFor("fixture") }, async (root) => {
    assert.deepEqual((await checkEnv({ root })).problems, []);
  });
});

test("checkEnv: web/.env.local 이 없으면 MISSING_FILE", async () => {
  await withRoot({ web: null }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map((p) => [p.file, p.code]),
      [["web/.env.local", "MISSING_FILE"]],
    );
    assert.equal(result.counts.missing, 1);
  });
});

test("checkEnv: web 필수 키가 빠지면 MISSING_KEY", async () => {
  const { AI_GATEWAY_URL: _omitted, ...web } = WEB_BASE;
  await withRoot({ web }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map((p) => [p.file, p.key, p.code]),
      [["web/.env.local", "AI_GATEWAY_URL", "MISSING_KEY"]],
    );
  });
});

test("checkEnv: web 금지 키는 대소문자를 구분하지 않는다", async () => {
  const web = {
    ...WEB_BASE,
    NEXT_PUBLIC_service_role: "x",
    next_public_g2b_x: "x",
    supabase_service_role_key: "x",
  };
  await withRoot({ web }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems
        .filter((p) => p.code === "FORBIDDEN_KEY")
        .map((p) => p.key)
        .sort(),
      ["NEXT_PUBLIC_service_role", "next_public_g2b_x", "supabase_service_role_key"],
    );
  });
});

test("checkEnv: process.env 는 판정에 쓰지 않는다", async () => {
  const names = ["SOL_RUN_MODE", "DEMO_MODE", "AI_PROVIDER"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    await withRoot({}, async (root) => {
      const before = await checkEnv({ root });
      process.env.SOL_RUN_MODE = "live";
      process.env.DEMO_MODE = "false";
      process.env.AI_PROVIDER = "hosted";
      assert.deepEqual(await checkEnv({ root }), before);
      assert.equal(before.mode, "mock");
    });
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

/** web/ 에 임의 이름의 env 파일을 더 쓴다. */
const addWebFile = (root, name, values) =>
  writeFile(path.join(root, "web", name), toEnvText(values));

test("checkEnv: web/.env.production 의 금지 키는 그 파일 이름으로 FORBIDDEN_KEY", async () => {
  await withRoot({}, async (root) => {
    await addWebFile(root, ".env.production", { SUPABASE_SERVICE_ROLE_KEY: "x" });
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.filter((p) => p.code === "FORBIDDEN_KEY"),
      [{ file: "web/.env.production", key: "SUPABASE_SERVICE_ROLE_KEY", code: "FORBIDDEN_KEY" }],
    );
  });
});

test("checkEnv: web/.env.example 의 금지 키는 무시한다", async () => {
  await withRoot({}, async (root) => {
    await addWebFile(root, ".env.example", { SUPABASE_SERVICE_ROLE_KEY: "" });
    const result = await checkEnv({ root });
    assert.equal(result.ok, true);
  });
});

test("checkEnv: web 의 QWEN_API_KEY·KEV_API_KEY·HOSTED_API_KEY 는 FORBIDDEN_KEY", async () => {
  const web = { ...WEB_BASE, QWEN_API_KEY: "x", KEV_API_KEY: "x", HOSTED_API_KEY: "x" };
  await withRoot({ web }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems
        .filter((p) => p.code === "FORBIDDEN_KEY")
        .map((p) => p.key)
        .sort(),
      ["HOSTED_API_KEY", "KEV_API_KEY", "QWEN_API_KEY"],
    );
  });
});

test("checkEnv: REDIS_PASSWORD 에 영숫자 외 문자가 있으면 INVALID_FORMAT, 16진수는 통과", async () => {
  await withRoot({ infra: { ...INFRA_BASE, REDIS_PASSWORD: "ab/cd" } }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map(({ file, key, code }) => [file, key, code]),
      [["infra/.env", "REDIS_PASSWORD", "INVALID_FORMAT"]],
    );
    assert.equal(result.counts.invalid, 1);
    const cli = runCli(root);
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /FAIL infra\/\.env REDIS_PASSWORD INVALID_FORMAT/);
    assert.ok(!(cli.stdout + cli.stderr).includes("ab/cd"));
  });
  const hex = "0123456789abcdef".repeat(4);
  await withRoot({ infra: { ...INFRA_BASE, REDIS_PASSWORD: hex } }, async (root) => {
    assert.equal((await checkEnv({ root })).ok, true);
  });
});

test("checkEnv: web 에 API_CURSOR_SECRET 이 없으면 MISSING_KEY", async () => {
  const { API_CURSOR_SECRET: _omitted, ...web } = WEB_BASE;
  await withRoot({ web }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map(({ file, key, code }) => [file, key, code]),
      [["web/.env.local", "API_CURSOR_SECRET", "MISSING_KEY"]],
    );
  });
});

test("checkEnv: API_CURSOR_SECRET 이 32자 미만이면 INVALID_FORMAT, 값은 출력하지 않는다", async () => {
  await withRoot({ web: { ...WEB_BASE, API_CURSOR_SECRET: "s".repeat(31) } }, async (root) => {
    const result = await checkEnv({ root });
    assert.deepEqual(
      result.problems.map(({ file, key, code }) => [file, key, code]),
      [["web/.env.local", "API_CURSOR_SECRET", "INVALID_FORMAT"]],
    );
    assert.equal(result.counts.invalid, 1);
    const cli = runCli(root);
    assert.equal(cli.status, 1);
    assert.ok(!(cli.stdout + cli.stderr).includes("s".repeat(31)));
  });
  await withRoot({ web: { ...WEB_BASE, API_CURSOR_SECRET: "s".repeat(32) } }, async (root) => {
    assert.equal((await checkEnv({ root })).ok, true);
  });
});

// M7: 런타임(readCursorSecret)은 앞뒤 공백을 뗀 뒤 32자를 잰다. check:env 도 같게 잰다.
test("checkEnv: API_CURSOR_SECRET 은 앞뒤 공백을 뗀 길이로 잰다(공백만 32자 이상이면 INVALID_FORMAT)", async () => {
  for (const value of [" ".repeat(40), `   ${"s".repeat(31)}   `]) {
    // 따옴표로 감싸야 env 파서가 공백을 남긴다.
    await withRoot({ web: { ...WEB_BASE, API_CURSOR_SECRET: `"${value}"` } }, async (root) => {
      const result = await checkEnv({ root });
      assert.deepEqual(
        result.problems.map(({ file, key, code }) => [file, key, code]),
        [["web/.env.local", "API_CURSOR_SECRET", "INVALID_FORMAT"]],
        JSON.stringify(value),
      );
    });
  }
  await withRoot(
    { web: { ...WEB_BASE, API_CURSOR_SECRET: `"  ${"s".repeat(32)}  "` } },
    async (root) => {
      assert.equal((await checkEnv({ root })).ok, true);
    },
  );
});

test("Supabase Storage replacement does not require MinIO credentials or endpoint", async () => {
  const infra = { ...INFRA_BASE };
  delete infra.MINIO_ROOT_USER;
  delete infra.MINIO_ROOT_PASSWORD;
  const web = { ...WEB_BASE };
  delete web.MINIO_ENDPOINT;
  await withRoot({ infra, web }, async (root) => {
    assert.equal((await checkEnv({ root })).ok, true);
  });
});

test("redis-api accepts Worker health reports without a direct AI gateway URL", async () => {
  const web = { ...WEB_BASE, SOL_DEPLOYMENT_ROLE: "redis-api", REDIS_API_TOKEN: "a".repeat(64) };
  delete web.MINIO_ENDPOINT;
  delete web.AI_GATEWAY_URL;
  await withRoot({ web }, async (root) => {
    assert.equal((await checkEnv({ root })).ok, true);
  });
});
