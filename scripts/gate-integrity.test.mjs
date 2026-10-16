// 게이트 자기 보호 시험 — 검증·커밋 게이트가 기대는 설정이 최소한의 검사를 그대로 부르는지 고정한다.
// 실행: 루트에서 `pnpm test`
//
// "정확히 이 목록"이 아니라 최소 집합을 본다. 검사를 더하는 것은 자유다(손으로 적은 목록은 검사를 더할 때마다
// 깨졌다 — scripts/template/verify.test.mjs 의 주석). 막는 것은 검사를 빼거나, 실패를 삼키게 바꾸거나, 이름만 남기고
// 내용을 비우거나, 인자로 범위를 좁히는 것이다. 그래서 목록은 최소 집합으로, 각 검사의 본문은 그대로 고정한다.
// 에이전트 세션이 직접 고치는 길은 .claude/settings.json 의 편집 금지(deny)가 막고, 그 목록도 여기서 고정한다.
//
// 웹·앱 중 한쪽만 쓰는 복사본은 디스크에 <폴더>/package.json(설정의 marker)이 없을 때만 그 폴더를 건너뛴다.
// verify.config.json 에서 프로젝트를 지우는 것만으로 검사가 꺼지면 안 되므로 건너뛰기 판정에 설정을 쓰지 않는다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");
const readJson = (rel) => JSON.parse(read(rel));

// ── 최소 집합 ──

const COMMON = ["format:check", "test", "check:tokens", "check:colors", "check:db-types"];

// verify 가 반드시 잇는 검사(키, verify 순서)와 각 검사 스크립트의 본문. 본문은 문자 하나까지 같아야 한다.
// 앞부분만 보면 `vitest run nothing`·`eslint --config empty.mjs` 처럼 도구는 그대로 두고 범위를 좁히는 인자가 통과한다.
// 도구나 인자를 바꾸면 이 표도 같이 고친다. 게이트를 바꾸는 일이라 일부러 손이 가게 둔다.
const APP_FORMAT_CHECK =
  "prettier --check . --ignore-path ../.gitignore --ignore-path ../.prettierignore";
const APP_SCRIPTS = {
  web: {
    "format:check": APP_FORMAT_CHECK,
    // next-env.d.ts 는 깃에 없는 생성물이라 새 체크아웃에는 없다. next typegen 이 그 파일과 경로 타입을 만든 뒤 tsc 가 본다.
    "type-check": "next typegen && tsc --noEmit",
    lint: "eslint",
    test: "vitest run",
    lodestar: "lodestar check",
    "check:tokens": "node ../scripts/tokens-gen.mjs --check",
    "check:colors": "bash ../scripts/check-colors.sh",
    build: "next build",
  },
  mobile: {
    "format:check": APP_FORMAT_CHECK,
    "type-check": "tsc --noEmit",
    lint: "eslint .",
    test: "jest --runInBand",
    "check:tokens": "node ../scripts/tokens-gen.mjs --check",
    "check:colors": "bash ../scripts/check-colors.sh",
    "check:expo": "node ../scripts/check-expo.mjs",
    build: "expo export --platform ios --platform android",
  },
};
const APPS = Object.fromEntries(
  Object.entries(APP_SCRIPTS).map(([dir, scripts]) => [dir, Object.keys(scripts)]),
);
// verify:quick(커밋 게이트)은 느린 빌드·네트워크가 필요한 Expo 점검만 뺀 같은 집합이다.
const quickOf = (names) => names.filter((name) => !["build", "check:expo"].includes(name));

const ROOT_SCRIPTS = {
  // 큰따옴표다. 작은따옴표는 Windows 의 cmd.exe 가 따옴표로 보지 않는다
  "format:check": 'prettier --check . "!web/**" "!mobile/**"',
  // 큰따옴표 안의 glob 은 node 가 푼다. scripts/template/(템플릿 전용, 새 프로젝트에는 없다)의 시험까지 함께 돈다.
  test: 'node --test "scripts/**/*.test.mjs"',
  "check:tokens": "node scripts/tokens-gen.mjs --check",
  "check:colors": "bash scripts/check-colors.sh",
  "check:db-types": "node scripts/db-types-gen.mjs --check",
  verify: "node scripts/verify.mjs",
  "verify:quick": "node scripts/verify.mjs --quick",
};

// 커밋 게이트가 반드시 부르는 두 검사. 실패하면 exit 1 로 커밋을 막아야 한다.
const PRE_COMMIT_CALLS = [
  "node scripts/check-policy.mjs --staged",
  "node scripts/verify.mjs --quick --staged",
];
// push 전 검사(켠 저장소에서만 돈다). git 이 넘긴 원격 이름·주소를 그대로 넘기고, 실패하면 push 를 막아야 한다.
const PRE_PUSH_CALLS = ['node scripts/pre-push.mjs "$@"'];
const GUARDED_TOOLS = ["Bash", "Edit", "Write"];

