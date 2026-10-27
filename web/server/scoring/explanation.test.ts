import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { loadProfile, buildInput } from "./test-support";

// 회사 기술 목록이 완전하지 않으면 목록에 없는 기술을 "경험 없음"으로 단정하지 않는다.
// 설명문 인자만 다르고 점수·해시는 같아야 한다.

const ID = "FX-02";

describe("설명문 기술 문장", () => {
  it("technologiesComplete=true 면 미보유 기술을 경험 없음으로 쓴다", () => {
    const result = analyze(buildInput(ID));
    expect(result.explanation).toContain("경험 없음");
  });

  it("technologiesComplete=false 면 확인 필요로 쓴다", () => {
    const complete = analyze(buildInput(ID));
    const incomplete = analyze(
      buildInput(ID, { profile: { ...loadProfile(), technologiesComplete: false } }),
    );
    expect(incomplete.explanation).not.toContain("경험 없음");
    expect(incomplete.explanation).toContain("회사 기술 목록에서 확인 안 됨(확인 필요)");
    expect(incomplete.score).toBe(complete.score);
  });
});
