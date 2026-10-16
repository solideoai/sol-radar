import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

// 저장소 안을 가리키는 상대 경로인가. 절대 경로·`..`·역슬래시·glob 문자는 받지 않는다.
export const safeRelative = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value !== "." &&
  !isAbsolute(value) &&
  !value.includes("\\") &&
  !value.split("/").some((part) => part === ".." || part === ".") &&
  !/[\0\n\r:*?\[\]]/.test(value);

export function validateCommand(command) {
  if (
    !command ||
    typeof command.command !== "string" ||
    !command.command.trim() ||
    !Array.isArray(command.args) ||
    command.args.some((arg) => typeof arg !== "string") ||
    (command.cwd !== undefined && command.cwd !== "." && !safeRelative(command.cwd))
  ) {
    throw new Error(
      "명령은 { command, args, cwd? } 형식이며 cwd 는 프로젝트 안의 상대 경로여야 합니다",
    );
  }
  return command;
}

export function loadConfig(root) {
  const config = JSON.parse(readFileSync(join(root, "verify.config.json"), "utf8"));
  if (config.version !== 1) throw new Error("지원하지 않는 verify.config.json version");
  const { verification } = config;
  if (
    !Array.isArray(verification?.common) ||
    verification.common.length === 0 ||
    !Array.isArray(verification.projects)
  )
    throw new Error("공통 검증과 프로젝트 목록이 필요합니다");
  verification.common.forEach(validateCommand);
  if (
    new Set(verification.projects.map((project) => project.name)).size !==
    verification.projects.length
  )
    throw new Error("프로젝트 이름이 중복됩니다");
  verification.projects.forEach((project) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project.name ?? ""))
      throw new Error("프로젝트 name 은 영문 소문자·숫자·하이픈이어야 합니다");
    if (!safeRelative(project.directory) || !safeRelative(project.marker))
      throw new Error("프로젝트 경로·marker 는 안전한 상대 경로여야 합니다");
    validateCommand(project.verify);
    validateCommand(project.quick);
    for (const key of ["setup", "prepareE2e", "e2e"])
      if (project[key]) validateCommand(project[key]);
  });
  if (
    !Array.isArray(config.migrationDirectories) ||
    !config.migrationDirectories.every(safeRelative)
  )
    throw new Error("migrationDirectories 는 상대 경로 배열이어야 합니다");
  return config;
}

export const presentProjects = (root, config) =>
  config.verification.projects.filter((project) =>
    existsSync(join(root, project.directory, project.marker)),
  );

const touchedProjects = (root, config, files) =>
  presentProjects(root, config).filter(
    (project) => !files || files.some((file) => file.startsWith(`${project.directory}/`)),
  );

export const projectCommands = (root, config, { quick = false, files } = {}) =>
  touchedProjects(root, config, files).map((project) => ({
    ...project[quick ? "quick" : "verify"],
    cwd: project.directory,
  }));

export const verificationCommands = (root, config, options = {}) => [
  ...config.verification.common,
  ...projectCommands(root, config, options),
];
