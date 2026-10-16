// 로컬 Supabase 켜고 끄기(scripts/db-local.mjs) 통합 테스트. 실행: 루트에서 `pnpm test`
//
// 진짜 Supabase CLI·Docker 는 부르지 않는다. 임시 루트에 db-local.mjs·local-env.mjs 를 복사하고
// web/·mobile/ 의 package.json·.env.example 을 만든 뒤, PATH 에는 가짜 supabase 하나만 둔다.
// 가짜는 받은 인자를 한 줄씩 기록하고 `status -o env` 에는 정해 둔 값을 낸다(sh 내장 명령만 쓴다).
// 폰 주소는 --host 로 넘겨 이 컴퓨터의 네트워크와 상관없이 같은 결과를 낸다. macOS·Linux 에서 돈다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { writeExecutable } from "../test-support.mjs";

// scripts/ 의 스크립트를 복사한다(변형 시험에서 복사본을 바꿔 돌릴 수 있게).
const here = join(dirname(fileURLToPath(import.meta.url)), "..");

const HOST = "192.168.0.10";
const ANON = "anon-zz-3307";
const PUBLISHABLE = "pub-zz-9902";
const STATUS = {
  API_URL: "http://127.0.0.1:54321",
  ANON_KEY: ANON,
  PUBLISHABLE_KEY: PUBLISHABLE,
  STUDIO_URL: "http://127.0.0.1:54323",
  MAILPIT_URL: "http://127.0.0.1:54324",
  // 아래는 env 파일·화면 어디에도 나오면 안 되는 값. 이름에 SERVICE_ROLE·SECRET_KEY 가 든 값은 20자 미만(가드 규칙).
  SERVICE_ROLE_KEY: "svc-zz-7781",
  SECRET_KEY: "sec-zz-4410",
  JWT_SECRET: "jwt-zz-1203",
  DB_URL: "postgresql://postgres:dbpw-zz-5520@127.0.0.1:54322/postgres",
};
const LEAKS = ["svc-zz-7781", "sec-zz-4410", "jwt-zz-1203", "dbpw-zz-5520"];

const WEB_EXAMPLE = [
  "# 웹 예시",
  "NEXT_PUBLIC_SUPABASE_URL=",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
  "",
  "# SUPABASE_SERVICE_ROLE_KEY=",
  "",
].join("\n");
const MOBILE_EXAMPLE = [
  "# 앱 예시",
  "EXPO_PUBLIC_SUPABASE_URL=",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY=",
  "",
].join("\n");
const WEB_EXPECTED = [
  "# 웹 예시",
  "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
  `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}`,
  "",
  "# SUPABASE_SERVICE_ROLE_KEY=",
  "",
].join("\n");
const MOBILE_EXPECTED = [
  "# 앱 예시",
  `EXPO_PUBLIC_SUPABASE_URL=http://${HOST}:54321`,
  `EXPO_PUBLIC_SUPABASE_ANON_KEY=${ANON}`,
  "",
].join("\n");

// 받은 인자를 기록하고, status 에는 STATUS 를 env 꼴로 낸다. FAKE_SUPABASE_FAIL 에 적은 명령은 1 로 끝난다.
const FAKE_CLI = [
  "#!/bin/sh",
  'printf \'%s\\n\' "$*" >> "$FAKE_SUPABASE_LOG"',
  'if [ "$1" = "$FAKE_SUPABASE_FAIL" ]; then exit 1; fi',
  "if [ \"$1\" = \"--version\" ]; then printf '%s\\n' '9.9.9-fake'; fi",
  'if [ "$1" = "status" ]; then',
  ...Object.entries(STATUS).map(([key, value]) => `  printf '%s\\n' '${key}="${value}"'`),
  "fi",
  "exit 0",
  "",
].join("\n");

// 임시 루트(repo)와 가짜 CLI 폴더(bin)를 만든다. files 로 repo 안 파일을 더하거나(문자열) 빼게(null) 한다.
const makeProject = (files = {}) => {
  const base = mkdtempSync(join(tmpdir(), "db-local-test-"));
  const root = join(base, "repo");
  const bin = join(base, "bin");
  const emptyBin = join(base, "empty-bin");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(bin);
  mkdirSync(emptyBin);
  ["db-local.mjs", "local-env.mjs", "command.mjs"].forEach((file) =>
    copyFileSync(join(here, file), join(root, "scripts", file)),
  );
  writeExecutable(join(bin, "supabase"), FAKE_CLI);
  Object.entries({
    "web/package.json": "{}\n",
    "web/.env.example": WEB_EXAMPLE,
    "mobile/package.json": "{}\n",
    "mobile/.env.example": MOBILE_EXAMPLE,
    ...files,
  })
    .filter(([, content]) => content !== null)
    .forEach(([path, content]) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    });
  return { base, root, bin, emptyBin, log: join(base, "supabase-calls.log") };
};

const removeProject = (project) => rmSync(project.base, { recursive: true, force: true });

const tempProject = (t, files) => {
  const project = makeProject(files);
  t.after(() => removeProject(project));
  return project;
};

