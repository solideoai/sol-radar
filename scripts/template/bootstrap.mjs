#!/usr/bin/env node
// 새 프로젝트 만들기 — `pnpm bootstrap <새 폴더> --name <이름> [--mode web|mobile|both] [--dry-run]`
//
// 이 템플릿을 복사해 새 폴더에 내 프로젝트를 만든다. 원본은 읽기만 하고 지우거나 이름을 바꾸지 않는다.
// - 쓰기 전에 인자 검사·복사 계획·메타데이터 충돌 검사를 모두 끝낸다. 하나라도 어긋나면 아무것도 쓰지 않는다.
// - Git 저장소면 추적된 파일(작업 폴더의 현재 bytes)만 복사한다. 새 파일은 `git add` 한 뒤에 복사된다.
//   Git 이 없는 공식 ZIP 이면 템플릿 허용 목록(ZIP_ALLOWLIST)만 복사한다.
//   두 경우 모두 의존성·빌드·캐시·개인 파일·실제 env 값은 빼고, .env.example 은 넣는다. 심볼릭 링크를 만나면 멈춘다.
// - 템플릿 관리용(이 스크립트가 있는 scripts/template/ 와 template.yml 워크플로)은 복사하지 않고, 그것을 부르는 루트 스크립트 항목도 뺀다.
//   새 프로젝트는 제품이 쓰는 도구·게이트·시험만 갖는다.
// - 새 폴더는 이미 있으면(비어 있어도) 거부한다. 폴더는 배타적으로 만들고 파일도 덮어쓰지 않고 쓴다.
//   도중에 실패하면 만든 만큼을 지우지 않고 남겨 두고, 확인할 길을 알린다.
// - 이름은 JSON·TOML 의 해당 값 자리만 바꾼다. 서식·다른 필드·스크립트·의존성·버전은 그대로 둔다.
//   템플릿 기본값이 아닌 값(사용자가 바꾼 값)은 보존하고, 명시한 플래그와 부딪히면 쓰기 전에 충돌로 멈춘다.
// - 새 프로젝트 루트에 template.json(템플릿 이름·원본 커밋·만든 날짜)을 남긴다.
// 설치·git init·개발 서버 실행은 하지 않는다. 끝나면 다음 명령을 알려 준다.
//
// 종료: 0 성공(또는 --dry-run) · 1 계획·충돌·쓰기 실패 · 2 잘못된 인자
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "사용법: pnpm bootstrap <새 폴더> --name <소문자-이름> [--mode web|mobile|both] " +
  "[--ios-id <역도메인>] [--android-id <역도메인>] [--scheme <스킴>] [--dry-run]";

export const TEMPLATE_DEFAULTS = {
  name: "agentic-boilerplate",
  webPackage: "agentic-boilerplate-web",
  mobilePackage: "agentic-boilerplate-mobile",
  scheme: "agenticboilerplate",
  appId: "com.example.agenticboilerplate",
};

export const TEMPLATE_FILE = "template.json";

const PLATFORMS = { web: ["web"], mobile: ["mobile"], both: ["web", "mobile"] };
const PLATFORM_DIRS = ["web", "mobile"];

// Git 이 없는 공식 ZIP 에서 복사하는 최상위 파일·폴더. 없는 항목(예: 아직 없는 docs/)은 건너뛴다.
export const ZIP_ALLOWLIST = [
  ".claude",
  ".github",
  ".husky",
  "design",
  "docs",
  "mobile",
  "scripts",
  "supabase",
  "web",
  ".env.example",
  ".gitattributes",
  ".gitignore",
  ".mcp.json",
  ".nvmrc",
  ".prettierignore",
  ".prettierrc.json",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "verify.config.json",
  "package.json",
  "pnpm-lock.yaml",
];

