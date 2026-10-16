// 커밋 메시지 규칙(scripts/commit-message.mjs)과 그 훅(.husky/commit-msg) 테스트.
// 실행: 루트에서 `pnpm test`
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { COMMIT_TYPES, MAX_HEADER_LENGTH, findProblems } from "../commit-message.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

const passes = (message) => assert.deepEqual(findProblems(message), [], message);
const fails = (message) => assert.notDeepEqual(findProblems(message), [], message);

describe("형식: `타입: 작업 내용`", () => {
  it("허용된 타입 뒤에 콜론과 한 칸, 작업 내용이 오면 통과한다", () => {
    passes("feat: 로그인 화면 추가");
    passes("chore: 의존성 정리");
  });

  it("허용된 타입은 모두 통과한다", () => {
    COMMIT_TYPES.forEach((type) => passes(`${type}: 작업 내용`));
  });

  it("타입이 없으면 막는다", () => {
    fails("로그인 화면 추가");
  });

  it("목록에 없는 타입은 막는다", () => {
    fails("feature: 로그인 화면 추가");
    fails("update: 로그인 화면 추가");
  });

  it("타입은 소문자만 받는다", () => {
    fails("Feat: 로그인 화면 추가");
  });
});

describe("범위 표기: `타입(범위): 작업 내용`", () => {
  it("타입 바로 뒤 괄호 안의 범위는 통과한다", () => {
    passes("feat(web): 로그인 화면 추가");
    passes("fix(mobile): 결제일 계산 오류 수정");
    passes("chore(web/auth): 세션 정리");
    passes("docs(로그인): 흐름 설명 추가");
  });

  it("빈 괄호는 막는다", () => {
    fails("feat(): 로그인 화면 추가");
  });

  it("타입과 괄호 사이를 띄우면 막는다", () => {
    fails("feat (web): 로그인 화면 추가");
  });

  it("범위 안에 공백이 있으면 막는다", () => {
    fails("feat(we b): 로그인 화면 추가");
  });

  it("괄호를 닫지 않으면 막는다", () => {
    fails("feat(web: 로그인 화면 추가");
  });

  it("범위가 있어도 콜론 앞뒤 규칙은 같다", () => {
    fails("feat(web):로그인 화면 추가");
    fails("feat(web):  로그인 화면 추가");
    fails("feat(web) : 로그인 화면 추가");
  });

  it("목록에 없는 타입은 범위가 있어도 막는다", () => {
    fails("feature(web): 로그인 화면 추가");
  });

  it("범위 문제를 짚어 안내한다", () => {
    assert.match(findProblems("feat (web): 로그인").join("\n"), /괄호 안에 공백 없이/);
  });
});

describe("콜론 뒤는 정확히 한 칸", () => {
  it("콜론 뒤에 띄우지 않으면 막는다", () => {
    fails("feat:로그인 화면 추가");
  });

  it("콜론 뒤에 두 칸 이상 띄우면 막는다", () => {
    fails("feat:  로그인 화면 추가");
  });

  it("콜론 뒤를 탭으로 띄우면 막는다", () => {
    fails("feat:\t로그인 화면 추가");
  });

  it("콜론 앞에 띄우면 막는다", () => {
    fails("feat : 로그인 화면 추가");
  });

  it("콜론 뒤에 작업 내용이 없으면 막는다", () => {
    fails("feat:");
    fails("feat: ");
  });

  it("띄어쓰기 문제를 짚어 안내한다", () => {
    assert.match(findProblems("feat:로그인").join("\n"), /한 칸/);
  });
});

describe("간단하게: 첫 줄 길이", () => {
  const headerOf = (length) => `feat: ${"가".repeat(length - "feat: ".length)}`;

  it(`첫 줄이 ${MAX_HEADER_LENGTH}자면 통과한다`, () => {
    passes(headerOf(MAX_HEADER_LENGTH));
  });

  it(`첫 줄이 ${MAX_HEADER_LENGTH}자를 넘으면 막는다`, () => {
    fails(headerOf(MAX_HEADER_LENGTH + 1));
  });
});

describe("본문", () => {
  it("한 줄을 비우고 쓴 본문과 트레일러는 통과한다", () => {
    passes(
      "feat: 로그인 화면 추가\n\n이메일 로그인만 먼저 연다.\n\nCo-Authored-By: someone <a@b.c>\n",
    );
  });

  it("제목 바로 다음 줄에 내용을 붙여 쓰면 막는다", () => {
    fails("feat: 로그인 화면 추가\n이메일 로그인만 먼저 연다.");
  });

  it("빈 메시지는 막는다", () => {
    fails("");
    fails("\n\n");
  });
});

// 훅은 git 이 주석·diff 를 지우기 전의 원문을 받는다. 그 부분은 규칙 밖이다.
describe("git 이 지우는 부분은 보지 않는다", () => {
  it("# 주석 줄은 무시한다", () => {
    passes(
      "feat: 로그인 화면 추가\n# Please enter the commit message for your changes.\n# On branch main\n",
    );
  });

  it("앞쪽 빈 줄은 무시한다", () => {
    passes("\n\nfeat: 로그인 화면 추가\n");
  });

  it("git commit -v 의 가위 줄 아래 diff 는 무시한다", () => {
    passes(
      "feat: 로그인 화면 추가\n# ------------------------ >8 ------------------------\n# Do not modify or remove the line above.\ndiff --git a/x b/x\n+아무 내용\n",
    );
  });

  it("윈도 줄바꿈(CRLF)도 같은 규칙으로 본다", () => {
    passes("feat: 로그인 화면 추가\r\n\r\n본문\r\n");
    fails("feat:로그인 화면 추가\r\n");
  });
});

describe("git 이 만드는 메시지는 통과시킨다", () => {
  it("병합 커밋", () => {
    passes("Merge branch 'main' of github.com:someone/agentic-boilerplate");
  });

  it("되돌리기 커밋", () => {
    passes('Revert "feat: 로그인 화면 추가"\n\nThis reverts commit abc123.');
  });

  it("autosquash 커밋 (fixup!·squash!·amend!)", () => {
    passes("fixup! feat: 로그인 화면 추가");
    passes("squash! feat: 로그인 화면 추가");
    passes("amend! feat: 로그인 화면 추가");
  });
});

describe("훅 연결 (.husky/commit-msg)", () => {
  // 게이트(pre-commit)가 커밋 도중 이 테스트를 부를 때 git 이 넘긴 GIT_* 값이 섞이지 않게 걷어낸다.
  const cleanEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );

  const runHook = (t, message) => {
    const dir = mkdtempSync(join(tmpdir(), "commit-msg-test-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(file, message);
    const result = spawnSync("sh", ["-e", ".husky/commit-msg", file], {
      cwd: root,
      encoding: "utf8",
      env: cleanEnv,
    });
    return { code: result.status, output: `${result.stdout}${result.stderr}` };
  };

  it("규칙에 맞는 메시지는 통과한다", (t) => {
    const { code } = runHook(t, "feat: 로그인 화면 추가\n");

    assert.equal(code, 0);
  });

  it("규칙에 어긋나면 이유와 함께 막는다", (t) => {
    const { code, output } = runHook(t, "로그인 화면 추가\n");

    assert.notEqual(code, 0);
    assert.match(output, /\[차단\]/);
    assert.match(output, /feat: /);
  });
});
