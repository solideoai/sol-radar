// CI 커밋 메시지 검사(scripts/check-commits.mjs) 시험. 실행: 루트에서 `pnpm test`
//
// 규칙 자체(형식·길이)는 commit-message.mjs 의 것이라 여기서 다시 보지 않는다. 이 파일은 check-commits 가
// 더하는 것만 고정한다 — PR 번호 꼬리 떼기, PR 제목의 git 예외 제거, Dependabot 커밋 제외, 범위 읽기.
// Dependabot 예외는 실제 임시 저장소에 봇 작성자로 커밋을 만들어 main() 끝까지 돌려 본다.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  commitsInRange,
  isDependabot,
  main,
  messageProblems,
  prTitleProblems,
  withoutPrNumber,
} from "./check-commits.mjs";
import { tempDir } from "./test-support.mjs";

const DEPENDABOT = "49699333+dependabot[bot]@users.noreply.github.com";
const HUMAN = "gate-test@example.invalid";
// Dependabot 이 실제로 올린 제목(60자). 50자 규칙을 넘는다.
const BOT_TITLE = "build: bump the web group across 1 directory with 12 updates";
const sha = (letter) => letter.repeat(40);

describe("Dependabot 작성자 판별", () => {
  it("GitHub 이 봇에 주는 noreply 주소를 알아본다", () => {
    assert.ok(isDependabot(DEPENDABOT));
    assert.ok(isDependabot("dependabot[bot]@users.noreply.github.com"));
    assert.ok(isDependabot(` ${DEPENDABOT}\n`));
  });

  it("사람·다른 봇·비슷한 글자의 주소는 아니다", () => {
    [
      HUMAN,
      "renovate[bot]@users.noreply.github.com",
      "dependabot@example.com",
      "dependabot[bot]@users.noreply.github.com.evil.example",
      "",
      undefined,
    ].forEach((email) => assert.equal(isDependabot(email), false, String(email)));
  });
});

describe("메시지 문제 모으기", () => {
  it("Dependabot 커밋은 제목이 길어도 문제로 잡지 않는다", () => {
    assert.deepEqual(
      messageProblems({ commits: [{ sha: sha("a"), author: DEPENDABOT, message: BOT_TITLE }] }),
      [],
    );
  });

  it("사람이 쓴 같은 제목은 그대로 잡는다", () => {
    const problems = messageProblems({
      commits: [{ sha: sha("b"), author: HUMAN, message: BOT_TITLE }],
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0].what, /^bbbbbbb "build: bump/);
    assert.match(problems[0].problems[0], /60자/);
  });

  it("Dependabot 커밋이어도 PR 제목은 사람 몫이라 검사한다", () => {
    const problems = messageProblems({
      commits: [{ sha: sha("a"), author: DEPENDABOT, message: BOT_TITLE }],
      prTitle: BOT_TITLE,
    });
    assert.equal(problems.length, 1);
    assert.ok(problems[0].prTitle);
    assert.match(problems[0].what, /^PR 제목/);
  });

  it("작성자가 없는 커밋(옛 호출자)은 사람이 쓴 것으로 본다", () => {
    assert.equal(messageProblems({ commits: [{ sha: sha("c"), message: BOT_TITLE }] }).length, 1);
  });

  it("squash 병합이 붙인 ' (#번호)' 는 첫 줄 끝에서 한 번만 뗀다", () => {
    assert.equal(withoutPrNumber("feat: 로그인 (#12)"), "feat: 로그인");
    assert.equal(withoutPrNumber("feat: 로그인 (#12)\n\n본문 (#3)"), "feat: 로그인\n\n본문 (#3)");
    assert.equal(withoutPrNumber("feat: (#12) 로그인"), "feat: (#12) 로그인");
  });

  it("PR 제목에는 병합·autosquash 예외가 없고 되돌리기만 남는다", () => {
    assert.match(prTitleProblems("Merge develop into main")[0], /'Merge' 예외가 없습니다/);
    assert.deepEqual(prTitleProblems('Revert "feat: 로그인"'), []);
    assert.deepEqual(prTitleProblems("build(web): 의존성 12개 갱신"), []);
  });
});

// ── 임시 저장소에서 main() 까지 돌린다 ──

const sandbox = tempDir("check-commits-test-");
after(() => rmSync(sandbox, { recursive: true, force: true }));

const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_") && key !== "HUSKY"),
);
const git = (repo, ...args) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=gate-test",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { cwd: repo, env: baseEnv, encoding: "utf8" },
  ).trim();

