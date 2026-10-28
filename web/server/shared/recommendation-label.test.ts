import { describe, expect, it } from "vitest";
import { recommendationWithObject, relabelLegacyExplanation } from "./recommendation-label";

// 지난 판본 scoring/explanation.ts 의 buildExplanation 이 실제로 만든 문장(ADR-062 전 표기).
const LEGACY_FX01_979C25F0 =
  "필수자격 1건을 모두 충족했습니다. SOL Score 94점으로 참여 권고 구간(75 이상)입니다. 권고: BID(참여 권고). 최종 참여 결정은 사람이 합니다.";
const LEGACY_FX03_5261730F =
  "필수자격 미충족: 정보통신공사업 등록. 공고 근거와 회사 프로필의 미보유 기록이 모두 있어 규칙 판정이 우선합니다. 점수 68점은 참고용으로만 표시하며 권고는 NO-BID(참여 비권고)입니다. 결정 모델은 BID를 제시했지만 규칙 판정이 우선합니다. 결정 모델 분포는 모델 참고 지표이며 점수에 반영하지 않습니다. 최종 참여 결정은 사람이 합니다.";
const LEGACY_FX04_E22DE09E =
  "AI 서비스를 사용할 수 없어 규칙 기반 결과만 제공합니다. 필수자격 확인 필요(NOTICE_INFO_MISSING). 정보 부족은 미충족이 아니며 사람이 확인합니다. 자격 확인이 끝나기 전에는 점수 85점과 무관하게 WATCH(사람 검토)입니다. Kev는 NO_BID를 제시했지만 규칙 판정이 우선합니다. Kev 분포는 모델 참고 지표이며 점수에 반영하지 않습니다. 최종 참여 결정은 사람이 합니다.";

describe("권고 표기(ADR-062)", () => {
  it("지난 템플릿 문장의 옛 권고 표기만 추천·보류·비추천으로 바꾸고, 사람이 쓴 문장과 받침 조사는 그대로 맞다", () => {
    expect(relabelLegacyExplanation(LEGACY_FX01_979C25F0)).toBe(
      "필수자격 1건을 모두 충족했습니다. SOL Score 94점으로 추천 구간(75 이상)입니다. 권고: 추천. 최종 참여 결정은 사람이 합니다.",
    );
    expect(relabelLegacyExplanation(LEGACY_FX03_5261730F)).toBe(
      "필수자격 미충족: 정보통신공사업 등록. 공고 근거와 회사 프로필의 미보유 기록이 모두 있어 규칙 판정이 우선합니다. 점수 68점은 참고용으로만 표시하며 권고는 비추천입니다. 결정 모델은 추천을 제시했지만 규칙 판정이 우선합니다. 결정 모델 분포는 모델 참고 지표이며 점수에 반영하지 않습니다. 최종 참여 결정은 사람이 합니다.",
    );
    expect(relabelLegacyExplanation(LEGACY_FX04_E22DE09E)).toBe(
      "AI 서비스를 사용할 수 없어 규칙 기반 결과만 제공합니다. 필수자격 확인 필요(NOTICE_INFO_MISSING). 정보 부족은 미충족이 아니며 사람이 확인합니다. 자격 확인이 끝나기 전에는 점수 85점과 무관하게 보류입니다. Kev는 비추천을 제시했지만 규칙 판정이 우선합니다. Kev 분포는 모델 참고 지표이며 점수에 반영하지 않습니다. 최종 참여 결정은 사람이 합니다.",
    );
    // 템플릿이 아닌 글(사람 사유·공고명)의 낱말 BID·WATCH 는 건드리지 않는다.
    const human =
      "정보통신공사업 등록이 없어 필수 자격 미충족. 결정 모델이 BID 를 제시해도 규칙이 우선이므로 사전 검토에서 불참을 결정했다. BID 관리 시스템 WATCH 기능 고도화";
    expect(relabelLegacyExplanation(human)).toBe(human);
    expect(
      (["BID", "WATCH", "NO_BID"] as const).map((value) => recommendationWithObject(value)),
    ).toEqual(["추천을", "보류를", "비추천을"]);
  });
});