// 템플릿 저장소만 쓰는 것: 새 프로젝트 만들기·템플릿 스모크·문서 대조 시험(scripts/template/)과
// 스모크·Windows 검증 워크플로. 새 프로젝트에 딸려 가면 제품의 README·문서를 고칠 때마다 템플릿 시험이 깨진다.
// scripts/ 의 도구 하나하나를 보는 단위 시험도 여기 둔다. 새 프로젝트가 고치지 않는 도구의 시험까지 물려받지 않게 한다.
const TEMPLATE_ONLY_DIR = "scripts/template/";
const TEMPLATE_ONLY_FILES = new Set([".github/workflows/template.yml"]);
// 위 파일을 부르는 루트 package.json 의 스크립트. 새 프로젝트에서는 가리키는 파일이 없으므로 항목도 뺀다.
export const TEMPLATE_ONLY_SCRIPTS = ["bootstrap", "smoke:template"];

// 최상위에서 통째로 빼는 폴더: 사후 기록·미션과 스펙(새 프로젝트가 스스로 세운다)
const EXCLUDED_TOP = new Set(["reports", "polaris"]);
// 어느 깊이에서든 빼는 폴더: 의존성·빌드·캐시·네이티브 생성물
const EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".pnpm-store",
  ".next",
  ".expo",
  ".turbo",
  ".vercel",
  ".cache",
  "out",
  "build",
  "dist",
  "coverage",
  "playwright-report",
  "test-results",
  ".playwright-mcp",
  "ios",
  "android",
]);
const PRIVATE_FILES = new Set([".DS_Store", "settings.local.json"]);
const SECRET_EXTENSIONS = [".pem", ".key", ".p8", ".p12", ".jks", ".mobileprovision"];

export class BootstrapError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}
const usageError = (message) => new BootstrapError(`${message}\n${USAGE}`, 2);

// 복사하지 않는 이유. 복사할 파일이면 null.
export function excludedReason(path) {
  const parts = path.split("/");
  const name = parts.at(-1);
  if (EXCLUDED_TOP.has(parts[0])) return "실행 기록·개인 문서";
  if (path.startsWith(TEMPLATE_ONLY_DIR) || TEMPLATE_ONLY_FILES.has(path)) return "템플릿 관리용";
  if (parts.slice(0, -1).some((part) => EXCLUDED_DIRS.has(part))) return "의존성·빌드·캐시";
  if (name === ".env" || (name.startsWith(".env.") && name !== ".env.example")) return "실제 env";
  if (SECRET_EXTENSIONS.some((extension) => name.endsWith(extension))) return "서명 키";
  if (PRIVATE_FILES.has(name)) return "개인 파일";
  if (name.endsWith(".tsbuildinfo") || /\.log$|debug\.log/.test(name)) return "의존성·빌드·캐시";
  // Finder 가 남기는 사본("spec 2.md")은 사용자 파일이다
  if (/ \d+(\.[^. ]+)?$/.test(name)) return "개인 파일";
  return null;
}

const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};

const symlinkError = (path) =>
  new BootstrapError(
    `${path} 는 심볼릭 링크입니다. 링크가 가리키는 바깥 파일을 복사하지 않도록 멈춥니다. 링크를 실제 파일로 바꾸거나 지운 뒤 다시 실행하세요.`,
  );

// 경로의 모든 단계가 실제 폴더·파일인지 본다. 링크를 거쳐 원본 밖을 읽지 않는다.
function readSourceFile(root, path) {
  const parts = path.split("/");
  for (const [index] of parts.entries()) {
    const prefix = parts.slice(0, index + 1).join("/");
    const stat = lstatOrNull(join(root, prefix));
    if (!stat) return null;
    if (stat.isSymbolicLink()) throw symlinkError(prefix);
    if (index < parts.length - 1 && !stat.isDirectory())
      throw new BootstrapError(`${prefix} 가 폴더가 아닙니다`);
    if (index === parts.length - 1 && !stat.isFile())
      throw new BootstrapError(
        `${path} 는 일반 파일이 아닙니다(하위 모듈 등). 템플릿에서 빼고 다시 실행하세요.`,
      );
  }
  const stat = lstatSync(join(root, path));
  return { path, bytes: readFileSync(join(root, path)), mode: stat.mode & 0o777 };
}

