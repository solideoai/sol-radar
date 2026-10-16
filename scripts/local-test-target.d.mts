// Node-only test tooling shared by seed CLIs and web Auth fixtures.
export type LocalStatusOptions = {
  env?: Record<string, string | undefined>;
  run?: (
    command: string,
    args: string[],
    options: { cwd: string; encoding: "utf8"; stdio: ["ignore", "pipe", "pipe"]; shell: boolean },
  ) => { status: number | null; stdout: unknown; error?: unknown };
};
export declare function readLocalStatus(options?: LocalStatusOptions): Record<string, string>;
