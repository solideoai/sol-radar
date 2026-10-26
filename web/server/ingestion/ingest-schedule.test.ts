import { describe, expect, it } from "vitest";
import {
  INGEST_SCHEDULE_SLOT_HOURS_KST,
  latestIngestSlotAtOrBefore,
  nextIngestSlotAfter,
} from "./ingest-schedule";

// 한국시간 시·분. 시험 기계의 시간대와 상관없이 Asia/Seoul 로 읽는다.
const kstHourMinute = (at: Date): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);

describe("정기 수집 일정(한국시간 3시간 정각)", () => {
  it("하루 8번, 한국시간 00·03·06·09·12·15·18·21시 정각이다", () => {
    // 한국시간 10-27 00:00 직전(= UTC 10-26 14:59)부터 하루 동안
    let at = new Date("2026-10-26T14:59:00Z");
    const slots: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      at = nextIngestSlotAfter(at);
      slots.push(kstHourMinute(at));
    }
    expect(slots).toEqual(["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"]);
    expect(INGEST_SCHEDULE_SLOT_HOURS_KST).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
  });

  it("UTC 와 헷갈리지 않는다: 한국시간 14:50 다음은 15:00(UTC 06:00)이다", () => {
    const next = nextIngestSlotAfter(new Date("2026-10-26T05:50:00Z"));
    expect(next.toISOString()).toBe("2026-10-26T06:00:00.000Z");
    expect(kstHourMinute(next)).toBe("15:00");
  });

  it("정각에는 그다음 정각이고, 마지막 정각은 자기 자신이다", () => {
    const slot = new Date("2026-10-26T09:00:00Z"); // 한국시간 18:00
    expect(nextIngestSlotAfter(slot).toISOString()).toBe("2026-10-26T12:00:00.000Z");
    expect(latestIngestSlotAtOrBefore(slot).toISOString()).toBe(slot.toISOString());
    expect(latestIngestSlotAtOrBefore(new Date("2026-10-26T11:59:59Z")).toISOString()).toBe(
      slot.toISOString(),
    );
  });
});
