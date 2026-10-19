import { describe, expect, it } from "vitest";
import {
  DAILY_LIMIT_RESULT_CODE,
  QUOTA_AUXILIARY_STOP_RATIO,
  isDailyLimitExceeded,
  quotaKey,
  quotaState,
} from "./quota";

// V2-11 호출 예산: Redis 카운터 quota:{serviceId}:{YYYYMMDD}(KST), 90% 에서 보조 조회 중단, 에러코드 22 면 그날 중단.
const BID_NOTICE = "15129394";

describe("quotaKey", () => {
  it("quota:{serviceId}:{KST YYYYMMDD} 형식이다", () => {
    expect(quotaKey(BID_NOTICE, new Date("2026-10-19T03:00:00.000Z"))).toBe(
      "quota:15129394:20261019",
    );
  });

  it("UTC 14:59:59.999 는 아직 그날 KST 날짜다", () => {
    expect(quotaKey(BID_NOTICE, new Date("2026-10-19T14:59:59.999Z"))).toBe(
      "quota:15129394:20261019",
    );
  });

  it("UTC 15:00 부터는 KST 다음 날짜다", () => {
    expect(quotaKey(BID_NOTICE, new Date("2026-10-19T15:00:00.000Z"))).toBe(
      "quota:15129394:20261020",
    );
  });

  it("KST 로 해가 바뀌면 다음 해 날짜다", () => {
    expect(quotaKey(BID_NOTICE, new Date("2026-12-31T15:00:00.000Z"))).toBe(
      "quota:15129394:20270101",
    );
  });

  it("KST 12월 31일 23:59 는 그해 날짜다", () => {
    expect(quotaKey(BID_NOTICE, new Date("2026-12-31T14:59:00.000Z"))).toBe(
      "quota:15129394:20261231",
    );
  });

  it("한 자리 월·일을 0 으로 채운다", () => {
    expect(quotaKey(BID_NOTICE, new Date("2027-01-04T00:00:00.000Z"))).toBe(
      "quota:15129394:20270104",
    );
  });

  it("서비스마다 키가 다르다", () => {
    const at = new Date("2026-10-19T03:00:00.000Z");
    expect(quotaKey("15129437", at)).not.toBe(quotaKey(BID_NOTICE, at));
  });

  it("at Date 를 바꾸지 않는다", () => {
    const at = new Date("2026-10-19T15:00:00.000Z");
    quotaKey(BID_NOTICE, at);
    expect(at.toISOString()).toBe("2026-10-19T15:00:00.000Z");
  });
});

describe("quotaState", () => {
  it("보조 조회 중단 비율은 0.9 다", () => {
    expect(QUOTA_AUXILIARY_STOP_RATIO).toBe(0.9);
  });

  it("한 번도 쓰지 않았으면 OK 다", () => {
    expect(quotaState(0, 1000)).toBe("OK");
  });

  it("한도의 90% 직전(899/1000)은 OK 다", () => {
    expect(quotaState(899, 1000)).toBe("OK");
  });

  it("한도의 90%(900/1000)에 닿으면 AUXILIARY_STOPPED 다", () => {
    expect(quotaState(900, 1000)).toBe("AUXILIARY_STOPPED");
  });

  it("한도 직전(999/1000)은 AUXILIARY_STOPPED 다", () => {
    expect(quotaState(999, 1000)).toBe("AUXILIARY_STOPPED");
  });

  it("한도(1000/1000)에 닿으면 EXHAUSTED 다", () => {
    expect(quotaState(1000, 1000)).toBe("EXHAUSTED");
  });

  it("한도를 넘으면 EXHAUSTED 다", () => {
    expect(quotaState(1001, 1000)).toBe("EXHAUSTED");
  });

  it("한도가 0 이면 쓰지 않았어도 EXHAUSTED 다", () => {
    expect(quotaState(0, 0)).toBe("EXHAUSTED");
  });

  it("한도가 음수면 EXHAUSTED 다", () => {
    expect(quotaState(0, -1)).toBe("EXHAUSTED");
  });
});

describe("isDailyLimitExceeded", () => {
  it("일일 한도 초과 결과 코드는 '22' 다", () => {
    expect(DAILY_LIMIT_RESULT_CODE).toBe("22");
  });

  it("'22' 는 한도 초과다", () => {
    expect(isDailyLimitExceeded("22")).toBe(true);
  });

  it("앞뒤 공백을 지우고 비교한다", () => {
    expect(isDailyLimitExceeded(" 22\n")).toBe(true);
  });

  it.each(["00", "07", "08", "022", "2", "220", ""])(
    "결과 코드 %j 는 한도 초과가 아니다",
    (code) => {
      expect(isDailyLimitExceeded(code)).toBe(false);
    },
  );

  it("null 은 한도 초과가 아니다", () => {
    expect(isDailyLimitExceeded(null)).toBe(false);
  });

  it("undefined 는 한도 초과가 아니다", () => {
    expect(isDailyLimitExceeded(undefined)).toBe(false);
  });
});
