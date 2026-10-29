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
});

describe("insightJobId", () => {
  it("BullMQ 사용자 id 에 ':' 을 쓰지 않는다", () => {
    expect(insightJobId("0b0c4c2e-6a55-4b8e-9d35-5d0f8f3a1e11")).toBe(
      "insight-0b0c4c2e-6a55-4b8e-9d35-5d0f8f3a1e11",
    );
  });
});
