import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { main, requiredProblems } from "../ci-required.mjs";
import { jobBlock } from "../test-support.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const ok = {
  common: "success",
  commits: "success",
  audit: "success",
  project: "success",
  hasProjects: "true",
};

describe("필수 검사 판정", () => {
  test("모두 성공이면 통과한다", () => {
    assert.deepEqual(requiredProblems(ok), []);
  });

  // 결과가 비어 있어도(잡 이름이 바뀌는 등) 통과시키지 않는다. 건너뛴 required 는 성공으로 쳐지므로 여기서 막는다.
  test("common·commits·audit 는 success 가 아니면 모두 막는다", () => {
    for (const name of ["common", "commits", "audit"]) {
      for (const result of ["failure", "cancelled", "skipped", "", undefined]) {
        const problems = requiredProblems({ ...ok, [name]: result });
        assert.equal(problems.length, 1, `${name}=${result}`);
        assert.match(problems[0], new RegExp(`^${name}: `), `${name}=${result}`);
      }
      assert.match(requiredProblems({ ...ok, [name]: "skipped" })[0], /건너뛰었습니다/, name);
    }
  });

  test("common 이 실패해 뒤 job 이 건너뛰어도 성공으로 덮지 않는다", () => {
    for (const common of ["failure", "cancelled", "skipped"])
      assert.ok(
        requiredProblems({ ...ok, common, project: "skipped", hasProjects: "" }).length >= 1,
        common,
      );
  });

  test("project 는 검사할 프로젝트가 없을 때만 건너뛸 수 있다", () => {
    assert.deepEqual(requiredProblems({ ...ok, project: "skipped", hasProjects: "false" }), []);
    assert.equal(requiredProblems({ ...ok, project: "skipped" }).length, 1);
    for (const project of ["failure", "cancelled", ""])
      assert.equal(requiredProblems({ ...ok, project }).length, 1, project);
  });

  test("check 명령은 환경변수의 job 결과로 종료 코드를 정한다", () => {
    const quiet = { log: () => {}, error: () => {} };
    const env = {
      COMMON_RESULT: "success",
      COMMITS_RESULT: "success",
      AUDIT_RESULT: "success",
      PROJECT_RESULT: "success",
      HAS_PROJECTS: "true",
    };
    assert.equal(main(["check"], { env, ...quiet }), 0);
    for (const name of Object.keys(env).filter((key) => key.endsWith("_RESULT"))) {
      assert.equal(main(["check"], { env: { ...env, [name]: "failure" }, ...quiet }), 1, name);
      assert.equal(main(["check"], { env: { ...env, [name]: undefined }, ...quiet }), 1, name);
    }
    assert.equal(main(["nope"], { env, ...quiet }), 2);
  });
});

