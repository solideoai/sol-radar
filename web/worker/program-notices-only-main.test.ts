import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INGEST_QUEUE } from "@/server/ingestion";
import {
  loadProgramNoticesConfig,
  runProgramNoticeRound,
  type NormalizedProgramNotice,
} from "@/server/program-notices";
import { defaultWorkerDeps } from "@/worker/main";
import {
  BIZINFO_SCHEDULER_ID,
  PROGRAM_NOTICES_QUEUE,
  SCHEDULED_SOURCES,
  runProgramNoticesOnly,
  scheduleProgramNotices,
  type ProgramNoticesOnlyDeps,
} from "@/worker/program-notices-only-main";

// 회사 전용 worker 의 기업마당 정기 수집. 실제 기업마당·Redis·Supabase 는 부르지 않는다.
// 응답은 2026-10-28 실호출 녹음(fixtures/recorded/program-notices/bizinfo)을 그대로 쓴다.
const root = path.resolve(process.cwd(), "..");
const configFile = path.join(root, "infra/sources/program-notices.yaml");
const recordingFile = path.join(
  root,
  "fixtures/recorded/program-notices/bizinfo/api.20261028.masked.json",
);
const KEY = "bizinfo-test-key-0000";
const liveEnv = {
  SOL_RUN_MODE: "live",
  REDIS_URL: "redis://127.0.0.1:6399",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  PROGRAM_NOTICES_CONFIG_FILE: configFile,
  BIZINFO_API_KEY: KEY,
};

describe("program-notices-only worker", () => {
  it("schedules bizinfo on its own queue at KST 00·03·…·21 o'clock", async () => {
    const calls: unknown[][] = [];
    await scheduleProgramNotices({
      upsertJobScheduler: async (...args: unknown[]) => {
        calls.push(args);
        return undefined as never;
      },
    });
    expect(PROGRAM_NOTICES_QUEUE).not.toBe(INGEST_QUEUE);
    expect(SCHEDULED_SOURCES).toEqual(["bizinfo"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(BIZINFO_SCHEDULER_ID);
    expect(calls[0]?.[1]).toEqual({ pattern: "0 */3 * * *", tz: "Asia/Seoul" });
  });

  it("retries a 5xx, then saves the recorded bizinfo response without calling MSS or logging the key", async () => {
    const loaded = await loadProgramNoticesConfig(configFile);
    if (!loaded.ok) throw new Error("program-notices config unavailable");
    const recording = JSON.parse(await readFile(recordingFile, "utf8")) as { body: string };
    const hosts: string[] = [];
    const logs: string[] = [];
    const waits: number[] = [];
    let saved: NormalizedProgramNotice[] = [];
    const runs = await runProgramNoticeRound({
      config: loaded.config,
      runMode: "live",
      env: { BIZINFO_API_KEY: KEY },
      fetch: async (url) => {
        hosts.push(new URL(url).hostname);
        return hosts.length === 1
          ? new Response("busy", { status: 503 })
          : new Response(recording.body, { status: 200 });
      },
      recordingsDir: path.join(root, "fixtures/recorded/program-notices"),
      now: () => new Date("2026-10-28T09:00:00.000Z"),
      log: (line) => logs.push(line),
      retry: { sleep: async (ms) => void waits.push(ms), random: () => 0 },
      sources: SCHEDULED_SOURCES,
      store: {
        upsertNotices: async (notices) => {
          saved = notices;
          return notices.length;
        },
        recordRun: async () => undefined,
      },
    });
    expect(hosts).toEqual(["www.bizinfo.go.kr", "www.bizinfo.go.kr"]);
    expect(waits).toEqual([1000]);
    expect(runs).toMatchObject([
      { source: "bizinfo", status: "SUCCEEDED", fetchedCount: 100, savedCount: 100 },
    ]);
    expect(new Set(saved.map((notice) => notice.sourceNoticeId)).size).toBe(100);
    // 실제 응답의 해시태그 칸(hashtags)을 읽고, 지역 16개가 모두 붙은 공고는 "전국" 하나로 줄인다.
    expect(saved.some((notice) => notice.tags.includes("전국"))).toBe(true);
    expect(
      saved.every((notice) => !notice.tags.includes("전국") || !notice.tags.includes("서울")),
    ).toBe(true);
    expect(logs.join("\n")).not.toContain(KEY);
  });

  it("--check passes with the key set, prints no key value, and fails when the key is empty", async () => {
    const run = async (env: Record<string, string>) => {
      const out: string[] = [];
      const codes: number[] = [];
      const deps: ProgramNoticesOnlyDeps = {
        workerDeps: defaultWorkerDeps,
        runOnce: async () => [],
        withRedis: async () => {
          throw new Error("--check must not connect");
        },
        onSignal: () => undefined,
        exit: (code) => void codes.push(code),
        log: (line) => out.push(line),
        logError: (line) => out.push(line),
      };
      await runProgramNoticesOnly(["--check"], env, deps);
      return { out: out.join("\n"), codes };
    };
    const ready = await run(liveEnv);
    expect(ready.codes).toEqual([0]);
    expect(ready.out).toContain("BIZINFO_API_KEY SET");
    expect(ready.out).toContain("bizinfo-scheduled");
    expect(ready.out).not.toContain(KEY);
    const missing = await run({ ...liveEnv, BIZINFO_API_KEY: " " });
    expect(missing.codes).toEqual([1]);
    expect(missing.out).toContain("BIZINFO_API_KEY 가 비어 있다");
  });
});
