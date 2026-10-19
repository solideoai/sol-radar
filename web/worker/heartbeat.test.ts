import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeHeartbeatFile, startHeartbeat } from "@/worker/heartbeat";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sol-hb-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("heartbeat", () => {
  it("시작하면 바로 파일을 쓰고 stop 하면 지운다", () => {
    const file = join(dir, "hb");
    const heartbeat = startHeartbeat(file, 60_000);
    expect(readFileSync(file, "utf8")).toMatch(/^\d{4}-/);
    heartbeat.stop();
    expect(existsSync(file)).toBe(false);
  });

  it("stop 을 두 번 불러도 파일이 없다고 실패하지 않는다", () => {
    const heartbeat = startHeartbeat(join(dir, "hb"), 60_000);
    heartbeat.stop();
    expect(() => heartbeat.stop()).not.toThrow();
  });

  it("removeHeartbeatFile 은 없는 파일을 무시하지만 다른 오류는 던진다", () => {
    expect(() => removeHeartbeatFile(join(dir, "none"))).not.toThrow();
    // 디렉터리는 파일이 아니라 rmSync 가 거부한다(ENOENT 아님).
    expect(() => removeHeartbeatFile(dir)).toThrow();
  });
});
