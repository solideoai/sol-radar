// 명령 실행 — 셸 없이 실행 파일과 인자 배열을 그대로 넘긴다. macOS·Linux 에서는 child_process 와 같다.
//
// Windows 에서는 pnpm·claude 같은 명령이 실행 파일이 아니라 .cmd 래퍼다. Node 는 셸 없이 .cmd 를 찾지도
// 실행하지도 못하므로(ENOENT·EINVAL) PATH·PATHEXT 로 실제 파일을 찾고, .cmd·.bat 이면 cmd.exe 에 인자를
// 이스케이프해 넘긴다(cross-spawn 과 같은 규칙). 공백·따옴표·JSON·% 는 그대로 전달되지만 cmd.exe 는
// 줄바꿈이 든 인자와 8191자를 넘는 명령 줄을 넘기지 못한다. 여러 줄 값(프롬프트 등)은 표준 입력으로 넘긴다.
//
// 의존성(cross-spawn)을 쓰지 않는 이유: doctor 처럼 의존성 설치 전에도 돌아야 하는 스크립트가 이 파일을 쓰고,
// 시험은 스크립트만 임시 폴더에 복사해 돌린다.
import { spawn, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { delimiter, extname, join } from "node:path";

const isWindows = process.platform === "win32";
const META = /([()\][%!^"`<>&|;, *?])/g;

// Windows 환경변수 이름은 대소문자를 가리지 않는다. 객체로 복사한 env 에는 Path·PATH 가 함께 있을 수 있다.
const envValue = (env, name) =>
  env[
    Object.keys(env)
      .reverse()
      .find((key) => key.toUpperCase() === name) ?? name
  ];

const isFile = (path) => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

function resolveWindows(command, env) {
  const extensions = (envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const names = [...(extname(command) ? [command] : []), ...extensions.map((ext) => command + ext)];
  const dirs = /[\\/]/.test(command) ? [""] : (envValue(env, "PATH") ?? "").split(delimiter);
  return dirs.flatMap((dir) => names.map((name) => join(dir, name))).find(isFile);
}

const quote = (arg) =>
  `"${String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, "$1$1")}"`.replace(META, "^$1");

// [command, args, options] 를 이 운영체제에서 셸 없이 실행할 수 있는 모양으로 바꾼다.
export function commandLine(command, args = [], options = {}) {
  if (!isWindows) return [command, args, options];
  const env = options.env ?? process.env;
  const file = resolveWindows(command, env);
  if (!file || !/\.(cmd|bat)$/i.test(file)) return [file ?? command, args, options];
  const line = [file, ...args].map(quote).join(" ");
  return [
    envValue(env, "COMSPEC") ?? "cmd.exe",
    ["/d", "/s", "/c", `"${line}"`],
    { ...options, windowsVerbatimArguments: true },
  ];
}

export const spawnCommand = (command, args, options) =>
  spawn(...commandLine(command, args, options));

export const spawnCommandSync = (command, args, options) =>
  spawnSync(...commandLine(command, args, options));

// 자식과 그 자식까지 끝낸다. Windows 의 .cmd 는 cmd.exe 가 자식이라 그 아래 node 까지 같이 끝내야 한다.
export function killTree(child, signal = "SIGTERM") {
  try {
    if (isWindows)
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-child.pid, signal);
  } catch {
    /* 이미 끝났다 */
  }
}
