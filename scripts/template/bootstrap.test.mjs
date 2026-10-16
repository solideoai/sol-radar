import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  planCopy,
  readTomlString,
  removeJsonScript,
  runBootstrap,
  setTomlString,
  TEMPLATE_DEFAULTS,
  TEMPLATE_ONLY_SCRIPTS,
} from "./bootstrap.mjs";
import { loadConfig, presentProjects } from "../project-config.mjs";
import { permissionSkip, symlinkSkip } from "../test-support.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const real = (path) => readFileSync(join(REPO, path));
// 한쪽만 고른 프로젝트에서는 없는 플랫폼의 파일을 아래 고정 bytes 로 대신한다. 판정은 verify 와 같은 marker 기준이다.
// bootstrap 으로 만든 프로젝트(이름이 템플릿 기본값이 아님)는 메타데이터도 기본값을 가진 고정 bytes 를 쓴다.
const PRESENT = new Set(
  presentProjects(REPO, loadConfig(REPO)).map((project) => project.directory),
);
const ROOT_PACKAGE = JSON.parse(real("package.json"));
const IS_TEMPLATE = ROOT_PACKAGE.name === TEMPLATE_DEFAULTS.name;
const METADATA = new Set([
  "web/package.json",
  "web/project.json",
  "mobile/package.json",
  "mobile/app.json",
]);
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;
const FIXED = {
  "web/package.json": jsonBytes({
    name: TEMPLATE_DEFAULTS.webPackage,
    private: true,
    scripts: { dev: "next dev" },
  }),
  "web/project.json": jsonBytes({ title: TEMPLATE_DEFAULTS.name, description: "설명" }),
  "web/app/layout.tsx": 'import project from "@/project.json";\nexport const metadata = project;\n',
  "web/app/globals.css": "/* 생성물 */\n",
  "web/lib/database.types.ts": "export type Database = {};\n",
  "mobile/package.json": jsonBytes({
    name: TEMPLATE_DEFAULTS.mobilePackage,
    private: true,
    scripts: { start: "expo start" },
  }),
  "mobile/app.json": jsonBytes({
    expo: {
      name: TEMPLATE_DEFAULTS.name,
      slug: TEMPLATE_DEFAULTS.name,
      scheme: TEMPLATE_DEFAULTS.scheme,
      ios: { supportsTablet: true, bundleIdentifier: TEMPLATE_DEFAULTS.appId },
      android: { package: TEMPLATE_DEFAULTS.appId },
    },
  }),
  "mobile/theme/tokens.ts": "// 생성물\nexport const colors = {};\n",
  "mobile/lib/database.types.ts": "export type Database = {};\n",
};
const platformFile = (path) =>
  PRESENT.has(path.split("/")[0]) && (IS_TEMPLATE || !METADATA.has(path))
    ? real(path)
    : FIXED[path];
const scratch = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const fresh = (name) => mkdtempSync(join(scratch, `${name}-`));

