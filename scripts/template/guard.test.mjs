// Claude 가드(.claude/hooks/guard.sh) 테스트.
// 막아야 할 실행은 막고, 같은 글자를 검색·문서·메시지로 다루는 일은 통과시키는지 본다.
// 실행: 루트에서 `pnpm test`
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it as test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const decide = async (input) => {
  // 종료 코드가 0 이 아니면 stderr 를 담아 거부된다.
  const guard = execFileAsync("bash", [join(root, ".claude/hooks/guard.sh")]);
  guard.child.stdin.end(JSON.stringify(input));
  const { stdout } = await guard;
  return stdout.trim() ? JSON.parse(stdout).hookSpecificOutput.permissionDecision : "allow";
};
const run = (command) => decide({ tool_name: "Bash", tool_input: { command } });
const write = (file_path, content) =>
  decide({ tool_name: "Write", tool_input: { file_path, content } });

// 가드 한 번은 bash 와 node 를 띄운다. Windows 는 프로세스 하나가 비싸서 하나씩 기다리면 느리다.
// 그래서 판정은 걸어만 두고(expects), it 이 끝날 때 한꺼번에 기다린다.
const pending = [];
const expects = (decision, expected, message) =>
  pending.push(decision.then((actual) => assert.equal(actual, expected, message)));
const it = (name, body) =>
  test(name, async (t) => {
    body(t);
    await Promise.all(pending.splice(0));
  });

const denies = (command) => expects(run(command), "deny", command);
const allows = (command) => expects(run(command), "allow", command);

// 진짜 키처럼 생긴 값. 소스에 이어 붙여 적지 않아야 이 파일이 커밋 게이트에 걸리지 않는다.
const secret = ["sb", "secret", "a1b2c3d4e5f6g7h8"].join("_");

// Supabase JWT 키와 같은 모양(헤더.본문.서명)의 가짜 값. 서명은 가짜이고, 본문의 role 만 다르다.
// 실행할 때 base64 로 만들어 이 파일에는 eyJ… 값이 그대로 적히지 않는다.
const jwt = (role) =>
  [
    { alg: "HS256", typ: "JWT" },
    { iss: "supabase", ref: "abcdefghijklmnopqrst", role },
  ]
    .map((part) => Buffer.from(JSON.stringify(part)).toString("base64url"))
    .concat("fake-signature")
    .join(".");
const serviceRole = jwt("service_role");
const anon = jwt("anon");

// .env 의 이름과 값 사이. Next·Expo 의 env 로더는 = 앞뒤의 공백·탭을 걷어 내고 읽고,
// Next 는 `이름: 값` 도 읽는다. 어느 쪽으로 적어도 같은 공개 변수가 된다.
const separators = ["=", " = ", "= ", "\t=\t", ": "];

describe("커밋 게이트 우회", () => {
  it("--no-verify 와 커밋의 -n 은 막는다", () => {
    denies('git commit --no-verify -m "feat: x"');
    denies('git commit -m "feat: x" --no-verify;');
    denies("git commit --no-verif -m x");
    denies('git commit -n -m "feat: x"');
    denies('git commit -anm "feat: x"');
    denies("cd web && git commit -n -m x");
    denies("git merge --no-verify feature");
  });

  it("HUSKY 변수와 core.hooksPath 바꾸기·지우기는 막는다", () => {
    denies('HUSKY=0 git commit -m "feat: x"');
    denies('export HUSKY="0" && git commit -m x');
    denies("git -c core.hooksPath=/dev/null commit -m x");
    denies('git -c "core.hooksPath=/dev/null" commit -m x');
    denies("git config core.hooksPath /dev/null");
    denies("git config --unset core.hooksPath");
  });

  it("같은 글자를 검색하거나 메시지에 적는 것은 통과시킨다", () => {
    allows("grep -rn HUSKY=0 scripts");
    allows("grep -rn -- --no-verify .husky");
    allows('git commit -m "docs: --no-verify 와 -n 을 막는 이유"');
    allows("git commit --amend --no-edit");
    allows("git merge -n feature");
    allows("git log -n 5");
    allows("git config --get core.hooksPath");
  });
});