// 에이전트가 고치지 못하게 .claude/settings.json 의 permissions.deny 에 있어야 하는 게이트 파일(더 있는 것은 허용).
// .claude/ 에서 편집 금지는 settings·hooks 만 막는다. .claude/skills·commands·agents 는 지침이라 세션이 고칠 수 있게
// 열어 둔다. Edit(/web/…)·Edit(/mobile/…) 은 그 폴더가 디스크에 있을 때만 요구한다(아래 appOf).
// 막는 것은 금지 자체(settings·hooks)와 다른 검사가 약화를 잡지 못하는 파일(.husky·.github·lodestar 설정)뿐이다.
// package.json·verify.config.json·eslint 설정·scripts/ 는 세션이 고칠 수 있다. 약화는 이 시험의 본문 고정,
// check:lint-guards, 커밋 게이트의 `pnpm test`, 커밋된 diff 검토가 잡는다.
const DENY_EDITS = [
  "Edit(/.husky/**)",
  "Edit(/.claude/settings.json)",
  "Edit(/.claude/settings.local.json)",
  "Edit(/.claude/hooks/**)",
  "Edit(/.github/**)",
  "Edit(/web/lodestar.config.*)",
];

// ── 판정 (순수 함수, 문제 목록을 돌려준다) ──

// 셸 제어 문자(; | & 줄바꿈·명령 치환). 도구 호출 하나에 끼면 그 실패를 삼키거나 다른 명령을 끼울 수 있다.
const SHELL_CONTROL = /[;|&\n`]|\$\(/;

// verify 류 스크립트는 `pnpm <이름>` 을 && 로만 잇는다. 칸마다 정확히 `pnpm <이름>` 이어야 이름으로 센다.
// 문자열 includes 로 보면 "test" 가 "type-check" 안에서 맞는다. ||·;·exit 0 같은 다른 칸이 끼면
// 앞 단계의 실패가 삼켜지거나 뒤 단계가 돌지 않으므로 그 칸도 문제로 본다.
const chainProblems = (script, required) => {
  const parts = String(script ?? "")
    .split("&&")
    .map((part) => part.trim());
  const names = parts.map((part) => /^pnpm ([\w:.-]+)$/.exec(part)?.[1]);
  return [
    ...parts
      .filter((_, at) => !names[at])
      .map((part) => `\`pnpm <이름>\` 이 아닌 칸: ${JSON.stringify(part)}`),
    ...required.filter((name) => !names.includes(name)).map((name) => `pnpm ${name} 이 없습니다`),
  ];
};

// 이름만 남기고 내용을 `true`·`echo` 로 바꾸거나, 실패를 삼키거나, 인자로 범위를 좁히면 본문이 달라진다.
const toolProblems = (scripts, expected) =>
  Object.entries(expected)
    .filter(([name, body]) => scripts?.[name] !== body)
    .map(
      ([name, body]) =>
        `${name} 이 ${JSON.stringify(body)} 가 아닙니다: ${JSON.stringify(scripts?.[name])}`,
    );

const runsPnpm = (command, name) =>
  command?.command === "pnpm" &&
  JSON.stringify(command.args) === JSON.stringify([name]) &&
  (command.cwd ?? ".") === ".";

// 공통 검증은 루트에서 `pnpm <이름>` 을 인자 없이 부른다(인자를 붙이면 시험 범위를 좁힐 수 있다).
const commonProblems = (config) =>
  COMMON.filter((name) => !(config.verification?.common ?? []).some((c) => runsPnpm(c, name))).map(
    (name) => `verification.common 에 pnpm ${name} 이 없습니다`,
  );

// 디스크에 있는 폴더는 설정에서도 검증된다: marker 가 package.json 이고 pnpm verify·verify:quick 을 부른다.
const projectProblems = (config, dir) => {
  const project = (config.verification?.projects ?? []).find((entry) => entry.directory === dir);
  return project
    ? [
        ...(project.marker === "package.json"
          ? []
          : [`${dir} 의 marker 가 package.json 이 아닙니다`]),
        ...(runsPnpm(project.verify, "verify")
          ? []
          : [`${dir} 의 verify 가 pnpm verify 가 아닙니다`]),
        ...(runsPnpm(project.quick, "verify:quick")
          ? []
          : [`${dir} 의 quick 이 pnpm verify:quick 이 아닙니다`]),
      ]
    : [`verification.projects 에 ${dir} 가 없습니다`];
};

