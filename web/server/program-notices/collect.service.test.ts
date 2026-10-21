import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runProgramNoticeRound, type ProgramRun, type RoundDeps } from "./collect.service";
import type { ProgramNoticesConfig } from "./config";
import type { FetchLike } from "./http";
import type { NormalizedProgramNotice } from "./program-notice.model";
import type { ProgramNoticesStore } from "./program-notices.store";
import { PROGRAM_RECORDED_SCHEMA_VERSION } from "./recording";

const KEY = "test-key-123";
const NOW = new Date("2026-10-21T03:00:00.000Z");
const BIZINFO_BODY = readFileSync(join(__dirname, "test-data", "bizinfo-sample.json"), "utf8");
const MSS_BODY = readFileSync(join(__dirname, "test-data", "mss-sample.xml"), "utf8");

const CONFIG: ProgramNoticesConfig = {
  bizinfo: {
    ok: true,
    value: {
      enabled: true,
      baseUrl: "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do",
      keyEnv: "BIZINFO_API_KEY",
      categories: ["02"],
      maxItems: 100,
    },
  },
  mss: { ok: true, value: { enabled: true, baseUrl: "https://mss.go.kr/rss/smba/board/310.do" } },
};

type FakeStore = ProgramNoticesStore & { saved: NormalizedProgramNotice[][]; runs: ProgramRun[] };

const fakeStore = (overrides: Partial<ProgramNoticesStore> = {}): FakeStore => {
  const saved: NormalizedProgramNotice[][] = [];
  const runs: ProgramRun[] = [];
  return {
    saved,
    runs,
    upsertNotices: async (rows) => {
      saved.push(rows);
      return rows.length;
    },
    recordRun: async (run) => {
      runs.push(run);
    },
    ...overrides,
  };
};

const fetchBy = (bodies: Record<string, string>) =>
  vi.fn<FetchLike>(async (url) => {
    const host = new URL(url).hostname;
    const body = bodies[host];
    return body === undefined ? new Response("no", { status: 404 }) : new Response(body);
  });

const depsOf = (overrides: Partial<RoundDeps> = {}): RoundDeps & { lines: string[] } => {
  const lines: string[] = [];
  return {
    config: CONFIG,
    runMode: "live",
    env: { BIZINFO_API_KEY: KEY },
    fetch: fetchBy({ "www.bizinfo.go.kr": BIZINFO_BODY, "mss.go.kr": MSS_BODY }),
    store: fakeStore(),
    recordingsDir: join(tmpdir(), "program-recordings-none"),
    now: () => NOW,
    log: (line) => {
      lines.push(line);
    },
    lines,
    ...overrides,
  };
};

const statusOf = (runs: ProgramRun[]) =>
  Object.fromEntries(runs.map((run) => [run.source, [run.status, run.errorCode]]));

const recordingsDirWith = (source: string, body: string, fetchedAt: string): string => {
  const root = mkdtempSync(join(tmpdir(), "program-round-recordings-"));
  mkdirSync(join(root, source));
  writeFileSync(
    join(root, source, "r.masked.json"),
    JSON.stringify({
      schemaVersion: PROGRAM_RECORDED_SCHEMA_VERSION,
      source,
      params: {},
      fetchedAt,
      httpStatus: 200,
      contentType: "application/rss+xml",
      body,
      rawSha256: "b".repeat(64),
      masked: true,
      maskedFields: [],
      note: "시험",
    }),
  );
  return root;
};