describe("이력 없는 DB 변경", () => {
  it("db reset 과 psql 로 보내는 파괴적 SQL 은 막는다", () => {
    denies("supabase db reset");
    denies("npx supabase db reset --linked");
    denies('psql "$SUPABASE_DB_URL" -c "drop table public.notes"');
    denies('psql "$SUPABASE_DB_URL" -c "DROP SCHEMA public cascade"');
    denies(
      `node -e "new (require('pg').Client)(process.env.SUPABASE_DB_URL).query('truncate notes')"`,
    );
  });

  it("문서를 검색하거나 읽기만 하는 SQL 은 통과시킨다", () => {
    allows('grep -rn "supabase db reset" .claude');
    allows('grep -n "drop table" supabase/migrations docs/psql.md');
    allows('psql "$SUPABASE_DB_URL" -c "select 1"');
  });
});

describe("비밀 키가 적히는 자리", () => {
  it(".env 실파일에 쓰는 것은 통과시킨다", () => {
    allows(`echo "SUPABASE_SECRET=${secret}" >> web/.env.local`);
    allows(`echo "SUPABASE_SECRET=${secret}" | tee -a web/.env.local mobile/.env > /dev/null`);
    allows(`echo "SUPABASE_SECRET=${secret}" | tee -a web/.env.local 2>/dev/null`);
    expects(write("web/.env.local", `SUPABASE_SECRET=${secret}`), "allow");
  });

  it("명령에 .env 가 섞여 있어도 다른 파일에 쓰면 막는다", () => {
    denies(`cat web/.env.local; echo "${secret}" > web/app/key.ts`);
    denies(`echo "${secret}" > web/.env.example`);
    expects(write("web/app/key.ts", `export const key = "${secret}";`), "deny");
  });

  it("tee 의 여러 파일과 >| 도 쓰는 곳으로 보고, 하나라도 .env 실파일이 아니면 막는다", () => {
    denies(`echo "${serviceRole}" | tee web/.env.local web/lib/app.ts`);
    denies(`echo "${secret}" | tee -a web/.env.local web/lib/app.ts`);
    denies(`echo x >> web/.env.local; echo "${secret}" >| web/app/key.ts`);
  });

  // tee 를 못 보고 넘기면 남은 쓰는 곳이 전부 .env 라서 예외가 풀린다. 아래는 모두 tee 가 app 파일에 쓴다.
  it("명령 위치의 tee 는 줄 처음·연결 기호·sudo·경로·역슬래시 뒤 어디서든 쓰는 곳으로 센다", () => {
    [
      `echo "${secret}" | tee web/app/key.ts >> web/.env.local`,
      `echo "${secret}"|tee -a web/app/key.ts >> web/.env.local`,
      `echo "${secret}" |\ttee web/app/key.ts >> web/.env.local`,
      `echo "${secret}" | sudo tee web/app/key.ts >> web/.env.local`,
      `echo "${secret}" | /usr/bin/tee web/app/key.ts >> web/.env.local`,
      `echo "${secret}" | \\tee web/app/key.ts >> web/.env.local`,
      `echo "${secret}" | (tee web/app/key.ts) >> web/.env.local`,
      `tee web/app/key.ts <<< "${secret}" >> web/.env.local`,
      `echo x >> web/.env.local\ntee web/app/key.ts <<< "${secret}"`,
      `echo x >> web/.env.local\r\ntee web/app/key.ts <<< "${secret}"`,
      `echo x >> web/.env.local && tee web/app/key.ts <<< "${secret}"`,
      `echo x >> web/.env.local || tee web/app/key.ts <<< "${secret}"`,
      `echo x >> web/.env.local; \`tee web/app/key.ts <<< "${secret}"\``,
    ].forEach((command) => denies(command));
  });

  it("단어 안의 tee(committee·guarantee, 경로 속 이름)는 쓰는 곳으로 보지 않는다", () => {
    allows(`echo "SUPABASE_SECRET=${secret}" >> web/.env.local; echo committee notes`);
    allows(`echo KEY=${secret} >> .env.local && echo guarantee notes`);
    allows(`echo "SUPABASE_SECRET=${secret}" >> web/.env.local; cat docs/committee notes/a.md`);
  });

  it("외부 서비스 키는 코드에서 막고 .env 실파일에서는 통과시킨다", () => {
    const keys = [
      ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
      ["ghp", "a".repeat(36)].join("_"),
      ["github", "pat", "b".repeat(30)].join("_"),
      ["sk", "ant", "api03", "c".repeat(24)].join("-"),
      ["sk", "proj", "d".repeat(24)].join("-"),
      ["xoxb", "1234567890", "abcdef"].join("-"),
      ["-----BEGIN", "PRIVATE", "KEY-----"].join(" "),
      ["test", "sk", "e".repeat(12)].join("_"),
    ];
    keys.forEach((key) => {
      expects(write("web/server/x.ts", `const key = "${key}";`), "deny", key);
      expects(write("web/.env.local", `KEY=${key}`), "allow", key);
    });
  });

  it("키의 접두어를 문서에 적는 것은 통과시킨다", () => {
    expects(
      write(
        "docs/keys.md",
        "AWS 키는 AKIA 로, GitHub 토큰은 ghp_ 로, Anthropic 키는 sk-ant- 로 시작한다.",
      ),
      "allow",
    );
  });

  it("이름 중간에 .env 가 든 코드 파일은 .env 실파일로 보지 않고 막는다", () => {
    ["web/lib/config.env.ts", "web/lib/stripe.env.mjs", "secrets.env"].forEach((file) =>
      [serviceRole, secret].forEach((key) => {
        expects(write(file, `export const key = "${key}";`), "deny", file);
        denies(`echo "${key}" > ${file}`);
      }),
    );
  });

  it("쓰는 곳 이름에 셸 펼침($·`)이 있으면 어느 파일인지 알 수 없으니 막는다", () => {
    denies(`echo "${serviceRole}" > .env.$X`);
    denies(`echo "${secret}" > web/.env.\`whoami\``);
  });

  it("이름이 .env·.env.<무엇> 인 실파일은 통과시키고 .env.example 은 막는다", () => {
    ["web/.env.local", "mobile/.env", ".env.production.local"].forEach((file) =>
      [serviceRole, secret].forEach((key) => {
        expects(write(file, `SUPABASE_SECRET=${key}`), "allow", file);
        allows(`echo "SUPABASE_SECRET=${key}" >> ${file}`);
      }),
    );
    [serviceRole, secret].forEach((key) =>
      expects(write("web/.env.example", `SUPABASE_SECRET=${key}`), "deny", key),
    );
  });

  it("공개 변수에 비밀 키를 넣는 것은 막는다", () => {
    denies("NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY=abc pnpm dev");
    separators.forEach((sep) => {
      expects(write("web/.env.local", `NEXT_PUBLIC_SECRET_KEY${sep}abc`), "deny", sep);
      denies(`echo 'NEXT_PUBLIC_SECRET_KEY${sep}abc' >> web/.env.local`);
    });
  });

  it("공개 변수에 service_role JWT·sb_secret_ 값을 넣는 것은 .env 실파일이라도 막는다", () => {
    separators.forEach((sep) => {
      const pub = `NEXT_PUBLIC_SUPABASE_ANON_KEY${sep}${serviceRole}`;
      expects(write("web/.env.local", pub), "deny", sep);
      expects(write("mobile/.env", `EXPO_PUBLIC_KEY${sep}${secret}`), "deny", sep);
      denies(`echo '${pub}' >> web/.env.local`);
      denies(`echo 'EXPO_PUBLIC_KEY${sep}${secret}' >> mobile/.env`);
    });
  });

  it("printf 한 줄로 공개 변수와 서버 비밀을 함께 쓰는 것은 통과시킨다", () => {
    // printf·echo -e 는 글자 그대로의 \n 을 줄바꿈으로 쓴다. 다음 줄은 다른 변수다.
    // 마지막은 값이 빈 공개 변수 바로 뒤에 서버 비밀 줄이 오는 경우다.
    allows(
      `printf 'NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\\nSUPABASE_SECRET_KEY=${secret}\\n' > web/.env.local`,
    );
    allows(
      `printf 'NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}\\nSUPABASE_SERVICE_ROLE_KEY=${serviceRole}\\n' >> web/.env.local`,
    );
    allows(
      `echo -e "NEXT_PUBLIC_SUPABASE_URL=\\nSUPABASE_SECRET=${serviceRole}" >> web/.env.local`,
    );
  });

  it("파일 쓰기에서도 공개 변수 줄과 서버 비밀 줄을 따로 본다", () => {
    [
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}\nSUPABASE_SECRET_KEY=${secret}`,
      `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}\nSUPABASE_SERVICE_ROLE_KEY=${serviceRole}`,
    ].forEach((content) => expects(write("web/.env.local", content), "allow", content));
  });

  it("공개 변수의 anon JWT 와 접두어 없는 비밀 변수는 .env 실파일에서 통과시킨다", () => {
    allows(`echo NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon} >> web/.env.local`);
    allows(`echo EXPO_PUBLIC_SUPABASE_ANON_KEY=${anon} >> mobile/.env`);
    expects(write("mobile/.env", `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anon}`), "allow");
    expects(write("web/.env.local", `SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`), "allow");
  });
});

describe(".env 실파일 읽기", () => {
  it("셸로 .env 실파일 내용을 내는 명령은 막는다", () => {
    denies("cat web/.env.local");
    denies('cat "web/.env.local"');
    denies("/usr/bin/cat .env");
    denies("cd web && tail -n 3 .env.production");
    denies("head .env | base64");
    denies("less mobile/.env");
    denies("grep KEY web/.env.local");
    denies('rg -n "SUPABASE_URL" .env.local');
    denies("sed -n p mobile/.env");
    denies("awk 1 .env.local");
    denies("source web/.env.local");
    denies(". ./.env");
    denies("base64 .env.local");
    denies("xxd web/.env.local | head");
    denies("cat web/.env*");
    denies("diff web/.env.example web/.env.local");
    denies("cp web/.env.local /tmp/x");
    denies("node app.js < web/.env.local");
    denies("while read l; do echo $l; done <.env");
  });

  it("내용을 내지 않거나 .env.example·쓰기·검색어로 다루는 명령은 통과시킨다", () => {
    allows("ls -la web/.env.local");
    allows("test -f web/.env.local && echo ok");
    allows("git diff -- web/.env.example");
    allows("git status --short web/.env.local");
    allows("cat web/.env.example");
    allows("cp web/.env.example web/.env.local");
    allows("cat > web/.env.local <<EOF\nNEXT_PUBLIC_SUPABASE_URL=http://localhost\nEOF");
    allows("grep -n .env.local .gitignore");
    allows('grep -rn "\.env" scripts');
    allows('git commit -m "docs: cat .env.local 을 막는다"');
    allows("cat .envrc.md");
  });
});

describe("재귀 강제 삭제", () => {
  it("플래그 순서·분리와 상관없이 rm 의 재귀+강제를 막는다", () => {
    denies("rm -rf node_modules");
    denies("rm -fr web/.next");
    denies("rm -r -f dist");
    denies("rm -R -f dist");
    denies("rm -v -Rf dist");
    denies("rm --recursive --force dist");
    denies("rm -r --force dist");
    denies('rm -rf "web/.next"');
    denies("cd web && rm -rf .next");
    denies("/bin/rm -rf x");
  });

  it("강제나 재귀 하나만이거나 rm 실행이 아니면 통과시킨다", () => {
    allows("rm -f web/tsconfig.tsbuildinfo");
    allows("rm -r tmp-output");
    allows("git rm -rf --cached web/.next");
    allows('grep -rn "rm -rf" .claude');
    allows('git commit -m "chore: rm -rf 를 막는다"');
  });
});
