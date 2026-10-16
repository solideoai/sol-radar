#!/usr/bin/env node
// CI 에서 커밋 메시지 규칙을 다시 본다 — `.github/workflows/ci.yml` 의 commits 잡이 부른다.
//
// 로컬 commit-msg 훅은 그 PC 에서 만든 커밋만 본다. GitHub 웹에서 만든 커밋, 훅을 건너뛴 커밋,
// squash 병합 제목(= PR 제목)은 여기서 같은 규칙으로 본다. 규칙과 예외(병합·되돌리기 커밋 등)는
// scripts/commit-message.mjs 에서 그대로 가져오고 다시 쓰지 않는다. 다른 점은 둘이다.
//   - 저장된 메시지를 본다. 훅이 받는 저장 전 원문과 달리 '#' 줄도 메시지다.
//   - PR 제목은 git 이 만들지 않는다. 그래서 git 이 만드는 메시지 예외 가운데 되돌리기만 남긴다.
//
// 값은 환경변수로 받는다. PR 제목은 PR 을 연 사람이 정하는 값이라 워크플로의 run 에 직접 넣지 않는다.
//   EVENT_NAME  pull_request | push
//   BASE_SHA    비교 기준. PR 은 base.sha, push 는 event.before
//   HEAD_SHA    검사할 끝. PR 은 head.sha, push 는 event.after (비면 체크아웃한 HEAD)
//   PR_TITLE    PR 제목. squash 병합하면 main 의 커밋 제목이 된다. PR 이면 꼭 있어야 한다
//
// 범위가 애매할 때도 조용히 통과시키지 않고, 무엇을 검사했는지 출력한다.
//   - 범위에 새 커밋이 없다: 0개를 검사했다고 알리고 통과한다(PR 제목은 그래도 본다).
//   - BASE_SHA 가 0000…(새 브랜치 push): 비교할 이전 커밋이 없으니 HEAD_SHA 까지 이력 전체를 본다.
//   - BASE_SHA 가 이력에 없다(force push 로 덮였거나 얕은 체크아웃): 무엇이 새 커밋인지 몰라 실패한다.
//     같은 push 는 check-policy 의 diff 도 실패한다.
// 종료 코드: 0 통과, 1 규칙 위반·범위를 알 수 없음, 2 잘못된 입력.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_HEADER_LENGTH, findProblems } from "./commit-message.mjs";

const SHA = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const NO_BASE = /^0+$/;

