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
      getRevisionHistory: async () => null,
      getRevisionSnapshots: async () => [],
      listBids: unused,
      countBids: unused,
      getBid: unused,
      bidExists: async () => true,
      getAnalysisReadiness: async () => ({ ready: true, reason: null }),
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

// 분석 원문(최신 revision 본문·분석 가능한 첨부)이 없는 공고는 속도 제한·행·큐를 쓰지 않고 409 다.
describe("분석 원문 미확보 차단", () => {
  type Readiness = Awaited<ReturnType<BidsRepo["getAnalysisReadiness"]>>;
  function setup(readiness: Readiness, role: "SALES" | "VIEWER" = "SALES") {
    const created: CreateAnalysisRun[] = [];
    const jobs: Parameters<AnalysisQueue["enqueue"]>[0][] = [];
    let limiterHits = 0;
    let readinessReads = 0;
    const unused = async (): Promise<never> => {
      throw new Error("분석 원문 판정에서 호출하지 않는 저장 동작");
    };
    const repo: BidsRepo = {
      getRevisionHistory: async () => null,
      getRevisionSnapshots: async () => [],
      listBids: unused,
      countBids: unused,
      getBid: unused,
      bidExists: async () => readiness !== null,
      getAnalysisReadiness: async () => {
        readinessReads += 1;
        return readiness;
      },
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
        stage: "NOTICE",
      }),
      createAnalysisRun: async (input) => {
        created.push(input);
        return { created: { id: "analysis-1", status: "QUEUED" } };
      },
      markRunFailed: unused,
      findIdempotency: async () => null,
    };
    const run = () =>
      requestAnalysis(
        { orgId: "org-1", userId: "user-1", role },
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
          limiter: {
            hit: async () => {
              limiterHits += 1;
              return { allowed: true };
            },
          },
          onInfraError: () => {},
        },
      );
    return { run, created, jobs, limiterHits: () => limiterHits, reads: () => readinessReads };
  }

  it("분석 원문이 없는 공고(판정 SOURCE_TEXT_MISSING)는 409 ANALYSIS_SOURCE_MISSING 이고 속도 제한·행·큐를 쓰지 않는다", async () => {
    const test = setup({ ready: false, reason: "SOURCE_TEXT_MISSING" });
    expect(await test.run()).toEqual({
      ok: false,
      status: 409,
      code: "ANALYSIS_SOURCE_MISSING",
      message: "공고 본문 미확보 · 분석 준비 중",
      details: { reason: "SOURCE_TEXT_MISSING" },
    });
    expect(test.limiterHits()).toBe(0);
    expect(test.created).toEqual([]);
    expect(test.jobs).toEqual([]);
  });

  it("분석 원문이 있으면(판정 ready) 예전처럼 202 로 큐에 넣는다", async () => {
    const test = setup({ ready: true, reason: null });
    expect(await test.run()).toMatchObject({ ok: true, status: 202 });
    expect(test.limiterHits()).toBe(1);
    expect(test.jobs).toHaveLength(1);
  });

  it("없는(또는 보이지 않는) 공고는 예전처럼 404 다", async () => {
    const test = setup(null);
    expect(await test.run()).toMatchObject({ ok: false, status: 404, code: "NOT_FOUND" });
    expect(test.jobs).toEqual([]);
  });

  it("권한이 없으면 원문을 읽기 전에 403 이다", async () => {
    const test = setup({ ready: false, reason: "SOURCE_TEXT_MISSING" }, "VIEWER");
    expect(await test.run()).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
    expect(test.reads()).toBe(0);
  });
});
