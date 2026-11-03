import { describe, expect, it } from "vitest";
import { readableCheck } from "./qualification-reason";

// 운영 qualification_checks 에 저장된 규칙 엔진 문장 그대로(2026-11-03 운영 조회).
const AUX_QUOTA = {
  requirementName: "면허·지역 제한 조회 실패(호출 예산)",
  basis: "API_FIELD",
  reason:
    "공공 API 호출 예산으로 보조 조회(g2b-bid-license-limit, g2b-bid-region, g2b-bid-eorder-attach)를 부르지 못함. 면허·지역 제한을 확인하지 못해 사람 검토 필요",
} as const;

describe("readableCheck", () => {
  it("호출 한도로 보조 조회를 못 한 행은 우리가 받아 오지 못한 것으로 읽히고 조회 키가 보이지 않는다", () => {
    const { name, reason } = readableCheck(AUX_QUOTA);
    expect(name).toBe("면허·지역 제한");
    expect(reason).toBe(
      "나라장터 API의 하루 호출 한도에 걸려 면허·지역 제한 정보를 받아 오지 못했습니다. 나라장터 공고 원문에서 확인하세요.",
    );
    expect(`${name} ${reason}`).not.toMatch(/g2b-|호출 예산|[A-Z]{2,}_/);
  });

  it("같은 이름이라도 AI 추출 행은 보조 조회 행으로 보지 않는다", () => {
    expect(readableCheck({ ...AUX_QUOTA, basis: "EXTRACTION" }).name).toBe(
      AUX_QUOTA.requirementName,
    );
  });

  it("영어 코드·규칙 버전 꼬리표를 빼고, 공고 원문 이름의 괄호는 남긴다", () => {
    const read = (reason: string) =>
      readableCheck({ requirementName: "가상 자격", basis: "EXTRACTION", reason }).reason;
    expect(read("공고에서 자격 요건을 꺼내지 못함(UNKNOWN). 원문 확인 필요")).toBe(
      "AI가 공고에서 자격 요건을 찾지 못함. 원문 확인 필요",
    );
    expect(read("참가가능지역 조건은 회사 프로필에 소재지 기록이 없어 판정하지 못함(v0.1)")).toBe(
      "참가가능지역 조건은 회사 프로필에 소재지 기록이 없어 판정하지 못함",
    );
    expect(read("면허제한이 2행이라 AND/OR 를 확인하지 못함. 사람 검토 필요")).toBe(
      "면허제한이 2개라 모두 필요한지 하나만 필요한지 확인하지 못함. 사람 검토 필요",
    );
    expect(
      read(
        "회사 프로필에 소프트웨어사업자 신고확인서(SW_BUSINESS_REG) 기록이 없음. 보유·미보유를 확인하지 못함",
      ),
    ).toBe("회사 프로필에 소프트웨어사업자 신고확인서 기록이 없음. 보유·미보유를 확인하지 못함");
    expect(read("회사 프로필 등록 SW_BUSINESS_REG 보유(HELD)")).toBe("회사 프로필에 보유로 등록됨");
    expect(read("회사 프로필에 직접생산확인증명 미보유(NOT_HELD)로 기록됨")).toBe(
      "회사 프로필에 직접생산확인증명 미보유로 기록됨",
    );
    expect(
      read("면허제한 2행을 모두 보유해 AND/OR 와 상관없이 충족(회사 프로필 업종 1468 보유(HELD))"),
    ).toBe("면허제한 2개를 모두 보유해 충족(회사 프로필에 이 업종 보유로 등록됨)");
    const quoted =
      '"정보보호(ISMS) 인증"은(는) 자격 코드 사전에 없어 의미 대응을 확정하지 못함. 사람 검토 필요';
    expect(read(quoted)).toBe(quoted);
  });
});
