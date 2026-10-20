import { describe, expect, it } from "vitest";
import {
  STALE_RUN_MS,
  WORKER_START_GRACE_MS,
  isRunBlocked,
  isSettled,
  isUuid,
  mergeRuns,
  pendingRuns,
  statusLineOf,
  upsertRuns,
  watchRunning,
  type AcceptedRun,
} from "./ingest-runs";
import type { IngestRun } from "./ingestion-copy";

// 이력 표·상태 줄·머리 단추의 계산(디자인 스펙 §4.3 상태 줄, §4.5 표 합치기, §4.8 멈춤, §4.10, D9·D15).

const ID = {
  a: "aaaaaaaa-0000-4000-8000-000000000001",
  b: "bbbbbbbb-0000-4000-8000-000000000002",
  c: "cccccccc-0000-4000-8000-000000000003",
  d: "dddddddd-0000-4000-8000-000000000004",
} as const;

const T0 = Date.parse("2026-10-20T05:00:00.000Z");
const at = (offsetMs: number): string => new Date(T0 + offsetMs).toISOString();

const run = (over: Partial<IngestRun> = {}): IngestRun => ({
  id: ID.a,
  source: "fixture",
  runMode: "mock",
  batch: "seed",
  trigger: "MANUAL",
  status: "SUCCEEDED",
  summary: {
    created: 0,
    changed: 0,
    cancelled: 0,
    skippedDuplicate: 0,
    quarantined: 0,
    retried: 0,
  },
  quotaUsed: 0,
  errors: [],
  cursor: null,
  requestedBy: null,
  startedAt: at(0),
  finishedAt: at(12_000),
  ...over,
});

const accepted = (over: Partial<IngestRun>, acceptedAt = T0): AcceptedRun => ({
  run: run({ status: "RUNNING", finishedAt: null, ...over }),
  acceptedAt,
});

const ids = (runs: readonly { id: string }[]): string[] => runs.map((r) => r.id);

describe("isUuid", () => {
  it("UUID 모양이면 참이다(대소문자 무관)", () => {
    expect(isUuid(ID.a)).toBe(true);
    expect(isUuid(ID.a.toUpperCase())).toBe(true);
  });

  it.each(["", "aaaaaaaa", `${ID.a}x`, "zzzzzzzz-0000-4000-8000-000000000001"])(
    "%j 는 UUID 가 아니다",
    (value) => {
      expect(isUuid(value)).toBe(false);
    },
  );
});

describe("upsertRuns — §4.5 폴링 합치기", () => {
  it("같은 id 는 새로 읽은 값으로 바꾼다", () => {
    const known = [run({ id: ID.a, status: "RUNNING", finishedAt: null })];
    const fresh = [run({ id: ID.a, status: "PARTIAL" })];
    const merged = upsertRuns(known, fresh);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("PARTIAL");
  });

  it("fresh 에 없는 known 행(더 보기로 붙인 행)은 버리지 않는다", () => {
    const known = [run({ id: ID.a, startedAt: at(0) }), run({ id: ID.b, startedAt: at(-60_000) })];
    const fresh = [run({ id: ID.a, startedAt: at(0) })];
    expect(ids(upsertRuns(known, fresh))).toEqual([ID.a, ID.b]);
  });

  it("새 id 는 시작 시각 순서대로 맨 위에 더해진다", () => {
    const known = [run({ id: ID.a, startedAt: at(0) })];
    const fresh = [run({ id: ID.b, startedAt: at(60_000) })];
    expect(ids(upsertRuns(known, fresh))).toEqual([ID.b, ID.a]);
  });

  it("결과는 startedAt 내림차순이다", () => {
    const merged = upsertRuns(
      [run({ id: ID.a, startedAt: at(0) }), run({ id: ID.c, startedAt: at(120_000) })],
      [run({ id: ID.b, startedAt: at(60_000) })],
    );
    expect(ids(merged)).toEqual([ID.c, ID.b, ID.a]);
  });

  it("startedAt 이 같으면 id 내림차순이다(서버 keyset 과 같다)", () => {
    const merged = upsertRuns(
      [run({ id: ID.a, startedAt: at(0) })],
      [run({ id: ID.b, startedAt: at(0) })],
    );
    expect(ids(merged)).toEqual([ID.b, ID.a]);
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const known = [run({ id: ID.a, startedAt: at(0) })];
    const fresh = [run({ id: ID.b, startedAt: at(60_000) })];
    upsertRuns(known, fresh);
    expect(ids(known)).toEqual([ID.a]);
    expect(ids(fresh)).toEqual([ID.b]);
  });
});

