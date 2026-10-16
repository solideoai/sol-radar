// CI 의 커밋 메시지 검사(scripts/check-commits.mjs)와 Dependabot 제목 시험.
// 실행: 루트에서 `pnpm test`
//
// 시험용 저장소는 운영체제 임시 폴더에 만든다. 게이트(pre-commit)가 커밋 도중 이 시험을 부르면
// git 이 넘긴 GIT_* 값이 원본 저장소를 가리키므로, 하위 git 에서는 걷어낸다.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { commitsInRange, main, withoutPrNumber } from "../check-commits.mjs";
import { MAX_HEADER_LENGTH, findProblems } from "../commit-message.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../..");
const NO_BASE = "0".repeat(40);

const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const git = (cwd, ...args) => {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=시험",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd, env: cleanEnv, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const sandbox = (t) => {
  const dir = mkdtempSync(join(tmpdir(), "check-commits-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  return dir;
};

// flags 로 git 의 메시지 정리 방식을 바꾼다. `--cleanup=verbatim` 은 GitHub 웹 커밋처럼 '#' 줄까지 그대로 저장한다.
const commit = (repo, message, ...flags) => {
  git(repo, "commit", "-q", "--allow-empty", ...flags, "-m", message);
  return git(repo, "rev-parse", "HEAD");
};

// main 을 그 저장소에서 부르고 종료 코드와 출력 전체를 돌려준다
const run = (repo, env) => {
  const lines = [];
  const code = main([], {
    env,
    cwd: repo,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  });
  return { code, output: lines.join("\n") };
};

describe("범위 안의 커밋을 commit-message.mjs 규칙으로 본다", () => {
  test("규칙에 맞는 커밋만 있으면 통과하고 몇 개를 봤는지 알린다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    commit(repo, "feat: 로그인 화면 추가");
    const head = commit(repo, "fix(web): 결제일 계산 오류 수정\n\n본문은 한 줄 비우고 쓴다.");

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head });

    assert.equal(code, 0, output);
    assert.match(output, /커밋 2개/);
    assert.match(output, new RegExp(`${base.slice(0, 7)}\\.\\.${head.slice(0, 7)}`));
  });

  test("GitHub 웹에서 만든 것 같은 규칙 밖 커밋은 SHA·제목·이유와 함께 막는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const bad = commit(repo, "Update README.md");
    const head = commit(repo, "feat: 로그인 화면 추가");

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head });

    assert.equal(code, 1);
    assert.match(output, new RegExp(bad.slice(0, 7)));
    assert.match(output, /"Update README\.md"/);
    assert.match(output, /맨 앞에 타입/);
  });

  test("제목 다음 줄을 비우지 않은 본문도 로컬 훅과 같이 막는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가\n바로 붙인 본문");

    assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head }).code, 1);
  });

  test("기준보다 앞선 커밋은 보지 않는다", (t) => {
    const repo = sandbox(t);
    commit(repo, "옛날에 규칙 없이 쓴 커밋");
    const base = commit(repo, "chore: 규칙 도입");
    const head = commit(repo, "feat: 로그인 화면 추가");

    assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head }).code, 0);
  });

  test("git·GitHub 이 만드는 병합·되돌리기 커밋은 로컬 훅처럼 통과시킨다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    git(repo, "switch", "-q", "-c", "topic");
    commit(repo, "feat: 로그인 화면 추가");
    git(repo, "switch", "-q", "main");
    commit(repo, "docs: 안내 추가");
    git(repo, "merge", "-q", "--no-ff", "-m", "Merge pull request #12 from someone/topic", "topic");
    const head = commit(repo, 'Revert "docs: 안내 추가"\n\nThis reverts commit abc.');

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head });

    assert.equal(code, 0, output);
    assert.match(output, /커밋 4개/);
  });

  test("HEAD_SHA 를 비우면 지금 체크아웃한 HEAD 까지 본다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    commit(repo, "고쳤음");

    assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: base }).code, 1);
  });

  // 저장된 메시지에는 주석이 없다. '#' 줄을 주석으로 지우면 그다음 줄이 제목으로 검사받는다.
  test("저장된 첫 줄이 '#' 로 시작하면 그 줄을 제목으로 보고 막는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(
      repo,
      "# 아무렇게나 쓴 제목\n\nfeat: 정상처럼 보이는 줄",
      "--cleanup=verbatim",
    );

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head });

    assert.equal(code, 1, output);
    assert.match(output, /"# 아무렇게나 쓴 제목"/);
    assert.match(output, /맨 앞에 타입/);
  });

  test("제목 바로 다음 줄이 '#' 로 시작해도 비우지 않은 본문으로 막는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가\n# 바로 붙인 줄", "--cleanup=verbatim");

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head });

    assert.equal(code, 1, output);
    assert.match(output, /제목 다음 줄은 비워/);
  });

  test("한 줄 비운 본문의 '#' 줄(마크다운 제목 등)은 통과시킨다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(
      repo,
      "feat: 로그인 화면 추가\n\n# 바뀐 것\n- 로그인 버튼",
      "--cleanup=verbatim",
    );

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head });
    assert.equal(code, 0, output);
  });
});

