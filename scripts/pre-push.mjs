#!/usr/bin/env node
// push 전 검사 — `.husky/pre-push` 가 부른다. 켠 저장소에서만 돈다.
//
//   켜기: git config gate.prePush true      끄기: git config --unset gate.prePush
//
// CI(.github/workflows/ci.yml)가 돌지 못할 때(Actions 사용 분 소진 등) 같은 검사를 push 전에 로컬에서 돌린다.
// 기본은 꺼져 있다. CI 가 도는 저장소에서 push 마다 몇 분씩 같은 검사를 다시 돌릴 까닭이 없다.
//
// push 할 커밋을 임시 worktree 에 꺼내 CI 처럼 깨끗한 checkout 에서 본다. 작업 폴더의 커밋 안 한 변경과
// 같은 폴더에서 일하는 다른 세션의 작업이 결과에 섞이지 않는다. 대신 매번 의존성을 설치하고 캐시 없이 빌드한다.
// .env 파일이 없는 자리라 CI 와 같은 Supabase 자리값을 넣고 돌린다.
//
// 순서: 커밋 메시지(check-commits) → 변경분 정책(check-policy) → 루트 설치 → 아래를 동시에
//   - 공통 검사(verify --common) · 루트 의존성 감사
//   - 프로젝트마다: 설치 → verify(빌드 포함) → E2E(설정에 있으면) → 의존성 감사
// 프로젝트 검사는 그 폴더나 공유 파일(프로젝트 폴더 밖의 문서 아닌 파일)이 바뀐 push 에서만 돈다.
// 새 브랜치처럼 원격에 비교할 커밋이 없으면 전부 돈다.
//
// CI 와 다른 점: E2E 브라우저 설치(prepareE2e)는 하지 않는다. --with-deps 가 리눅스에서 sudo 로 시스템 패키지를
// 설치하려 할 수 있다. 브라우저가 없으면 E2E 가 실패하며 설치 명령을 알려 준다.
// E2E 는 빈 포트(E2E_PORT)에서 돈다. 개발 서버나 다른 세션의 E2E 와 3100 포트를 다투지 않는다.
//
// 실패하면 그 작업의 로그 끝을 보여 주고 전체 로그는 임시 폴더에 남긴다. worktree 는 성공·실패와 상관없이 지운다.
// 종료 코드: 0 통과(또는 꺼짐), 1 검사 실패·범위를 알 수 없음.
import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { killTree, spawnCommand } from "./command.mjs";
import { loadConfig, presentProjects } from "./project-config.mjs";

const NO_SHA = /^0+$/;
const LOG_TAIL = 40;

// ci.yml 의 프로젝트 검증 단계와 같은 자리값. 비밀이 아니다. scripts/pre-push.test.mjs 가 ci.yml 과 대조한다.
export const PLACEHOLDER_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ci-placeholder.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "ci-placeholder-anon-key-not-a-secret",
};

// git 이 표준 입력으로 넘기는 줄: <로컬 참조> <로컬 SHA> <원격 참조> <원격 SHA>.
// 원격 참조를 지우는 push(로컬 SHA 가 0000…)는 검사할 커밋이 없다. 같은 커밋을 여러 참조로 보내면 한 번만 본다.
export const parseRefs = (input) => {
  const updates = input
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length === 4)
    .map(([, local, , remote]) => ({ local, remote }))
    .filter(({ local }) => !NO_SHA.test(local));
  return updates.filter(
    (update, at) => updates.findIndex((other) => other.local === update.local) === at,
  );
};

// 문서는 프로젝트 검사(빌드·E2E)에 영향을 주지 않는다. 문서 시험은 공통 검사(pnpm test)가 본다.
export const isDoc = (file) => /\.md$/i.test(file) || /^(docs|polaris)\//.test(file);

// files 가 null 이면(비교할 커밋이 없다) 전부. 프로젝트 폴더 밖의 문서 아닌 파일(디자인 정본·스키마·스크립트·설정)은
// 모든 프로젝트에 걸릴 수 있어 전부 돈다.
export const projectsToCheck = (projects, files) => {
  if (!files) return projects;
  const code = files.filter((file) => !isDoc(file));
  const inside = (project, file) => file.startsWith(`${project.directory}/`);
  const shared = code.some((file) => !projects.some((project) => inside(project, file)));
  return projects.filter((project) => shared || code.some((file) => inside(project, file)));
};

