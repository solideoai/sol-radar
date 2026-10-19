import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ASSUMED_HOUR_KST, KST_OFFSET_MINUTES, parseKstDateTime } from "./normalize-date";

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
// KST 2026-10-19 12:00
const ANCHOR = new Date("2026-10-19T03:00:00.000Z");
const OTHER_ANCHOR = new Date("2027-05-01T20:00:00.000Z");
const FAIL = { ok: false };
const assumed = (value: string) => ({ ok: true, value, assumedTime: true });
const exact = (value: string) => ({ ok: true, value, assumedTime: false });

describe("parseKstDateTime — 상수", () => {
  it("KST 오프셋은 540분이다", () => {
    expect(KST_OFFSET_MINUTES).toBe(540);
  });

  it("시각 없는 값은 KST 18시로 간주한다", () => {
    expect(ASSUMED_HOUR_KST).toBe(18);
  });
});

// 상대 표기 ^[+-]\d+d$: anchor 의 KST 달력 날짜 + N일, KST 18:00.
describe("parseKstDateTime — 상대 표기", () => {
  it("'+2d' 는 anchor 의 KST 날짜에서 이틀 뒤 KST 18:00 이다", () => {
    expect(parseKstDateTime("+2d", ANCHOR)).toStrictEqual(assumed("2026-10-21T09:00:00.000Z"));
  });

  it("UTC 로는 전날이어도 KST 날짜를 기준으로 센다", () => {
    // UTC 2026-10-19 16:00 = KST 2026-10-20 01:00
    expect(parseKstDateTime("+0d", new Date("2026-10-19T16:00:00.000Z"))).toStrictEqual(
      assumed("2026-10-20T09:00:00.000Z"),
    );
  });

  it("'-5d' 는 anchor 의 KST 날짜에서 닷새 전 KST 18:00 이다", () => {
    expect(parseKstDateTime("-5d", ANCHOR)).toStrictEqual(assumed("2026-10-14T09:00:00.000Z"));
  });

  it("anchor 가 KST 23:59:59.999 이면 그날을 기준으로 한다", () => {
    expect(parseKstDateTime("+0d", new Date("2026-10-19T14:59:59.999Z"))).toStrictEqual(
      assumed("2026-10-19T09:00:00.000Z"),
    );
  });

  it("anchor 가 KST 00:00 이면 새 날짜를 기준으로 한다", () => {
    expect(parseKstDateTime("+0d", new Date("2026-10-19T15:00:00.000Z"))).toStrictEqual(
      assumed("2026-10-20T09:00:00.000Z"),
    );
  });

  it("달이 바뀌는 날짜를 센다", () => {
    expect(parseKstDateTime("+14d", ANCHOR)).toStrictEqual(assumed("2026-11-02T09:00:00.000Z"));
  });

  it("해가 바뀌는 날짜를 센다", () => {
    expect(parseKstDateTime("+3d", new Date("2026-12-30T03:00:00.000Z"))).toStrictEqual(
      assumed("2027-01-02T09:00:00.000Z"),
    );
  });

  it("세 자리 일수도 센다", () => {
    expect(parseKstDateTime("+120d", ANCHOR)).toStrictEqual(assumed("2027-02-16T09:00:00.000Z"));
  });

  it("앞뒤 공백을 지우고 읽는다", () => {
    expect(parseKstDateTime("  +2d \n", ANCHOR)).toStrictEqual(assumed("2026-10-21T09:00:00.000Z"));
  });

  it.each(["2d", "+2", "+2D", "+2일", "+-2d", "+2.5d", "+ 2d", "+d"])(
    "상대 표기 형식이 아닌 %j 는 실패한다",
    (raw) => {
      expect(parseKstDateTime(raw, ANCHOR)).toStrictEqual(FAIL);
    },
  );

  it("anchor Date 를 바꾸지 않는다", () => {
    const anchor = new Date("2026-10-19T03:00:00.000Z");
    parseKstDateTime("+2d", anchor);
    expect(anchor.toISOString()).toBe("2026-10-19T03:00:00.000Z");
  });
});

describe("parseKstDateTime — FX-14 마감 (11 §3.1)", () => {
  it("fixture 마감 '+2d' 를 UTC 09:00 으로 저장한다", () => {
    const file = JSON.parse(readFileSync(join(FIXTURES_DIR, "bids", "FX-14.json"), "utf8")) as {
      records: { deadlineAt: string }[];
    };
    const raw = file.records[0].deadlineAt;
    const parsed = parseKstDateTime(raw, ANCHOR);

    expect(raw).toBe("+2d");
    expect(parsed).toStrictEqual(assumed("2026-10-21T09:00:00.000Z"));
  });
});