// 테스트 러너의 내부 변수는 넘기지 않는다. PATH 는 가짜 CLI 폴더 하나뿐이라 진짜 supabase 가 끼지 않는다.
const run = (project, args, { path = project.bin, fail = "" } = {}) => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST")),
  );
  const result = spawnSync(
    process.execPath,
    [join(project.root, "scripts/db-local.mjs"), ...args],
    {
      cwd: project.root,
      encoding: "utf8",
      env: { ...env, PATH: path, FAKE_SUPABASE_LOG: project.log, FAKE_SUPABASE_FAIL: fail },
    },
  );
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};

const calls = (project) =>
  existsSync(project.log) ? readFileSync(project.log, "utf8").split("\n").filter(Boolean) : [];

const read = (project, path) => readFileSync(join(project.root, path), "utf8");
const exists = (project, path) => existsSync(join(project.root, path));

const allFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? allFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );

describe("db:start — 켜고 웹·앱 env 파일에 주소·anon 키를 적는다", () => {
  const project = makeProject();
  const state = {};
  before(() => {
    state.result = run(project, ["start", "--host", HOST]);
  });
  after(() => removeProject(project));

  it("0 으로 끝난다", () => {
    assert.equal(state.result.code, 0, state.result.stderr);
  });

  it("CLI 를 --version → start → migration up --local → status -o env 순서로 부른다", () => {
    assert.deepEqual(calls(project), [
      "--version",
      "start",
      "migration up --local",
      "status -o env",
    ]);
  });

  it("web/.env.local 을 .env.example 바탕으로 만들고 주소·anon 키를 적는다", () => {
    assert.equal(read(project, "web/.env.local"), WEB_EXPECTED);
  });

  it("mobile/.env 에는 --host 로 받은 PC 주소를 적는다", () => {
    assert.equal(read(project, "mobile/.env"), MOBILE_EXPECTED);
  });

  it("service_role·secret 키·JWT secret·DB 비밀번호는 어떤 파일·출력에도 없다", () => {
    const outputs = [
      ["stdout", state.result.stdout],
      ["stderr", state.result.stderr],
      ...allFiles(project.root).map((file) => [file, readFileSync(file, "utf8")]),
    ];
    outputs.forEach(([where, text]) =>
      LEAKS.forEach((value) =>
        assert.equal(text.includes(value), false, `${value} 가 ${where} 에 있다`),
      ),
    );
  });

  it("anon·publishable 키 값은 화면에 찍지 않는다", () => {
    const printed = `${state.result.stdout}${state.result.stderr}`;
    [ANON, PUBLISHABLE].forEach((value) => assert.equal(printed.includes(value), false, value));
  });
});

