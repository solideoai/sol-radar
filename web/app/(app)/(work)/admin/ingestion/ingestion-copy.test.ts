import { describe, expect, it } from "vitest";
import {
  acceptsSource,
  batchLabel,
  runModeLabel,
  sourceLabel,
  sourceWithBatch,
  triggerLabel,
} from "./ingestion-copy";

// 수집 화면 용어(디자인 스펙 §3.4). 배치 LIVE 와 실행 모드 live 가 섞이지 않게 앞말을 늘 붙인다(19 §2.1).

describe("triggerLabel — 실행 방식", () => {
  it("MANUAL 이고 요청자가 있으면 '수동 · {이름}' 이다", () => {
    expect(triggerLabel({ trigger: "MANUAL", requestedBy: { id: "u1", name: "김가람" } })).toBe(
      "수동 · 김가람",
    );
  });

  it("MANUAL 이고 요청자가 null 이면 '수동 · 요청자 정보 없음' 이다", () => {
    expect(triggerLabel({ trigger: "MANUAL", requestedBy: null })).toBe("수동 · 요청자 정보 없음");
  });

  it("DEMO 는 표에서 '데모 초기화', 서랍에서 명령까지 보인다", () => {
    expect(triggerLabel({ trigger: "DEMO", requestedBy: null })).toBe("데모 초기화");
    expect(triggerLabel({ trigger: "DEMO", requestedBy: null }, true)).toBe(
      "데모 초기화 (pnpm demo:reset)",
    );
  });

  it("SCHEDULED 는 '일정' 이다", () => {
    expect(triggerLabel({ trigger: "SCHEDULED", requestedBy: null })).toBe("일정");
  });
});

describe("소스·배치·실행 모드 글자", () => {
  it("소스 긴 글자와 좁은 칸 글자", () => {
    expect(sourceLabel("fixture")).toBe("데모 데이터 (fixture)");
    expect(sourceLabel("fixture", true)).toBe("데모 데이터");
    expect(sourceLabel("g2b")).toBe("나라장터 (g2b)");
    expect(sourceLabel("g2b", true)).toBe("나라장터");
  });

  it("배치는 늘 '배치' 앞말 + 대문자다", () => {
    expect(batchLabel("seed")).toBe("배치 SEED");
    expect(batchLabel("live")).toBe("배치 LIVE");
  });

  it("실행 모드는 늘 '실행 모드' 앞말 + 소문자다", () => {
    expect(runModeLabel("mock")).toBe("실행 모드 mock");
    expect(runModeLabel("live")).toBe("실행 모드 live");
  });

  it("fixture 는 소스 뒤에 배치를 붙이고, 배치가 없으면(g2b) 소스만이다", () => {
    expect(sourceWithBatch({ source: "fixture", batch: "live" }, true)).toBe(
      "데모 데이터 · 배치 LIVE",
    );
    expect(sourceWithBatch({ source: "g2b", batch: null })).toBe("나라장터 (g2b)");
  });
});

describe("acceptsSource — 실행 모드별 소스(05 :428, ADR-020)", () => {
  it.each([
    ["live", "g2b", true],
    ["live", "fixture", false],
    ["fixture", "fixture", true],
    ["fixture", "g2b", false],
    ["mock", "fixture", true],
    ["mock", "g2b", false],
  ] as const)("실행 모드 %s 에서 %s 는 %s", (mode, source, expected) => {
    expect(acceptsSource(mode, source)).toBe(expected);
  });
});