describe("mergeRuns", () => {
  it("폴링으로 읽은 것이 없으면 화면 행을 그대로 돌려준다(새 배열)", () => {
    const rows = [run({ id: ID.b, startedAt: at(0) }), run({ id: ID.a, startedAt: at(60_000) })];
    const merged = mergeRuns([], rows);
    expect(merged).toEqual(rows);
    expect(merged).not.toBe(rows);
  });

  it("폴링 값이 같은 id 의 화면 행을 이긴다", () => {
    const rows = [run({ id: ID.a, status: "RUNNING", finishedAt: null })];
    const polled = [run({ id: ID.a, status: "FAILED" })];
    expect(mergeRuns(polled, rows)[0]?.status).toBe("FAILED");
  });
});

describe("pendingRuns — 접수 행(D15)", () => {
  it("같은 id 가 목록에 나타나면 접수 행에서 빠진다(목록 행으로 교체)", () => {
    const entries = [accepted({ id: ID.a }), accepted({ id: ID.b })];
    const rows = [run({ id: ID.a, status: "RUNNING", finishedAt: null })];
    expect(pendingRuns(entries, rows).map((e) => e.run.id)).toEqual([ID.b]);
  });

  it("목록에 없으면 남고, 최근 접수가 위다", () => {
    const entries = [
      accepted({ id: ID.a, startedAt: at(0) }),
      accepted({ id: ID.b, startedAt: at(60_000) }),
    ];
    expect(pendingRuns(entries, []).map((e) => e.run.id)).toEqual([ID.b, ID.a]);
  });
});

describe("isRunBlocked — 머리 [수동 수집 실행] 막기(D9)", () => {
  it("실행 중이 없고 접수 행도 없으면 막지 않는다", () => {
    expect(isRunBlocked([run({ status: "SUCCEEDED" })], [], "mock")).toBe(false);
  });

  it("접수 행이 있으면 막는다", () => {
    expect(isRunBlocked([], [accepted({ id: ID.a })], "mock")).toBe(true);
  });

  it("지금 모드가 받는 소스의 run 이 실행 중이면 막는다(mock·fixture)", () => {
    const rows = [run({ source: "fixture", status: "RUNNING", finishedAt: null })];
    expect(isRunBlocked(rows, [], "mock")).toBe(true);
    expect(isRunBlocked(rows, [], "fixture")).toBe(true);
  });

  it("live 모드에서 g2b run 이 실행 중이면 막는다", () => {
    const rows = [run({ source: "g2b", batch: null, status: "RUNNING", finishedAt: null })];
    expect(isRunBlocked(rows, [], "live")).toBe(true);
  });

  it("지금 모드가 받지 않는 소스의 RUNNING(모드 바뀌기 전 run)은 막지 않는다", () => {
    const g2bRunning = [run({ source: "g2b", batch: null, status: "RUNNING", finishedAt: null })];
    const fixtureRunning = [run({ source: "fixture", status: "RUNNING", finishedAt: null })];
    expect(isRunBlocked(g2bRunning, [], "mock")).toBe(false);
    expect(isRunBlocked(fixtureRunning, [], "live")).toBe(false);
  });

  it.each(["SUCCEEDED", "PARTIAL", "FAILED"] as const)(
    "끝난 run(%s)만 있으면 막지 않는다",
    (status) => {
      expect(isRunBlocked([run({ status })], [], "mock")).toBe(false);
    },
  );
});

