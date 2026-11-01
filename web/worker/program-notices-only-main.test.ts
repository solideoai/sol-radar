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

// 회사 전용 worker 의 기업마당·과기정통부 정기 수집. 실제 기업마당·과기정통부·Redis·Supabase 는 부르지 않는다.
// 기업마당 응답은 2026-10-28 실호출 녹음(fixtures/recorded/program-notices/bizinfo), 과기정통부는 가상 샘플을 쓴다.
const root = path.resolve(process.cwd(), "..");
const configFile = path.join(root, "infra/sources/program-notices.yaml");
const recordingFile = path.join(
  root,
  "fixtures/recorded/program-notices/bizinfo/api.20261028.masked.json",
);
const msitSampleFile = path.join(
  process.cwd(),
  "server/program-notices/test-data/msit-sample.json",
);
const KEY = "bizinfo-test-key-0000";
const MSIT_KEY = "msit%2Bkey%3D";
const MSIT_KEY_FORMS = /msit%2Bkey|msit\+key|msit%252Bkey/;
const liveEnv = {
  SOL_RUN_MODE: "live",
  REDIS_URL: "redis://127.0.0.1:6399",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  PROGRAM_NOTICES_CONFIG_FILE: configFile,
  BIZINFO_API_KEY: KEY,
};

const runCheck = async (env: Record<string, string>) => {
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

/** 회사 회차(기업마당·과기정통부)를 가짜 응답으로 돌린다. msitBody 가 과기정통부 응답 본문이다 */
async function runCompanyRound(msitBody: string) {
  const loaded = await loadProgramNoticesConfig(configFile);
  if (!loaded.ok) throw new Error("program-notices config unavailable");
  const bizinfo = JSON.parse(await readFile(recordingFile, "utf8")) as { body: string };
  const logs: string[] = [];
  const runs = await runProgramNoticeRound({
    config: loaded.config,
    runMode: "live",
    env: { BIZINFO_API_KEY: KEY, MSIT_ANNOUNCEMENT_API_KEY: MSIT_KEY },
    fetch: async (url) =>
      new Response(new URL(url).hostname === "apis.data.go.kr" ? msitBody : bizinfo.body, {
        status: 200,
      }),
    recordingsDir: path.join(root, "fixtures/recorded/program-notices"),
    now: () => new Date("2026-11-02T00:00:00.000Z"),
    log: (line) => logs.push(line),
    retry: { sleep: async () => undefined, random: () => 0 },
    sources: SCHEDULED_SOURCES,
    store: {
      upsertNotices: async (notices) => notices.length,
      recordRun: async () => undefined,
    },
  });
  return { runs, logs };
}

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
    expect(SCHEDULED_SOURCES).toEqual(["bizinfo", "msit"]);
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
      sources: ["bizinfo"],
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
    const ready = await runCheck(liveEnv);
    expect(ready.codes).toEqual([0]);
    expect(ready.out).toContain("BIZINFO_API_KEY SET");
    expect(ready.out).toContain("bizinfo-scheduled");
    expect(ready.out).not.toContain(KEY);
    const missing = await runCheck({ ...liveEnv, BIZINFO_API_KEY: " " });
    expect(missing.codes).toEqual([1]);
    expect(missing.out).toContain("BIZINFO_API_KEY 가 비어 있다");
  });

  it("--check skips MSIT without its key and includes it with the key, printing no key value", async () => {
    const without = await runCheck(liveEnv);
    expect(without.codes).toEqual([0]);
    expect(without.out).toContain(
      "과기정통부: MSIT_ANNOUNCEMENT_API_KEY 없음 또는 형식 오류, 건너뜀",
    );
    const withKey = await runCheck({ ...liveEnv, MSIT_ANNOUNCEMENT_API_KEY: MSIT_KEY });
    expect(withKey.codes).toEqual([0]);
    expect(withKey.out).toContain("과기정통부: 최대 10건 · MSIT_ANNOUNCEMENT_API_KEY SET");
    expect(withKey.out).not.toMatch(MSIT_KEY_FORMS);
  });

  it("saves MSIT notices as SUCCEEDED, logs the excluded count, and never logs the key", async () => {
    const { runs, logs } = await runCompanyRound(await readFile(msitSampleFile, "utf8"));
    expect(runs.find((run) => run.source === "msit")).toMatchObject({
      status: "SUCCEEDED",
      errorCode: null,
      droppedCount: 0,
      fetchedCount: 4,
      savedCount: 3,
    });
    expect(logs.join("\n")).toContain(
      '"event":"program_notices.excluded","source":"msit","excluded":1',
    );
    expect([...logs, JSON.stringify(runs)].join("\n")).not.toMatch(MSIT_KEY_FORMS);
  });

  it("keeps bizinfo when msit returns the gateway XML error", async () => {
    const { runs } = await runCompanyRound(
      "<OpenAPI_ServiceResponse><cmmMsgHeader><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>",
    );
    expect(runs).toMatchObject([
      { source: "bizinfo", status: "SUCCEEDED" },
      { source: "msit", status: "FAILED", errorCode: "RESPONSE_SHAPE" },
    ]);
  });
});