// 템플릿의 메타데이터·생성물은 실제 bytes 를 쓰고, 나머지는 작은 가짜 파일로 채운다.
const TEMPLATE = {
  "package.json": IS_TEMPLATE
    ? real("package.json")
    : jsonBytes({ ...ROOT_PACKAGE, name: TEMPLATE_DEFAULTS.name }),
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  "verify.config.json": real("verify.config.json"),
  ".gitignore": real(".gitignore"),
  ".env.example": "NEXT_PUBLIC_SUPABASE_URL=\n",
  "AGENTS.md": "# 규칙\n",
  "README.md": "# 시작\n\n[첫 배포](docs/first-deployment.md)\n",
  "docs/first-deployment.md": "# 첫 배포 안내\n",
  "design/tokens.json": "{}\n",
  "supabase/migrations/20260101000001_init.sql": "select 1;\n",
  "supabase/config.toml": IS_TEMPLATE
    ? real("supabase/config.toml")
    : `# 로컬 Supabase\nproject_id = "${TEMPLATE_DEFAULTS.name}"\n\n[db]\nmajor_version = 17\n`,
  "scripts/verify.mjs": "// verify\n",
  ".claude/settings.json": "{}\n",
  ".claude/commands/spec.md": "# spec\n",
  "web/package.json": platformFile("web/package.json"),
  "web/pnpm-lock.yaml": "lockfileVersion: '9.0'\n# web\n",
  "web/project.json": platformFile("web/project.json"),
  "web/app/layout.tsx": platformFile("web/app/layout.tsx"),
  "web/app/globals.css": platformFile("web/app/globals.css"),
  "web/lib/database.types.ts": platformFile("web/lib/database.types.ts"),
  "mobile/package.json": platformFile("mobile/package.json"),
  "mobile/pnpm-lock.yaml": "lockfileVersion: '9.0'\n# mobile\n",
  "mobile/app.json": platformFile("mobile/app.json"),
  "mobile/theme/tokens.ts": platformFile("mobile/theme/tokens.ts"),
  "mobile/lib/database.types.ts": platformFile("mobile/lib/database.types.ts"),
};
// 템플릿 저장소만 쓰는 것. 원본에는 있지만 새 프로젝트로 복사하지 않는다.
const TEMPLATE_ONLY = {
  "scripts/template/bootstrap.mjs": "// bootstrap\n",
  "scripts/template/docs.test.mjs": "// 문서 대조 시험\n",
  "scripts/template/smoke-template.mjs": "// smoke\n",
  ".github/workflows/template.yml": "name: template\n",
};
const HOOK = ".husky/pre-commit";
const SECRET = "SUPABASE_SERVICE_ROLE_KEY=secret-sentinel\n";
// 복사하면 안 되는 것들
const NOISE = {
  "web/.env.local": SECRET,
  ".env": SECRET,
  "node_modules/husky/index.js": "x",
  "web/node_modules/next/index.js": "x",
  "web/.next/cache.txt": "x",
  "web/coverage/index.html": "x",
  "web/tsconfig.tsbuildinfo": "x",
  "mobile/.expo/state.json": "x",
  "mobile/ios/Podfile": "x",
  "reports/postmortem.md": "# 사후 기록\n",
  "polaris/mission.md": "# 미션\n",
  ".claude/settings.local.json": "{}",
  ".claude/commands/spec 2.md": "# 사용자 사본\n",
  ".DS_Store": "x",
  "notes.txt": "내 메모\n",
};

const put = (root, files) => {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
};

function makeTemplate(extra = {}) {
  const root = fresh("template");
  put(root, { ...TEMPLATE, ...TEMPLATE_ONLY, ...NOISE, ...extra });
  put(root, { [HOOK]: "#!/bin/sh\nexit 0\n" });
  chmodSync(join(root, HOOK), 0o755);
  return root;
}

