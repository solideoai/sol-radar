import "server-only";

import { describe, expect, it } from "vitest";
import type { AnalysisQueue, BidsRepo, CreateAnalysisRun } from "./bids.repo";
import { requestAnalysis } from "./bids.service";

describe("분석 단계 호환성", () => {
  it("지원하지 않는 조달요청 단계는 분석 행과 작업을 만들기 전에 거절한다", async () => {
    const created: CreateAnalysisRun[] = [];
    const jobs: Parameters<AnalysisQueue["enqueue"]>[0][] = [];
    const unused = async (): Promise<never> => {
      throw new Error("분석 단계 검증에서 호출하지 않는 저장 동작");
    };
    const repo: BidsRepo = {
      listBids: unused,
      countBids: unused,
      getBid: unused,
      bidExists: async () => true,
      listAnalyses: unused,
      getLatestScoredAnalysis: unused,
      getAnalysis: unused,
      getAnalysisSnapshot: unused,
      findRunningAnalysis: async () => null,
      findCompletedSameInput: async () => null,
      resolveAnalysisInput: async () => ({
        companyProfileId: "profile-1",
        profileRevision: 1,
        revisionId: "revision-1",
        extractionId: null,
        algorithmVersion: "rules-v1",
        stage: "PROCUREMENT_REQUEST",
      }),
      createAnalysisRun: async (input) => {
        created.push(input);
        return { created: { id: "analysis-1", status: "QUEUED" } };
      },
      markRunFailed: unused,
      findIdempotency: async () => null,
    };
    const result = await requestAnalysis(
      { orgId: "org-1", userId: "user-1", role: "SALES" },
      "bid-1",
      { declaredTooLarge: false, read: async () => ({ ok: true, value: {} }) },
      null,
      {
        repo,
        queue: {
          enqueue: async (job) => {
            jobs.push(job);
          },
        },
        limiter: { hit: async () => ({ allowed: true }) },
        onInfraError: () => {},
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      details: { stage: "PROCUREMENT_REQUEST", reason: "STAGE_NOT_SUPPORTED" },
    });
    expect(created).toEqual([]);
    expect(jobs).toEqual([]);
  });
});