// Claude Code 의 matcher: 비었거나 * 면 모든 도구, 아니면 도구 이름 정규식(여기서는 전체 일치로 엄격하게 본다).
const matchesTool = (matcher, tool) =>
  [undefined, "", "*"].includes(matcher) || new RegExp(`^(?:${matcher})$`).test(tool);
const callsGuard = (group) =>
  (group.hooks ?? []).some(
    (hook) =>
      hook.type === "command" &&
      typeof hook.command === "string" &&
      !SHELL_CONTROL.test(hook.command) &&
      /^bash \S*\.claude\/hooks\/guard\.sh$/.test(hook.command),
  );
// 훅만 본다. 거부 목록(permissions.deny)은 아래 denyProblems 가 최소 집합으로 따로 본다.
const settingsProblems = (settings) => [
  ...(settings.disableAllHooks === true ? ["disableAllHooks 가 훅을 모두 끕니다"] : []),
  ...GUARDED_TOOLS.filter(
    (tool) =>
      !(settings.hooks?.PreToolUse ?? []).some(
        (group) => matchesTool(group.matcher, tool) && callsGuard(group),
      ),
  ).map((tool) => `PreToolUse 훅이 ${tool} 에서 guard.sh 를 부르지 않습니다`),
];

// Edit(/web/…)·Edit(/mobile/…) 은 그 앱 폴더 몫이다.
const appOf = (rule) => /^Edit\(\/(web|mobile)\//.exec(rule)?.[1];
// 규칙은 글자 그대로 본다. `/` 를 빼거나 Edit 를 Read 로 바꾸면 막는 범위가 달라진다.
// apps: 디스크에 있는 앱 폴더. 없는 폴더의 규칙은 요구하지 않는다.
const denyProblems = (settings, apps) => {
  const deny = Array.isArray(settings.permissions?.deny) ? settings.permissions.deny : [];
  return DENY_EDITS.filter((rule) => !appOf(rule) || apps.includes(appOf(rule)))
    .filter((rule) => !deny.includes(rule))
    .map((rule) => `permissions.deny 에 ${rule} 이 없습니다`);
};

// ── 커밋 게이트(셸) 판정 ──
// 셸을 해석하지 않는다. 줄마다 블록 깊이와 heredoc 본문인지만 따라가는 최소 신호다. 보는 것:
//   - 두 호출이 최상위(if·case·while·for·{ } 블록과 heredoc 밖) 줄 맨 앞에 있고, 뒤에는 아무것도 없거나
//     `|| { …; exit 1; }` 만 온다.
//   - 호출보다 앞에 성공으로 끝날 수 있는 것이 없다(조건부 포함): 코드 없는·0·변수 exit, exec, trap, 최상위 return.
//     실패로 끝내는 `exit 1` 과 함수 안의 return 은 괜찮다.
// 보지 않는 것: node 를 함수·PATH 로 바꿔치기, 따옴표 없는 단어(echo done)에 속는 경우 등.
// 훅을 실제로 `sh -e` 로 돌려 무엇을 부르고 무엇을 막는지는 템플릿 원본의 scripts/template/pre-commit.test.mjs 가 임시 저장소에서 본다.

// 따옴표 안 글자·${…}·줄 끝 주석을 지운 줄. 문자열 속 단어(echo "… exit 0 …")에 속지 않게 한다.
// heredoc 구분자(<<"SKIP")의 따옴표는 남긴다.
const shellCode = (line) =>
  line
    .replace(/(<<-?\s*)?('[^']*'|"(?:[^"\\]|\\.)*")/g, (match, heredoc) => (heredoc ? match : "''"))
    .replace(/\$\{[^}]*\}/g, "$v")
    .replace(/(^|\s)#.*$/, "$1");

// 셸 단어: 앞이 줄 처음·공백·; & | ( 이고 뒤가 줄 끝·공백·; & | ) 인 것. 개수로만 쓴다(g 정규식의 test 는 상태가 남는다).
const words = (pattern) => new RegExp(`(^|[\\s;&|(])(?:${pattern})(?=$|[\\s;&|)])`, "g");
const count = (code, pattern) => (code.match(pattern) ?? []).length;
const OPENERS = words("if|case|while|until|for|\\{");
const CLOSERS = words("fi|esac|done|\\}");
const EARLY_EXITS = words("exit(?!\\s+[1-9])|exec|trap");
const RETURN = words("return");

// 줄마다 { line, code, depth: 그 줄이 시작할 때 열린 블록 수, body: 셸이 명령으로 읽지 않는 heredoc 본문인지 }.
const shellLines = (text) =>
  text.split("\n").reduce(
    ({ depth, heredoc, lines }, line) => {
      if (heredoc) {
        const end = (heredoc.tabs ? line.replace(/^\t+/, "") : line) === heredoc.tag;
        return {
          depth,
          heredoc: end ? undefined : heredoc,
          lines: [...lines, { line, code: "", depth, body: true }],
        };
      }
      const code = shellCode(line);
      const start = /<<(-?)\s*\\?(['"]?)(\w+)\2/.exec(code);
      return {
        depth: depth + count(code, OPENERS) - count(code, CLOSERS),
        heredoc: start ? { tag: start[3], tabs: start[1] === "-" } : undefined,
        lines: [...lines, { line, code, depth, body: false }],
      };
    },
    { depth: 0, heredoc: undefined, lines: [] },
  ).lines;

const exitsEarly = ({ code, depth }) =>
  count(code, EARLY_EXITS) > 0 || (depth === 0 && count(code, RETURN) > 0);

const hookProblems = (text, required) => {
  const lines = shellLines(text);
  return required.flatMap((call) => {
    const calls = lines.filter(
      ({ line, body }) => !body && line.startsWith(call) && /^(\s|$)/.test(line.slice(call.length)),
    );
    const top = calls.find(({ depth }) => depth === 0);
    if (!top) {
      return [
        calls.length > 0
          ? `${call} 가 블록 안에 있어 늘 돌지는 않습니다`
          : `${call} 를 부르지 않습니다`,
      ];
    }
    const rest = top.line.slice(call.length).trim();
    const early = lines
      .slice(0, lines.indexOf(top))
      .find((entry) => !entry.body && exitsEarly(entry));
    return [
      ...(rest === "" || /^\|\|\s*\{[^}]*\bexit [1-9]\d*;?\s*\}$/.test(rest)
        ? []
        : [`${call} 의 실패를 막지 않습니다: ${JSON.stringify(rest)}`]),
      ...(early
        ? [
            `${call} 보다 앞에서 게이트가 성공으로 끝날 수 있습니다: ${JSON.stringify(early.line.trim())}`,
          ]
        : []),
    ];
  });
};
const preCommitProblems = (text) => hookProblems(text, PRE_COMMIT_CALLS);
const prePushProblems = (text) => hookProblems(text, PRE_PUSH_CALLS);

// ── 읽기 ──

// 디스크에 있는 앱 폴더. marker 는 <폴더>/package.json 이다(맨 위 주석의 건너뛰기 판정).
const hasApp = (dir, app) => existsSync(join(dir, app, "package.json"));
const presentApps = (dir) => Object.keys(APPS).filter((app) => hasApp(dir, app));

// 커밋될 내용: 작업 폴더가 아니라 스테이징본(인덱스)을 읽는다. `:./경로` 는 dir 기준이라 이 템플릿이 더 큰
// 저장소 안에 있어도 같은 파일을 가리킨다. 커밋 게이트 안에서는 git 이 넘긴 GIT_INDEX_FILE 이 커밋될 인덱스
// (git commit -a 의 임시 인덱스 포함)를 가리키므로 env 를 그대로 물려준다.
// git 저장소가 아니거나(git 없는 복사본·시험용 임시 폴더) 인덱스에 그 파일이 없으면(새 프로젝트 첫 커밋 전)
// 작업 폴더 파일로 대신한다. 단 HEAD 에 있던 파일이 인덱스에서만 빠졌으면(git rm --cached) 이번 커밋이 그 파일을
// 지우는 것이므로 작업 폴더로 넘어가지 않고 undefined 를 돌려준다.
const stagedText = (dir, rel, env = process.env) => {
  const show = (spec) => spawnSync("git", ["show", spec], { cwd: dir, env, encoding: "utf8" });
  const staged = show(`:./${rel}`);
  if (staged.status === 0) return staged.stdout;
  return show(`HEAD:./${rel}`).status === 0 ? undefined : readFileSync(join(dir, rel), "utf8");
};

// 편집 금지는 스테이징본으로 본다. README 는 게이트 파일을 고칠 때 사람이 작업 폴더에서만 deny 줄을 잠시
// 지우라고 안내한다. 작업 폴더를 읽으면 그동안 이 시험이 깨지고, 지운 채 스테이징·커밋하는 것은 막아야 한다.
// 가드 훅(settingsProblems)은 작업 폴더로 본다. 작업 폴더에서 훅을 지우면 지금 세션의 가드가 바로 꺼지기 때문이다.
// 커밋될 훅을 따로 볼 필요는 없다. 커밋에 settings.json 이 들어가면 부분 스테이징 차단(.husky/pre-commit)으로
// 스테이징본과 작업 폴더가 같고, 들어가지 않으면 커밋될 것은 이미 통과한 HEAD 그대로다.
const stagedDenyProblems = (dir, env = process.env) => {
  const text = stagedText(dir, ".claude/settings.json", env);
  return text === undefined
    ? [".claude/settings.json 이 이번 커밋에서 빠집니다"]
    : denyProblems(JSON.parse(text), presentApps(dir));
};

// ── 실제 저장소 ──

describe("공통 검증", () => {
  it("verify.config.json 의 verification.common 이 최소 검사를 포함한다 (더 있는 것은 허용)", () => {
    assert.deepEqual(commonProblems(readJson("verify.config.json")), []);
  });

  it("루트 package.json 의 공통 검사·verify 본문이 고정한 그대로다", () => {
    const { scripts } = readJson("package.json");
    assert.deepEqual(toolProblems(scripts, ROOT_SCRIPTS), []);
  });
});

Object.entries(APPS).forEach(([dir, names]) => {
  const present = hasApp(root, dir);
  describe(`${dir} 검증`, { skip: !present && `${dir}/package.json 이 없는 복사본` }, () => {
    const scripts = () => readJson(`${dir}/package.json`).scripts ?? {};

    it("verify 가 최소 검사를 && 로만 잇는다", () => {
      assert.deepEqual(chainProblems(scripts().verify, names), []);
    });

    it("verify:quick 이 빌드·Expo 점검을 뺀 같은 집합을 && 로만 잇는다", () => {
      assert.deepEqual(chainProblems(scripts()["verify:quick"], quickOf(names)), []);
    });

    it("검사 이름이 가리키는 스크립트 본문이 고정한 그대로다 (도구·인자 모두)", () => {
      assert.deepEqual(toolProblems(scripts(), APP_SCRIPTS[dir]), []);
    });

    it("verify.config.json 이 이 폴더를 pnpm verify·verify:quick 으로 검증한다", () => {
      assert.deepEqual(projectProblems(readJson("verify.config.json"), dir), []);
    });
  });
});

describe("Claude 가드 훅", () => {
  it(".claude/settings.json 의 PreToolUse 훅이 Bash·Edit·Write 에서 guard.sh 를 부른다", () => {
    assert.ok(existsSync(join(root, ".claude/hooks/guard.sh")));
    assert.deepEqual(settingsProblems(readJson(".claude/settings.json")), []);
  });

  it(".claude/settings.json(스테이징본)의 permissions.deny 가 게이트 파일 편집 금지를 포함한다", () => {
    assert.deepEqual(stagedDenyProblems(root), []);
  });
});

describe("커밋 게이트", () => {
  it(".husky/pre-commit 이 변경분 정책과 바뀐 폴더 검증을 부르고, 실패하면 막는다", () => {
    assert.deepEqual(preCommitProblems(read(".husky/pre-commit")), []);
  });

  it(".husky/pre-push 가 push 전 검사를 원격 인자와 함께 부르고, 실패하면 막는다", () => {
    assert.deepEqual(prePushProblems(read(".husky/pre-push")), []);
  });
});

// ── 판정 자체: 가까운 변형을 놓치지 않고, 정상 변경은 막지 않는다 ──

describe("판정의 가까운 변형", () => {
  const WEB = APPS.web;
  const verify = WEB.map((name) => `pnpm ${name}`).join(" && ");

  it("검사를 더하는 것은 허용한다", () => {
    assert.deepEqual(chainProblems(`${verify} && pnpm extra`, WEB), []);
  });

  it("빠진 검사를 이름 단위로 잡는다 (type-check 안의 test 같은 부분 일치에 속지 않는다)", () => {
    assert.deepEqual(chainProblems(verify.replace(" && pnpm build", ""), WEB), [
      "pnpm build 이 없습니다",
    ]);
    assert.deepEqual(chainProblems("pnpm type-check && pnpm test:e2e", ["test"]), [
      "pnpm test 이 없습니다",
    ]);
    assert.ok(chainProblems(undefined, ["test"]).length > 0);
  });

  it("실패를 삼키거나 건너뛰는 셸 구문을 잡는다", () => {
    [
      `${verify} || true`,
      `${verify} && true || true`,
      `exit 0 && ${verify}`,
      `${verify}; exit 0`,
      verify.replace("pnpm lint", "pnpm lint || true"),
      verify.replace(" && pnpm build", " & pnpm build"),
    ].forEach((script) => assert.ok(chainProblems(script, WEB).length > 0, script));
  });

  it("이름만 남기고 내용을 비운 스크립트를 잡고, 다른 스크립트를 더하는 것은 허용한다", () => {
    const web = APP_SCRIPTS.web;
    assert.deepEqual(toolProblems({ ...web, "test:e2e": "playwright test" }, web), []);
    [
      { test: "true" },
      { test: "vitest run || true" },
      { test: "echo vitest run" },
      { build: "next build; exit 0" },
      { test: undefined },
    ].forEach((change) =>
      assert.ok(toolProblems({ ...web, ...change }, web).length > 0, JSON.stringify(change)),
    );
    assert.ok(toolProblems(undefined, web).length > 0);
    assert.ok(
      toolProblems(
        { ...ROOT_SCRIPTS, test: "node --test scripts/template/verify.test.mjs" },
        ROOT_SCRIPTS,
      ).length > 0,
    );
  });

  it("도구 이름은 맞아도 범위를 좁히는 인자를 붙이면 잡는다", () => {
    [
      ["web", { test: "vitest run --passWithNoTests nothing" }],
      ["web", { lint: "eslint --config empty.mjs" }],
      ["web", { "type-check": "tsc --noEmit -p tsconfig.empty.json" }],
      ["web", { "format:check": "prettier --check app" }],
      ["web", { build: "next build --no-lint" }],
      ["mobile", { test: "jest --runInBand nothing" }],
      ["mobile", { lint: "eslint app/x.ts" }],
    ].forEach(([dir, change]) =>
      assert.ok(
        toolProblems({ ...APP_SCRIPTS[dir], ...change }, APP_SCRIPTS[dir]).length > 0,
        `${dir} ${JSON.stringify(change)}`,
      ),
    );
    assert.ok(
      toolProblems(
        { ...ROOT_SCRIPTS, "format:check": "prettier --check scripts/verify.mjs" },
        ROOT_SCRIPTS,
      ).length > 0,
    );
  });

  it("공통 검증에서 검사를 빼거나 인자로 좁히면 잡는다", () => {
    const common = (list) => ({
      verification: { common: list.map((args) => ({ command: "pnpm", args })) },
    });
    const full = COMMON.map((name) => [name]);
    assert.deepEqual(commonProblems(common([...full, ["extra"]])), []);
    assert.deepEqual(commonProblems(common(full.filter(([name]) => name !== "check:colors"))), [
      "verification.common 에 pnpm check:colors 이 없습니다",
    ]);
    assert.ok(
      commonProblems(
        common(full.map((args) => (args[0] === "test" ? ["test", "--", "x.test.mjs"] : args))),
      ).length > 0,
    );
  });

  it("설정에서 프로젝트를 지우거나 marker·명령을 바꾸면 잡는다", () => {
    const project = {
      directory: "web",
      marker: "package.json",
      verify: { command: "pnpm", args: ["verify"] },
      quick: { command: "pnpm", args: ["verify:quick"] },
    };
    const config = (projects) => ({ verification: { projects } });
    assert.deepEqual(projectProblems(config([project]), "web"), []);
    [
      [],
      [{ ...project, directory: "mobile" }],
      [{ ...project, marker: "missing.json" }],
      [{ ...project, verify: { command: "pnpm", args: ["verify:quick"] } }],
      [{ ...project, quick: { command: "true", args: [] } }],
    ].forEach((projects) =>
      assert.ok(projectProblems(config(projects), "web").length > 0, JSON.stringify(projects)),
    );
  });

  it("가드 훅: 도구가 빠지거나 실패를 삼키면 잡고, 거부 목록 추가·matcher * 는 허용한다", () => {
    const guard = { type: "command", command: 'bash "$CLAUDE_PROJECT_DIR"/.claude/hooks/guard.sh' };
    const settings = (matcher, hook = guard, extra = {}) => ({
      ...extra,
      hooks: { PreToolUse: [{ matcher, hooks: [hook] }] },
    });
    assert.deepEqual(settingsProblems(settings("Bash|Write|Edit|MultiEdit|NotebookEdit")), []);
    assert.deepEqual(settingsProblems(settings("*")), []);
    assert.deepEqual(
      settingsProblems(
        settings("Bash|Write|Edit", guard, { permissions: { deny: ["Edit(.husky/**)"] } }),
      ),
      [],
    );
    assert.deepEqual(settingsProblems(settings("Write|Edit")), [
      "PreToolUse 훅이 Bash 에서 guard.sh 를 부르지 않습니다",
    ]);
    assert.equal(settingsProblems(settings("Bash|Write")).length, 1);
    assert.equal(
      settingsProblems(
        settings("Bash.*|Edit|Write", { ...guard, command: `${guard.command} || true` }),
      ).length,
      3,
    );
    assert.equal(
      settingsProblems(settings("Bash|Edit|Write", { ...guard, command: "true" })).length,
      3,
    );
    assert.equal(settingsProblems({ ...settings("*"), disableAllHooks: true }).length, 1);
    assert.equal(settingsProblems({}).length, 3);
  });

  it("편집 금지: 규칙을 빼거나 바꾸면 잡고, 더하는 것과 없는 앱 폴더의 규칙이 빠진 것은 허용한다", () => {
    const settings = (deny) => ({ permissions: { deny } });
    const apps = ["web", "mobile"];
    const webRules = DENY_EDITS.filter((rule) => appOf(rule) === "web");
    const without = (rules) => DENY_EDITS.filter((rule) => !rules.includes(rule));
    assert.deepEqual(denyProblems(settings(["Bash(sudo *)", ...DENY_EDITS]), apps), []);
    assert.deepEqual(denyProblems(settings(without(webRules)), ["mobile"]), []);
    assert.equal(denyProblems(settings(without(webRules)), apps).length, webRules.length);
    assert.deepEqual(denyProblems(settings(without(["Edit(/.github/**)"])), apps), [
      "permissions.deny 에 Edit(/.github/**) 이 없습니다",
    ]);
    // 앱 폴더가 없어도 루트 규칙은 그대로 요구한다.
    assert.equal(denyProblems({}, []).length, DENY_EDITS.filter((rule) => !appOf(rule)).length);
    [
      // `/` 를 빼면 클로드를 연 폴더 기준이 아니라 어느 깊이의 .github/ 로 뜻이 바뀐다.
      DENY_EDITS.map((rule) => rule.replace("Edit(/.github/**)", "Edit(.github/**)")),
      DENY_EDITS.map((rule) => rule.replace("Edit(/.husky/**)", "Read(/.husky/**)")),
      DENY_EDITS.join(","),
    ].forEach((deny) => assert.ok(denyProblems(settings(deny), apps).length > 0, String(deny)));
    assert.ok(denyProblems({ permissions: { allow: DENY_EDITS } }, apps).length > 0);
  });

  it("커밋 게이트: 주석 처리·실패 삼키기·앞선 exit 를 잡는다", () => {
    const gate = PRE_COMMIT_CALLS.map((call) => `${call} || { echo "[차단]"; exit 1; }`).join("\n");
    assert.deepEqual(preCommitProblems(gate), []);
    assert.deepEqual(preCommitProblems(PRE_COMMIT_CALLS.join("\n")), []);
    [
      gate.replace("node scripts/check-policy", "# node scripts/check-policy"),
      gate.replace("node scripts/verify", "  # node scripts/verify"),
      gate.replace('{ echo "[차단]"; exit 1; }', "true"),
      gate.replace("exit 1", "exit 0"),
      `exit 0\n${gate}`,
      gate.replace("--quick --staged", "--quick --staged-not"),
    ].forEach((text) => assert.ok(preCommitProblems(text).length > 0, text));
  });

  it("push 전 검사: 인자 빼기·실패 삼키기·앞선 exit·블록 안의 호출을 잡는다", () => {
    const [call] = PRE_PUSH_CALLS;
    assert.deepEqual(prePushProblems(call), []);
    [
      "node scripts/pre-push.mjs",
      `${call} || true`,
      `exit 0\n${call}`,
      `# ${call}`,
      `if false; then\n${call}\nfi`,
    ].forEach((text) => assert.ok(prePushProblems(text).length > 0, text));
  });

  // 호출보다 앞의 조건부·변형 종료, 호출을 블록·heredoc 안에 넣어 돌지 않게 하는 것.
  it("커밋 게이트: 앞선 종료의 가까운 변형과 블록·heredoc 안의 호출을 잡는다", () => {
    const gate = PRE_COMMIT_CALLS.map((call) => `${call} || { echo "[차단]"; exit 1; }\n`).join("");
    const head = "ROOT=$(git rev-parse --show-toplevel)\n";
    [
      `exit 0;\n${gate}`,
      `  exit 0\n${gate}`,
      `true && exit 0\n${gate}`,
      `exit 0 # skip\n${gate}`,
      `[ -n "$CI" ] || exit 0\n${gate}`,
      `exit\n${gate}`,
      `exec true\n${head}${gate}`,
      `return 0\n${gate}`,
      `trap 'exit 0' EXIT\n${gate}`,
      `${head}: <<"SKIP"\n${gate}SKIP\n`,
      `${head}: <<-SKIP\n${gate}\tSKIP\n`,
      `if false; then\n${gate}fi\n`,
      `skip() {\n${gate}}\n`,
      `while false; do\n${gate}done\n`,
      `case x in\n  y)\n${gate};;\nesac\n`,
    ].forEach((text) => assert.ok(preCommitProblems(text).length > 0, text));
  });

  it("커밋 게이트: 앞선 함수·블록·heredoc·실패로 끝내는 exit 1 과 호출 뒤의 exit 0 은 허용한다", () => {
    const [policy, verify] = PRE_COMMIT_CALLS.map(
      (call) => `${call} || { echo "[차단]"; exit 1; }`,
    );
    const text = [
      'staged() { git diff --cached --name-only --diff-filter="$1"; }',
      "while IFS= read -r f; do",
      '  case "$NL$CHANGED$NL" in',
      '    *"$NL$f$NL"*) PARTIAL="$PARTIAL$NL   - $f" ;;',
      "  esac",
      "done <<EOF",
      "$UNSTAGED",
      "EOF",
      'if [ -n "$PARTIAL" ]; then',
      '  echo "[차단] 고치고 (exit 0 이나 done 이라고 적어도) 다시 커밋하세요"',
      "  exit 1",
      "fi",
      policy,
      "require_pnpm() {",
      "  command -v pnpm >/dev/null 2>&1 && return 0",
      "  exit 1",
      "}",
      "{ pnpm check:tokens && pnpm check:colors; } || {",
      "  exit 1",
      "}",
      "stem=${f%.*}",
      verify,
      'echo "[통과]"',
      "exit 0",
    ].join("\n");
    assert.deepEqual(preCommitProblems(text), []);
  });
});

// ── 편집 금지는 스테이징본을 본다 (임시 저장소) ──
// 시험용 저장소는 운영체제 임시 폴더에 만든다. 게이트(pre-commit)가 커밋 도중 이 시험을 부르면 git 이 넘긴
// GIT_* 값(GIT_INDEX_FILE 등)이 원본 저장소를 가리키므로 걷어 낸다. GIT_CEILING_DIRECTORIES 는 임시 폴더 위로
// 저장소를 찾아 올라가지 않게 해서 'git 저장소가 아닌 폴더' 를 어디서 돌려도 같게 만든다.

describe("편집 금지는 스테이징본을 본다", () => {
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  const FULL = { permissions: { deny: ["Bash(sudo *)", ...DENY_EDITS] } };
  const DROPPED = ["Edit(/.claude/hooks/**)", "Edit(/.github/**)"];
  const DROPPED_PROBLEMS = DROPPED.map((rule) => `permissions.deny 에 ${rule} 이 없습니다`);
  const without = (rules) => ({
    permissions: { deny: FULL.permissions.deny.filter((rule) => !rules.includes(rule)) },
  });

  const sandbox = (t, apps = Object.keys(APPS)) => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "gate-integrity-test-")));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    [".claude", ...apps].forEach((sub) => mkdirSync(join(dir, sub)));
    apps.forEach((app) => writeFileSync(join(dir, app, "package.json"), "{}\n"));
    const env = { ...cleanEnv, GIT_CEILING_DIRECTORIES: dirname(dir) };
    return {
      git: (...args) => {
        const result = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      },
      save: (settings) =>
        writeFileSync(join(dir, ".claude/settings.json"), `${JSON.stringify(settings, null, 2)}\n`),
      problems: () => stagedDenyProblems(dir, env),
    };
  };

  it("작업 폴더에서만 지운 것은 통과하고, 지운 채 스테이징하면 작업 폴더를 되돌려도 잡는다", (t) => {
    const { git, save, problems } = sandbox(t);
    save(FULL);
    git("init", "-q");
    git("add", ".claude/settings.json");
    save(without(DROPPED));
    assert.deepEqual(problems(), []);
    git("add", ".claude/settings.json");
    assert.deepEqual(problems(), DROPPED_PROBLEMS);
    save(FULL);
    assert.deepEqual(problems(), DROPPED_PROBLEMS);
  });

  it("커밋된 settings.json 을 인덱스에서 빼면(git rm --cached) 작업 폴더로 넘어가지 않고 막는다", (t) => {
    const { git, save, problems } = sandbox(t);
    save(FULL);
    git("init", "-q");
    git("add", ".claude/settings.json");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
    git("rm", "-q", "--cached", ".claude/settings.json");
    assert.deepEqual(problems(), [".claude/settings.json 이 이번 커밋에서 빠집니다"]);
  });

  it("git 저장소가 아니거나 인덱스에 그 파일이 없으면 작업 폴더를 본다", (t) => {
    const { git, save, problems } = sandbox(t);
    save(without(DROPPED));
    assert.deepEqual(problems(), DROPPED_PROBLEMS);
    save(FULL);
    assert.deepEqual(problems(), []);
    git("init", "-q");
    assert.deepEqual(problems(), []);
    save(without(DROPPED));
    assert.deepEqual(problems(), DROPPED_PROBLEMS);
  });

  it("디스크에 없는 앱 폴더의 규칙은 요구하지 않는다", (t) => {
    const webRules = DENY_EDITS.filter((rule) => appOf(rule) === "web");
    const mobileOnly = sandbox(t, ["mobile"]);
    mobileOnly.save(without(webRules));
    assert.deepEqual(mobileOnly.problems(), []);
    const webOnly = sandbox(t, ["web"]);
    webOnly.save(without(webRules));
    assert.equal(webOnly.problems().length, webRules.length);
  });
});