// 원본을 가리키는 GIT_DIR 같은 환경변수(커밋 훅 안에서 설정된다)를 지워, 늘 root 의 저장소를 읽는다.
const gitEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_PREFIX", "GIT_COMMON_DIR"].includes(
          key,
        ),
    ),
  );

function gitTrackedFiles(root) {
  const result = spawnSync("git", ["-C", root, "ls-files", "-z", "--cached"], {
    encoding: "utf8",
    env: { ...gitEnv(), GIT_OPTIONAL_LOCKS: "0" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new BootstrapError(
      `git 추적 파일 목록을 읽지 못했습니다: ${(result.error?.message ?? result.stderr).trim()}`,
    );
  return [...new Set(result.stdout.split("\0").filter(Boolean))].sort();
}

const isDropped = (path, dropped) => dropped.some((dir) => path.startsWith(`${dir}/`));

function collectGit(root, dropped) {
  const files = [];
  const excluded = [];
  for (const path of gitTrackedFiles(root)) {
    if (isDropped(path, dropped)) {
      excluded.push({ path, reason: "선택하지 않은 플랫폼" });
      continue;
    }
    const reason = excludedReason(path);
    if (reason) {
      excluded.push({ path, reason });
      continue;
    }
    const file = readSourceFile(root, path);
    if (file) files.push({ ...file, origin: "tracked" });
    else excluded.push({ path, reason: "작업 폴더에서 지워짐" });
  }
  return { files, excluded };
}

function collectZip(root, dropped) {
  const files = [];
  const excluded = [];
  const walk = (path) => {
    const stat = lstatSync(join(root, path));
    if (stat.isSymbolicLink()) throw symlinkError(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(join(root, path)).sort()) {
        const child = `${path}/${entry}`;
        if (isDropped(`${child}/`, dropped))
          excluded.push({ path: `${child}/`, reason: "선택하지 않은 플랫폼" });
        else if (EXCLUDED_DIRS.has(entry) && lstatSync(join(root, child)).isDirectory())
          excluded.push({ path: `${child}/`, reason: "의존성·빌드·캐시" });
        else walk(child);
      }
      return;
    }
    const reason = excludedReason(path);
    if (reason) excluded.push({ path, reason });
    else files.push({ ...readSourceFile(root, path), origin: "zip" });
  };
  for (const entry of readdirSync(root).sort()) {
    if (!ZIP_ALLOWLIST.includes(entry)) excluded.push({ path: entry, reason: "템플릿 목록 밖" });
    else if (PLATFORM_DIRS.includes(entry) && dropped.includes(entry))
      excluded.push({ path: `${entry}/`, reason: "선택하지 않은 플랫폼" });
    else walk(entry);
  }
  return { files, excluded };
}

// 새 프로젝트가 어느 템플릿·커밋에서 왔는지. ZIP 원본이면 커밋을 알 수 없어 비운다.
// Git 원본은 작업 폴더 bytes 를 복사하므로, 원본에 커밋하지 않은 변경이 있으면 이 커밋과 조금 다를 수 있다.
function templateRecord(root, source) {
  const head =
    source === "git"
      ? spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", env: gitEnv() })
      : null;
  const record = {
    template: TEMPLATE_DEFAULTS.name,
    commit: head?.status === 0 ? head.stdout.trim() : "",
    created: new Date().toISOString().slice(0, 10),
  };
  return {
    path: TEMPLATE_FILE,
    bytes: Buffer.from(`${JSON.stringify(record, null, 2)}
`),
    mode: 0o644,
    origin: "generated",
    record,
  };
}

// 원본에서 무엇을 복사할지 정한다. 아무것도 쓰지 않는다. 시험·스모크 검사가 같은 계획을 재사용한다.
export function planCopy(root, { mode = "both" } = {}) {
  const selected = PLATFORMS[mode];
  if (!selected) throw usageError(`--mode 는 web·mobile·both 중 하나입니다: ${mode}`);
  const dropped = PLATFORM_DIRS.filter((dir) => !selected.includes(dir));
  const dotGit = lstatOrNull(join(root, ".git"));
  const source = dotGit ? "git" : "zip";
  const { files, excluded } =
    source === "git" ? collectGit(root, dropped) : collectZip(root, dropped);
  const paths = new Set(files.map((file) => file.path));
  for (const dir of selected)
    if (!paths.has(`${dir}/package.json`))
      throw new BootstrapError(
        `원본에 ${dir}/package.json 이 없습니다. --mode 를 원본에 있는 플랫폼으로 고르세요.`,
      );
  // 원본이 bootstrap 으로 만든 프로젝트여도 기록은 새로 쓴다
  const record = templateRecord(root, source);
  const scripts = dropTemplateScripts(files.filter((file) => file.path !== TEMPLATE_FILE));
  return {
    source,
    platforms: selected,
    files: [...scripts.files, record],
    excluded,
    removedScripts: scripts.removed,
  };
}

// JSON 문자열 값이 놓인 자리 [시작, 끝]. JSON.parse 를 통과한 글만 받는다.
function locateString(text, target) {
  const cursor = { at: 0, hit: null };
  const skipSpace = () => {
    while (cursor.at < text.length && /\s/.test(text[cursor.at])) cursor.at += 1;
  };
  const readString = () => {
    const start = cursor.at;
    cursor.at += 1;
    while (text[cursor.at] !== '"') cursor.at += text[cursor.at] === "\\" ? 2 : 1;
    cursor.at += 1;
    return [start, cursor.at];
  };
  const samePath = (path) =>
    path.length === target.length && path.every((key, index) => key === target[index]);
  const readValue = (path) => {
    skipSpace();
    const char = text[cursor.at];
    if (char === "{" || char === "[") {
      const close = char === "{" ? "}" : "]";
      cursor.at += 1;
      skipSpace();
      if (text[cursor.at] === close) {
        cursor.at += 1;
        return;
      }
      for (const index of Array.from({ length: text.length }, (_, i) => i)) {
        skipSpace();
        if (char === "{") {
          const [start, end] = readString();
          const key = JSON.parse(text.slice(start, end));
          skipSpace();
          cursor.at += 1;
          readValue([...path, key]);
        } else readValue([...path, index]);
        skipSpace();
        const next = text[cursor.at];
        cursor.at += 1;
        if (next === close) return;
      }
    }
    if (char === '"') {
      const span = readString();
      if (samePath(path)) cursor.hit = span;
      return;
    }
    while (cursor.at < text.length && !/[\s,\]}]/.test(text[cursor.at])) cursor.at += 1;
  };
  readValue([]);
  return cursor.hit;
}

