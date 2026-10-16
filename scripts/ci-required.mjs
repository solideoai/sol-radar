#!/usr/bin/env node
// CI 의 고정 이름 검사(required) — `.github/workflows/ci.yml` 이 부른다.
//
// `node scripts/ci-required.mjs check` — 앞선 job 결과를 모아 하나라도 어긋나면 종료 1.
//   common(공통 검증)·commits(커밋 메시지)·audit(루트 의존성 감사)는 success 만 통과한다.
//   project 는 success, 또는 검사할 프로젝트가 없어 의도적으로 건너뛴 경우만 통과.
//   failure·cancelled·예상 밖 skipped·빈 결과(잡 이름이 바뀐 경우 등)는 막는다.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKIPPED = {
  common: "공통 검증을 건너뛰었습니다",
  commits: "커밋 메시지 검사를 건너뛰었습니다",
  audit: "루트 의존성 감사를 건너뛰었습니다",
  project: "검사할 프로젝트가 있는데 건너뛰었습니다",
};
const problem = (name, result) =>
  `${name}: ${result === "skipped" ? SKIPPED[name] : result || "결과 없음"}`;

export function requiredProblems({ common, commits, audit, project, hasProjects }) {
  const results = { common, commits, audit };
  const problems = Object.entries(results)
    .filter(([, result]) => result !== "success")
    .map(([name, result]) => problem(name, result));
  const projectOk = project === "success" || (project === "skipped" && hasProjects === "false");
  return projectOk ? problems : [...problems, problem("project", project)];
}

export function main(argv, { env = process.env, log = console.log, error = console.error } = {}) {
  const [command] = argv;
  if (command === "check") {
    const problems = requiredProblems({
      common: env.COMMON_RESULT,
      commits: env.COMMITS_RESULT,
      audit: env.AUDIT_RESULT,
      project: env.PROJECT_RESULT,
      hasProjects: env.HAS_PROJECTS,
    });
    if (problems.length) {
      error(`✗ 필수 검사 실패\n${problems.map((line) => `- ${line}`).join("\n")}`);
      return 1;
    }
    log("✓ 모든 필수 검사 통과");
    return 0;
  }
  error("사용법: node scripts/ci-required.mjs check");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
