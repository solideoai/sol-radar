import "server-only";

import { describe, expect, it } from "vitest";
import { classifyProcurementRelevance } from "./relevance";

describe("공공 SI·AI 관련성 근거", () => {
  it("AI 단어가 없는 SW 유지보수도 제목과 본문 근거로 우선 검토한다", () => {
    const result = classifyProcurementRelevance({
      title: "행정정보시스템 유지보수 용역",
      body: "행정정보시스템의 소프트웨어 유지보수와 기능 개선을 수행한다.",
    });

    expect(result.state).toBe("RELEVANT");
    expect(result.score).toBe(55);
    expect(result.categories).toContain("SI_SW");
    expect(result.tags).toContain("maintenance");
    expect(result.missingChannels).toEqual(["officialIndustry", "attachment"]);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ channel: "title", quote: "정보시스템", start: 2, end: 7 }),
    );
  });

  it("데이터 케이블과 영단어 일부를 양성 근거로 만들지 않는다", () => {
    const body =
      "데이터 케이블 납품. 소프트웨어 개발이나 정보시스템 구축은 과업에 포함되지 않는다.";
    const result = classifyProcurementRelevance({
      title: "데이터 케이블 납품 및 chair 구매",
      body,
      reviewedEvidence: [
        {
          channel: "body",
          quote: body,
          start: 0,
          end: body.length,
          polarity: "UNRELATED",
          category: "OTHER",
          reviewer: "human",
          verificationId: "review-cable",
        },
      ],
    });

    expect(result.state).toBe("LOW_RELEVANCE");
    expect(result.score).toBe(0);
    expect(result.categories).toEqual(["OTHER"]);
  });

  it("본문 미확보를 비관련으로 확정하지 않고 점수도 만들지 않는다", () => {
    const result = classifyProcurementRelevance({ title: "2026년 통합 운영 용역", body: null });

    expect(result.state).toBe("UNCLASSIFIED");
    expect(result.score).toBeNull();
    expect(result.missingChannels).toContain("body");
  });

  it("한 양성 채널은 후보로 남기고 모델이 보낸 잘못된 인용은 점수로 쓰지 않는다", () => {
    const result = classifyProcurementRelevance({
      title: "AI 민원 상담 구축",
      body: "실제 과업은 추후 제공한다.",
      reviewedEvidence: [
        {
          channel: "body",
          quote: "LLM 기반 시스템",
          start: 0,
          end: 10,
          polarity: "POSITIVE",
          category: "AI_AX",
          reviewer: "verified_classifier",
          verificationId: "verified-but-incorrect-offset",
        },
      ],
    });

    expect(result.state).toBe("CANDIDATE");
    expect(result.score).toBe(30);
    expect(result.rejectedEvidence).toHaveLength(1);
    expect(result.evidence.every(({ channel }) => channel === "title")).toBe(true);
  });

  it("동일 채널의 반복 근거는 가산하지 않고 공식 업종과 검증된 첨부를 합산한다", () => {
    const result = classifyProcurementRelevance({
      title: "AI 및 LLM 상담 플랫폼",
      officialIndustries: [{ code: "001469", name: "소프트웨어사업자" }],
      attachments: [
        { id: "rfp-1", text: "문서업무 지능화" },
        { id: "rfp-2", text: "LLM 구축 세부 과업" },
      ],
      reviewedEvidence: [
        {
          channel: "attachment",
          documentId: "rfp-1",
          quote: "문서업무 지능화",
          start: 0,
          end: 8,
          polarity: "POSITIVE",
          category: "AI_AX",
          reviewer: "verified_classifier",
          verificationId: "semantic-review-1",
        },
      ],
    });

    expect(result.state).toBe("RELEVANT");
    expect(result.score).toBe(75);
    expect(result.missingChannels).toEqual(["body"]);
    expect(result.evidence).toContainEqual(
      expect.objectContaining({
        documentId: "rfp-1",
        quote: "문서업무 지능화",
        origin: "verified_classifier",
      }),
    );
  });

  it("확인된 양성과 비관련 근거가 충돌하면 검토를 우선한다", () => {
    const body = "이번 구매는 사무용 의자 납품만을 포함한다.";
    const result = classifyProcurementRelevance({
      title: "AI 플랫폼 구축",
      body,
      reviewedEvidence: [
        {
          channel: "body",
          quote: body,
          start: 0,
          end: body.length,
          polarity: "UNRELATED",
          category: "OTHER",
          reviewer: "verified_classifier",
          verificationId: "review-scope",
        },
      ],
    });

    expect(result.state).toBe("NEEDS_REVIEW");
    expect(result.score).toBe(30);
    expect(result.evidence.map(({ polarity }) => polarity)).toContain("UNRELATED");
    expect(result.inputHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