describe("isSettled — 폴링 정상 멈춤(§4.8)", () => {
  it("첫 쪽에 실행 중이 없고 접수한 run 이 모두 보이면 멈춘다", () => {
    expect(isSettled([run({ id: ID.a, status: "SUCCEEDED" })], [ID.a])).toBe(true);
  });

  it("첫 쪽에 실행 중이 있으면 멈추지 않는다", () => {
    expect(isSettled([run({ id: ID.a, status: "RUNNING", finishedAt: null })], [])).toBe(false);
  });

  it("접수한 run 이 첫 쪽에 아직 없으면 멈추지 않는다", () => {
    expect(isSettled([run({ id: ID.a, status: "SUCCEEDED" })], [ID.b])).toBe(false);
  });

  it("빈 첫 쪽이고 접수한 run 도 없으면 멈춘다", () => {
    expect(isSettled([], [])).toBe(true);
  });
});

describe("statusLineOf — 상태 줄(§4.3)", () => {
  const none = new Set<string>();

  it("진행 중도 지켜본 run 도 없으면 null 이다", () => {
    expect(statusLineOf({ rows: [run()], pending: [], watched: none, now: T0 })).toBeNull();
  });

  it("실행 중 run 이 하나면 running, 나머지 0건이다", () => {
    const running = run({ id: ID.a, status: "RUNNING", finishedAt: null, startedAt: at(0) });
    const model = statusLineOf({ rows: [running], pending: [], watched: none, now: T0 + 60_000 });
    expect(model).toEqual({ kind: "running", run: running, others: 0, stale: false });
  });

  it("진행 중이 여럿이면 가장 최근 것과 나머지 수(외 N건)다", () => {
    const older = run({ id: ID.a, status: "RUNNING", finishedAt: null, startedAt: at(0) });
    const newer = run({ id: ID.b, status: "RUNNING", finishedAt: null, startedAt: at(60_000) });
    const model = statusLineOf({ rows: [older, newer], pending: [], watched: none, now: T0 });
    expect(model).toMatchObject({ kind: "running", run: { id: ID.b }, others: 1 });
  });

  it("접수 행이 실행 중 run 보다 최근이면 접수 행을 보이고 실행 중은 나머지로 센다", () => {
    const running = run({ id: ID.a, status: "RUNNING", finishedAt: null, startedAt: at(0) });
    const entry = accepted({ id: ID.b, startedAt: at(60_000) }, T0 + 60_000);
    const model = statusLineOf({
      rows: [running],
      pending: [entry],
      watched: none,
      now: T0 + 70_000,
    });
    expect(model).toMatchObject({ kind: "pending", entry: { run: { id: ID.b } }, others: 1 });
  });

  it("실행 중 run 이 접수 행보다 최근이면 running 이다", () => {
    const entry = accepted({ id: ID.a, startedAt: at(0) }, T0);
    const running = run({ id: ID.b, status: "RUNNING", finishedAt: null, startedAt: at(60_000) });
    const model = statusLineOf({ rows: [running], pending: [entry], watched: none, now: T0 });
    expect(model).toMatchObject({ kind: "running", run: { id: ID.b }, others: 1 });
  });

  it("접수 뒤 60초 전이면 worker 미시작 경고가 아니다", () => {
    const entry = accepted({ id: ID.a }, T0);
    const model = statusLineOf({
      rows: [],
      pending: [entry],
      watched: none,
      now: T0 + WORKER_START_GRACE_MS - 1,
    });
    expect(model).toMatchObject({ kind: "pending", overdue: false });
  });

  it("접수 뒤 정확히 60초면 worker 미시작 경고다", () => {
    expect(WORKER_START_GRACE_MS).toBe(60_000);
    const entry = accepted({ id: ID.a }, T0);
    const model = statusLineOf({ rows: [], pending: [entry], watched: none, now: T0 + 60_000 });
    expect(model).toMatchObject({ kind: "pending", overdue: true });
  });

  it("시작 30분이 지나면(초과) 실행 중 경고(stale)다", () => {
    expect(STALE_RUN_MS).toBe(30 * 60_000);
    const running = run({ status: "RUNNING", finishedAt: null, startedAt: at(0) });
    const model = statusLineOf({
      rows: [running],
      pending: [],
      watched: none,
      now: T0 + 30 * 60_000 + 1,
    });
    expect(model).toMatchObject({ kind: "running", stale: true });
  });

  it("시작 뒤 정확히 30분이면 아직 stale 이 아니다", () => {
    const running = run({ status: "RUNNING", finishedAt: null, startedAt: at(0) });
    const model = statusLineOf({
      rows: [running],
      pending: [],
      watched: none,
      now: T0 + 30 * 60_000,
    });
    expect(model).toMatchObject({ kind: "running", stale: false });
  });

  it.each(["SUCCEEDED", "PARTIAL", "FAILED"] as const)(
    "지켜보던 run 이 %s 로 끝나면 finished 로 그 run 을 보인다",
    (status) => {
      const done = run({ id: ID.a, status });
      const model = statusLineOf({ rows: [done], pending: [], watched: new Set([ID.a]), now: T0 });
      expect(model).toEqual({ kind: "finished", run: done });
    },
  );

  it("지켜보지 않은 run 이 끝나 있어도 상태 줄을 보이지 않는다(새로 고침 뒤)", () => {
    const done = run({ id: ID.a, status: "SUCCEEDED" });
    expect(
      statusLineOf({ rows: [done], pending: [], watched: new Set([ID.b]), now: T0 }),
    ).toBeNull();
  });

  it("지켜보던 run 이 여럿 끝났으면 목록 순서(최근)의 첫 run 이다", () => {
    const newer = run({ id: ID.b, status: "FAILED", startedAt: at(60_000) });
    const older = run({ id: ID.a, status: "SUCCEEDED", startedAt: at(0) });
    const model = statusLineOf({
      rows: [newer, older],
      pending: [],
      watched: new Set([ID.a, ID.b]),
      now: T0,
    });
    expect(model).toMatchObject({ kind: "finished", run: { id: ID.b } });
  });

  it("진행 중이 있으면 지켜보던 run 이 끝났어도 진행 중을 먼저 보인다", () => {
    const done = run({ id: ID.a, status: "SUCCEEDED", startedAt: at(0) });
    const running = run({ id: ID.b, status: "RUNNING", finishedAt: null, startedAt: at(-60_000) });
    const model = statusLineOf({
      rows: [done, running],
      pending: [],
      watched: new Set([ID.a]),
      now: T0,
    });
    expect(model).toMatchObject({ kind: "running", run: { id: ID.b } });
  });
});

describe("watchRunning", () => {
  it("실행 중 run 의 id 를 지켜볼 목록에 더한다", () => {
    const next = watchRunning(new Set([ID.a]), [
      run({ id: ID.b, status: "RUNNING", finishedAt: null }),
      run({ id: ID.c, status: "SUCCEEDED" }),
    ]);
    expect([...next].toSorted()).toEqual([ID.a, ID.b]);
  });

  it("새로 더할 것이 없으면 같은 집합 객체를 돌려준다", () => {
    const watched = new Set([ID.a]);
    expect(watchRunning(watched, [run({ id: ID.a, status: "RUNNING", finishedAt: null })])).toBe(
      watched,
    );
    expect(watchRunning(watched, [run({ id: ID.b, status: "SUCCEEDED" })])).toBe(watched);
  });
});