describe("squash 병합 제목", () => {
  test("GitHub 이 붙이는 ` (#번호)` 는 사람이 쓴 길이에 넣지 않는다", () => {
    const title = `feat: ${"가".repeat(MAX_HEADER_LENGTH - "feat: ".length)}`;
    assert.deepEqual(findProblems(withoutPrNumber(`${title} (#123)\n\n* feat: 하나`)), []);
    assert.equal(withoutPrNumber("feat: 로그인 (#12)\n\n본문 (#3)"), "feat: 로그인\n\n본문 (#3)");
  });

  test("번호를 떼어도 형식이 틀리면 막는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat:로그인 화면 추가 (#12)");

    assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head }).code, 1);
  });

  test("50자 제목에 번호가 붙은 main 의 squash 커밋은 통과한다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, `feat: ${"가".repeat(MAX_HEADER_LENGTH - 6)} (#1234)`);

    assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head }).code, 0);
  });
});

describe("PR 제목 (squash 병합하면 main 의 커밋 제목이 된다)", () => {
  test("규칙에 어긋난 PR 제목은 커밋이 모두 맞아도 막는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");

    const { code, output } = run(repo, {
      EVENT_NAME: "pull_request",
      BASE_SHA: base,
      HEAD_SHA: head,
      PR_TITLE: "Add login screen",
    });

    assert.equal(code, 1);
    assert.match(output, /PR 제목 "Add login screen"/);
  });

  test("맞는 PR 제목은 통과하고 검사했다고 알린다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");

    const { code, output } = run(repo, {
      EVENT_NAME: "pull_request",
      BASE_SHA: base,
      HEAD_SHA: head,
      PR_TITLE: "feat: 로그인 화면 추가",
    });

    assert.equal(code, 0, output);
    assert.match(output, /PR 제목/);
  });

  test("PR 인데 제목을 받지 못하면(연결 실수) 통과시키지 않는다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");

    const { code, output } = run(repo, {
      EVENT_NAME: "pull_request",
      BASE_SHA: base,
      HEAD_SHA: head,
    });

    assert.equal(code, 2);
    assert.match(output, /PR_TITLE/);
  });

  // PR 제목만 고치는 편집은 CI 를 다시 돌리지 않고, Re-run 은 처음 이벤트의 옛 제목을 다시 본다(ci.yml 의 on: 주석)
  test("PR 제목이 틀리면 고친 뒤 다시 검사받는 길을 알린다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");
    const pr = run(repo, {
      EVENT_NAME: "pull_request",
      BASE_SHA: base,
      HEAD_SHA: head,
      PR_TITLE: "Add login screen",
    });

    assert.equal(pr.code, 1);
    assert.match(pr.output, /Re-run/);
    assert.match(pr.output, /닫았다 다시 열/);

    const bad = commit(repo, "고쳤음");
    const push = run(repo, { EVENT_NAME: "push", BASE_SHA: head, HEAD_SHA: bad });
    assert.equal(push.code, 1);
    assert.doesNotMatch(push.output, /닫았다 다시 열/);
  });

  // git 이 만드는 메시지 예외(병합·autosquash)는 PR 제목에 쓸모가 없다. 남기면 squash 뒤 main 의 제목이 된다.
  test("PR 제목에는 병합·autosquash 예외가 없다 — GitHub 되돌리기 제목만 통과한다", (t) => {
    const repo = sandbox(t);
    const head = commit(repo, "chore: 시작");
    const pr = (title) =>
      run(repo, { EVENT_NAME: "pull_request", BASE_SHA: head, HEAD_SHA: head, PR_TITLE: title });

    for (const title of [
      "Merge 아무 제목이나 써도 됨",
      "Merge develop into main",
      "fixup! whatever",
      "squash! feat: 로그인",
      "amend! feat: 로그인",
    ]) {
      const { code, output } = pr(title);
      assert.equal(code, 1, `${title}\n${output}`);
      assert.ok(output.includes(`PR 제목 "${title}"`), output);
    }
    const revert = pr('Revert "feat: 로그인 화면 추가"');
    assert.equal(revert.code, 0, revert.output);
  });

  test("PR 제목은 사람이 쓴 그대로 본다(번호를 떼지 않는다)", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");
    const title = `feat: ${"가".repeat(MAX_HEADER_LENGTH)} (#1)`;

    const env = { EVENT_NAME: "pull_request", BASE_SHA: base, HEAD_SHA: head, PR_TITLE: title };
    assert.equal(run(repo, env).code, 1);
  });
});