// GitHub 은 squash 병합 제목 끝에 ` (#PR번호)` 를 붙인다. 사람이 쓴 부분이 아니라서 규칙을 보기 전에 뗀다.
// 붙인 채로 재면 50자 이내로 쓴 PR 제목이 병합 뒤 main push 검사에서만 길이 초과가 된다.
// 첫 줄 끝의 한 번만 뗀다. 형식(타입·콜론·띄어쓰기)은 그대로 검사한다.
const PR_NUMBER_SUFFIX = / \(#\d+\)$/;

export const withoutPrNumber = (message) => {
  const [header = "", ...rest] = message.split("\n");
  return [header.replace(PR_NUMBER_SUFFIX, ""), ...rest].join("\n");
};

// cleanMessage(findProblems 가 부른다)는 저장 전 원문을 위한 것이라 줄 머리 '#' 를 주석으로 지운다.
// 저장된 메시지(GitHub 웹 커밋·`--cleanup=verbatim`)에서는 그 줄도 메시지다. 지우게 두면
// "# 아무 제목" 커밋이 다음 줄을 제목으로 검사받아 통과한다. 줄 머리 '#' 를 주석으로 읽히지 않는
// 전각 '＃' 로 바꿔 넘긴다. 글자 수가 같아서 길이·형식 판정은 그대로다.
const asStored = (message) => message.replace(/^#/gm, "＃");

// 사람이 읽는 제목 — git log 의 %s 처럼 앞쪽 빈 줄을 건너뛴 첫 줄
const headerOf = (message) => message.split("\n").find((line) => line.trim() !== "") ?? "";

// commit-message.mjs 의 GIT_GENERATED 가운데 git 만 만드는 것(병합·autosquash). PR 제목에 쓰면 규칙을
// 건너뛰고 squash 병합 뒤 main 의 커밋 제목이 된다("Merge develop into main" 같은 제목은 흔하다).
// GitHub 의 되돌리기 버튼은 PR 제목을 'Revert "…"' 로 열므로 그것만 예외로 남긴다.
const GIT_ONLY = /^(Merge|fixup!|squash!|amend!) /;

export const prTitleProblems = (title) => {
  const [, prefix] = title.match(GIT_ONLY) ?? [];
  return prefix
    ? [
        `PR 제목은 git 이 만드는 메시지가 아니라서 '${prefix}' 예외가 없습니다. 맨 앞에 타입(필요하면 범위)과 콜론을 쓰세요.`,
      ]
    : findProblems(asStored(title));
};

const short = (sha) => (SHA.test(sha) ? sha.slice(0, 7) : sha);

// 커밋 도중(게이트 시험 등)에 불려도 git 이 넘긴 GIT_* 값이 다른 저장소를 가리키지 않게 걷어낸다
const git = (root, args) =>
  spawnSync("git", args, {
    cwd: root,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

const hasCommit = (root, sha) => git(root, ["cat-file", "-e", `${sha}^{commit}`]).status === 0;

// 범위의 커밋을 오래된 것부터 돌려준다. label 은 무엇을 봤는지 사람이 읽는 설명이다.
export function commitsInRange(root, base, head) {
  if (!hasCommit(root, head)) throw new Error(`검사할 커밋 ${short(head)} 이 이력에 없습니다.`);
  const newBranch = NO_BASE.test(base);
  if (!newBranch && !hasCommit(root, base))
    throw new Error(
      `비교 기준 ${short(base)} 이 이력에 없습니다(force push 로 덮였거나 얕은 체크아웃). ` +
        "어느 커밋이 새로 들어왔는지 알 수 없어 실패로 둡니다.",
    );
  const range = newBranch ? head : `${base}..${head}`;
  const result = git(root, ["log", "-z", "--format=%H%n%B", range, "--"]);
  if (result.status !== 0) throw new Error(result.stderr.trim() || "git log 실패");
  const commits = result.stdout
    .split("\0")
    .map((record) => record.replace(/^\n/, ""))
    .filter(Boolean)
    .map((record) => {
      const newline = record.indexOf("\n");
      return newline === -1
        ? { sha: record, message: "" }
        : { sha: record.slice(0, newline), message: record.slice(newline + 1) };
    })
    .reverse();
  return {
    label: newBranch
      ? `새 브랜치라 비교 기준이 없어 ${short(head)} 까지 이력 전체`
      : `${short(base)}..${short(head)}`,
    commits,
  };
}

// 커밋·PR 제목마다 어긋난 이유. 빈 배열이면 통과다.
export const messageProblems = ({ commits, prTitle }) => [
  ...commits.flatMap(({ sha, message }) => {
    const problems = findProblems(asStored(withoutPrNumber(message)));
    return problems.length ? [{ what: `${short(sha)} "${headerOf(message)}"`, problems }] : [];
  }),
  ...(prTitle === undefined
    ? []
    : [{ what: `PR 제목 "${prTitle}"`, problems: prTitleProblems(prTitle), prTitle: true }].filter(
        ({ problems }) => problems.length,
      )),
];

const USAGE =
  "사용법: EVENT_NAME=pull_request|push BASE_SHA=<sha> [HEAD_SHA=<sha>] [PR_TITLE=<제목>] node scripts/check-commits.mjs";

export function main(
  argv,
  { env = process.env, cwd = process.cwd(), log = console.log, error = console.error } = {},
) {
  const base = env.BASE_SHA ?? "";
  const head = env.HEAD_SHA || "HEAD";
  const isPr = env.EVENT_NAME === "pull_request";
  const prTitle = env.PR_TITLE || undefined;
  if (argv.length) {
    error(USAGE);
    return 2;
  }
  if (!SHA.test(base) || (head !== "HEAD" && !SHA.test(head))) {
    error(`✗ BASE_SHA·HEAD_SHA 에 커밋 SHA(40자)가 필요합니다. BASE_SHA="${base}"\n${USAGE}`);
    return 2;
  }
  if (isPr && prTitle === undefined) {
    error(
      `✗ PR 인데 제목(PR_TITLE)을 받지 못했습니다. 워크플로의 env 연결을 확인하세요.\n${USAGE}`,
    );
    return 2;
  }

  const range = (() => {
    try {
      return commitsInRange(cwd, base, head);
    } catch (problem) {
      return problem;
    }
  })();
  if (range instanceof Error) {
    error(`✗ 커밋 메시지 검사 범위를 정하지 못했습니다: ${range.message}`);
    return 1;
  }

  const checked = [
    `커밋 ${range.commits.length}개${range.commits.length ? "" : "(새 커밋 없음)"}`,
    ...(prTitle === undefined ? [] : ["PR 제목"]),
  ].join(" + ");
  log(`커밋 메시지 검사: ${range.label} — ${checked}`);

  const problems = messageProblems({ commits: range.commits, prTitle });
  if (problems.length === 0) {
    log(`✓ 커밋 메시지 규칙 통과 (${checked})`);
    return 0;
  }
  error(
    [
      `✗ 커밋 메시지 규칙 위반 ${problems.length}건`,
      ...problems.flatMap(({ what, problems: reasons }) => [
        `- ${what}`,
        ...reasons.map((reason) => `    ${reason}`),
      ]),
      "",
      `형식: <타입>: <작업 내용>  또는  <타입>(<범위>): <작업 내용>  (콜론 뒤 정확히 한 칸, 첫 줄 ${MAX_HEADER_LENGTH}자 이내)`,
      "규칙: scripts/commit-message.mjs · 커밋은 `git rebase -i` 의 reword 로, PR 제목은 PR 화면에서 고칩니다.",
      ...(isPr ? ["PR 제목은 squash 병합 때 main 의 커밋 제목이 됩니다."] : []),
      // 제목 편집(edited)은 CI 를 다시 돌리지 않고, Re-run 은 처음 이벤트의 값(옛 제목)을 다시 쓴다
      ...(problems.some(({ prTitle: title }) => title)
        ? [
            "PR 제목만 고치면 이 검사는 다시 돌지 않고, Re-run 은 처음 이벤트의 옛 제목을 다시 봅니다.",
            "제목을 고친 뒤 PR 을 닫았다 다시 열거나(Close → Reopen) 새 커밋을 push 하세요.",
          ]
        : []),
    ].join("\n"),
  );
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
