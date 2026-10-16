// 루트 검증(scripts/verify.mjs) 테스트. 실행: 루트에서 `pnpm test`
//
// 임시 폴더에 verify.mjs 를 복사해 돌린다. pnpm 은 호출 인자만 적어 두는 가짜로 바꿔 끼운다 —
// 각 폴더의 검사 자체가 맞는지는 그 폴더의 verify 가 본다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pathWith, writeExecutable } from "../test-support.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// 커밋 게이트가 이 테스트를 부를 때 git 이 넘긴 GIT_* 값이 섞이지 않게 걷어낸다.
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const FAKE_PNPM = `#!/bin/sh
case "$PWD" in
  */web) set -- -C web "$@" ;;
  */mobile) set -- -C mobile "$@" ;;
esac
echo "$*" >> "$PNPM_LOG"
[ "$*" = "$FAKE_PNPM_FAIL_ON" ] && exit 1
exit 0
`;

// folders: package.json 을 둘 앱 폴더 목록 (web·mobile 중 일부)
const createSandbox = (t, folders) => {
  const base = mkdtempSync(join(tmpdir(), "verify-test-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const project = join(base, "project");
  const bin = join(base, "bin");
  mkdirSync(join(project, "scripts"), { recursive: true });
  mkdirSync(bin);
  for (const file of ["verify.mjs", "project-config.mjs", "command.mjs"])
    copyFileSync(join(root, "scripts", file), join(project, "scripts", file));
  copyFileSync(join(root, "verify.config.json"), join(project, "verify.config.json"));
  folders.forEach((folder) => {
    mkdirSync(join(project, folder));
    writeFileSync(join(project, folder, "package.json"), "{}\n");
  });
  writeExecutable(join(bin, "pnpm"), FAKE_PNPM);

  return { project, bin, log: join(base, "pnpm.log") };
};

const runVerify = ({ project, bin, log }, { args = [], failOn = "" } = {}) => {
  const result = spawnSync(process.execPath, ["scripts/verify.mjs", ...args], {
    cwd: project,
    encoding: "utf8",
    env: {
      ...cleanEnv,
      PATH: pathWith(bin, cleanEnv.PATH),
      PNPM_LOG: log,
      FAKE_PNPM_FAIL_ON: failOn,
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { code: result.status, output: `${result.stdout}${result.stderr}`, calls };
};

// 공통 검사 목록은 샌드박스에 복사하는 verify.config.json 에서 읽는다. 여기서 검사하는 것은 실행기가
// "공통 검사 → 있는 폴더" 순서로 돈다는 점이지 공통 검사의 이름이 아니다. 목록을 손으로 적어 두면
// 공통 검사를 하나 더할 때마다 이 테스트가 깨진다(check:db-types·format:check 때 실제로 깨졌다).
const COMMON = JSON.parse(
  readFileSync(join(root, "verify.config.json"), "utf8"),
).verification.common.map(({ args }) => args.join(" "));
// 실패 지점 시험에 쓰는 중간 단계. 그 앞까지만 돌고 멈춰야 한다.
const MIDDLE = "check:tokens";

describe("있는 폴더만 검증한다", () => {
  it("web·mobile 이 다 있으면 공통 검사 뒤에 둘 다 검사한다", (t) => {
    const { code, calls } = runVerify(createSandbox(t, ["web", "mobile"]));

    assert.equal(code, 0);
    assert.deepEqual(calls, [...COMMON, "-C web verify", "-C mobile verify"]);
  });

  it("--quick 이면 각 폴더의 verify:quick 을 부른다", (t) => {
    const { code, calls } = runVerify(createSandbox(t, ["web", "mobile"]), { args: ["--quick"] });

    assert.equal(code, 0);
    assert.deepEqual(calls, [...COMMON, "-C web verify:quick", "-C mobile verify:quick"]);
  });

  it("web 만 있으면 mobile 은 건너뛰고 그렇다고 알린다", (t) => {
    const { code, calls, output } = runVerify(createSandbox(t, ["web"]));

    assert.equal(code, 0);
    assert.deepEqual(calls, [...COMMON, "-C web verify"]);
    assert.match(output, /mobile.*건너뜁니다/);
  });

  it("mobile 만 있으면 web 은 건너뛴다", (t) => {
    const { code, calls } = runVerify(createSandbox(t, ["mobile"]));

    assert.equal(code, 0);
    assert.deepEqual(calls, [...COMMON, "-C mobile verify"]);
  });

  it("package.json 이 없는 폴더는 없는 것으로 본다", (t) => {
    const sandbox = createSandbox(t, ["web"]);
    mkdirSync(join(sandbox.project, "mobile"));

    const { calls } = runVerify(sandbox);

    assert.deepEqual(calls, [...COMMON, "-C web verify"]);
  });
});

describe("실패하면 멈춘다", () => {
  it("중간 단계가 실패하면 뒤 단계는 돌리지 않고 실패로 끝난다", (t) => {
    const { code, calls, output } = runVerify(createSandbox(t, ["web", "mobile"]), {
      failOn: MIDDLE,
    });

    assert.notEqual(code, 0);
    assert.deepEqual(calls, COMMON.slice(0, COMMON.indexOf(MIDDLE) + 1));
    assert.match(output, /check:tokens/);
  });

  it("폴더 검사가 실패해도 실패로 끝난다", (t) => {
    const { code, calls } = runVerify(createSandbox(t, ["web", "mobile"]), {
      failOn: "-C web verify",
    });

    assert.notEqual(code, 0);
    assert.deepEqual(calls, [...COMMON, "-C web verify"]);
  });
});

describe("다른 스택 등록", () => {
  it("실행기를 고치지 않고 설정의 별도 프로젝트를 검증한다", (t) => {
    const s = createSandbox(t, []);
    const configPath = join(s.project, "verify.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    mkdirSync(join(s.project, "backend"));
    writeFileSync(join(s.project, "backend", "pyproject.toml"), "[project]\n");
    config.verification.projects = [
      {
        name: "backend",
        directory: "backend",
        marker: "pyproject.toml",
        verify: { command: "pnpm", args: ["backend-test"] },
        quick: { command: "pnpm", args: ["backend-quick"] },
      },
    ];
    writeFileSync(configPath, JSON.stringify(config));
    const result = runVerify(s);
    assert.equal(result.code, 0, result.output);
    assert.deepEqual(result.calls, [...COMMON, "backend-test"]);
  });
  it("잘못된 설정은 어떤 검증도 실행하기 전에 거부한다", (t) => {
    const s = createSandbox(t, ["web"]);
    const configPath = join(s.project, "verify.config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.verification.projects[0].directory = "../outside";
    writeFileSync(configPath, JSON.stringify(config));
    const result = runVerify(s);
    assert.notEqual(result.code, 0);
    assert.deepEqual(result.calls, []);
  });
});