describe("범위가 애매할 때 — 조용히 통과시키지 않는다", () => {
  test("범위에 새 커밋이 없으면 0개를 봤다고 알리고 통과한다", (t) => {
    const repo = sandbox(t);
    const head = commit(repo, "chore: 시작");

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: head, HEAD_SHA: head });

    assert.equal(code, 0);
    assert.match(output, /커밋 0개/);
  });

  test("범위가 비어도 PR 제목은 본다", (t) => {
    const repo = sandbox(t);
    const head = commit(repo, "chore: 시작");

    const env = { EVENT_NAME: "pull_request", BASE_SHA: head, HEAD_SHA: head, PR_TITLE: "wip" };
    assert.equal(run(repo, env).code, 1);
  });

  test("새 브랜치 push(기준 0000…)는 HEAD 까지 이력 전체를 본다", (t) => {
    const repo = sandbox(t);
    commit(repo, "Initial commit");
    const head = commit(repo, "feat: 로그인 화면 추가");

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: NO_BASE, HEAD_SHA: head });

    assert.equal(code, 1);
    assert.match(output, /이력 전체/);
    assert.match(output, /"Initial commit"/);
  });

  test("새 브랜치 push 의 이력이 모두 맞으면 통과하고 몇 개를 봤는지 알린다", (t) => {
    const repo = sandbox(t);
    commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: NO_BASE, HEAD_SHA: head });

    assert.equal(code, 0, output);
    assert.match(output, /이력 전체/);
    assert.match(output, /커밋 2개/);
  });

  test("기준이 이력에 없으면(force push) 범위를 알 수 없다며 실패한다", (t) => {
    const repo = sandbox(t);
    commit(repo, "chore: 시작");
    const head = commit(repo, "feat: 로그인 화면 추가");
    const gone = "1234567890abcdef1234567890abcdef12345678";

    const { code, output } = run(repo, { EVENT_NAME: "push", BASE_SHA: gone, HEAD_SHA: head });

    assert.equal(code, 1);
    assert.match(output, /이력에 없습니다/);
    assert.throws(() => commitsInRange(repo, gone, head), /이력에 없습니다/);
  });

  test("기준이 없거나 SHA 모양이 아니면 잘못된 입력으로 멈춘다", (t) => {
    const repo = sandbox(t);
    const head = commit(repo, "chore: 시작");

    for (const base of [undefined, "", "main", "--output=/tmp/x", "abc123"])
      assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: head }).code, 2, base);
    assert.equal(run(repo, { EVENT_NAME: "push", BASE_SHA: head, HEAD_SHA: "-p" }).code, 2);
  });
});

describe("명령으로 실행", () => {
  test("CI 처럼 환경변수만으로 부르면 종료 코드로 알린다", (t) => {
    const repo = sandbox(t);
    const base = commit(repo, "chore: 시작");
    commit(repo, "고쳤음");
    const result = spawnSync("node", [join(REPO, "scripts/check-commits.mjs")], {
      cwd: repo,
      env: { ...cleanEnv, EVENT_NAME: "push", BASE_SHA: base, HEAD_SHA: "" },
      encoding: "utf8",
    });

    assert.equal(result.status, 1, result.stderr);
    assert.match(`${result.stdout}${result.stderr}`, /"고쳤음"/);
  });
});

