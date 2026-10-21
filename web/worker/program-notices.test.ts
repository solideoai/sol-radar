import { afterEach, describe, expect, it, vi } from "vitest";
import {
  programNoticesWorkerRegistration,
  readProgramNoticeSettings,
  startProgramNoticeCollector,
} from "@/worker/program-notices";

const deferred = () => {
  let resolve: () => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<void>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
};

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("readProgramNoticeSettings", () => {
  it("빈 env 는 60분 간격·mock 모드, 설정 파일은 registry 옆, 녹음은 fixtures/recorded/program-notices 다", () => {
    expect(
      readProgramNoticeSettings({
        SOURCES_REGISTRY_FILE: "/srv/sol-radar/infra/sources/registry.yaml",
        FIXTURES_DIR: "/srv/sol-radar/fixtures",
      }),
    ).toEqual({
      ok: true,
      intervalMs: 60 * 60 * 1000,
      runMode: "mock",
      configFile: "/srv/sol-radar/infra/sources/program-notices.yaml",
      recordingsDir: "/srv/sol-radar/fixtures/recorded/program-notices",
    });
  });

  it("PROGRAM_NOTICES_CONFIG_FILE·간격·실행 모드를 env 에서 읽는다", () => {
    expect(
      readProgramNoticeSettings({
        PROGRAM_NOTICES_CONFIG_FILE: " /tmp/p.yaml ",
        PROGRAM_NOTICES_INTERVAL_MINUTES: "1440",
        SOL_RUN_MODE: "live",
        FIXTURES_DIR: "/f",
      }),
    ).toMatchObject({
      ok: true,
      intervalMs: 1440 * 60 * 1000,
      runMode: "live",
      configFile: "/tmp/p.yaml",
    });
  });

  it("간격이 1~1440 분 정수가 아니거나 실행 모드가 틀리면 ok:false 이고 사유에 값이 없다", () => {
    for (const env of [
      { PROGRAM_NOTICES_INTERVAL_MINUTES: "0" },
      { PROGRAM_NOTICES_INTERVAL_MINUTES: "abc" },
      { PROGRAM_NOTICES_INTERVAL_MINUTES: "1441" },
      { PROGRAM_NOTICES_INTERVAL_MINUTES: "1.5" },
      { SOL_RUN_MODE: "demo-secret-value" },
    ]) {
      const result = readProgramNoticeSettings(env);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(/abc|1441|1\.5|demo-secret-value/);
    }
  });
});

describe("startProgramNoticeCollector", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("기동 때 한 번 돌고, 앞 회차가 안 끝났으면 다음 틱은 건너뛴다", async () => {
    vi.useFakeTimers();
    const first = deferred();
    const runRound = vi.fn(() =>
      runRound.mock.calls.length === 1 ? first.promise : Promise.resolve(),
    );
    const collector = startProgramNoticeCollector({ runRound, log: () => {}, intervalMs: 1000 });
    expect(runRound).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(runRound).toHaveBeenCalledTimes(1);
    first.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    expect(runRound).toHaveBeenCalledTimes(2);
    await collector.stop();
  });

  it("회차 오류는 삼키고 오류 이름만 로그 한 줄로 남긴 뒤 다음 틱에 다시 돈다", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const runRound = vi.fn(async () => {
      throw new Error("secret https://www.bizinfo.go.kr/?crtfcKey=abc");
    });
    const collector = startProgramNoticeCollector({
      runRound,
      log: (line) => lines.push(line),
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(runRound).toHaveBeenCalledTimes(2);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toContainEqual({
      event: "program_notices.round_failed",
      errorName: "Error",
    });
    expect(lines.join("\n")).not.toContain("crtfcKey");
    await collector.stop();
  });

  it("stop 은 타이머를 멈추고 진행 중 회차가 끝날 때까지 기다린다", async () => {
    const running = deferred();
    const runRound = vi.fn(() => running.promise);
    const collector = startProgramNoticeCollector({ runRound, log: () => {}, intervalMs: 1000 });
    let isStopped = false;
    const stopping = collector.stop().then(() => {
      isStopped = true;
    });
    await flush();
    expect(isStopped).toBe(false);
    running.resolve();
    await stopping;
    expect(isStopped).toBe(true);
  });

  it("진행 중 회차가 5초 안에 안 끝나면 stop 은 stop_timeout 한 줄을 남기고 돌아온다", async () => {
    vi.useFakeTimers();
    const lines: string[] = [];
    const collector = startProgramNoticeCollector({
      runRound: () => new Promise(() => {}),
      log: (line) => lines.push(line),
      intervalMs: 1000,
    });
    const stopping = collector.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await stopping;
    expect(lines).toContain(JSON.stringify({ event: "program_notices.stop_timeout" }));
  });
});

describe("programNoticesWorkerRegistration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("env·설정이 틀려도 던지지 않고 disabled 한 줄을 남긴 뒤 빈 Closable 을 준다", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [
      { PROGRAM_NOTICES_INTERVAL_MINUTES: "abc" },
      { PROGRAM_NOTICES_CONFIG_FILE: "/nonexistent/program-notices.yaml" },
    ]) {
      log.mockClear();
      const start = await programNoticesWorkerRegistration(env);
      const closable = await start({} as never);
      await expect(closable.close()).resolves.toBeUndefined();
      const lines = log.mock.calls.map(([line]) => JSON.parse(String(line)) as { event: string });
      expect(lines.filter((line) => line.event === "program_notices.disabled")).toHaveLength(1);
    }
  });
});
