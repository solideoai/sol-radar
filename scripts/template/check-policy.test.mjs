// 변경분 정책 시험 — 커밋 게이트(--staged)와 CI(--base)가 같은 규칙으로 마이그레이션 수정·비밀값·env 실파일을 잡는지 본다.
// 실행: 루트에서 `pnpm test`
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { checkPolicy } from "../check-policy.mjs";

const root = process.cwd();
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "check-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: dir,
      env: cleanEnv,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (file, body) => {
    mkdirSync(resolve(dir, file, ".."), { recursive: true });
    writeFileSync(join(dir, file), body);
  };
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  git("config", "user.name", "test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  write("verify.config.json", readFileSync(join(root, "verify.config.json"), "utf8"));
  write(".claude/hooks/guard.sh", readFileSync(join(root, ".claude/hooks/guard.sh"), "utf8"));
  write("supabase/migrations/1_init.sql", "select 1;\n");
  git("add", "-A");
  git("commit", "-qm", "chore: init");
  return { dir, git, write, base: git("rev-parse", "HEAD") };
}

test("CI 정책은 훅 없이 커밋한 마이그레이션 변경과 비밀값을 잡는다", (t) => {
  const s = fixture(t);
  s.write("supabase/migrations/1_init.sql", "select 2;\n");
  s.write("secret.ts", 'export const token = "' + "sk_live_" + "123456789abcdef" + '";\n');
  s.git("add", "-A");
  s.git("commit", "-qm", "feat: invalid");
  const problems = checkPolicy(s.dir, s.base);
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(problems.join("\n"), /마이그레이션/);
  assert.match(problems.join("\n"), /시크릿/);
});

test("커밋 게이트·CI 정책은 이름 중간에 .env 가 든 코드 파일의 service_role 키를 잡는다", (t) => {
  const s = fixture(t);
  // 가짜 서명의 service_role JWT. 실행할 때 만들어 이 파일에 eyJ… 값이 그대로 적히지 않는다.
  const serviceRole = [
    { alg: "HS256", typ: "JWT" },
    { iss: "supabase", role: "service_role" },
  ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .concat("fake-signature")
    .join(".");
  s.write("web/lib/config.env.ts", `export const key = "${serviceRole}";\n`);
  s.git("add", "-A");
  // 스테이징 검사는 커밋 훅이 넘긴 GIT_INDEX_FILE 을 그대로 쓴다. 이 시험도 커밋 게이트 안에서 돌므로
  // 바깥 저장소의 인덱스를 읽지 않게, 게이트가 부르는 명령(checkPolicy(cwd, _, { staged: true }))을 깨끗한 환경에서 부른다.
  const staged = spawnSync(process.execPath, [join(root, "scripts/check-policy.mjs"), "--staged"], {
    cwd: s.dir,
    env: cleanEnv,
    encoding: "utf8",
  });
  assert.equal(staged.status, 1, staged.stdout);
  assert.match(staged.stderr, /web\/lib\/config\.env\.ts: service_role/);
  s.git("commit", "-qm", "feat: invalid");
  const problems = checkPolicy(s.dir, s.base);
  assert.equal(problems.length, 1, problems.join("\n"));
  assert.match(problems[0], /web\/lib\/config\.env\.ts: service_role/);
});

test("CI 정책은 새 마이그레이션과 빈 환경변수 예시를 허용한다", (t) => {
  const s = fixture(t);
  s.write("supabase/migrations/2_next.sql", "select 2;\n");
  s.write(".env.example", "SECRET_KEY=\n");
  s.git("add", "-A");
  s.git("commit", "-qm", "feat: valid");
  assert.deepEqual(checkPolicy(s.dir, s.base), []);
});