describe("parseKstDateTime — 날짜만", () => {
  it.each(["2026-11-23", "2026.11.23", "20261123"])(
    "%j 는 그날 KST 18:00 이고 시각을 가정했다고 표시한다",
    (raw) => {
      expect(parseKstDateTime(raw, ANCHOR)).toStrictEqual(assumed("2026-11-23T09:00:00.000Z"));
    },
  );

  it("anchor 와 무관하게 같은 값을 낸다", () => {
    expect(parseKstDateTime("2026-11-23", OTHER_ANCHOR)).toStrictEqual(
      assumed("2026-11-23T09:00:00.000Z"),
    );
  });

  it("윤년의 2월 29일을 받는다", () => {
    expect(parseKstDateTime("2028-02-29", ANCHOR)).toStrictEqual(
      assumed("2028-02-29T09:00:00.000Z"),
    );
  });
});

describe("parseKstDateTime — 시각 있음, 오프셋 없음 (KST 벽시계)", () => {
  it("'2026-11-23 12:00:00' 은 UTC 03:00 이다", () => {
    expect(parseKstDateTime("2026-11-23 12:00:00", ANCHOR)).toStrictEqual(
      exact("2026-11-23T03:00:00.000Z"),
    );
  });

  it.each(["2026-11-23 12:00", "2026-11-23T12:00", "2026-11-23T12:00:00", "202611231200"])(
    "%j 도 KST 벽시계로 읽는다",
    (raw) => {
      expect(parseKstDateTime(raw, ANCHOR)).toStrictEqual(exact("2026-11-23T03:00:00.000Z"));
    },
  );

  it("초를 보존한다", () => {
    expect(parseKstDateTime("2026-11-23 12:34:56", ANCHOR)).toStrictEqual(
      exact("2026-11-23T03:34:56.000Z"),
    );
  });

  it("KST 오전 9시 전은 UTC 전날이다", () => {
    expect(parseKstDateTime("2026-11-23 08:59", ANCHOR)).toStrictEqual(
      exact("2026-11-22T23:59:00.000Z"),
    );
  });

  it("KST 새해 자정은 UTC 전해 12월 31일 15시다", () => {
    expect(parseKstDateTime("2026-01-01 00:00", ANCHOR)).toStrictEqual(
      exact("2025-12-31T15:00:00.000Z"),
    );
  });

  it("원문에 18:00 이 적혀 있으면 시각을 가정하지 않은 것으로 표시한다", () => {
    expect(parseKstDateTime("2026-11-23 18:00", ANCHOR)).toStrictEqual(
      exact("2026-11-23T09:00:00.000Z"),
    );
  });

  it("anchor 와 무관하게 같은 값을 낸다", () => {
    expect(parseKstDateTime("2026-11-23 12:00", OTHER_ANCHOR)).toStrictEqual(
      exact("2026-11-23T03:00:00.000Z"),
    );
  });
});

describe("parseKstDateTime — ISO 오프셋 있음", () => {
  it("+09:00 오프셋은 그 순간이다", () => {
    expect(parseKstDateTime("2026-11-23T12:00:00+09:00", ANCHOR)).toStrictEqual(
      exact("2026-11-23T03:00:00.000Z"),
    );
  });

  it("Z 는 UTC 그대로다", () => {
    expect(parseKstDateTime("2026-11-23T03:00:00Z", ANCHOR)).toStrictEqual(
      exact("2026-11-23T03:00:00.000Z"),
    );
  });

  it("음수 오프셋도 그 순간으로 바꾼다", () => {
    expect(parseKstDateTime("2026-11-23T12:00:00-05:00", ANCHOR)).toStrictEqual(
      exact("2026-11-23T17:00:00.000Z"),
    );
  });

  it("anchor 와 무관하게 같은 값을 낸다", () => {
    expect(parseKstDateTime("2026-11-23T12:00:00+09:00", OTHER_ANCHOR)).toStrictEqual(
      exact("2026-11-23T03:00:00.000Z"),
    );
  });
});

describe("parseKstDateTime — 범위 오류", () => {
  it.each([
    "2026-02-30",
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-11-31",
    "2026-11-00",
    "2026.02.30",
    "20260230",
    "2026-11-23 25:00",
    "2026-11-23 24:00",
    "2026-11-23 12:60",
    "2026-11-23 12:00:60",
    "202602301200",
    "2026-02-30T00:00:00Z",
    "2026-02-30T09:00:00+09:00",
  ])("달력에 없는 날짜·시각 %j 는 실패한다", (raw) => {
    expect(parseKstDateTime(raw, ANCHOR)).toStrictEqual(FAIL);
  });
});

describe("parseKstDateTime — 그 밖의 문자열", () => {
  it.each([
    "",
    "   ",
    "미정",
    "추후 공지",
    "2026/11/23",
    "2026-1-5",
    "23-11-2026",
    "2026-11-23 12",
    "2026-11-23T12:00:00+0900",
  ])("%j 는 실패한다", (raw) => {
    expect(parseKstDateTime(raw, ANCHOR)).toStrictEqual(FAIL);
  });
});
