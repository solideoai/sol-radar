import { describe, expect, it } from "vitest";
import { analyze } from "./analyze";
import { canonicalJson } from "./snapshot-hash";
import { buildInput } from "./test-support";

// G4: 근거 문서 없음 → NEEDS_REVIEW/WATCH, 수주확률 문구 없음(11 §3). FX-04 자격 미추출, FX-05 첨부 파싱 실패.

// "수주 확률"·"충족 확률"·"낙찰 확률"이 같은 문장(또는 JSON 문자열 값) 안에서 부정(아님·아닙니다·아니다·않)과 함께 쓰이지 않고
// 단독으로 등장하면 실패(11 §3 G4 "'아님' 없이 단독 등장 0회").
function unqualifiedProbabilityMentions(text: string): string[] {
  const sentences = text.split(/[.。!?\n"]/);
  return sentences.filter(
    (sentence) =>
      /(수주 ?확률|충족 ?확률|낙찰 ?확률)/.test(sentence) && !/(아니|아닙|아님|않)/.test(sentence),
  );
}

describe("G4 · 근거 없음은 미충족이 아니라 확인 필요다 (FX-04·FX-05)", () => {
  it("FX-04: 자격 요건 미추출 → NEEDS_REVIEW(NOTICE_INFO_MISSING), WATCH, 인용 0건", () => {
    const result = analyze(buildInput("FX-04"));
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.qualificationChecks).toHaveLength(1);
    expect(result.qualificationChecks[0]).toMatchObject({
      requirementCode: null,
      mandatory: true,
      outcome: "NEEDS_REVIEW",
      reasonCode: "NOTICE_INFO_MISSING",
      basis: "EXTRACTION",
      evidence: [],
      companyEvidence: [],
    });
    expect(result.recommendation).toBe("WATCH");
    expect(result.factors.flatMap((factor) => factor.evidence)).toHaveLength(0);
    expect(result.reviewFlags).not.toContain("PARSE_UNSUPPORTED");
    expect(result.missingFactors.map((entry) => entry.reason)).toEqual([
      "NO_REQUIREMENTS_EXTRACTED",
      "BID_DOMAIN_UNKNOWN",
    ]);
    expect(result.explanation).toContain("정보 부족은 미충족이 아니");
  });

  it("FX-05: 첨부 파싱 실패 → 자격 NEEDS_REVIEW(PARSE_UNSUPPORTED), reviewFlags PARSE_UNSUPPORTED, 설명에 파싱 실패 명시", () => {
    const result = analyze(buildInput("FX-05"));
    expect(result.qualificationStatus).toBe("NEEDS_REVIEW");
    expect(result.qualificationChecks[0]).toMatchObject({
      outcome: "NEEDS_REVIEW",
      reasonCode: "PARSE_UNSUPPORTED",
    });
    expect(result.reviewFlags).toContain("PARSE_UNSUPPORTED");
    expect(result.recommendation).toBe("WATCH");
    expect(result.explanation).toContain("첨부 문서를 읽지 못해");
    // 본문에서 읽은 요구기술(Java, Spring Boot)은 그대로 점수에 쓰인다. 읽지 못한 첨부 내용을 추측해 채우지 않는다.
    expect(result.factors[0].rawValue).toMatchObject({ required: 2, matched: 2 });
  });

  it("FX-05 는 호출자가 attachmentsIncomplete 를 줘도 같은 결과다(03 §5.7 과 같은 이름)", () => {
    const input = buildInput("FX-05");
    const result = analyze({ ...input, bid: { ...input.bid, attachmentsIncomplete: true } });
    expect(result.qualificationChecks[0].reasonCode).toBe("PARSE_UNSUPPORTED");
  });

  it("결과 JSON·설명 문자열에 수주 확률·충족 확률·낙찰 확률이 부정 없이 단독으로 등장하지 않는다", () => {
    for (const id of [
      "FX-01",
      "FX-02",
      "FX-03",
      "FX-04",
      "FX-05",
      "FX-11",
      "FX-15",
      "FX-16",
      "FX-17",
    ]) {
      const result = analyze(buildInput(id));
      expect(unqualifiedProbabilityMentions(result.explanation), `${id} explanation`).toEqual([]);
      expect(unqualifiedProbabilityMentions(canonicalJson(result)), `${id} json`).toEqual([]);
      expect(result.disclaimer).toBe(
        "SOL Score는 내부 적합도이며 낙찰 확률이 아닙니다. 최종 참여 결정은 사람이 합니다.",
      );
      expect(result.kev.disclaimer).toBe(
        "Kev 확률은 선택지에 대한 모델 분포이며 충족 확률·수주확률이 아닙니다.",
      );
    }
  });

  it("검사 함수 자체가 단독 등장을 잡는다(자기 검증)", () => {
    expect(unqualifiedProbabilityMentions("이 공고의 수주 확률은 80%입니다.")).toHaveLength(1);
    expect(unqualifiedProbabilityMentions("수주 확률이 아닙니다.")).toHaveLength(0);
    expect(unqualifiedProbabilityMentions('{"a":"충족 확률 90%","b":"수주확률 아님"}')).toEqual([
      "충족 확률 90%",
    ]);
  });
});