describe("CI 연결", () => {
  const ci = readFileSync(join(REPO, ".github/workflows/ci.yml"), "utf8");
  const job = (name) => {
    const block = jobBlock(ci, name);
    assert.ok(block, `${name} 잡이 없습니다`);
    return block;
  };

  test("required 는 common·commits·audit·project 를 모두 기다리고 판정기를 부른다", () => {
    const required = job("required");
    assert.match(required, /^ {4}if: always\(\)$/m);
    assert.match(required, /needs: \[common, commits, audit, project\]/);
    assert.match(required, /node scripts\/ci-required\.mjs check/);
    for (const name of ["common", "commits", "audit", "project"])
      assert.ok(
        required.includes(`${name.toUpperCase()}_RESULT: \${{ needs.${name}.result }}`),
        `${name} 결과를 넘기지 않습니다`,
      );
    assert.match(required, /HAS_PROJECTS: \$\{\{ needs\.common\.outputs\.has-projects \}\}/);
  });

  // 스모크·Windows 는 템플릿 전용 워크플로(template.yml)에 있다. 여기에 수동 실행이 남아 있으면
  // 비교할 범위가 없는 실행에서 commits 가 건너뛰어 required 판정이 다시 이벤트를 가려야 한다.
  test("PR 과 main push 에서만 돌고, 잡을 조건으로 건너뛰지 않는다", () => {
    assert.match(
      ci,
      /^on:\n(?: {2}#.*\n)* {2}pull_request:\n {2}push:\n {4}branches: \[main\]\n\n/m,
    );
    assert.ok(!ci.includes("workflow_dispatch"));
    for (const name of ["common", "commits", "audit"])
      assert.doesNotMatch(job(name), /^ {4}if:/m, `${name} 잡에 조건이 있습니다`);
  });

  test("같은 PR 의 이전 실행만 취소하고 push 는 서로 취소하지 않는다", () => {
    assert.match(
      ci,
      /group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.run_id \}\}/,
    );
    assert.match(ci, /cancel-in-progress: true/);
  });

  test("기존 전체 검증·E2E 를 유지하고 실패를 성공으로 덮지 않는다", () => {
    assert.match(ci, /node scripts\/verify\.mjs --project "\$PROJECT_NAME" --setup --ci/);
    assert.match(job("common"), /node scripts\/verify\.mjs --common/);
    assert.match(job("common"), /node scripts\/check-policy\.mjs --base "\$BASE_SHA"/);
    assert.ok(!ci.includes("continue-on-error"));
    assert.ok(!ci.includes("|| true"));
  });

  // 커밋 메시지는 따로 도는 commits 잡이다. 제목이 틀려도 common 이 멈추지 않아 project 검증이 그대로 돈다.
  test("commits 잡이 common 과 따로 커밋 메시지 규칙을 PR 범위·제목과 push 범위로 검사한다", () => {
    const commits = job("commits");
    assert.match(commits, /run: node scripts\/check-commits\.mjs$/m);
    assert.match(commits, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
    assert.match(
      commits,
      /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.before \}\}/,
    );
    assert.match(
      commits,
      /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.event\.after \}\}/,
    );
    assert.match(commits, /PR_TITLE: \$\{\{ github\.event\.pull_request\.title \}\}/);
    assert.match(commits, /fetch-depth: 0/);
    assert.doesNotMatch(commits, /^ {4}needs:/m);
    assert.ok(!job("common").includes("check-commits"), "common 잡이 아직 커밋 검사를 돕니다");
  });

  // 루트 감사는 따로 도는 audit 잡이다. project 가 기다리는 common 안에 있으면 루트 devDependency 의
  // critical 이나 npm 감사 서버 장애 하나로 모든 PR 의 프로젝트 검증이 건너뛰어진다. 판정은 required 가 모은다.
  // 프로젝트 감사는 project 잡 안에 두되 검증 뒤에 돌아서 검증 결과를 잃지 않는다.
  test("audit 잡이 common 과 따로 설치 뒤 루트 critical 의존성 감사를 돈다", () => {
    const audit = job("audit");
    const command = "pnpm audit --audit-level critical";
    assert.match(audit, /^ {8}run: pnpm audit --audit-level critical$/m);
    const install = audit.indexOf("run: pnpm install --frozen-lockfile");
    assert.ok(install !== -1, "audit 잡이 락파일 그대로 설치하지 않습니다");
    assert.ok(audit.indexOf(command) > install, "audit 잡이 설치 전에 감사합니다");
    assert.match(audit.slice(install), /^ {10}HUSKY: "0"$/m);
    assert.match(audit, /run: corepack enable/);
    assert.match(audit, /node-version-file: \.nvmrc/);
    assert.match(audit, /^ {4}timeout-minutes: \d+$/m);
    // 건너뛰지 않고(잡·단계 모두 조건 없음), 앞선 잡을 기다리지 않으며, 루트에서 돈다
    assert.doesNotMatch(audit, /^\s*(- )?if:/m);
    assert.doesNotMatch(audit, /^ {4}needs:/m);
    assert.doesNotMatch(audit, /working-directory:/);
    assert.ok(!job("common").includes("pnpm audit"), "common 잡이 아직 루트 감사를 돕니다");
    assert.match(job("project"), /^ {4}needs: common$/m, "project 잡이 audit 을 기다립니다");
  });

  test("project 잡은 검증 뒤 프로젝트 폴더에서 critical 의존성 감사를 돈다", () => {
    const audit = "pnpm audit --audit-level critical";
    const project = job("project");
    assert.ok(project.includes(audit), "project 잡에 프로젝트 감사가 없습니다");
    assert.ok(project.indexOf(audit) > project.indexOf("node scripts/verify.mjs --project"));
    assert.match(project, /working-directory: \$\{\{ matrix\.project\.directory \}\}/);
  });
});