// 훅 안에서 불려도 git 이 넘긴 GIT_* 값이 다른 저장소·worktree 를 가리키지 않게 걷어낸다
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
);

const git = (cwd, args) =>
  spawnSync("git", args, { cwd, env: cleanEnv, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const short = (sha) => sha.slice(0, 7);

const enabled = (root) => {
  const result = git(root, ["config", "--bool", "--get", "gate.prePush"]);
  if (result.status === 1 && result.stdout.trim() === "") return false;
  if (result.status !== 0)
    throw new Error(`git 설정 gate.prePush 를 읽지 못했습니다: ${result.stderr.trim()}`);
  return result.stdout.trim() === "true";
};

const changedFiles = (root, base, head) => {
  if (NO_SHA.test(base)) return null;
  if (git(root, ["cat-file", "-e", `${base}^{commit}`]).status !== 0)
    throw new Error(
      `원격의 ${short(base)} 가 로컬 이력에 없어 무엇이 새 커밋인지 알 수 없습니다. git fetch 로 원격을 받은 뒤 다시 push 하세요.`,
    );
  const result = git(root, ["diff", "--name-only", "--no-renames", "-z", base, head]);
  if (result.status !== 0) throw new Error(`바뀐 파일을 읽지 못했습니다: ${result.stderr.trim()}`);
  return result.stdout.split("\0").filter(Boolean);
};

const freePort = () =>
  new Promise((done, fail) => {
    const server = createServer();
    server.on("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });

const elapsed = (started) => {
  const seconds = Math.round((Date.now() - started) / 100) / 10;
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

// 도는 자식. 신호를 받으면 자식과 그 자식까지 끝낸다(command.mjs 의 killTree 는 프로세스 그룹을 끝내므로 detached).
const running = new Set();

const runStep = (step, fd) =>
  new Promise((done) => {
    const child = spawnCommand(step.command, step.args, {
      cwd: step.cwd,
      env: step.env,
      stdio: ["ignore", fd, fd],
      detached: process.platform !== "win32",
    });
    running.add(child);
    child.on("error", (error) => {
      running.delete(child);
      done({ ok: false, error });
    });
    child.on("close", (code) => {
      running.delete(child);
      done({ ok: code === 0 });
    });
  });

// 작업 하나 = 단계 여러 개를 차례로. 처음 실패한 단계에서 멈춘다. 출력은 작업마다 로그 파일 하나에 모은다.
const runTask = async (task, logDir) => {
  const log = join(logDir, `${task.id}.log`);
  const fd = openSync(log, "w");
  const started = Date.now();
  try {
    for (const step of task.steps) {
      writeSync(fd, `\n$ ${step.command} ${step.args.join(" ")}\n`);
      const result = await runStep(step, fd);
      if (!result.ok)
        return { task, ok: false, step, error: result.error, log, time: elapsed(started) };
    }
    return { task, ok: true, log, time: elapsed(started) };
  } finally {
    closeSync(fd);
  }
};

const report = (result) => {
  if (result.ok) {
    console.log(`  ✓ ${result.task.label} (${result.time})`);
    return;
  }
  const { step, error, log } = result;
  const reason = error ? ` (실행할 수 없습니다: ${error.message})` : "";
  const tail = readFileSync(log, "utf8").trimEnd().split("\n").slice(-LOG_TAIL);
  console.error(
    [
      `  ✗ ${result.task.label} — 실패한 단계: ${step.command} ${step.args.join(" ")}${reason}`,
      ...tail.map((line) => `    ${line}`),
      `    전체 로그: ${log}`,
    ].join("\n"),
  );
};

const removeWorktree = (root, worktree) => {
  if (git(root, ["worktree", "remove", "--force", worktree]).status === 0) return;
  rmSync(worktree, { recursive: true, force: true });
  git(root, ["worktree", "prune"]);
};

// 설정은 push 할 커밋(worktree)의 것을 읽는다. 작업 폴더의 설정은 아직 커밋되지 않았을 수 있다.
const selectProjects = (worktree, files) => {
  const present = presentProjects(worktree, loadConfig(worktree));
  const selected = projectsToCheck(present, files);
  present
    .filter((project) => !selected.includes(project))
    .forEach((project) => console.log(`  - ${project.name}: 바뀐 파일이 없어 건너뜁니다`));
  return selected;
};

async function checkUpdate(root, update) {
  const { local, remote } = update;
  console.log(
    `push 전 검사(gate.prePush): ${short(local)} 를 임시 worktree 에서 CI 처럼 검사합니다`,
  );
  const files = changedFiles(root, remote, local);
  const temp = mkdtempSync(join(tmpdir(), "pre-push-"));
  const worktree = join(temp, "repo");
  const logDir = join(temp, "logs");
  mkdirSync(logDir);

  const added = git(root, ["worktree", "add", "--detach", worktree, local]);
  if (added.status !== 0) {
    rmSync(temp, { recursive: true, force: true });
    throw new Error(`임시 worktree 를 만들지 못했습니다: ${added.stderr.trim()}`);
  }
  const cleanup = (keepLogs) => {
    removeWorktree(root, worktree);
    if (!keepLogs) rmSync(temp, { recursive: true, force: true });
  };
  const onSignal = (signal) => {
    running.forEach((child) => killTree(child, signal));
    cleanup(false);
    process.exit(130);
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    const env = { ...cleanEnv, ...PLACEHOLDER_ENV, CI: "true", E2E_PORT: String(await freePort()) };
    const node = (...args) => ({ command: process.execPath, args, cwd: worktree, env });
    const pnpm = (dir, ...args) => ({ command: "pnpm", args, cwd: join(worktree, dir), env });
    const audit = (dir) =>
      existsSync(join(worktree, dir, "pnpm-lock.yaml"))
        ? [pnpm(dir, "audit", "--audit-level", "critical")]
        : [];

    const first = [
      {
        id: "commits",
        label: "커밋 메시지",
        steps: [
          {
            ...node("scripts/check-commits.mjs"),
            env: { ...env, EVENT_NAME: "push", BASE_SHA: remote, HEAD_SHA: local },
          },
        ],
      },
      {
        id: "policy",
        label: "변경분 정책",
        steps: [node("scripts/check-policy.mjs", "--base", remote)],
      },
      { id: "install", label: "루트 설치", steps: [pnpm(".", "install", "--frozen-lockfile")] },
    ];
    for (const task of first) {
      const result = await runTask(task, logDir);
      report(result);
      if (!result.ok) {
        cleanup(true);
        return false;
      }
    }

    const selected = selectProjects(worktree, files);
    const parallel = [
      { id: "common", label: "공통 검사", steps: [node("scripts/verify.mjs", "--common")] },
      { id: "audit", label: "루트 의존성 감사", steps: audit(".") },
      ...selected.map((project) => ({
        id: `project-${project.name}`,
        label: `${project.name} 프로젝트`,
        steps: [
          node("scripts/verify.mjs", "--project", project.name, "--setup"),
          ...(project.e2e ? [{ ...project.e2e, cwd: join(worktree, project.directory), env }] : []),
          ...audit(project.directory),
        ],
      })),
    ].filter((task) => task.steps.length > 0);
    console.log(`  … ${parallel.map((task) => task.label).join(" · ")} 동시 진행`);
    const results = await Promise.all(
      parallel.map((task) =>
        runTask(task, logDir).then((result) => {
          report(result);
          return result;
        }),
      ),
    );
    const ok = results.every((result) => result.ok);
    cleanup(!ok);
    return ok;
  } catch (error) {
    cleanup(true);
    throw error;
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

async function main(root) {
  if (!enabled(root)) return 0;
  const updates = parseRefs(readFileSync(0, "utf8"));
  const results = [];
  for (const update of updates) results.push(await checkUpdate(root, update));
  if (results.every(Boolean)) {
    if (updates.length > 0) console.log("[통과] push 전 검사 통과.");
    return 0;
  }
  console.error("[차단] push 전 검사가 실패했습니다. 고친 뒤 다시 push 하세요.");
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  main(root).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[차단] push 전 검사를 돌리지 못했습니다: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
