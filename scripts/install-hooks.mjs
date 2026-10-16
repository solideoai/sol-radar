#!/usr/bin/env node
// 커밋 게이트를 켠다. pnpm install 이 자동으로 부른다(package.json 의 prepare).
//
// 건너뛰는 경우(종료 0) — 이유를 알린다:
// - HUSKY=0: 일부러 끈 경우(CI 등).
// - .git 이 없다: 템플릿을 zip 으로 받아 압축만 푼 상태. 여기서 실패하면 설치가 통째로 멈춘다.
//   `git init` 을 한 뒤 `pnpm install` 을 다시 돌리면 그때 켜진다.
//
// 실제 git 저장소인데 켜지 못하면 종료 1 이다. 게이트 없이 커밋이 통과하는 것을 성공으로 숨기지 않는다.
// - 사용자가 이미 다른 core.hooksPath 를 쓰고 있으면 덮어쓰지 않고 멈춘다.
// - husky 는 내부 git 실패를 문자열로 돌려줄 뿐 실패로 끝나지 않으므로 셸 명령(`husky`) 대신
//   로컬 husky API 를 직접 부르고, 돌려받은 진단과 설치 뒤 실제 상태(scripts/git-hooks.mjs)를 둘 다 본다.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HOOKS_PATH, HUSKY_DIR, inspectGitHooks } from "./git-hooks.mjs";

const RETRY = "고친 뒤 `pnpm install`(또는 `node scripts/install-hooks.mjs`)을 다시 돌리세요.";
const SKIP = "게이트 없이 설치만 하려면 `HUSKY=0 pnpm install` 로 명시적으로 건너뛰세요.";

const skip = (reason, ...details) => ({ code: 0, lines: [`ℹ️  ${reason}`, ...details] });

const fail = (reason, ...fixes) => ({
  code: 1,
  lines: [
    `❌ 커밋 게이트를 켜지 못했습니다: ${reason}`,
    ...fixes.map((fix) => `   ${fix}`),
    `   ${SKIP}`,
  ],
});

const conflict = ({ value, scope }) => {
  const userScope = scope === "local" || scope === "worktree";
  return fail(
    `이미 다른 core.hooksPath 가 설정돼 있습니다: ${value} (${scope}). 덮어쓰지 않았습니다.`,
    userScope
      ? `기존 훅을 ${HUSKY_DIR}/ 로 옮긴 뒤 \`git config --${scope} --unset core.hooksPath\` 로 지우세요.`
      : `이 저장소만 게이트를 쓰려면 \`git config --local core.hooksPath ${HOOKS_PATH}\` — 이 저장소에서는 ${value} 의 훅이 돌지 않습니다.`,
    RETRY,
  );
};

const loadLocalHusky = async () => (await import("husky")).default;

const loadHusky = async (load) => {
  try {
    const husky = await load();
    return typeof husky === "function"
      ? { husky }
      : {
          failure: fail(
            "husky 모듈이 설치 함수를 내보내지 않습니다.",
            "`pnpm install` 로 husky 를 다시 설치하세요.",
          ),
        };
  } catch (error) {
    return {
      failure: fail(
        `husky 를 불러오지 못했습니다 (${error.code ?? error.message}).`,
        "루트에서 `pnpm install` 로 husky 를 설치하세요.",
      ),
    };
  }
};

// husky(dir) 는 process.cwd() 에서 일한다. 기본 loadHusky 를 쓸 때는 cwd 가 process.cwd() 여야 한다.
// 성공이면 빈 문자열을, 실패면 진단 문자열을 돌려준다(던지기도 한다).
const runHusky = (husky) => {
  try {
    const diagnostic = husky(HUSKY_DIR);
    return typeof diagnostic === "string" && diagnostic.trim() === ""
      ? null
      : `husky 가 실패를 알렸습니다: ${String(diagnostic).trim()}`;
  } catch (error) {
    return `husky 설치 중 오류: ${error.message}`;
  }
};

export const installHooks = async ({
  cwd = process.cwd(),
  env = process.env,
  load = loadLocalHusky,
} = {}) => {
  if (env.HUSKY === "0") {
    return skip(
      "HUSKY=0 이라 커밋 게이트 설치를 건너뜁니다. 이 상태로는 커밋을 검사하지 않습니다.",
    );
  }
  if (!existsSync(join(cwd, ".git"))) {
    return skip(
      "아직 git 저장소가 아니라 커밋 게이트를 걸지 않았습니다.",
      "   `git init` 뒤에 `pnpm install` 을 한 번 더 돌리면 켜집니다.",
    );
  }

  const before = inspectGitHooks({ cwd, env });
  if (before.error) return fail(before.error, RETRY);
  if (before.hooksPath.value !== null && !before.active) return conflict(before.hooksPath);

  const loaded = await loadHusky(load);
  if (loaded.failure) return loaded.failure;

  const huskyError = runHusky(loaded.husky);
  if (huskyError) return fail(huskyError, RETRY);

  const after = inspectGitHooks({ cwd, env });
  if (after.problems.length > 0) {
    const overridden = after.hooksPath?.value != null && !after.active;
    return fail(
      "설치 뒤 확인에 실패했습니다.",
      ...after.problems.map((problem) => `- ${problem}`),
      overridden
        ? `다른 범위(${after.hooksPath.scope})의 core.hooksPath 가 이기고 있습니다. 그 설정을 정리하세요.`
        : `\`git config core.hooksPath\` 와 ${HOOKS_PATH}/ 를 확인하세요.`,
      RETRY,
    );
  }

  return {
    code: 0,
    lines: [`✅ 커밋 게이트 켜짐 (core.hooksPath=${HOOKS_PATH} · pre-commit·commit-msg)`],
  };
};

const isMain = () => {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (process.argv[1] && isMain()) {
  const { code, lines } = await installHooks();
  (code === 0 ? console.log : console.error)(lines.join("\n"));
  process.exitCode = code;
}