let repoCount = 0;

// 사람이 만든 첫 커밋 하나가 있는 저장소. 돌려주는 base 가 PR 의 base.sha 역할이다.
function makeRepo() {
  const repo = join(sandbox, `case-${(repoCount += 1)}`);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", `user.email=${HUMAN}`, "add", "-A");
  git(repo, "-c", `user.email=${HUMAN}`, "commit", "-q", "-m", "chore: 처음");
  return { repo, base: git(repo, "rev-parse", "HEAD") };
}

const commitAs = (repo, email, message) => {
  writeFileSync(join(repo, `${repoCount}-${Math.random()}.txt`), "x\n");
  git(repo, "add", "-A");
  git(repo, "-c", `user.email=${email}`, "commit", "-q", "-m", message);
  return git(repo, "rev-parse", "HEAD");
};

// main() 을 CI 의 pull_request 이벤트처럼 부른다. 출력은 모아서 돌려준다.
function runPr(repo, base, head, prTitle) {
  const out = [];
  const code = main([], {
    env: { EVENT_NAME: "pull_request", BASE_SHA: base, HEAD_SHA: head, PR_TITLE: prTitle },
    cwd: repo,
    log: (line) => out.push(line),
    error: (line) => out.push(line),
  });
  return { code, out: out.join("\n") };
}

describe("임시 저장소에서 검사", () => {
  it("범위의 커밋마다 작성자 이메일을 함께 읽는다", () => {
    const { repo, base } = makeRepo();
    const head = commitAs(repo, DEPENDABOT, BOT_TITLE);
    const { commits } = commitsInRange(repo, base, head);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].sha, head);
    assert.equal(commits[0].author, DEPENDABOT);
    assert.equal(commits[0].message.trimEnd(), BOT_TITLE);
  });

  it("Dependabot 커밋 + 50자 이내 PR 제목은 통과하고, 제외했다고 알린다", () => {
    const { repo, base } = makeRepo();
    const head = commitAs(repo, DEPENDABOT, BOT_TITLE);
    const { code, out } = runPr(repo, base, head, "build(web): 의존성 12개 갱신");
    assert.equal(code, 0, out);
    assert.match(out, /커밋 1개\(Dependabot 1개는 규칙 밖\)/);
    assert.match(out, /✓ 커밋 메시지 규칙 통과/);
  });

  it("Dependabot 커밋이어도 PR 제목이 길면 막는다", () => {
    const { repo, base } = makeRepo();
    const head = commitAs(repo, DEPENDABOT, BOT_TITLE);
    const { code, out } = runPr(repo, base, head, BOT_TITLE);
    assert.equal(code, 1);
    assert.match(out, /규칙 위반 1건/);
    assert.match(out, /- PR 제목 "build: bump/);
    assert.doesNotMatch(out, /^- [0-9a-f]{7} /m);
  });

  it("사람이 쓴 긴 커밋은 Dependabot 커밋과 섞여 있어도 막는다", () => {
    const { repo, base } = makeRepo();
    commitAs(repo, DEPENDABOT, BOT_TITLE);
    const head = commitAs(repo, HUMAN, BOT_TITLE);
    const { code, out } = runPr(repo, base, head, "build(web): 의존성 12개 갱신");
    assert.equal(code, 1);
    assert.match(out, /커밋 2개\(Dependabot 1개는 규칙 밖\)/);
    assert.match(out, /규칙 위반 1건/);
    assert.match(out, new RegExp(`- ${head.slice(0, 7)} "build: bump`));
  });

  it("사람 커밋만 있으면 제외 안내가 붙지 않는다", () => {
    const { repo, base } = makeRepo();
    const head = commitAs(repo, HUMAN, "feat: 로그인 화면 추가");
    const { code, out } = runPr(repo, base, head, "feat: 로그인 화면 추가");
    assert.equal(code, 0, out);
    assert.match(out, /커밋 1개 \+ PR 제목/);
    assert.doesNotMatch(out, /Dependabot/);
  });
});