describe("db:start — 다시 돌려도 같다", () => {
  it("두 번째 실행은 env 파일을 바꾸지 않는다", (t) => {
    const project = tempProject(t);
    assert.equal(run(project, ["start", "--host", HOST]).code, 0);
    const second = run(project, ["start", "--host", HOST]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(read(project, "web/.env.local"), WEB_EXPECTED);
    assert.equal(read(project, "mobile/.env"), MOBILE_EXPECTED);
  });
});

// 초대 메일(web/server/organization)을 로컬 메일함으로 보내는 값. 포트와 웹 주소의 정본은 supabase/config.toml 이다.
const CONFIG_TOML = [
  "[local_smtp]",
  "smtp_port = 54325",
  "",
  "[auth]",
  'site_url = "http://localhost:3000"',
  "",
].join("\n");
const MAIL_LINES = [
  "SMTP_HOST=127.0.0.1",
  "SMTP_PORT=54325",
  "MAIL_FROM=no-reply@example.com",
  "SITE_URL=http://localhost:3000",
];
const WEB_WITH_MAIL = `${WEB_EXPECTED}${MAIL_LINES.join("\n")}\n`;

describe("db:start — 초대 메일을 로컬 메일함으로 보내는 값은 웹에만, 비어 있을 때만 적는다", () => {
  it("config.toml 의 메일함 SMTP 포트·웹 주소와 메일함 호스트를 web/.env.local 끝에 적고 알린다", (t) => {
    const project = tempProject(t, { "supabase/config.toml": CONFIG_TOML });
    const result = run(project, ["start", "--host", HOST]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(read(project, "web/.env.local"), WEB_WITH_MAIL);
    assert.match(result.stdout, /메일함 SMTP\(127\.0\.0\.1:54325\)/);
    assert.match(result.stdout, /http:\/\/localhost:3000/);
  });

  it("앱(mobile/.env)에는 메일 값을 적지 않는다", (t) => {
    const project = tempProject(t, { "supabase/config.toml": CONFIG_TOML });
    assert.equal(run(project, ["start", "--host", HOST]).code, 0);
    assert.equal(read(project, "mobile/.env"), MOBILE_EXPECTED);
  });

  it("다시 돌리면 파일을 바꾸지 않고 메일 안내도 다시 내지 않는다", (t) => {
    const project = tempProject(t, { "supabase/config.toml": CONFIG_TOML });
    assert.equal(run(project, ["start", "--host", HOST]).code, 0);
    const second = run(project, ["start", "--host", HOST]);
    assert.equal(second.code, 0, second.stderr);
    assert.equal(read(project, "web/.env.local"), WEB_WITH_MAIL);
    assert.doesNotMatch(second.stdout, /메일함 SMTP/);
  });

  it("손으로 적은 메일 설정이 있으면 메일 값은 하나도 건드리지 않고 Supabase 값만 적는다", (t) => {
    const handWritten = [
      "NEXT_PUBLIC_SUPABASE_URL=",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
      "SMTP_HOST=smtp.example.com",
      "SMTP_PORT=587",
      "",
    ].join("\n");
    const project = tempProject(t, {
      "supabase/config.toml": CONFIG_TOML,
      "web/.env.local": handWritten,
    });
    const result = run(project, ["start", "--host", HOST]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(
      read(project, "web/.env.local"),
      [
        "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
        `NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}`,
        "SMTP_HOST=smtp.example.com",
        "SMTP_PORT=587",
        "",
      ].join("\n"),
    );
    assert.doesNotMatch(result.stdout, /메일함 SMTP/);
  });

  it("config.toml 에 메일함 SMTP 포트가 없으면 메일 값을 적지 않는다", (t) => {
    const project = tempProject(t, {
      "supabase/config.toml": ["[auth]", 'site_url = "http://localhost:3000"', ""].join("\n"),
    });
    assert.equal(run(project, ["start", "--host", HOST]).code, 0);
    assert.equal(read(project, "web/.env.local"), WEB_EXPECTED);
  });
});

describe("db:start — 클라우드 값이 든 env 파일은 건드리지 않는다", () => {
  const CLOUD_WEB = [
    "# 운영 프로젝트",
    "NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=cloud-anon-zz",
    "OTHER=1",
    "",
  ].join("\n");
  const project = makeProject({ "web/.env.local": CLOUD_WEB });
  const original = readFileSync(join(project.root, "web/.env.local"));
  const state = {};
  before(() => {
    state.result = run(project, ["start", "--host", HOST]);
  });
  after(() => removeProject(project));

  it("1 로 끝나고 건너뛴 파일을 알린다", () => {
    assert.equal(state.result.code, 1);
    assert.match(state.result.stderr, /web\/\.env\.local/);
  });

  it("web/.env.local 은 바이트 그대로다", () => {
    assert.deepEqual(readFileSync(join(project.root, "web/.env.local")), original);
  });

  it("클라우드 값이 없는 mobile/.env 는 정상으로 적는다", () => {
    assert.equal(read(project, "mobile/.env"), MOBILE_EXPECTED);
  });
});

describe("db:start — 실패와 생략", () => {
  it("PATH 에 supabase CLI 가 없으면 설치 안내를 내고 1 로 끝나며 env 파일을 만들지 않는다", (t) => {
    const project = tempProject(t);
    const result = run(project, ["start", "--host", HOST], { path: project.emptyBin });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Supabase CLI/);
    assert.equal(exists(project, "web/.env.local"), false);
    assert.equal(exists(project, "mobile/.env"), false);
  });

  it("인자가 틀리면 2 로 끝나고 CLI 를 부르지 않는다", (t) => {
    const project = tempProject(t);
    [["start", "--host", "1.2.3"], ["restart"], [], ["start", "--verbose"]].forEach((args) => {
      const result = run(project, args);
      assert.equal(result.code, 2, JSON.stringify(args));
      assert.match(result.stderr, /사용법/, JSON.stringify(args));
    });
    assert.deepEqual(calls(project), []);
  });

  it("supabase start 가 실패하면 1 로 끝나고 다음 단계로 가지 않으며 env 파일을 만들지 않는다", (t) => {
    const project = tempProject(t);
    const result = run(project, ["start", "--host", HOST], { fail: "start" });
    assert.equal(result.code, 1);
    assert.deepEqual(calls(project), ["--version", "start"]);
    assert.equal(exists(project, "web/.env.local"), false);
    assert.equal(exists(project, "mobile/.env"), false);
  });

  it("web/package.json 이 없으면 web env 파일은 만들지 않는다", (t) => {
    const project = tempProject(t, { "web/package.json": null });
    const result = run(project, ["start", "--host", HOST]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(exists(project, "web/.env.local"), false);
    assert.equal(read(project, "mobile/.env"), MOBILE_EXPECTED);
  });
});

describe("db:stop — 끈다 (데이터는 남긴다)", () => {
  const project = makeProject();
  const state = {};
  before(() => {
    state.result = run(project, ["stop"]);
  });
  after(() => removeProject(project));

  it("0 으로 끝난다", () => {
    assert.equal(state.result.code, 0, state.result.stderr);
  });

  it("CLI 에 stop 만 넘기고 --no-backup 은 넘기지 않는다", () => {
    const stopCalls = calls(project).filter((line) => line !== "--version");
    assert.deepEqual(stopCalls, ["stop"]);
    assert.equal(
      calls(project).some((line) => line.includes("--no-backup")),
      false,
    );
  });

  it("env 파일은 만들지 않는다", () => {
    assert.equal(exists(project, "web/.env.local"), false);
    assert.equal(exists(project, "mobile/.env"), false);
  });
});
