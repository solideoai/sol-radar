import { describe, expect, it } from "vitest";
import { itBatchIdempotencyKey, splitBySource, toItBatchRunRow } from "./it-batch.model";

// IT 공고 일괄 분석(ADR-069)의 순수 규칙: run 행·멱등 키·원문 판정.

describe("일괄 분석 규칙", () => {
  it("일괄 분석 run 행에는 requested_by 가 없다", () => {
    const row = toItBatchRunRow({
      orgId: "o",
      bidId: "b",
      revisionId: "r",
      companyProfileId: "p",
      profileRevision: 5,
      idempotencyKey: "k",
    });
    // requested_by 가 있으면 finish_score_run 이 BID_RECOMMENDED outbox 를 쓴다(카카오 알림 수백 통).
    expect(row).not.toHaveProperty("requested_by");
    expect(row.run_mode).toBe("LIVE");
    expect(row.ai_provider).toBe("LOCAL");
  });

  it("멱등 키에 revision 과 프로필 revision 이 들어간다", () => {
    expect(itBatchIdempotencyKey("o", { bidId: "b", revisionId: "r", revision: 3 }, 5)).toBe(
      "o:it-batch-b-r03-p5",
    );
  });

  it("본문이나 파싱된 첨부가 있는 공고만 넣을 대상이다", () => {
    const candidates = [
      { bidId: "b1", revisionId: "r1", revision: 1, content: "과업 내용" },
      { bidId: "b2", revisionId: "r2", revision: 1, content: "  " },
      { bidId: "b3", revisionId: "r3", revision: 2, content: null },
    ];
    const split = splitBySource(candidates, new Set(["r3"]), true);
    expect(split.ready).toEqual([
      { bidId: "b1", revisionId: "r1", revision: 1 },
      { bidId: "b3", revisionId: "r3", revision: 2 },
    ]);
    expect(split.skippedNoSource).toBe(1);
    // 분석이 첨부를 읽지 않으면 첨부만 있는 공고도 넣지 않는다.
    expect(splitBySource(candidates, new Set(["r3"]), false).skippedNoSource).toBe(2);
  });
});