const valueAt = (object, path) => path.reduce((value, key) => value?.[key], object);

// 문자열 값 하나만 바꾼다. 나머지 bytes(서식·순서·다른 필드)는 그대로다.
export function setJsonString(text, path, value) {
  const span = locateString(text, path);
  if (!span) throw new BootstrapError(`${path.join(".")} 문자열 값을 찾지 못했습니다`);
  const next = text.slice(0, span[0]) + JSON.stringify(value) + text.slice(span[1]);
  if (valueAt(JSON.parse(next), path) !== value)
    throw new BootstrapError(`${path.join(".")} 를 바꾸지 못했습니다`);
  return next;
}

// TOML 맨 위(첫 [표] 앞)에 한 줄로 적힌 `키 = "값"`. 이스케이프 없는 기본 문자열만 다룬다(supabase/config.toml 의 project_id).
// s: 줄 끝의 \r(CRLF)도 꼬리(tail)로 받아 그대로 돌려놓는다.
const tomlLine = (key) => new RegExp(String.raw`^(\s*${key}\s*=\s*)"([^"\\]*)"(.*)$`, "s");

function findTomlString(text, key) {
  const lines = text.split("\n");
  const tableAt = lines.findIndex((line) => /^\s*\[/.test(line));
  const index = (tableAt === -1 ? lines : lines.slice(0, tableAt)).findIndex((line) =>
    tomlLine(key).test(line),
  );
  return index === -1 ? null : { lines, index, match: lines[index].match(tomlLine(key)) };
}

export const readTomlString = (text, key) => findTomlString(text, key)?.match[2];

// 문자열 값 하나만 바꾼다. 나머지 bytes(주석·다른 줄)는 그대로다.
export function setTomlString(text, key, value) {
  const found = findTomlString(text, key);
  if (!found) throw new BootstrapError(`${key} 문자열 값을 찾지 못했습니다`);
  const [, head, , tail] = found.match;
  const next = found.lines.with(found.index, `${head}${JSON.stringify(value)}${tail}`).join("\n");
  if (readTomlString(next, key) !== value) throw new BootstrapError(`${key} 를 바꾸지 못했습니다`);
  return next;
}

// 메타데이터 값 하나를 읽고 바꾼다. 형식은 확장자로 가른다.
function readMetadata(edit, text) {
  if (edit.file.endsWith(".toml")) return readTomlString(text, edit.path[0]);
  try {
    return valueAt(JSON.parse(text), edit.path);
  } catch (error) {
    throw new BootstrapError(`${edit.file} 를 JSON 으로 읽지 못했습니다: ${error.message}`);
  }
}

const writeMetadata = (edit, text) =>
  edit.file.endsWith(".toml")
    ? setTomlString(text, edit.path[0], edit.to)
    : setJsonString(text, edit.path, edit.to);

// package.json 의 scripts 에서 항목 하나를 줄째로 지운다. 나머지 bytes(서식·순서·다른 항목)는 그대로다.
// 항목마다 한 줄인 서식(Prettier)을 전제한다. 그 모양이 아니거나 결과가 기대와 다르면 고치지 않고 멈춘다.
export function removeJsonScript(text, name) {
  const parsed = JSON.parse(text);
  if (typeof parsed.scripts?.[name] !== "string") return text;
  const fail = () => new BootstrapError(`package.json 의 scripts.${name} 항목을 빼지 못했습니다`);
  const span = locateString(text, ["scripts", name]);
  if (!span) throw fail();
  const lineStart = text.lastIndexOf("\n", span[0]) + 1;
  const lineEnd = text.indexOf("\n", span[1]);
  if (lineEnd === -1) throw fail();
  const line = text.slice(lineStart, lineEnd).trim();
  if (line.replace(/,$/, "") !== `${JSON.stringify(name)}: ${text.slice(span[0], span[1])}`)
    throw fail();
  // 마지막 항목이었으면 앞 줄의 쉼표를 뗀다
  const head = line.endsWith(",")
    ? text.slice(0, lineStart)
    : text.slice(0, lineStart).replace(/,(\r?\n)$/, "$1");
  const next = head + text.slice(lineEnd + 1);
  const { [name]: _removed, ...scripts } = parsed.scripts;
  if (JSON.stringify(JSON.parse(next)) !== JSON.stringify({ ...parsed, scripts })) throw fail();
  return next;
}

// 템플릿 관리용 파일을 부르는 루트 스크립트 항목을 뺀다. 가리키는 파일을 복사하지 않기 때문이다.
function dropTemplateScripts(files) {
  const removed = [];
  const next = files.map((file) => {
    if (file.path !== "package.json") return file;
    const original = file.bytes.toString("utf8");
    const text = (() => {
      try {
        JSON.parse(original);
      } catch (error) {
        throw new BootstrapError(`package.json 을 JSON 으로 읽지 못했습니다: ${error.message}`);
      }
      return TEMPLATE_ONLY_SCRIPTS.reduce((current, name) => {
        const stripped = removeJsonScript(current, name);
        if (stripped !== current) removed.push(name);
        return stripped;
      }, original);
    })();
    return text === original ? file : { ...file, bytes: Buffer.from(text, "utf8") };
  });
  return { files: next, removed };
}

const compact = (name) => name.replaceAll("-", "");

function metadataEdits(options) {
  const appId = `com.example.${compact(options.name)}`;
  return [
    { file: "package.json", path: ["name"], from: TEMPLATE_DEFAULTS.name, to: options.name },
    {
      file: "web/package.json",
      path: ["name"],
      from: TEMPLATE_DEFAULTS.webPackage,
      to: `${options.name}-web`,
    },
    { file: "web/project.json", path: ["title"], from: TEMPLATE_DEFAULTS.name, to: options.name },
    {
      file: "mobile/package.json",
      path: ["name"],
      from: TEMPLATE_DEFAULTS.mobilePackage,
      to: `${options.name}-mobile`,
    },
    {
      file: "mobile/app.json",
      path: ["expo", "name"],
      from: TEMPLATE_DEFAULTS.name,
      to: options.name,
    },
    {
      file: "mobile/app.json",
      path: ["expo", "slug"],
      from: TEMPLATE_DEFAULTS.name,
      to: options.name,
    },
    {
      file: "mobile/app.json",
      path: ["expo", "scheme"],
      from: TEMPLATE_DEFAULTS.scheme,
      to: options.scheme ?? compact(options.name),
      explicit: options.scheme !== undefined,
    },
    {
      file: "mobile/app.json",
      path: ["expo", "ios", "bundleIdentifier"],
      from: TEMPLATE_DEFAULTS.appId,
      to: options.iosId ?? appId,
      explicit: options.iosId !== undefined,
      preview: options.iosId === undefined,
    },
    {
      file: "mobile/app.json",
      path: ["expo", "android", "package"],
      from: TEMPLATE_DEFAULTS.appId,
      to: options.androidId ?? appId,
      explicit: options.androidId !== undefined,
      preview: options.androidId === undefined,
    },
    // 로컬 Supabase 의 Docker 컨테이너·볼륨 이름 앞에 붙는다. 템플릿과 같으면 두 프로젝트가 같은 로컬 DB 를 쓴다.
    {
      file: "supabase/config.toml",
      path: ["project_id"],
      from: TEMPLATE_DEFAULTS.name,
      to: options.name,
    },
  ];
}

// 계획의 메타데이터 파일 bytes 를 새 이름으로 바꾼다. 충돌이 하나라도 있으면 아무것도 바꾸지 않고 멈춘다.
export function applyMetadata(files, options) {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const texts = new Map();
  const changes = [];
  const kept = [];
  const conflicts = [];
  for (const edit of metadataEdits(options)) {
    const file = byPath.get(edit.file);
    if (!file) continue;
    const text = texts.get(edit.file) ?? file.bytes.toString("utf8");
    const current = readMetadata(edit, text);
    const label = `${edit.file} ${edit.path.join(".")}`;
    if (current === edit.to) {
      if (edit.preview) changes.push({ label, from: current, to: edit.to, preview: true });
    } else if (current === edit.from) {
      texts.set(edit.file, writeMetadata(edit, text));
      changes.push({ label, from: current, to: edit.to, preview: edit.preview });
    } else if (edit.explicit)
      conflicts.push(
        `${label}: 원본 값 ${JSON.stringify(current)} 가 템플릿 기본값이 아니라서 ${JSON.stringify(edit.to)} 로 덮지 않습니다`,
      );
    else kept.push({ label, value: current });
  }
  if (conflicts.length)
    throw new BootstrapError(
      `메타데이터 충돌 — 아무것도 쓰지 않았습니다.\n${conflicts.map((line) => `- ${line}`).join("\n")}\n` +
        "원본의 값을 쓰려면 해당 플래그를 빼고, 바꾸려면 원본에서 먼저 고치세요.",
    );
  const next = files.map((file) =>
    texts.has(file.path) ? { ...file, bytes: Buffer.from(texts.get(file.path), "utf8") } : file,
  );
  return { files: next, changes, kept };
}

const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const SCHEME = /^[a-z][a-z0-9+.-]*$/;
const VALUE_FLAGS = {
  "--name": "name",
  "--mode": "mode",
  "--ios-id": "iosId",
  "--android-id": "androidId",
  "--scheme": "scheme",
};

export function parseArgs(argv) {
  const options = { dryRun: false };
  const positional = [];
  const queue = [...argv];
  while (queue.length) {
    const arg = queue.shift();
    const [flag, inline] = arg.startsWith("--") && arg.includes("=") ? arg.split(/=(.*)/s) : [arg];
    if (flag === "--dry-run" && inline === undefined) {
      if (options.dryRun) throw usageError("--dry-run 을 두 번 적었습니다");
      options.dryRun = true;
    } else if (VALUE_FLAGS[flag]) {
      const key = VALUE_FLAGS[flag];
      const value = inline ?? queue.shift();
      if (value === undefined || value === "" || value.startsWith("-"))
        throw usageError(`${flag} 에 값이 없습니다`);
      if (options[key] !== undefined) throw usageError(`${flag} 를 두 번 적었습니다`);
      options[key] = value;
    } else if (arg.startsWith("-")) throw usageError(`모르는 옵션입니다: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw usageError("새 폴더 경로를 하나만 적으세요");
  options.target = positional[0];
  options.mode ??= "both";
  if (!PLATFORMS[options.mode])
    throw usageError(`--mode 는 web·mobile·both 중 하나입니다: ${options.mode}`);
  if (options.name === undefined) throw usageError("--name 이 필요합니다");
  if (!NAME.test(options.name) || options.name.length > 50)
    throw usageError(
      `--name 은 영문 소문자로 시작하는 소문자·숫자·하이픈(50자 이내)입니다: ${options.name}`,
    );
  const mobile = PLATFORMS[options.mode].includes("mobile");
  for (const [flag, key, pattern] of [
    ["--ios-id", "iosId", APP_ID],
    ["--android-id", "androidId", APP_ID],
    ["--scheme", "scheme", SCHEME],
  ]) {
    if (options[key] === undefined) continue;
    if (!mobile) throw usageError(`${flag} 는 앱(mobile)을 만들 때만 씁니다`);
    if (!pattern.test(options[key]))
      throw usageError(`${flag} 형식이 올바르지 않습니다: ${options[key]}`);
  }
  return options;
}

// 새 폴더 자리를 확인한다. 이미 있으면(비어 있어도, 링크여도) 거부하고, 원본 안이면 거부한다.
function checkDestination(root, destination) {
  if (lstatOrNull(destination))
    throw new BootstrapError(
      `${destination} 가 이미 있습니다. 기존 폴더는 덮지 않습니다. 없는 새 경로를 고르세요.`,
    );
  const parent = dirname(destination);
  const parentStat = (() => {
    try {
      return realpathSync(parent);
    } catch {
      return null;
    }
  })();
  if (!parentStat || !lstatSync(parentStat).isDirectory())
    throw new BootstrapError(
      `상위 폴더 ${parent} 가 없습니다. 먼저 만들거나 다른 경로를 고르세요.`,
    );
  const realDestination = join(parentStat, basename(destination));
  const realRoot = realpathSync(root);
  if (realDestination === realRoot || realDestination.startsWith(`${realRoot}${sep}`))
    throw new BootstrapError(`${destination} 는 원본 템플릿 안입니다. 원본 밖의 경로를 고르세요.`);
}

// 쓰기 전에 끝내는 전체 계획: 인자·목적지·복사 목록·메타데이터
export function planBootstrap(argv, { root, cwd }) {
  const options = parseArgs(argv);
  const destination = resolve(cwd, options.target);
  checkDestination(root, destination);
  const copy = planCopy(root, { mode: options.mode });
  const metadata = applyMetadata(copy.files, options);
  return { options, destination, ...copy, ...metadata };
}

const quote = (value) =>
  /^[\w./:@-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;

function describe(plan, print) {
  const counts = plan.excluded.reduce(
    (total, { reason }) => ({ ...total, [reason]: (total[reason] ?? 0) + 1 }),
    {},
  );
  print(`원본: ${plan.source === "git" ? "Git 추적 파일" : "ZIP 템플릿 허용 목록"}`);
  print(`플랫폼: ${plan.platforms.join(", ")} → ${plan.destination}`);
  print(`복사할 파일: ${plan.files.length}개`);
  const { commit } = plan.files.find((file) => file.path === TEMPLATE_FILE).record;
  print(`기록: ${TEMPLATE_FILE} (템플릿 커밋 ${commit ? commit.slice(0, 7) : "없음 — ZIP 원본"})`);
  for (const [reason, count] of Object.entries(counts)) print(`  뺌(${reason}): ${count}개`);
  for (const name of plan.removedScripts)
    print(`  뺌(템플릿 관리용): package.json scripts.${name}`);
  for (const change of plan.changes)
    print(
      `바꿈: ${change.label} ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}` +
        (change.preview ? " (로컬 미리보기용 예시 ID)" : ""),
    );
  for (const item of plan.kept)
    print(`그대로 둠(템플릿 기본값이 아님): ${item.label} = ${JSON.stringify(item.value)}`);
  if (plan.changes.some((change) => change.preview))
    print(
      "com.example ID 는 로컬 미리보기용입니다. 스토어에 올리기 전에 --ios-id·--android-id 로 내 ID 를 정해 새로 만들거나 mobile/app.json 을 고치세요.",
    );
}

function nextSteps(plan, print) {
  const has = (platform) => plan.platforms.includes(platform);
  print("\n다음 순서:");
  print(`  cd ${quote(plan.destination)}`);
  print("  git init");
  print("  pnpm install --frozen-lockfile");
  for (const platform of plan.platforms) print(`  pnpm -C ${platform} install --frozen-lockfile`);
  print("  pnpm run doctor");
  if (has("web")) print("  pnpm -C web dev");
  if (has("mobile")) print("  pnpm -C mobile start");
  print("  pnpm verify");
}

export function runBootstrap(
  argv,
  { root, cwd = process.cwd(), stdout = console.log, stderr = console.error, hooks = {} },
) {
  const plan = (() => {
    try {
      return planBootstrap(argv, { root, cwd });
    } catch (error) {
      if (!(error instanceof BootstrapError)) throw error;
      stderr(`✗ ${error.message}`);
      return error.exitCode;
    }
  })();
  if (typeof plan === "number") return plan;
  describe(plan, stdout);
  if (plan.options.dryRun) {
    for (const file of plan.files) stdout(`  ${file.path}`);
    stdout("--dry-run: 아무것도 쓰지 않았습니다.");
    return 0;
  }
  hooks.beforeCreate?.(plan.destination);
  try {
    mkdirSync(plan.destination);
  } catch (error) {
    stderr(
      `✗ ${plan.destination} 를 만들지 못했습니다(${error.code ?? error.message}). 그 사이 다른 곳에서 만들었을 수 있습니다. 아무것도 쓰지 않았습니다. 다른 경로를 고르세요.`,
    );
    return 1;
  }
  const write = hooks.writeFile ?? writeFileSync;
  const written = { count: 0 };
  try {
    for (const file of plan.files) {
      const target = join(plan.destination, ...file.path.split("/"));
      mkdirSync(dirname(target), { recursive: true });
      write(target, file.bytes, { flag: "wx", mode: file.mode });
      written.count += 1;
    }
  } catch (error) {
    stderr(
      `✗ 복사 도중 실패했습니다: ${error.message}\n` +
        `  ${plan.destination} 에 ${written.count}/${plan.files.length}개만 만들어졌고, 지우지 않고 남겨 두었습니다. 원본은 바뀌지 않았습니다.\n` +
        "  남은 내용을 확인해 직접 정리하거나, 다른 새 경로로 다시 실행하세요.",
    );
    return 1;
  }
  stdout(`✓ ${plan.destination} 에 새 프로젝트를 만들었습니다.`);
  nextSteps(plan, stdout);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  // pnpm 은 스크립트를 루트에서 돌리므로, 사용자가 명령을 친 폴더(INIT_CWD) 기준으로 상대 경로를 푼다.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  process.exitCode = runBootstrap(process.argv.slice(2), { root, cwd });
}
