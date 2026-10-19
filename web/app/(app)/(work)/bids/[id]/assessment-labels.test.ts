import { describe, expect, it } from "vitest";
import { assessmentLabel } from "./assessment-labels";

// Kev 항목별 분포 표의 항목 문구. itemId(추출 필드 경로)로 BidDetail.extraction 에서 찾는다(스펙 §5.4.7).

describe("assessmentLabel", () => {
  it("배열 경로의 {value} 항목이면 value 를 쓴다", () => {
    const extraction = {
      requiredSkills: [{ value: "Java" }, { value: "Spring" }, { value: "Kotlin" }],
    };
    expect(assessmentLabel(extraction, "requiredSkills[2]")).toBe("Kotlin");
  });

  it("추출 필드 감싸개({state, value: [...]})를 거쳐 문자열 항목을 읽는다", () => {
    const extraction = {
      requiredSkills: { state: "KNOWN", value: ["Java", "Spring Boot"], evidence: [] },
    };
    expect(assessmentLabel(extraction, "requiredSkills[1]")).toBe("Spring Boot");
  });

  it("자격·실적·인력 항목은 이름·설명·역할 글자를 쓴다", () => {
    const extraction = {
      qualifications: { value: [{ name: "소프트웨어사업자", kind: "LICENSE", mandatory: true }] },
      pastPerformance: { value: [{ description: "유사 사업 3건", mandatory: true }] },
      staffing: { value: [{ role: "PM", mandatory: true }] },
    };
    expect(assessmentLabel(extraction, "qualifications[0]")).toBe("소프트웨어사업자");
    expect(assessmentLabel(extraction, "pastPerformance[0]")).toBe("유사 사업 3건");
    expect(assessmentLabel(extraction, "staffing[0]")).toBe("PM");
  });

  it("점 경로도 읽는다", () => {
    expect(assessmentLabel({ summary: { value: "요약 문장" } }, "summary")).toBe("요약 문장");
    expect(assessmentLabel({ a: { b: "깊은 값" } }, "a.b")).toBe("깊은 값");
  });

  it("없는 경로·빈 추출·글자가 아닌 값이면 경로 문자열을 그대로 쓴다", () => {
    const extraction = { requiredSkills: [{ value: "Java" }] };
    expect(assessmentLabel(extraction, "requiredSkills[5]")).toBe("requiredSkills[5]");
    expect(assessmentLabel(extraction, "preferredSkills[0]")).toBe("preferredSkills[0]");
    expect(assessmentLabel(null, "requiredSkills[0]")).toBe("requiredSkills[0]");
    expect(assessmentLabel({ n: { value: 3 } }, "n")).toBe("n");
    expect(assessmentLabel({ s: "   " }, "s")).toBe("s");
    expect(assessmentLabel(extraction, "requiredSkills[")).toBe("requiredSkills[");
  });

  it("프로토타입 쪽 이름은 따라가지 않는다", () => {
    expect(assessmentLabel({}, "constructor.name")).toBe("constructor.name");
    expect(assessmentLabel({ a: [] }, "a.length")).toBe("a.length");
  });
});
