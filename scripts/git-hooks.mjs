// 커밋 게이트(husky)가 실제로 켜져 있는지 읽기만 하는 탐침. 아무것도 바꾸지 않는다.
//
// 설치기(scripts/install-hooks.mjs)가 설치 전 충돌 확인과 설치 뒤 검증에 쓰고,
// 환경 점검(doctor)도 같은 탐침을 쓴다. 판단 기준이 두 곳에서 갈라지지 않게 여기 한 곳에 둔다.
//
// "켜져 있다"의 뜻:
// - git 이 보는 core.hooksPath(로컬·전역·시스템 중 실제로 이기는 값)가 이 저장소의 .husky/_ 다
// - .husky/_/h(husky 디스패처)가 husky 가 심는 디스패처와 바이트까지 같다
// - .husky/_/<훅>(git 이 부르는 실행 래퍼)이 실행 가능한 일반 파일이고 husky 가 심는 래퍼와 같다
// - .husky/<훅>(원본 훅)이 읽을 수 있는 일반 파일이다 — h 가 `sh -e` 로 돌리므로 실행 비트는 필요 없다
//
// 디스패처·래퍼는 "h 를 부르는 줄이 들어 있는가"가 아니라 통째로 대조한다. 앞에 `exit 0` 한 줄만 끼워도
// 원본 훅이 돌지 않고 git 은 성공으로 끝나기 때문이다. 훅은 실행하지 않는다(읽기만 한다).
// 줄 끝 규칙: 기대 바이트와 같거나, 기대 바이트가 줄바꿈으로 끝나지 않을 때 끝에 LF 하나만 더 붙은 것까지 같다고 본다.
//
// 디스패처가 원본 훅보다 먼저 source 하는 사용자 파일(init.sh)은 findHuskyInit 이 따로 본다. 저장소 밖 사용자
// 설정이라 설치기는 막지 않고(inspectGitHooks 에 넣지 않는다), 환경 점검(doctor)이 실패로 알린다.
import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HUSKY_DIR = ".husky";
export const HOOKS_PATH = ".husky/_";
export const GATE_HOOKS = ["pre-commit", "commit-msg"];

// husky 9 의 index.js 가 .husky/_/<훅> 에 쓰는 래퍼 (끝 줄바꿈 없음).
export const HUSKY_WRAPPER = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"';

// husky 9.1.7 패키지의 `husky` 파일(디스패처) 바이트. 설치된 husky 를 찾으면 그 파일을 기준으로 쓰고,
// 루트 의존성을 아직(또는 다시) 설치하지 않아 husky 를 찾지 못할 때만 이 값을 쓴다.
// husky 를 올리면 템플릿 원본의 scripts/template/install-hooks.test.mjs 가 설치된 파일과 어긋난다고 알린다.
export const HUSKY_DISPATCHER = [
  "#!/usr/bin/env sh",
  '[ "$HUSKY" = "2" ] && set -x',
  'n=$(basename "$0")',
  's=$(dirname "$(dirname "$0")")/$n',
  "",
  '[ ! -f "$s" ] && exit 0',
  "",
  'if [ -f "$HOME/.huskyrc" ]; then',
  "\techo \"husky - '~/.huskyrc' is DEPRECATED, please move your code to ~/.config/husky/init.sh\"",
  "fi",
  'i="${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh"',
  '[ -f "$i" ] && . "$i"',
  "",
  '[ "${HUSKY-}" = "0" ] && exit 0',
  "",
  'export PATH="node_modules/.bin:$PATH"',
  'sh -e "$s" "$@"',
  "c=$?",
  "",
  '[ $c != 0 ] && echo "husky - $n script failed (code $c)"',
  '[ $c = 127 ] && echo "husky - command not found in PATH=$PATH"',
  "exit $c",
  "",
].join("\n");

// 설치기가 불러오는 것과 같은 husky(이 스크립트 기준으로 풀리는 패키지)의 디스패처 원본.
// 패키지가 없으면 null(내장 기준을 쓴다), 있는데 읽지 못하면 error.
export const readHuskyDispatcher = () => {
  const entry = (() => {
    try {
      return fileURLToPath(import.meta.resolve("husky"));
    } catch {
      return null;
    }
  })();
  if (!entry) return { value: null };
  const source = join(dirname(entry), "husky");
  try {
    return { value: readFileSync(source, "utf8") };
  } catch (error) {
    return {
      error: `설치된 husky 의 디스패처 원본(${source})을 읽지 못했습니다 (${error.code ?? error.message}).`,
    };
  }
};