describe("runProgramNoticeRound", () => {
  it("live: 두 소스를 가져와 저장하고 소스마다 run 을 남긴다(일부 버리면 PARTIAL)", async () => {
    const deps = depsOf();
    const runs = await runProgramNoticeRound(deps);
    expect(statusOf(runs)).toEqual({ bizinfo: ["PARTIAL", null], mss: ["PARTIAL", null] });
    expect(runs.find((run) => run.source === "bizinfo")).toMatchObject({
      runMode: "LIVE",
      fetchedCount: 4,
      savedCount: 2,
      droppedCount: 2,
      startedAt: NOW.toISOString(),
      finishedAt: NOW.toISOString(),
    });
    const store = deps.store as FakeStore;
    expect(store.runs).toEqual(runs);
    expect(store.saved.flat().map((row) => row.fetchedAt)).toEqual(
      Array(5).fill(NOW.toISOString()),
    );
  });

  it("live + 기업마당 키 없음 → bizinfo SKIPPED/KEY_MISSING, fetch 는 중기부만 한 번", async () => {
    const deps = depsOf({ env: { BIZINFO_API_KEY: "  " } });
    const runs = await runProgramNoticeRound(deps);
    expect(statusOf(runs)).toEqual({ bizinfo: ["SKIPPED", "KEY_MISSING"], mss: ["PARTIAL", null] });
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(String(vi.mocked(deps.fetch).mock.calls[0]?.[0])).hostname).toBe("mss.go.kr");
  });

  it("한 소스의 응답 본문이 중간에 깨져도 다른 소스는 저장되고 run 은 둘이다", async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error("connection reset"));
          },
        }),
      );
    const deps = depsOf({
      fetch: vi.fn<FetchLike>(async (url) =>
        new URL(url).hostname === "mss.go.kr" ? broken() : new Response(BIZINFO_BODY),
      ),
    });
    const runs = await runProgramNoticeRound(deps);
    expect(statusOf(runs)).toEqual({ bizinfo: ["PARTIAL", null], mss: ["FAILED", "HTTP_ERROR"] });
    expect((deps.store as FakeStore).saved).toHaveLength(1);
  });

  it("저장이 Error 가 아닌 값을 던져도 그 소스만 실패한다", async () => {
    const store = fakeStore();
    const upsert = store.upsertNotices;
    store.upsertNotices = async (rows) => {
      if (rows[0]?.source === "mss") throw "not an error";
      return upsert(rows);
    };
    const runs = await runProgramNoticeRound(depsOf({ store }));
    expect(statusOf(runs)).toEqual({ bizinfo: ["PARTIAL", null], mss: ["FAILED", "STORE_FAILED"] });
  });

  it("저장이 던지면 그 소스만 FAILED/STORE_FAILED 이고 다른 소스는 저장된다", async () => {
    const store = fakeStore();
    const upsert = store.upsertNotices;
    store.upsertNotices = async (rows) => {
      if (rows[0]?.source === "bizinfo") throw new Error(`db down ${KEY}`);
      return upsert(rows);
    };
    const runs = await runProgramNoticeRound(depsOf({ store }));
    expect(statusOf(runs)).toEqual({ bizinfo: ["FAILED", "STORE_FAILED"], mss: ["PARTIAL", null] });
    expect(store.saved).toHaveLength(1);
  });

  it("응답 모양이 틀리거나 0건이면 저장하지 않는다(마지막 성공 데이터 유지)", async () => {
    const deps = depsOf({
      fetch: fetchBy({
        "www.bizinfo.go.kr": "<html>점검</html>",
        "mss.go.kr": "<rss><channel></channel></rss>",
      }),
    });
    const runs = await runProgramNoticeRound(deps);
    expect(statusOf(runs)).toEqual({
      bizinfo: ["FAILED", "RESPONSE_SHAPE"],
      mss: ["SUCCEEDED", null],
    });
    expect((deps.store as FakeStore).saved).toEqual([]);
  });

  it("HTTP 실패 코드를 run 에 남긴다", async () => {
    const runs = await runProgramNoticeRound(depsOf({ fetch: fetchBy({}) }));
    expect(statusOf(runs)).toEqual({
      bizinfo: ["FAILED", "HTTP_ERROR"],
      mss: ["FAILED", "HTTP_ERROR"],
    });
  });

  it("mock: 녹음을 재생하고 fetch 를 부르지 않으며 녹음 시각을 fetchedAt 으로 저장한다", async () => {
    const deps = depsOf({
      runMode: "mock",
      recordingsDir: recordingsDirWith("mss", MSS_BODY, "2026-10-20T05:00:00.000Z"),
    });
    const runs = await runProgramNoticeRound(deps);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(statusOf(runs)).toEqual({
      bizinfo: ["SKIPPED", "NO_RECORDING"],
      mss: ["PARTIAL", null],
    });
    expect(runs.find((run) => run.source === "mss")?.runMode).toBe("MOCK");
    const rows = (deps.store as FakeStore).saved.flat();
    expect(rows.map((row) => row.fetchedAt)).toEqual(Array(3).fill("2026-10-20T05:00:00.000Z"));
  });

  it("fixture 모드도 녹음만 재생한다", async () => {
    const deps = depsOf({ runMode: "fixture" });
    const runs = await runProgramNoticeRound(deps);
    expect(deps.fetch).not.toHaveBeenCalled();
    expect(statusOf(runs)).toEqual({
      bizinfo: ["SKIPPED", "NO_RECORDING"],
      mss: ["SKIPPED", "NO_RECORDING"],
    });
    expect(runs.every((run) => run.runMode === "FIXTURE")).toBe(true);
  });

  it("설정이 틀린 소스는 SKIPPED/CONFIG_INVALID, 꺼 둔 소스는 run 없이 건너뛴다", async () => {
    const config: ProgramNoticesConfig = {
      bizinfo: { ok: false, reason: "sources.bizinfo.baseUrl" },
      mss: {
        ok: true,
        value: { enabled: false, baseUrl: "https://mss.go.kr/rss/smba/board/310.do" },
      },
    };
    const deps = depsOf({ config });
    const runs = await runProgramNoticeRound(deps);
    expect(statusOf(runs)).toEqual({ bizinfo: ["SKIPPED", "CONFIG_INVALID"] });
    expect(deps.fetch).not.toHaveBeenCalled();
  });

  it("같은 회차 안의 같은 공고 id 는 한 번만 저장한다", async () => {
    const twice = JSON.stringify({
      jsonArray: [
        { pblancId: "P1", pblancNm: "가", pblancUrl: "/a?pblancId=P1" },
        { pblancId: "P1", pblancNm: "가 수정", pblancUrl: "/a?pblancId=P1" },
      ],
    });
    const deps = depsOf({ fetch: fetchBy({ "www.bizinfo.go.kr": twice, "mss.go.kr": MSS_BODY }) });
    await runProgramNoticeRound(deps);
    const bizinfoRows = (deps.store as FakeStore).saved
      .flat()
      .filter((row) => row.source === "bizinfo");
    expect(bizinfoRows.map((row) => row.title)).toEqual(["가 수정"]);
  });

  it("run 기록이 던져도 회차는 끝나고 로그 한 줄을 남긴다", async () => {
    const store = fakeStore({
      recordRun: async () => {
        throw new Error("runs down");
      },
    });
    const deps = depsOf({ store });
    const runs = await runProgramNoticeRound(deps);
    expect(runs).toHaveLength(2);
    expect(
      deps.lines.filter((line) => line.includes("program_notices.run_record_failed")),
    ).toHaveLength(2);
  });

  it("로그는 소스마다 JSON 한 줄이고 로그·run 어디에도 키·URL·본문이 없다", async () => {
    const store = fakeStore({
      upsertNotices: async () => {
        throw new Error(`fail https://www.bizinfo.go.kr/?crtfcKey=${KEY}`);
      },
    });
    const deps = depsOf({
      store,
      fetch: vi.fn<FetchLike>(async (url) => {
        if (new URL(url).hostname === "mss.go.kr")
          throw new TypeError(`fetch failed ${url} ${KEY}`);
        return new Response(BIZINFO_BODY);
      }),
    });
    const runs = await runProgramNoticeRound(deps);
    const rounds = deps.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(rounds.filter((line) => line.event === "program_notices.round")).toHaveLength(2);
    const everything = JSON.stringify({
      runs,
      lines: deps.lines,
      saved: (deps.store as FakeStore).runs,
    });
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("crtfcKey");
    expect(everything).not.toContain("https://");
  });
});
