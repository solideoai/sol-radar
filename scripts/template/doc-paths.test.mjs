// 문서 경로 드리프트 시험(템플릿 전용) — README·docs/·.claude/**/*.md 의 백틱 안 저장소 경로가 실제로 있는지 본다.
// 실행: 루트에서 `pnpm test`. 새 프로젝트(pnpm bootstrap)에는 복사하지 않는다 — 제품의 문서는 제품이 고쳐 쓴다.
//
// 경로로 보는 것: 공백·자리표시(`<`·`*`·`{`·`$`·`…`)가 없고, 첫 마디가 저장소 맨 위에 있는 이름인 것
// (`scripts/verify.mjs`·`.claude/skills/`·`verify.config.json`). `src/app` 처럼 맨 위에 없는 이름으로
// 시작하면 다른 저장소를 가정한 예시로 보고 건너뛴다. 작업 기록 자리인 `polaris/` 도 건너뛴다. `path:12` 의 줄 번호와 `#제목` 은 떼고 본다.
// 있는지는 Git 이 아는 파일(추적·추적 예정)로 판단한다 — 설치·실행 결과에 따라 달라지지 않게.
// `.gitignore` 대상(비밀 env·설치물·로컬 설정)은 저장소에 없는 게 정상이라 통과시킨다.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

// 일부러 없는 경로(.gitignore 대상이 아닌 것). 사유를 함께 적는다.
const ABSENT = {
  "web/features": "색 검사가 새 폴더도 본다는 예시",
  "web/lib/theme.config.ts": "색 검사 대상 파일의 예시",
};

const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root, encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const known = new Set(
  files.flatMap((file) =>
    file
      .split("/")
      .map((_, i, parts) => parts.slice(0, i + 1).join("/") + (i < parts.length - 1 ? "/" : "")),
  ),
);
// polaris 는 뺀다. 스펙이 planned·in-progress·done 으로 옮겨 다니는 작업 기록 자리라 어떤 파일이 있는지가
// 그때그때 달라, 있다 없다를 문서와 대조하면 스펙을 옮길 때마다 시험이 흔들린다.
const tops = new Set(files.map((file) => file.split("/")[0]).filter((top) => top !== "polaris"));
const docs = files.filter((file) => file === "README.md" || /^(docs|\.claude)\/.*\.md$/.test(file));

const pathsIn = (text) =>
  [...text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\s]+)`/g)]
    .map(([, value]) => value.replace(/(:\d+(-\d+)?|#.*)$/, ""))
    .filter((value) => !/[<>*{}$|:…]/.test(value) && tops.has(value.split("/")[0]));

const mentioned = docs.flatMap((doc) =>
  pathsIn(readFileSync(join(root, doc), "utf8")).map((path) => ({ doc, path })),
);

// 경로나 그 상위 폴더가 .gitignore 에 걸리는가. 없는 파일도 규칙으로 판정한다(--no-index).
// 짧은 상위부터 하나씩 묻고 처음 걸리는 곳에서 멈춘다. 설치된 node_modules 안(pnpm 의 심볼릭 링크) 너머를
// git 에 물으면 fatal 이 나서 함께 물은 경로의 답까지 모두 사라진다(macOS·Linux 에서 web 을 설치한 뒤).
// 상위 마디는 폴더이므로 끝에 / 를 붙여 폴더 전용 규칙(node_modules/)에도 걸리게 한다.
// 문서가 끝에 / 를 붙여 폴더라고 적은 경로(`web/test-results/`)는 마지막 마디에도 붙인다. 붙이지 않으면 git 이 디스크를 보고
// 폴더인지 가려서, 그 폴더가 있는 곳(시험을 돌려 본 작업 폴더)과 없는 곳(CI 의 새 체크아웃)의 결과가 달라진다.
const isIgnored = (path) =>
  path
    .split("/")
    .filter(Boolean)
    .some(
      (_, i, parts) =>
        spawnSync(
          "git",
          [
            "check-ignore",
            "-q",
            "--no-index",
            "--",
            parts.slice(0, i + 1).join("/") +
              (i < parts.length - 1 || path.endsWith("/") ? "/" : ""),
          ],
          { cwd: root },
        ).status === 0,
    );

test("문서에 적힌 저장소 경로가 실제로 있다", () => {
  assert.ok(docs.includes("README.md") && docs.length > 10, "검사할 문서를 찾지 못했다");
  const absent = mentioned.filter(
    ({ path }) => !ABSENT[path] && !known.has(path) && !known.has(`${path}/`),
  );
  assert.ok(isIgnored("web/.env.local"), "gitignore 판정이 돌지 않는다");
  // 디스크에 없는 폴더도 폴더 전용 규칙으로 판정해야 한다(루트에는 이 폴더가 생기지 않는다).
  assert.ok(isIgnored("playwright-report/"), "없는 폴더가 폴더 전용 규칙에 걸리지 않는다");
  const ignored = new Set([...new Set(absent.map(({ path }) => path))].filter(isIgnored));
  const missing = absent
    .filter(({ path }) => !ignored.has(path))
    .map(({ doc, path }) => `${doc}: ${path}`);
  assert.deepEqual(
    missing,
    [],
    "없는 경로를 고치거나, 일부러 없는 것이면 ABSENT 에 사유와 함께 적는다",
  );
});

test("허용 목록의 경로는 정말 없고, 문서에 아직 쓰인다", () => {
  // 웹만·앱만 고른 프로젝트(pnpm bootstrap --mode)에는 없는 플랫폼의 폴더가 없어 그 경로를 경로로 세지 않는다.
  for (const path of Object.keys(ABSENT).filter((path) => tops.has(path.split("/")[0]))) {
    assert.equal(known.has(path), false, path);
    assert.ok(
      mentioned.some((entry) => entry.path === path),
      `${path}: 더 쓰이지 않으면 목록에서 지운다`,
    );
  }
});