// 디스패처(위 HUSKY_DISPATCHER 의 `i=` 줄)는 원본 훅보다 먼저 이 파일을 source 한다. 저장소 밖이라 게이트·CI 가
// 보지 못하고, `exit 0`·`HUSKY=0` 한 줄이면 두 훅이 다 꺼진 채 git 은 성공으로 끝난다.
// 경로 규칙은 디스패처와 같다: XDG_CONFIG_HOME 이 비었거나 없으면 $HOME/.config. 상대 경로는 git 이 훅을
// 돌리는 작업 폴더 최상위(cwd) 기준이다.
export const huskyInitPath = ({ cwd = process.cwd(), env = process.env } = {}) =>
  resolve(cwd, `${env.XDG_CONFIG_HOME || `${env.HOME ?? ""}/.config`}/husky/init.sh`);

// 디스패처의 `[ -f "$i" ]` 처럼 일반 파일(링크면 따라간 끝)일 때만 있다고 본다. 있으면 경로, 없으면 null.
// 내용은 읽지 않는다 — 사용자 설정이라 비밀이 들어 있을 수 있다.
export const findHuskyInit = ({ cwd = process.cwd(), env = process.env } = {}) => {
  const path = huskyInitPath({ cwd, env });
  try {
    return statSync(path).isFile() ? path : null;
  } catch {
    return null;
  }
};

export const sameShim = (actual, expected) =>
  actual === expected || (!expected.endsWith("\n") && actual === `${expected}\n`);

const git = (cwd, env, args) => spawnSync("git", args, { cwd, env, encoding: "utf8" });

const gitFailure = (result, what) =>
  result.error?.code === "ENOENT"
    ? "git 명령을 찾을 수 없습니다. git 을 설치하세요."
    : `${what}: ${(result.error?.message ?? result.stderr ?? "").trim() || `종료 코드 ${result.status}`}`;

// Windows 는 같은 폴더를 8.3 짧은 이름(RUNNER~1)과 긴 이름으로 다르게 줄 수 있다. git 은 긴 이름을 준다.
// realpathSync.native 는 짧은 이름도 긴 이름으로 푼다. 다른 운영체제는 기존 동작 그대로다.
const real = process.platform === "win32" ? realpathSync.native : realpathSync;

const samePath = (a, b) => {
  try {
    return real(a) === real(b);
  } catch {
    return false;
  }
};

// 이 폴더가 git 작업 폴더의 최상위인지. 아니면 husky 가 바깥 저장소의 설정을 바꿀 수 있다.
const checkGitRoot = (cwd, env) => {
  const result = git(cwd, env, ["rev-parse", "--show-toplevel"]);
  if (result.error || result.status !== 0)
    return gitFailure(result, "git 저장소를 읽지 못했습니다");
  const top = result.stdout.trim();
  return samePath(top, cwd)
    ? null
    : `이 폴더는 git 작업 폴더의 최상위가 아닙니다 (최상위: ${top}).`;
};

// git 이 실제로 쓰는 core.hooksPath 와 그 값을 정한 범위(local·global·system·worktree·command).
export const readHooksPath = ({ cwd = process.cwd(), env = process.env } = {}) => {
  const result = git(cwd, env, ["config", "--show-scope", "--get", "core.hooksPath"]);
  if (result.error)
    return { ok: false, reason: gitFailure(result, "core.hooksPath 를 읽지 못했습니다") };
  if (result.status === 1 && result.stdout.trim() === "")
    return { ok: true, value: null, scope: null };
  if (result.status !== 0) {
    return { ok: false, reason: gitFailure(result, "core.hooksPath 를 읽지 못했습니다") };
  }
  const line = result.stdout.replace(/\r?\n$/, "");
  const tab = line.indexOf("\t");
  return { ok: true, scope: line.slice(0, tab), value: line.slice(tab + 1) };
};

// git 은 상대 hooksPath 를 작업 폴더 최상위 기준으로 푼다. 절대 경로는 심볼릭 링크(/var → /private/var 등)를
// 풀어 비교한다. .husky/_ 는 설치 전에 없을 수 있어 그 부모(.husky)를 기준으로 본다.
export const isGateHooksPath = (cwd, value) => {
  if (typeof value !== "string" || value === "") return false;
  const target = resolve(cwd, value);
  const gate = resolve(cwd, HOOKS_PATH);
  return (
    target === gate ||
    (basename(target) === basename(gate) && samePath(dirname(target), dirname(gate)))
  );
};