// Dependabot 이 여는 PR·커밋 제목도 커밋 규칙을 지나야 CI 가 초록이 된다.
// 묶음(group) 갱신의 제목은 `<prefix>: bump the <묶음> group[ in <폴더>] with <N> updates` 다
// (prefix 뒤 콜론은 Dependabot 이 붙이고, prefix 가 있으면 bump 를 소문자로 쓴다).
//
// 웹·앱 중 한쪽만 쓰는 복사본은 디스크에 <폴더>/package.json(설정의 marker)이 있는지로 판정한다
// (scripts/gate-integrity.test.mjs 와 같은 기준). web/ 을 지운 복사본은 dependabot.yml 주석대로 /web 항목을 지운다.
describe("Dependabot 설정 (.github/dependabot.yml)", () => {
  const text = readFileSync(join(REPO, ".github/dependabot.yml"), "utf8");
  const present = (dir) => existsSync(join(REPO, dir, "package.json"));

  const parseUpdates = (yml) =>
    yml
      .split(/^ {2}- package-ecosystem: /m)
      .slice(1)
      .map((block) => ({
        ecosystem: block.split("\n")[0].trim(),
        directory: block.match(/^ {4}directory: "([^"]+)"$/m)?.[1],
        interval: block.match(/^ {6}interval: (\S+)$/m)?.[1],
        prefix: block.match(/^ {6}prefix: (\S+)$/m)?.[1],
        groups: [...block.matchAll(/^ {6}([\w-]+):\n {8}patterns:/gm)].map((match) => match[1]),
        ignoresMajor: /update-types: \["version-update:semver-major"\]/.test(block),
      }));
  const updates = parseUpdates(text);

  // 있는 폴더(web·mobile)에 따라 설정이 지켜야 할 것. 빈 배열이면 통과다.
  // web/ 이 없을 때는 /web 항목을 지운 모양과, bootstrap 이 그대로 복사한 모양(아래 시험)을 둘 다 받는다.
  const dependabotProblems = (yml, { web, mobile }) => {
    const listed = JSON.stringify(
      parseUpdates(yml).map(({ ecosystem, directory }) => `${ecosystem} ${directory}`),
    );
    const full = ["npm /", "npm /web", "github-actions /"];
    const allowed = (web ? [full] : [["npm /", "github-actions /"], full]).map((list) =>
      JSON.stringify(list),
    );
    return [
      ...(allowed.includes(listed) ? [] : [`항목 ${listed} — 기대 ${allowed.join(" 또는 ")}`]),
      ...parseUpdates(yml).flatMap(({ ecosystem, directory, interval, groups }) => [
        ...(interval === "weekly" ? [] : [`${ecosystem} ${directory}: 주 1회가 아닙니다`]),
        ...(groups.length === 1 ? [] : [`${ecosystem} ${directory}: 묶음이 하나가 아닙니다`]),
      ]),
      ...(!mobile || /expo install --fix/.test(yml)
        ? []
        : ["mobile/ 을 넣지 않은 이유(expo install --fix)가 없습니다"]),
    ];
  };

  // 앱만 쓰는 복사본이 주석대로 지운 모양
  const withoutUpdate = (yml, directory) => {
    const [head, ...blocks] = yml.split(/^(?= {2}- package-ecosystem: )/m);
    return [
      head,
      ...blocks.filter((block) => !block.includes(`    directory: "${directory}"\n`)),
    ].join("");
  };

  test("npm 은 루트·web, github-actions 는 루트를 주 1회 묶어서 올린다 — mobile 은 넣지 않는다", () => {
    assert.deepEqual(
      dependabotProblems(text, { web: present("web"), mobile: present("mobile") }),
      [],
    );
    assert.ok(!updates.some(({ directory }) => directory === "/mobile"));
  });

  test("앱만 쓰는 복사본이 주석대로 /web 항목을 지워도 통과한다", () => {
    const appOnly = withoutUpdate(text, "/web");
    assert.equal(parseUpdates(appOnly).length, 2);
    assert.deepEqual(dependabotProblems(appOnly, { web: false, mobile: true }), []);
  });

  test("web/ 이 있는데 /web 항목을 지우면 막는다", () => {
    assert.notDeepEqual(
      dependabotProblems(withoutUpdate(text, "/web"), { web: true, mobile: true }),
      [],
    );
  });

  // bootstrap --mode mobile 은 아직 .github/ 를 그대로 복사한다. 새 앱 프로젝트의 첫 pnpm test 를 깨지 않도록
  // web/ 이 없을 때 남은 /web 항목은 막지 않는다(Dependabot 이 없는 폴더라고 알린다).
  test("web/ 이 없을 때 그대로 복사된 /web 항목은 아직 막지 않는다", () => {
    assert.deepEqual(dependabotProblems(text, { web: false, mobile: true }), []);
  });

  test("웹만 쓰는 복사본은 mobile 안내 주석이 없어도 된다", () => {
    const webOnly = text.replace(/^#.*expo install --fix.*\n/m, "");
    assert.doesNotMatch(webOnly, /expo install --fix/);
    assert.deepEqual(dependabotProblems(webOnly, { web: true, mobile: false }), []);
    assert.notDeepEqual(dependabotProblems(webOnly, { web: true, mobile: true }), []);
  });

  test("npm 의 major 는 버전 갱신에서만 뺀다(보안 갱신은 그대로 온다)", () => {
    for (const update of updates.filter(({ ecosystem }) => ecosystem === "npm"))
      assert.ok(update.ignoresMajor, update.directory);
  });

  test("묶음 PR 제목과 그 squash 제목이 커밋 규칙을 지난다", () => {
    for (const { prefix, groups, directory } of updates)
      for (const group of groups)
        for (const count of ["1 update", "99 updates"]) {
          const where = directory === "/" ? "" : ` in ${directory}`;
          const title = `${prefix}: bump the ${group} group${where} with ${count}`;
          assert.deepEqual(findProblems(title), [], title);
          assert.deepEqual(findProblems(withoutPrNumber(`${title} (#1234)`)), [], title);
        }
  });
});
