import { describe, expect, it } from "vitest";
import { insightJobId, insightPayloadSchema } from "./insight.model";

const payload = {
  summary: "과거 유사 사업과 보유 기술이 공고 요구와 겹칩니다.",
  strengths: [{ text: "유사 시스템 고도화 수행", refIds: ["C1"] }],
  improvements: [{ text: "공동수급 지분 조건 확인", refIds: ["B1"] }],
  refs: [
    { id: "B1", kind: "BID", label: "공동수급", quotedText: "구성원 2개사 이하" },
    { id: "C1", kind: "COMPANY", label: "과거 수행 사업", quotedText: "학사정보시스템 고도화" },
  ],
};

describe("insightPayloadSchema", () => {
  it("항목의 근거 번호가 refs 에 있으면 받는다", () => {
    expect(insightPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("refs 에 없는 근거 번호를 가리키면 거절한다", () => {
    const result = insightPayloadSchema.safeParse({
      ...payload,
      improvements: [{ text: "공동수급 지분 조건 확인", refIds: ["B2"] }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["improvements", 0, "refIds", 0]);
  });

  // ADR-078: v0.2 는 새 칸 셋과 규칙 값 staffing 을 더한다. 옛 결과(새 칸 없음)도 그대로 읽혀야 한다.
  const v02 = {
    ...payload,
    summary: "가".repeat(800),
    factorNotes: [
      { factor: "pastPerformance", text: "유사 사업 수행 이력이 있습니다.", refIds: ["C1"] },
    ],
    checkNotes: [{ label: "직접생산확인", text: "증명서 확인이 필요합니다.", refIds: ["B1"] }],
    nextSteps: [{ text: "참여하려면 공동수급 지분을 확인해야 합니다.", refIds: [] }],
    staffing: { from: "2026-12-01", to: "2027-11-30", availableFte: 3.5, eligibleStaff: 7 },
  };

  it("새 칸이 모두 있는 v0.2 결과를 받는다", () => {
    expect(insightPayloadSchema.safeParse(v02).success).toBe(true);
  });

  it("새 칸이 가리킨 근거 번호도 refs 에 있어야 한다", () => {
    const result = insightPayloadSchema.safeParse({
      ...v02,
      nextSteps: [{ text: "서류 확인", refIds: ["C9"] }],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["nextSteps", 0, "refIds", 0]);
  });

  it("판단 이유가 800자를 넘으면 거절한다", () => {
    expect(insightPayloadSchema.safeParse({ ...v02, summary: "가".repeat(801) }).success).toBe(
      false,
    );
  });
});

describe("insightJobId", () => {
  it("BullMQ 사용자 id 에 ':' 을 쓰지 않는다", () => {
    expect(insightJobId("0b0c4c2e-6a55-4b8e-9d35-5d0f8f3a1e11")).toBe(
      "insight-0b0c4c2e-6a55-4b8e-9d35-5d0f8f3a1e11",
    );
  });
});