// 파일 상태: missing(없음·깨진 링크) · notFile(디렉터리 등) · denied(권한 없음) · ok(내용)
const probeFile = (path, mode) => {
  try {
    lstatSync(path);
  } catch {
    return { state: "missing" };
  }
  try {
    if (!statSync(path).isFile()) return { state: "notFile" };
    accessSync(path, mode);
    return { state: "ok", content: readFileSync(path, "utf8") };
  } catch (error) {
    return error.code === "ENOENT" ? { state: "missing" } : { state: "denied" };
  }
};

const dispatcherProblems = (cwd) => {
  const name = `${HOOKS_PATH}/h(husky 디스패처)`;
  const file = probeFile(join(cwd, HOOKS_PATH, "h"), constants.R_OK);
  if (file.state === "missing") return [`${name}가 없거나 읽을 수 없습니다.`];
  if (file.state === "notFile") return [`${name}가 일반 파일이 아닙니다.`];
  if (file.state === "denied") return [`${name}가 없거나 읽을 수 없습니다 (읽기 권한 없음).`];
  const installed = readHuskyDispatcher();
  if (installed.error) return [installed.error];
  return sameShim(file.content, installed.value ?? HUSKY_DISPATCHER)
    ? []
    : [`${name}가 husky 디스패처와 달라 원본 훅을 부른다고 볼 수 없습니다.`];
};

const wrapperProblems = (cwd, hook) => {
  const name = `${HOOKS_PATH}/${hook}(실행 래퍼)`;
  const file = probeFile(join(cwd, HOOKS_PATH, hook), constants.R_OK | constants.X_OK);
  if (file.state === "notFile") return [`${name}가 일반 파일이 아닙니다.`];
  if (file.state !== "ok") return [`${name}가 없거나 실행할 수 없습니다.`];
  return sameShim(file.content, HUSKY_WRAPPER)
    ? []
    : [`${name}가 ${HOOKS_PATH}/h 를 부르지 않습니다.`];
};

const originalProblems = (cwd, hook) => {
  const name = `${HUSKY_DIR}/${hook}(원본 훅)`;
  const file = probeFile(join(cwd, HUSKY_DIR, hook), constants.R_OK);
  if (file.state === "notFile") return [`${name}이 일반 파일이 아닙니다.`];
  return file.state === "ok" ? [] : [`${name}이 없거나 읽을 수 없습니다.`];
};

const fileProblems = (cwd) => [
  ...dispatcherProblems(cwd),
  ...GATE_HOOKS.flatMap((hook) => [...wrapperProblems(cwd, hook), ...originalProblems(cwd, hook)]),
];

// repo: 이 폴더에 .git(디렉터리 또는 linked worktree 의 파일)이 있는가. 없으면 나머지는 보지 않는다.
// error: git 을 부르지 못했거나 최상위가 아닌 등, 훅 상태를 판단할 수 없는 이유.
// active: 실제 core.hooksPath 가 .husky/_ 인가. problems: 켜지지 않았거나 깨진 이유 전부.
export const inspectGitHooks = ({ cwd = process.cwd(), env = process.env } = {}) => {
  if (!existsSync(join(cwd, ".git"))) {
    return { repo: false, error: null, hooksPath: null, active: false, problems: [] };
  }

  const rootError = checkGitRoot(cwd, env);
  const hooksPath = rootError ? null : readHooksPath({ cwd, env });
  const error = rootError ?? (hooksPath.ok ? null : hooksPath.reason);
  if (error) return { repo: true, error, hooksPath: null, active: false, problems: [error] };

  const current = { value: hooksPath.value, scope: hooksPath.scope };
  const active = isGateHooksPath(cwd, current.value);
  const pathProblems = active
    ? []
    : [
        current.value === null
          ? `core.hooksPath 가 설정되지 않았습니다 (기대: ${HOOKS_PATH}).`
          : `core.hooksPath 가 ${current.value} (${current.scope}) 입니다 (기대: ${HOOKS_PATH}).`,
      ];

  return {
    repo: true,
    error: null,
    hooksPath: current,
    active,
    problems: [...pathProblems, ...fileProblems(cwd)],
  };
};
