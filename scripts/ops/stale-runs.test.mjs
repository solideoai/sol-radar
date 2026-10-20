// ops/stale-runs.mjs 의 순수 함수 시험. 시각은 고정하고, 30분 경계·소스·상태·깨진 날짜를 본다.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_OLDER_THAN_MINUTES,
  MIN_OLDER_THAN_MINUTES,
  selectStaleRuns,
} from "./stale-runs.mjs";

const NOW = new Date("2026-10-20T12:00:00.000Z");

const run = (overrides) => ({
  id: "run-x",
  source: "g2b",
  status: "RUNNING",
  started_at: "2026-10-20T10:00:00+00:00",
  run_mode: "LIVE",
  trigger: "MANUAL",
  ...overrides,
});

const idsOf = (rows) => rows.map((row) => row.id);

describe("selectStaleRuns — 경계", () => {
  it("기본값과 하한은 30분이다", () => {
    assert.equal(DEFAULT_OLDER_THAN_MINUTES, 30);
    assert.equal(MIN_OLDER_THAN_MINUTES, 30);
  });

  it("정확히 30분 지난 run 은 고른다", () => {
    const rows = [run({ id: "at-30", started_at: "2026-10-20T11:30:00+00:00" })];
    assert.deepEqual(idsOf(selectStaleRuns(rows, NOW, 30)), ["at-30"]);
  });

  it("29분 59초 지난 run 은 고르지 않는다", () => {
    const rows = [
      run({ id: "at-29", started_at: "2026-10-20T11:31:00+00:00" }),
      run({ id: "almost-30", started_at: "2026-10-20T11:30:00.001+00:00" }),
    ];
    assert.deepEqual(selectStaleRuns(rows, NOW, 30), []);
  });

  it("31분 지난 run 은 고르고 경과 분과 원래 값을 돌려준다", () => {
    const rows = [
      run({ id: "at-31", started_at: "2026-10-20T11:29:00+00:00", trigger: "SCHEDULED" }),
    ];
    assert.deepEqual(selectStaleRuns(rows, NOW, 30), [
      {
        id: "at-31",
        startedAt: "2026-10-20T11:29:00+00:00",
        elapsedMinutes: 31,
        runMode: "LIVE",
        trigger: "SCHEDULED",
      },
    ]);
  });

  it("경과 분은 내림이고, 기준 분을 키우면 그만큼 덜 고른다", () => {
    const rows = [
      run({ id: "45m30s", started_at: "2026-10-20T11:14:30+00:00" }),
      run({ id: "2h", started_at: "2026-10-20T10:00:00+00:00" }),
    ];
    assert.deepEqual(
      selectStaleRuns(rows, NOW, 30).map((row) => [row.id, row.elapsedMinutes]),
      [
        ["45m30s", 45],
        ["2h", 120],
      ],
    );
    assert.deepEqual(idsOf(selectStaleRuns(rows, NOW, 60)), ["2h"]);
  });

  it("다른 시간대 표기와 마이크로초 표기도 같은 시각으로 읽는다", () => {
    const rows = [
      run({ id: "kst", started_at: "2026-10-20T20:30:00+09:00" }),
      run({ id: "micro", started_at: "2026-10-20T11:29:59.123456+00:00" }),
      run({ id: "zulu", started_at: "2026-10-20T11:00:00Z" }),
      run({ id: "space", started_at: "2026-10-20 11:00:00+00" }),
    ];
    assert.deepEqual(idsOf(selectStaleRuns(rows, NOW, 30)), ["kst", "micro", "zulu", "space"]);
  });

  it("미래 시각(시계 차이)의 run 은 고르지 않는다", () => {
    const rows = [run({ id: "future", started_at: "2026-10-20T13:00:00+00:00" })];
    assert.deepEqual(selectStaleRuns(rows, NOW, 30), []);
  });
});

describe("selectStaleRuns — 대상 밖", () => {
  it("g2b 가 아닌 run 은 아무리 오래돼도 고르지 않는다", () => {
    const rows = [
      run({ id: "fixture", source: "fixture" }),
      run({ id: "upper", source: "G2B" }),
      run({ id: "missing", source: undefined }),
    ];
    assert.deepEqual(selectStaleRuns(rows, NOW, 30), []);
  });

  it("RUNNING 이 아닌 run 은 고르지 않는다", () => {
    const rows = ["SUCCEEDED", "PARTIAL", "FAILED", "running", undefined].map((status, index) =>
      run({ id: `s-${index}`, status }),
    );
    assert.deepEqual(selectStaleRuns(rows, NOW, 30), []);
  });

  it("날짜가 깨진 run 은 고르지 않는다", () => {
    const broken = [
      null,
      undefined,
      "",
      "not-a-date",
      1792458000000,
      "2026-13-01T00:00:00Z",
      "2026-02-30T00:00:00Z",
      "2026-10-20T24:00:00Z",
      // 시간대가 없으면 기계의 지역 시각으로 읽혀 결과가 달라진다
      "2026-10-20T10:00:00",
      "2026-10-20",
    ];
    const rows = broken.map((started_at, index) => run({ id: `b-${index}`, started_at }));
    assert.deepEqual(selectStaleRuns(rows, NOW, 30), []);
  });

  it("행이 객체가 아니어도 멈추지 않고 건너뛴다", () => {
    assert.deepEqual(selectStaleRuns([null, "x", run({ id: "ok" })], NOW, 30).length, 1);
  });
});

describe("selectStaleRuns — 인자", () => {
  it("30분 미만·정수 아님은 거부한다", () => {
    for (const minutes of [29, 0, -5, 30.5, Number.NaN, "30"])
      assert.throws(() => selectStaleRuns([], NOW, minutes), /30 이상의 정수/);
  });

  it("now 가 올바른 Date 가 아니면 거부한다", () => {
    for (const now of [new Date("x"), "2026-10-20T12:00:00Z", Date.now()])
      assert.throws(() => selectStaleRuns([], now, 30), /now/);
  });

  it("rows 가 배열이 아니면 거부한다", () => {
    assert.throws(() => selectStaleRuns(null, NOW, 30), /rows/);
  });
});
