// 문서 대조 시험(템플릿 전용) — README·docs/ 가 실제 파일·스크립트·env 자리와 맞고, 새 프로젝트에도 이어지는지 본다.
// 실행: 루트에서 `pnpm test`. 새 프로젝트(pnpm bootstrap)에는 복사하지 않는다 — 제품의 README·문서는 제품이 고쳐 쓴다.
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { runBootstrap } from "./bootstrap.mjs";
import { loadConfig, presentProjects } from "../project-config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const real = (path) => readFileSync(join(REPO, path));
// 한쪽만 고른 프로젝트에서는 없는 플랫폼의 시험·대조를 건너뛴다. 판정은 verify 와 같은 marker 기준이다.
const PRESENT = new Set(
  presentProjects(REPO, loadConfig(REPO)).map((project) => project.directory),
);
const DROPPED = ["web", "mobile"].filter((dir) => !PRESENT.has(dir));
const inDropped = (path) => DROPPED.includes(path.split("/")[0]);
const skipUnless = (dir) => (PRESENT.has(dir) ? false : `${dir}/ 가 없는 프로젝트`);
const scratch = mkdtempSync(join(tmpdir(), "docs-test-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const fresh = (name) => mkdtempSync(join(scratch, `${name}-`));

const put = (root, files) => {
  for (const [path, bytes] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
};

// ── 문서 연결 ──
const README = "README.md";
const GUIDE = "docs/first-deployment.md";
// README 는 빠른 시작만 두고 상세는 docs/ 로 나눴다. 명령·env 이름 대조는 docs/ 의 모든 문서에 건다.
const DOCS = [
  README,
  ...readdirSync(join(REPO, "docs"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/${name}`),
];

// 문서 안의 로컬 마크다운 링크 → 저장소 기준 경로(앵커 제거). 바깥 주소·앵커만 있는 링크는 뺀다.
function localLinks(doc, root = REPO) {
  const text = readFileSync(join(root, doc), "utf8");
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((match) => match[1].split("#")[0])
    .filter((target) => target && !/^[a-z][a-z0-9+.-]*:/i.test(target))
    .map((target) => posix.normalize(posix.join(posix.dirname(doc), target)));
}

// 코드 조각(펜스 블록·인라인 코드) 안의 글
function codeText(doc) {
  const text = readFileSync(join(REPO, doc), "utf8");
  const fenced = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  const inline = [...text.replace(/```[\s\S]*?```/g, "").matchAll(/`([^`\n]+)`/g)].map(
    (match) => match[1],
  );
  return [...fenced, ...inline].join("\n");
}

const scriptsOf = (dir) =>
  Object.keys(JSON.parse(real(posix.join(dir, "package.json"))).scripts ?? {});
// pnpm 자체 명령과 그 별칭(update·up·upgrade, remove·rm·uninstall·un). 이 이름은 package.json 스크립트와 대조하지 않는다.
const PNPM_BUILTINS = new Set([
  ...["install", "i", "add", "dlx", "exec", "audit"],
  ...["update", "up", "upgrade"],
  ...["remove", "rm", "uninstall", "un"],
]);
// 문서가 폴더 없이 쓰는 플랫폼 전용 이름(Vercel 은 Root Directory=web 에서 부른다)·환경 변수 앞머리.
// 그 플랫폼이 있으면 아래 시험이 이 목록도 실제 package.json 과 대조한다.
const OWNED = { web: ["vercel-build"], mobile: [] };
const OWNED_ENV = { web: /^(?:NEXT_PUBLIC|VERCEL|REQUIRE)_/, mobile: /^EXPO_PUBLIC_/ };

describe("배포 안내 문서가 실제 파일·스크립트·env 자리와 맞다", () => {
  test("README 가 첫 배포 안내로 이어지고, 두 문서의 로컬 링크가 모두 실제 파일이다", () => {
    assert.ok(localLinks(README).includes(GUIDE), "README 에 첫 배포 안내 링크가 있어야 한다");
    for (const doc of DOCS)
      for (const target of localLinks(doc)) {
        assert.ok(!target.startsWith("../"), `${doc}: 저장소 밖 링크 ${target}`);
        if (inDropped(target)) continue;
        assert.ok(existsSync(join(REPO, target)), `${doc}: 없는 파일 링크 ${target}`);
      }
  });

  test("문서의 pnpm 명령은 해당 폴더 package.json 의 스크립트다", () => {
    const platforms = [...PRESENT];
    const scripts = { "": [".", ...platforms].flatMap(scriptsOf) };
    for (const dir of platforms) {
      scripts[dir] = scriptsOf(dir);
      for (const name of OWNED[dir])
        assert.ok(scripts[dir].includes(name), `${dir}/package.json 에 ${name} 가 있어야 한다`);
    }
    // 한 줄 안에서만 찾는다 — 코드 조각을 줄바꿈으로 이었으므로 줄을 넘으면 다른 조각의 단어를 명령으로 오인한다
    const pattern =
      /\bpnpm(?:[ \t]+--silent)?(?:[ \t]+-C[ \t]+(web|mobile))?(?:[ \t]+run)?[ \t]+([a-z][\w:-]*)/g;
    for (const doc of DOCS) {
      const commands = [...codeText(doc).matchAll(pattern)];
      // 명령을 안내하는 두 문서는 명령이 있어야 한다(대조할 것이 없으면 이 시험이 아무것도 안 본다).
      if ([README, GUIDE].includes(doc))
        assert.ok(commands.length, `${doc}: pnpm 명령을 찾지 못했다`);
      for (const [command, dir = "", name] of commands) {
        if (PNPM_BUILTINS.has(name)) continue;
        // 없는 플랫폼의 명령(-C 로 그 폴더를 가리키거나, 폴더 없이 쓴 그 플랫폼 전용 이름)만 건너뛴다
        if (DROPPED.includes(dir) || (dir === "" && DROPPED.some((d) => OWNED[d].includes(name))))
          continue;
        assert.ok(scripts[dir].includes(name), `${doc}: 없는 스크립트 ${command}`);
      }
    }
  });

  test("문서의 환경 변수 이름은 env 예시나 배포 스크립트에 실제로 있다", () => {
    const sources = [
      ".env.example",
      "web/.env.example",
      "mobile/.env.example",
      "web/scripts/vercel-build.sh",
      "scripts/db-verify.mjs",
    ]
      .filter((path) => !inDropped(path))
      .map((path) => real(path).toString("utf8"))
      .join("\n");
    for (const doc of DOCS) {
      const names = new Set(
        readFileSync(join(REPO, doc), "utf8").match(
          /\b(?:NEXT_PUBLIC|EXPO_PUBLIC|SUPABASE|REQUIRE|VERCEL)_[A-Z0-9_]*[A-Z0-9]\b/g,
        ),
      );
      for (const name of names) {
        if (DROPPED.some((dir) => OWNED_ENV[dir].test(name))) continue;
        assert.match(sources, new RegExp(`\\b${name}\\b`), `${doc}: 코드에 없는 환경 변수 ${name}`);
      }
    }
  });

  test("첫 배포 안내는 Vercel·Expo 공식 문서를 근거로 단다", () => {
    const hosts = new Set(
      [...readFileSync(join(REPO, GUIDE), "utf8").matchAll(/\]\((https:\/\/[^)\s]+)\)/g)].map(
        (match) => new URL(match[1]).host,
      ),
    );
    assert.ok(hosts.has("vercel.com"));
    assert.ok(hosts.has("docs.expo.dev"));
  });
});

// ── 새 프로젝트에서도 안내가 이어진다 ──
// 공식 ZIP 처럼 .git 없는 원본에 두 문서와 그 링크 대상, 메타데이터 파일의 실제 bytes 를 둔다.
function makeZipTemplate() {
  const root = fresh("zip");
  const paths = new Set([
    ...DOCS,
    "package.json",
    "web/package.json",
    "web/project.json",
    "mobile/package.json",
    "mobile/app.json",
  ]);
  for (const doc of DOCS) for (const target of localLinks(doc)) paths.add(target);
  for (const path of paths) if (inDropped(path)) paths.delete(path);
  for (const path of paths)
    assert.ok(statSync(join(REPO, path)).isFile(), `링크 대상은 파일이어야 한다: ${path}`);
  put(root, Object.fromEntries([...paths].map((path) => [path, real(path)])));
  return root;
}

describe("bootstrap 으로 만든 새 프로젝트에도 첫 배포 안내가 이어진다", () => {
  const PLATFORMS = { web: ["web"], mobile: ["mobile"], both: ["web", "mobile"] };
  for (const [mode, platforms] of Object.entries(PLATFORMS))
    test(`--mode ${mode}`, { skip: platforms.map(skipUnless).find(Boolean) ?? false }, () => {
      const root = makeZipTemplate();
      const destination = join(fresh("out"), "my-app");
      const errors = [];
      const status = runBootstrap([destination, "--name", "my-app", "--mode", mode], {
        root,
        cwd: scratch,
        stdout: () => {},
        stderr: (line) => errors.push(line),
      });
      assert.equal(status, 0, errors.join("\n"));
      for (const doc of DOCS)
        assert.deepEqual(
          readFileSync(join(destination, doc)),
          real(doc),
          `${doc} bytes 가 같아야 한다`,
        );
      assert.ok(localLinks(README, destination).includes(GUIDE));
      const dropped = ["web", "mobile"].filter((dir) => !platforms.includes(dir));
      for (const doc of DOCS)
        for (const target of localLinks(doc, destination)) {
          const top = target.split("/")[0];
          assert.equal(
            existsSync(join(destination, target)),
            !dropped.includes(top),
            `${mode}: ${doc} → ${target}`,
          );
        }
    });
});