const GIT_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
const git = (root, ...args) => {
  const result = spawnSync(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    {
      cwd: root,
      encoding: "utf8",
      // 사용자 전역 설정(훅 경로·서명)이 fixture 커밋에 끼어들지 않게 한다
      env: {
        ...GIT_ENV,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: join(scratch, "no-gitconfig"),
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

function makeGitTemplate() {
  const root = makeTemplate();
  git(root, "init", "-q");
  git(
    root,
    "add",
    "--",
    ...Object.keys(TEMPLATE),
    ...Object.keys(TEMPLATE_ONLY),
    HOOK,
    "reports/postmortem.md",
  );
  git(root, "commit", "-q", "-m", "init");
  return root;
}

// 원본 상태(.git 밖 파일 bytes 전체 + git 인덱스)를 찍는다.
function snapshot(root) {
  const files = {};
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (path === ".git") continue;
      if (entry.isDirectory()) walk(path);
      else files[path] = readFileSync(join(root, path), "utf8");
    }
  };
  walk("");
  const index = existsSync(join(root, ".git/index"))
    ? readFileSync(join(root, ".git/index")).toString("base64")
    : null;
  return { files, index };
}

function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk("");
  return files.sort();
}

function run(root, argv, options = {}) {
  const out = [];
  const err = [];
  const code = runBootstrap(argv, {
    root,
    cwd: options.cwd ?? scratch,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    hooks: options.hooks,
  });
  return { code, stdout: out.join("\n"), stderr: err.join("\n") };
}

const json = (root, path) => JSON.parse(readFileSync(join(root, path), "utf8"));
const target = (name) => join(fresh("out"), name);

function assertNoNoise(dest) {
  for (const path of [...Object.keys(NOISE), ...Object.keys(TEMPLATE_ONLY)])
    assert.ok(!existsSync(join(dest, path)), `${path} 복사됨`);
  for (const path of listFiles(dest))
    assert.ok(!readFileSync(join(dest, path), "utf8").includes("secret-sentinel"), path);
}

describe("세 mode 로 새 프로젝트를 만든다 (ZIP 원본)", () => {
  const GENERATED = {
    web: ["web/app/globals.css", "web/lib/database.types.ts"],
    mobile: ["mobile/theme/tokens.ts", "mobile/lib/database.types.ts"],
  };
  for (const [mode, platforms] of [
    ["web", ["web"]],
    ["mobile", ["mobile"]],
    ["both", ["web", "mobile"]],
  ]) {
    test(`--mode ${mode}: 고른 플랫폼과 공통 가드레일·문서만 같은 bytes 로 복사한다`, () => {
      const root = makeTemplate();
      const before = snapshot(root);
      const dest = target("새 프로젝트 한글");
      const result = run(root, [dest, "--name", "my-app", "--mode", mode]);
      assert.equal(result.code, 0, result.stderr);
      for (const dir of ["web", "mobile"])
        assert.equal(existsSync(join(dest, dir)), platforms.includes(dir), dir);
      for (const path of [
        "README.md",
        "docs/first-deployment.md",
        "supabase/migrations/20260101000001_init.sql",
        "design/tokens.json",
        ".env.example",
        "pnpm-lock.yaml",
        "verify.config.json",
        ".claude/commands/spec.md",
        ...platforms.flatMap((platform) => [...GENERATED[platform], `${platform}/pnpm-lock.yaml`]),
      ])
        assert.deepEqual(readFileSync(join(dest, path)), readFileSync(join(root, path)), path);
      const link = readFileSync(join(dest, "README.md"), "utf8").match(/\]\((docs\/[^)]+)\)/)[1];
      assert.ok(existsSync(join(dest, link)), "README 의 링크 대상이 함께 온다");
      if (!permissionSkip) assert.ok(statSync(join(dest, HOOK)).mode & 0o100, "실행 권한 유지");
      assertNoNoise(dest);
      assert.deepEqual(snapshot(root), before, "원본은 그대로");
      assert.match(result.stdout, /git init/);
      assert.match(result.stdout, /pnpm run doctor/);
      assert.match(result.stdout, /pnpm verify/);
      assert.match(result.stdout, /cd '.*새 프로젝트 한글'/);
      assert.equal(result.stdout.includes("pnpm -C web dev"), platforms.includes("web"));
      assert.equal(result.stdout.includes("pnpm -C mobile start"), platforms.includes("mobile"));
    });
  }

  test("ZIP 원본은 커밋을 모르므로 template.json 의 commit 을 비운다", () => {
    const root = makeTemplate();
    const dest = target("app");
    const result = run(root, [dest, "--name", "app"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(json(dest, "template.json").commit, "");
    assert.match(result.stdout, /템플릿 커밋 없음 — ZIP 원본/);
  });

  test("docs/ 가 아직 없는 원본도 오류 없이 만든다", () => {
    const root = makeTemplate();
    rmSync(join(root, "docs"), { recursive: true });
    const dest = target("app");
    assert.equal(run(root, [dest, "--name", "app"]).code, 0);
    assert.ok(!existsSync(join(dest, "docs")));
  });
});

describe("이름·ID 메타데이터", () => {
  test("기본값만 새 이름으로 바꾸고 나머지 필드·서식은 그대로 둔다", () => {
    const root = makeTemplate();
    const dest = target("app");
    const result = run(root, [dest, "--name", "my-app"]);
    assert.equal(result.code, 0, result.stderr);
    const original = json(root, "package.json");
    const scripts = Object.fromEntries(
      Object.entries(original.scripts).filter(([name]) => !TEMPLATE_ONLY_SCRIPTS.includes(name)),
    );
    assert.deepEqual(json(dest, "package.json"), { ...original, name: "my-app", scripts });
    // 이름 자리와 템플릿 전용 스크립트 줄만 다르다(마지막 항목이 빠지면 앞 줄의 쉼표가 떨어진다).
    const lines = (text) => text.split("\n").map((line) => line.replace(/,$/, ""));
    assert.deepEqual(
      lines(readFileSync(join(dest, "package.json"), "utf8")),
      lines(
        readFileSync(join(root, "package.json"), "utf8").replace(
          '"name": "agentic-boilerplate"',
          '"name": "my-app"',
        ),
      ).filter((line) => !TEMPLATE_ONLY_SCRIPTS.some((name) => line.includes(`"${name}":`))),
    );
    assert.deepEqual(json(dest, "web/package.json"), {
      ...json(root, "web/package.json"),
      name: "my-app-web",
    });
    assert.deepEqual(json(dest, "mobile/package.json"), {
      ...json(root, "mobile/package.json"),
      name: "my-app-mobile",
    });
    assert.deepEqual(json(dest, "web/project.json"), {
      ...json(root, "web/project.json"),
      title: "my-app",
    });
    const expo = json(root, "mobile/app.json").expo;
    assert.deepEqual(json(dest, "mobile/app.json").expo, {
      ...expo,
      name: "my-app",
      slug: "my-app",
      scheme: "myapp",
      ios: { ...expo.ios, bundleIdentifier: "com.example.myapp" },
      android: { ...expo.android, package: "com.example.myapp" },
    });
    assert.match(result.stdout, /로컬 미리보기용/);
    assert.deepEqual(
      readFileSync(join(dest, "web/app/layout.tsx")),
      readFileSync(join(root, "web/app/layout.tsx")),
    );
    // 로컬 Supabase 의 컨테이너·볼륨 이름이 템플릿과 겹치지 않게 project_id 줄만 바꾼다
    assert.equal(
      readFileSync(join(dest, "supabase/config.toml"), "utf8"),
      readFileSync(join(root, "supabase/config.toml"), "utf8").replace(
        `project_id = "${TEMPLATE_DEFAULTS.name}"`,
        'project_id = "my-app"',
      ),
    );
    assert.match(
      result.stdout,
      /바꿈: supabase\/config\.toml project_id "agentic-boilerplate" → "my-app"/,
    );
  });

  test("TOML 은 첫 [표] 앞의 한 줄만 바꾸고 주석·다른 줄은 그대로 둔다", () => {
    const text = '# 설명\nproject_id = "old" # 뒤 주석\r\n\n[db]\nproject_id = "inner"\n';
    const next = setTomlString(text, "project_id", "new-app");
    assert.equal(
      next,
      '# 설명\nproject_id = "new-app" # 뒤 주석\r\n\n[db]\nproject_id = "inner"\n',
    );
    assert.equal(readTomlString(next, "project_id"), "new-app");
    assert.equal(
      readTomlString('[db]\nproject_id = "inner"\n', "project_id"),
      undefined,
      "표 안은 보지 않는다",
    );
    assert.throws(() => setTomlString("[db]\n", "project_id", "x"), /찾지 못했습니다/);
  });

  test("명시한 iOS·Android ID 와 스킴은 서로 달라도 그대로 쓴다", () => {
    const root = makeTemplate();
    const dest = target("app");
    const result = run(root, [
      dest,
      "--name=shop",
      "--mode",
      "mobile",
      "--ios-id",
      "com.acme.shop",
      "--android-id",
      "com.acme.shop_android",
      "--scheme",
      "acmeshop",
    ]);
    assert.equal(result.code, 0, result.stderr);
    const { expo } = json(dest, "mobile/app.json");
    assert.equal(expo.ios.bundleIdentifier, "com.acme.shop");
    assert.equal(expo.android.package, "com.acme.shop_android");
    assert.equal(expo.scheme, "acmeshop");
    assert.doesNotMatch(result.stdout, /로컬 미리보기용/);
  });

  test("사용자가 바꾼 값은 보존하고, 명시한 플래그와 부딪히면 쓰기 전에 멈춘다", () => {
    const custom = (text) =>
      text
        .toString()
        .replace('"name": "agentic-boilerplate"', '"name": "my-product"')
        .replace(
          '"bundleIdentifier": "com.example.agenticboilerplate"',
          '"bundleIdentifier": "com.acme.product"',
        );
    const root = makeTemplate({
      "package.json": custom(TEMPLATE["package.json"]),
      "mobile/app.json": custom(TEMPLATE["mobile/app.json"]),
      "supabase/config.toml": TEMPLATE["supabase/config.toml"]
        .toString()
        .replace(`project_id = "${TEMPLATE_DEFAULTS.name}"`, 'project_id = "my-product"'),
    });
    const conflict = target("app");
    const refused = run(root, [conflict, "--name", "next", "--ios-id", "com.acme.other"]);
    assert.equal(refused.code, 1);
    assert.match(refused.stderr, /충돌/);
    assert.ok(!existsSync(conflict));

    const dest = target("app");
    const result = run(root, [dest, "--name", "next"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(json(dest, "package.json").name, "my-product");
    assert.equal(json(dest, "mobile/app.json").expo.ios.bundleIdentifier, "com.acme.product");
    assert.equal(json(dest, "mobile/app.json").expo.android.package, "com.example.next");
    assert.equal(
      readTomlString(readFileSync(join(dest, "supabase/config.toml"), "utf8"), "project_id"),
      "my-product",
    );
    assert.match(result.stdout, /그대로 둠.*my-product/);
  });
});

describe("템플릿 관리용은 새 프로젝트로 가지 않는다", () => {
  test("ZIP·Git 원본 모두 scripts/template/ 와 스모크를 빼고, 그것을 부르는 루트 스크립트 항목도 뺀다", () => {
    for (const root of [makeTemplate(), makeGitTemplate()]) {
      const dest = target("app");
      const result = run(root, [dest, "--name", "app"]);
      assert.equal(result.code, 0, result.stderr);
      for (const path of Object.keys(TEMPLATE_ONLY))
        assert.ok(!existsSync(join(dest, path)), `${path} 복사됨`);
      assert.ok(existsSync(join(dest, "scripts/verify.mjs")), "제품이 쓰는 스크립트는 온다");
      const scripts = json(dest, "package.json").scripts ?? {};
      for (const name of TEMPLATE_ONLY_SCRIPTS) assert.ok(!(name in scripts), name);
      // 남은 스크립트가 가리키는 scripts/ 파일은 모두 복사본에 있다
      for (const [name, body] of Object.entries(scripts))
        for (const [, path] of body.matchAll(/\b(scripts\/[\w./-]+\.(?:mjs|sh))\b/g))
          if (path in TEMPLATE || path in TEMPLATE_ONLY)
            assert.ok(existsSync(join(dest, path)), `${name} → ${path}`);
      assert.match(result.stdout, /뺌\(템플릿 관리용\): \d+개/);
    }
  });

  test("스크립트 항목은 줄째로 빼고 나머지 bytes 는 그대로 둔다", () => {
    const text = '{\n  "scripts": {\n    "a": "x",\n    "b": "y",\n    "c": "z"\n  }\n}\n';
    assert.equal(
      removeJsonScript(text, "b"),
      '{\n  "scripts": {\n    "a": "x",\n    "c": "z"\n  }\n}\n',
    );
    assert.equal(
      removeJsonScript(text, "c"),
      '{\n  "scripts": {\n    "a": "x",\n    "b": "y"\n  }\n}\n',
      "마지막 항목을 빼면 앞 줄의 쉼표를 뗀다",
    );
    assert.equal(removeJsonScript(text, "none"), text, "없는 항목이면 그대로다");
    assert.equal(removeJsonScript('{ "name": "x" }\n', "a"), '{ "name": "x" }\n');
    assert.throws(
      () => removeJsonScript('{ "scripts": { "a": "x", "b": "y" } }\n', "a"),
      /scripts\.a 항목을 빼지 못했습니다/,
      "항목마다 한 줄이 아니면 고치지 않고 멈춘다",
    );
  });
});

describe("Git 원본", () => {
  test("추적 파일의 작업 폴더 bytes 만 복사하고 원본 Git 상태를 바꾸지 않는다", () => {
    const root = makeGitTemplate();
    put(root, {
      "README.md": "# 고친 README (미커밋)\n",
      "scripts/other.mjs": "// 추적하지 않는 새 파일\n",
    });
    // status 는 인덱스의 stat 정보를 새로 쓸 수 있어 스냅숏보다 먼저 부른다
    const status = git(root, "status", "--porcelain");
    const before = snapshot(root);
    const dest = target("app");
    const result = run(root, [dest, "--name", "app"]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(join(dest, "README.md"), "utf8"), "# 고친 README (미커밋)\n");
    assert.ok(!existsSync(join(dest, "scripts/other.mjs")));
    assert.ok(!existsSync(join(dest, ".git")));
    assertNoNoise(dest);
    assert.deepEqual(snapshot(root), before);
    assert.equal(git(root, "status", "--porcelain"), status);
  });

  test("template.json 에 원본 커밋을 남기고, 원본에 있던 기록은 새로 쓴다", () => {
    const root = makeGitTemplate();
    put(root, { "template.json": '{ "commit": "old" }\n' });
    git(root, "add", "template.json");
    git(root, "commit", "-q", "-m", "기록");
    const dest = target("app");
    const result = run(root, [dest, "--name", "app"]);
    assert.equal(result.code, 0, result.stderr);
    const head = git(root, "rev-parse", "HEAD").trim();
    const record = json(dest, "template.json");
    assert.equal(record.template, TEMPLATE_DEFAULTS.name);
    assert.equal(record.commit, head);
    assert.match(record.created, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(result.stdout.includes(`기록: template.json (템플릿 커밋 ${head.slice(0, 7)})`));
  });

  test(
    "추적 파일이 심볼릭 링크로 바뀌어 있으면 아무것도 쓰지 않고 멈춘다",
    { skip: symlinkSkip },
    () => {
      const root = makeGitTemplate();
      rmSync(join(root, "scripts/verify.mjs"));
      symlinkSync(join(root, ".env"), join(root, "scripts/verify.mjs"));
      const dest = target("app");
      const result = run(root, [dest, "--name", "app"]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /심볼릭 링크/);
      assert.ok(!existsSync(dest));
    },
  );

  test("dry-run 은 같은 계획을 보여 주고 쓰지 않는다", () => {
    const root = makeGitTemplate();
    const dest = target("app");
    const dry = run(root, [dest, "--name", "app", "--dry-run"]);
    assert.equal(dry.code, 0, dry.stderr);
    assert.ok(!existsSync(dest));
    const listed = dry.stdout
      .split("\n")
      .filter((line) => line.startsWith("  ") && !line.includes(":"))
      .map((line) => line.trim())
      .sort();
    assert.equal(run(root, [dest, "--name", "app"]).code, 0);
    assert.deepEqual(listed, listFiles(dest));
    assert.deepEqual(
      planCopy(root)
        .files.map((file) => file.path)
        .sort(),
      listed,
    );
  });
});

describe("목적지를 덮지 않는다", () => {
  test("비어 있어도 이미 있는 폴더·원본 안 경로는 거부하고, 같은 목적지 재실행도 거부한다", () => {
    const root = makeTemplate();
    const empty = fresh("empty");
    assert.equal(run(root, [empty, "--name", "app"]).code, 1);
    assert.deepEqual(readdirSync(empty), []);

    const inside = run(root, [join(root, "copy"), "--name", "app"]);
    assert.equal(inside.code, 1);
    assert.match(inside.stderr, /원본/);
    assert.ok(!existsSync(join(root, "copy")));

    const dest = target("app");
    assert.equal(run(root, [dest, "--name", "app"]).code, 0);
    const files = snapshot(dest);
    assert.equal(run(root, [dest, "--name", "app"]).code, 1);
    assert.deepEqual(snapshot(dest), files);
    assert.equal(run(root, [target("app2"), "--name", "app"]).code, 0);
  });

  test("계획 뒤 다른 곳에서 먼저 만든 폴더의 sentinel 을 덮지 않는다", () => {
    const root = makeTemplate();
    const dest = target("app");
    const result = run(root, [dest, "--name", "app"], {
      hooks: { beforeCreate: (path) => put(path, { "package.json": "sentinel" }) },
    });
    assert.equal(result.code, 1);
    assert.deepEqual(readdirSync(dest), ["package.json"]);
    assert.equal(readFileSync(join(dest, "package.json"), "utf8"), "sentinel");
  });

  test("복사 도중 실패하면 만든 만큼 남겨 두고 안내하며, 원본은 그대로다", () => {
    const root = makeTemplate();
    const before = snapshot(root);
    const dest = target("app");
    const calls = { count: 0 };
    const result = run(root, [dest, "--name", "app"], {
      hooks: {
        writeFile: (path, bytes, options) => {
          calls.count += 1;
          if (calls.count === 3) throw new Error("디스크 가득 참");
          writeFileSync(path, bytes, options);
        },
      },
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /2\/\d+개만 만들어졌고, 지우지 않고 남겨 두었습니다/);
    assert.equal(listFiles(dest).length, 2);
    assert.deepEqual(snapshot(root), before);
  });
});

describe("잘못된 입력은 아무것도 쓰지 않는다", () => {
  const cases = [
    [[], "경로 없음"],
    [["a", "b", "--name", "app"], "경로 둘"],
    [["DEST"], "이름 없음"],
    [["DEST", "--name", "My_App"], "대문자·밑줄 이름"],
    [["DEST", "--name", "app-"], "하이픈으로 끝나는 이름"],
    [["DEST", "--name"], "값 없는 플래그"],
    [["DEST", "--name", "--dry-run"], "값 자리에 플래그"],
    [["DEST", "--name", "a", "--name", "b"], "같은 플래그 두 번"],
    [["DEST", "--name", "app", "--mode", "desktop"], "모르는 mode"],
    [["DEST", "--name", "app", "--force"], "모르는 옵션"],
    [["DEST", "--name", "app", "--ios-id", "myapp"], "점 없는 ID"],
    [["DEST", "--name", "app", "--android-id", "com.1bad.app"], "숫자로 시작하는 ID 조각"],
    [["DEST", "--name", "app", "--scheme", "Bad Scheme"], "잘못된 스킴"],
    [["DEST", "--name", "app", "--mode", "web", "--ios-id", "com.acme.app"], "웹 전용인데 앱 ID"],
  ];
  for (const [argv, label] of cases) {
    test(`${label} → 종료 2`, () => {
      const root = makeTemplate();
      const before = snapshot(root);
      const dest = target("app");
      const result = run(
        root,
        argv.map((arg) => (arg === "DEST" ? dest : arg)),
      );
      assert.equal(result.code, 2, result.stderr);
      assert.match(result.stderr, /사용법/);
      assert.ok(!existsSync(dest));
      assert.deepEqual(snapshot(root), before);
    });
  }
});

describe("실제 템플릿", () => {
  test("CLI dry-run 은 실행 기록·개인 파일 없이 있는 플랫폼의 메타데이터 정본을 담는다", () => {
    const dest = join(fresh("cli"), "새 앱");
    const web = PRESENT.has("web");
    const mobile = PRESENT.has("mobile");
    const mode = web && mobile ? "both" : web ? "web" : "mobile";
    const result = spawnSync(
      process.execPath,
      [
        join(REPO, "scripts/template/bootstrap.mjs"),
        dest,
        "--name",
        "demo",
        "--mode",
        mode,
        "--dry-run",
      ],
      { encoding: "utf8", env: { ...GIT_ENV, INIT_CWD: scratch } },
    );
    // 첫 커밋 전 새 프로젝트(git init 만 한 상태)는 추적 파일이 없어 원본으로 쓸 수 없다고 멈춘다
    const uncommitted =
      existsSync(join(REPO, ".git")) && git(REPO, "ls-files", "-z", "--cached") === "";
    if (uncommitted) {
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /원본에 (web|mobile)\/package\.json 이 없습니다/);
      assert.ok(!existsSync(dest));
      return;
    }
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(dest));
    const listed = result.stdout.split("\n").map((line) => line.trim());
    for (const path of [
      ...(web ? ["web/project.json", "web/app/layout.tsx"] : []),
      ...(mobile ? ["mobile/app.json"] : []),
      "scripts/verify.mjs",
      ".env.example",
    ])
      assert.ok(listed.includes(path), path);
    assert.ok(
      !listed.some((path) =>
        /^(reports|polaris)\/|^scripts\/template\/|^\.github\/workflows\/template\.yml$|node_modules|\.env\.local/.test(
          path,
        ),
      ),
    );
    for (const name of TEMPLATE_ONLY_SCRIPTS)
      assert.ok(
        result.stdout.includes(`뺌(템플릿 관리용): package.json scripts.${name}`),
        result.stdout,
      );
    // bootstrap 으로 만든 프로젝트에서는 이미 바뀐 이름을 덮지 않고 그대로 둔다고 알린다
    const expected = (label, value) =>
      value === TEMPLATE_DEFAULTS.name
        ? `바꿈: ${label} "${value}" → "demo"`
        : `그대로 둠(템플릿 기본값이 아님): ${label} = ${JSON.stringify(value)}`;
    if (web)
      assert.ok(
        result.stdout.includes(
          expected("web/project.json title", JSON.parse(real("web/project.json")).title),
        ),
        result.stdout,
      );
    if (mobile)
      assert.ok(
        result.stdout.includes(
          expected("mobile/app.json expo.name", JSON.parse(real("mobile/app.json")).expo.name),
        ),
        result.stdout,
      );
    assert.ok(
      result.stdout.includes(
        expected(
          "supabase/config.toml project_id",
          readTomlString(real("supabase/config.toml").toString(), "project_id"),
        ),
      ),
      result.stdout,
    );
  });

  test("CLI 는 잘못된 인자에 종료 2 를 돌려준다", () => {
    const result = spawnSync(
      process.execPath,
      [join(REPO, "scripts/template/bootstrap.mjs"), "--bogus"],
      {
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 2);
  });
});
