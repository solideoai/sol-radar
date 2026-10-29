import { describe, expect, it } from "vitest";
import {
  isItBatchIdempotencyKey,
  itBatchIdempotencyKey,
  splitBySource,
  toItBatchRunRow,
} from "./it-batch.model";

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

  it("일괄 분석 멱등 키만 일괄 분석 run 으로 가른다", () => {
    const key = itBatchIdempotencyKey("o", { bidId: "b", revisionId: "r", revision: 3 }, 5);
    expect(isItBatchIdempotencyKey(key)).toBe(true);
    // 화면 [분석](uuid)·DEMO 사전 분석(demo-pre)·키 없음은 아니다. 조직 접두어 없이 시작해도 아니다.
    for (const other of [
      "o:5f0c9a3e-2b7d-4c1a-9e8f-6d5c4b3a2f10",
      "o:demo-pre-FX-01-r01",
      null,
      "it-batch-b-r03-p5",
    ]) {
      expect(isItBatchIdempotencyKey(other)).toBe(false);
    }
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
