// 앱 Expo 점검(scripts/check-expo.mjs) 테스트. 실행: 루트에서 `pnpm test`
//
// expo-doctor 는 받은 EXPO_* 환경변수만 적어 두는 가짜로 바꿔 끼운다. 진짜 점검 결과는 mobile 의 verify 가 본다.
// 연결 확인 주소는 --api 로 바꾼다. 닿는 주소는 data: URL, 닿지 않는 주소는 닫힌 로컬 포트다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { writeExecutable } from "../test-support.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const REACHABLE = "data:,ok";
const UNREACHABLE = "http://127.0.0.1:1";

// 커밋 게이트·개발자 셸에서 넘어온 GIT_*·EXPO_* 값이 섞이지 않게 걷어낸다.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith("GIT_") && !key.startsWith("EXPO_"),
  ),
);

// PATH 는 샌드박스 폴더 하나만 준다(그래야 '없는 expo-doctor' 를 만들 수 있다). 가짜 안에서는 시스템 도구를 쓴다.
const FAKE_DOCTOR = `#!/bin/sh
PATH=/usr/bin:/bin
env | grep '^EXPO_' | sort > "$DOCTOR_LOG"
exit "\${FAKE_DOCTOR_EXIT:-0}"
`;

const createSandbox = (t, { doctor = true } = {}) => {
  const base = mkdtempSync(join(tmpdir(), "check-expo-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  if (doctor) {
    writeExecutable(join(base, "expo-doctor"), FAKE_DOCTOR);
  }
  return { bin: base, log: join(base, "doctor.log") };
};

const runCheck = ({ bin, log }, { api = REACHABLE, env = {}, doctorExit = 0 } = {}) => {
  const result = spawnSync(process.execPath, [join(root, "scripts/check-expo.mjs"), "--api", api], {
    encoding: "utf8",
    env: {
      ...cleanEnv,
      ...env,
      PATH: bin,
      DOCTOR_LOG: log,
      FAKE_DOCTOR_EXIT: String(doctorExit),
    },
  });
  const seen = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : undefined;
  return { code: result.status, output: `${result.stdout}${result.stderr}`, seen };
};

describe("expo-doctor 결과를 그대로 따른다", () => {
  it("통과하면 통과한다", (t) => {
    const { code, seen } = runCheck(createSandbox(t));

    assert.equal(code, 0);
    assert.ok(seen, "expo-doctor 가 불리지 않았다");
  });

  it("실패하면 실패하고 고치는 방법을 알린다", (t) => {
    const { code, output } = runCheck(createSandbox(t), { doctorExit: 1 });

    assert.equal(code, 1);
    assert.match(output, /\[차단\] Expo 점검/);
    assert.match(output, /expo install --fix/);
    assert.match(output, /app\.json/);
  });

  it("expo-doctor 가 없으면 설치하라고 알리고 실패한다", (t) => {
    const { code, output } = runCheck(createSandbox(t, { doctor: false }));

    assert.equal(code, 1);
    assert.match(output, /pnpm -C mobile install/);
  });
});

describe("오프라인에서 조용히 통과하지 않는다", () => {
  it("Expo API 에 닿지 않으면 expo-doctor 를 부르지 않고 실패한다", (t) => {
    const { code, output, seen } = runCheck(createSandbox(t), { api: UNREACHABLE });

    assert.equal(code, 1);
    assert.equal(seen, undefined);
    assert.match(output, /네트워크가 필요합니다/);
  });

  it("점검을 느슨하게 만드는 환경변수를 걷어내고 .env 읽기를 끈다", (t) => {
    const { code, seen } = runCheck(createSandbox(t), {
      env: {
        EXPO_DOCTOR_SKIP_DEPENDENCY_VERSION_CHECK: "1",
        EXPO_DOCTOR_WARN_ON_NETWORK_ERRORS: "1",
        EXPO_STAGING: "1",
        EXPO_LOCAL: "1",
        EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      },
    });

    assert.equal(code, 0);
    assert.deepEqual(seen, [
      "EXPO_NO_DOTENV=1",
      "EXPO_OFFLINE=1",
      "EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co",
    ]);
  });
});

describe("Expo 가 새 패치를 내도 결과가 바뀌지 않는다", () => {
  it("권장 버전을 설치된 expo 의 목록에서 읽게 한다 — 밖에서 꺼도 다시 켠다", (t) => {
    const { code, seen } = runCheck(createSandbox(t), { env: { EXPO_OFFLINE: "0" } });

    assert.equal(code, 0);
    assert.ok(seen.includes("EXPO_OFFLINE=1"), seen.join(" "));
  });
});

// 앱 폴더를 지운 프로젝트에서는 건너뛴다.
const mobilePackage = join(root, "mobile", "package.json");
describe("앱 검증에 연결돼 있다", { skip: !existsSync(mobilePackage) && "mobile/ 이 없다" }, () => {
  const read = () => JSON.parse(readFileSync(mobilePackage, "utf8"));

  it("full verify 는 빌드 전에 Expo 점검을 돈다", () => {
    const { scripts } = read();
    const steps = scripts.verify.split(" && ");

    assert.match(scripts["check:expo"], /scripts\/check-expo\.mjs/);
    assert.ok(steps.includes("pnpm check:expo"), scripts.verify);
    assert.ok(steps.indexOf("pnpm check:expo") < steps.indexOf("pnpm build"), scripts.verify);
  });

  it("커밋 게이트(verify:quick)에는 넣지 않는다 — 네트워크가 필요하고 수 초를 넘긴다", () => {
    assert.doesNotMatch(read().scripts["verify:quick"], /check:expo/);
  });

  it("expo-doctor 버전은 범위가 아니라 하나로 고정한다", () => {
    assert.match(read().devDependencies["expo-doctor"] ?? "", /^\d+\.\d+\.\d+$/);
  });
});
