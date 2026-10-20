import { describe, expect, it } from "vitest";
import { whatIf } from "./what-if";
import { buildInput } from "./test-support";

const ict = { kind: "QUALIFICATION", code: "ICT_CONSTRUCTION" } as const;

describe("whatIf", () => {
  it("FX-03 정보통신공사업 가정 → NO_BID 에서 WATCH, 점수 68 그대로", () => {
    const outcome = whatIf(buildInput("FX-03"), [ict]);
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;
    expect(outcome.before.recommendation).toBe("NO_BID");
    expect(outcome.after.recommendation).toBe("WATCH");
    expect(outcome.before.score).toBe(68);
    expect(outcome.after.score).toBe(68);
    expect(outcome.after.qualificationStatus).toBe("SATISFIED");
    expect(outcome.after.checks.every((check) => check.outcome === "SATISFIED")).toBe(true);
  });

  it.each(["FX-01", "FX-02", "FX-03"])("가정 0개 → %s 의 before 와 after 가 같다", (id) => {
    const outcome = whatIf(buildInput(id), []);
    expect(outcome?.ok).toBe(true);
    if (!outcome?.ok) return;
    expect(outcome.after).toEqual(outcome.before);
  });

  it("assumable 은 FX-03 에서 ICT_CONSTRUCTION 하나, FX-01 에서 비어 있다", () => {
    const fx03 = whatIf(buildInput("FX-03"), []);
    expect(fx03?.ok && fx03.assumable).toEqual(["ICT_CONSTRUCTION"]);
    const fx01 = whatIf(buildInput("FX-01"), []);
    expect(fx01?.ok && fx01.assumable).toEqual([]);
  });

  it("이미 충족한 코드는 ok:false 로 거절한다", () => {
    const bad = { kind: "QUALIFICATION", code: "SW_BUSINESS_REG" } as const;
    expect(whatIf(buildInput("FX-03"), [bad])).toEqual({ ok: false, rejected: [bad] });
  });

  it("사전에 없는 코드는 ok:false 로 거절한다", () => {
    const bad = { kind: "QUALIFICATION", code: "NOPE" } as const;
    expect(whatIf(buildInput("FX-03"), [ict, bad])).toEqual({ ok: false, rejected: [bad] });
  });

  it("kev 가 있어도 before·after 에 결정 모델 영향이 없다", () => {
    const input = buildInput("FX-03");
    const withKev = whatIf(input, [ict]);
    const withoutKev = whatIf({ ...input, kev: null }, [ict]);
    expect(withKev).toEqual(withoutKev);
  });

  it("입력 스냅샷을 바꾸지 않는다", () => {
    const input = buildInput("FX-03");
    const copy = structuredClone(input);
    whatIf(input, [ict]);
    expect(input).toEqual(copy);
  });

  it("스냅샷이 스키마에 안 맞으면 null", () => {
    expect(whatIf({}, [])).toBeNull();
  });
});