// 공급망: 태그는 옮겨질 수 있으니 커밋 SHA 로 고정하고, 체크아웃 토큰을 .git/config 에 남기지 않는다.
// 저장소의 워크플로 전부를 본다 — 새로 더한 워크플로도 같은 규칙을 따른다.
describe("워크플로 보안", () => {
  const dir = join(REPO, ".github/workflows");
  const workflows = Object.fromEntries(
    readdirSync(dir)
      .filter((name) => /\.ya?ml$/.test(name))
      .sort()
      .map((name) => [`.github/workflows/${name}`, readFileSync(join(dir, name), "utf8")]),
  );
  const REVIEW = ".github/workflows/claude-review.yml";

  test("CI 와 리뷰 봇 워크플로가 있다", () => {
    for (const file of [".github/workflows/ci.yml", REVIEW])
      assert.ok(workflows[file], `${file} 이 없습니다`);
  });

  test("모든 액션(주석으로 꺼 둔 것 포함)을 40자 SHA 와 정확한 버전 주석으로 고정한다", () => {
    for (const [file, text] of Object.entries(workflows)) {
      const uses = text.split("\n").filter((line) => /\buses:\s/.test(line));
      assert.ok(uses.length > 0, file);
      for (const line of uses)
        assert.match(
          line,
          /uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
          `${file}: ${line.trim()}`,
        );
    }
  });

  test("모든 actions/checkout 은 persist-credentials: false 로 토큰을 남기지 않는다", () => {
    for (const [file, text] of Object.entries(workflows)) {
      const lines = text.split("\n");
      const checkouts = lines.flatMap((line, index) =>
        /uses: actions\/checkout@/.test(line) ? [index] : [],
      );
      assert.ok(checkouts.length > 0, file);
      for (const index of checkouts) {
        const rest = lines.slice(index + 1);
        const end = rest.findIndex((line) => /^\s*(#\s*)?- /.test(line) || line.trim() === "");
        const step = rest.slice(0, end === -1 ? rest.length : end).join("\n");
        assert.match(step, /persist-credentials: false/, `${file} ${index + 1}행`);
      }
    }
  });

  test("이벤트 값(PR 제목 등)은 run 스크립트에 직접 넣지 않고 env 로 넘긴다", () => {
    for (const [file, text] of Object.entries(workflows))
      for (const script of runScripts(text))
        assert.ok(!script.includes("${{"), `${file}: ${script}`);
  });

  test("리뷰 봇은 Dependabot PR 을 건너뛴다(시크릿을 받지 못해 매번 실패한다)", () => {
    assert.match(
      workflows[REVIEW],
      /github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/,
    );
  });
});

// `run:` 한 줄과 `run: |` 블록의 스크립트들
function runScripts(text) {
  const lines = text.split("\n");
  return lines.flatMap((line, index) => {
    const match = line.match(/^(.*?)run:\s*(.*)$/);
    if (!match || !/^\s*(- )?$/.test(match[1])) return [];
    if (!/^[|>]/.test(match[2])) return [match[2]];
    const keyIndent = match[1].length;
    const rest = lines.slice(index + 1);
    const end = rest.findIndex((next) => next.trim() !== "" && next.search(/\S/) <= keyIndent);
    return [rest.slice(0, end === -1 ? rest.length : end).join("\n")];
  });
}
