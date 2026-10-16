#!/usr/bin/env node
// Git 훅을 거치지 않은 PR도 같은 환경변수·비밀값·마이그레이션 정책으로 검사한다.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { loadConfig } from "./project-config.mjs";
import { fileURLToPath } from "node:url";

export function checkPolicy(root, base, { staged = false } = {}) {
  const config = loadConfig(root);
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: root,
      env: staged
        ? process.env
        : Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
          ),
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    if (result.status !== 0) throw new Error(result.stderr || "Git diff 실패");
    return result.stdout;
  };
  if (!staged && !/^[a-f0-9]{40,64}$/.test(base ?? ""))
    throw new Error("--base 에 비교할 커밋 SHA가 필요합니다");
  const baseRef = /^0+$/.test(base)
    ? spawnSync("git", ["hash-object", "-t", "tree", "--stdin"], {
        input: "",
        encoding: "utf8",
      }).stdout.trim()
    : base;
  const comparison = staged ? ["--cached"] : [baseRef, "HEAD"];
  const entries = git("diff", "--name-status", "-z", "--no-renames", ...comparison)
    .split("\0")
    .filter(Boolean);
  const problems = [];
  for (let i = 0; i < entries.length; i += 2) {
    const [status, file] = entries.slice(i, i + 2);
    if (
      config.migrationDirectories.some((directory) =>
        file.startsWith(directory.replace(/\/$/, "") + "/"),
      ) &&
      status !== "A"
    )
      problems.push(`${file}: 기존 마이그레이션 수정·삭제 금지`);
    if (status === "D") continue;
    // .env 실파일: 파일 이름 자체가 .env 또는 .env.<무엇> 이고 .example 로 끝나지 않는 것.
    // .claude/hooks/guard.sh 의 is_env_file 과 같은 규칙이다. 가드는 이 파일들을 비밀 검사에서 빼므로
    // 두 규칙이 어긋나면 검사를 건너뛴 파일이 그대로 커밋된다. 한쪽을 바꾸면 다른 쪽도 바꾼다.
    if (/(^|\/)\.env(?:\.[^/]*)?$/.test(file) && !file.endsWith(".example")) {
      problems.push(`${file}: 실제 환경변수 파일 커밋 금지`);
      continue;
    }
    const diff = git(
      "diff",
      "--no-color",
      "--no-ext-diff",
      "--unified=0",
      ...comparison,
      "--",
      file,
    );
    const added = diff
      .split("\n")
      .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
      .map((line) => line.slice(1))
      .join("\n");
    const guard = spawnSync("bash", [resolve(root, ".claude/hooks/guard.sh")], {
      cwd: root,
      env: staged
        ? process.env
        : Object.fromEntries(
            Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
          ),
      encoding: "utf8",
      input: JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: file, content: added },
      }),
    });
    if (guard.status !== 0) throw new Error("비밀값 가드를 실행하지 못했습니다");
    if (guard.stdout.trim()) {
      const decision = JSON.parse(guard.stdout).hookSpecificOutput;
      if (decision?.permissionDecision === "deny")
        problems.push(`${file}: ${decision.permissionDecisionReason}`);
    }
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const problems = checkPolicy(process.cwd(), process.argv[process.argv.indexOf("--base") + 1], {
      staged: process.argv.includes("--staged"),
    });
    if (problems.length) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    } else console.log("✓ 변경분 정책 검사 통과");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
