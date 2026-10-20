import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  SCORING_CONFIG_V0_1,
  toScoringTeam,
  type CompanyProfile,
  type RequirementExtraction,
  type ScoringPerson,
} from "@/server/scoring";
import type { BidsRepo } from "./bids.repo";
import { computeWhatIf } from "./what-if.service";

// 가정 재계산 서비스(BOOST-2). 저장소는 스냅샷만 읽고 쓰기 메서드는 하나도 부르지 않는다.
// 경계 시험은 규칙 엔진(whatIf)까지 가지 않는다 — 스냅샷이 스키마에 안 맞으면 NO_SNAPSHOT 이다.
// 성공 경로(200)는 fixtures/ 의 FX-03 입력 스냅샷으로 실제 규칙 엔진을 돌린다.

const CALCULATION_DATE = "2026-10-16";

// scoring 의 test-support 는 딥임포트라 쓸 수 없다. 계약 시험(app/api/v1/what-if-contract.test.ts)과 같은 방식으로
// fixtures/ 에서 FX-03 입력 스냅샷을 조립한다.
const readFixture = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8")) as T;

function relativeDate(spec: string | null): string | null {
  const match = spec === null ? null : /^([+-])(\d+)d$/.exec(spec);
  if (spec === null || match === null) return spec;
  const days = Number(match[2]) * (match[1] === "-" ? -1 : 1);
  const [year, month, day] = CALCULATION_DATE.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days, 9, 0, 0)).toISOString();
}

function fx03Snapshot(): unknown {
  const bid = readFixture<{
    records: {
      amendmentNo: string;
      noticeId: string;
      title: string;
      agency: string | null;
      budgetKrw: string | null;
      noticeDate: string | null;
      deadlineAt: string | null;
      stage: "PLAN" | "PRE_SPEC" | "NOTICE";
    }[];
  }>("bids/FX-03.json").records[0];
  const people = readFixture<{
    people: ScoringPerson[];
    assignments: {
      personId: string;
      startsAt: string;
      endsAt: string;
      allocationPercent: number;
    }[];
    asOf: string;
  }>("people/solideo.people.json");
  return {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: {
      noticeId: bid.noticeId,
      revisionId: `FX-03#${bid.amendmentNo}`,
      title: bid.title,
      agency: bid.agency,
      stage: bid.stage,
      budgetKrw: bid.budgetKrw,
      deadlineAt: relativeDate(bid.deadlineAt),
      noticeDate: relativeDate(bid.noticeDate),
      fetchedAt: `${CALCULATION_DATE}T09:00:00Z`,
      projectPeriod: null,
      structuredQualifications: [],
    },
    extraction: readFixture<RequirementExtraction>("extractions/FX-03.json"),
    profile: readFixture<CompanyProfile>("company/solideo-profile.json"),
    team: toScoringTeam(people.people, people.assignments, people.asOf),
    kev: null,
    config: { ...SCORING_CONFIG_V0_1, today: CALCULATION_DATE },
  };
}

// getAnalysisSnapshot 밖의 저장소 함수는 꺼내기만 해도 던진다. 쓰기든 읽기든 다른 함수를 부르면 시험이 깨진다.
function snapshotOnlyRepo(snapshot: Awaited<ReturnType<BidsRepo["getAnalysisSnapshot"]>>) {
  const getAnalysisSnapshot = vi.fn(async () => snapshot);
  const repo = new Proxy({} as BidsRepo, {
    get(_target, key) {
      if (key === "getAnalysisSnapshot") return getAnalysisSnapshot;
      throw new Error(`가정 재계산이 부르지 않는 저장소 함수다: ${String(key)}`);
    },
  });
  return { repo, getAnalysisSnapshot };
}

function fakeRepo(snapshot: Awaited<ReturnType<BidsRepo["getAnalysisSnapshot"]>>) {
  const writes = {
    createAnalysisRun: vi.fn(),
    markRunFailed: vi.fn(),
  };
  const repo = {
    getAnalysisSnapshot: vi.fn(async () => snapshot),
    ...writes,
  } as unknown as BidsRepo;
  return { repo, writes };
}

const body = { assumptions: [{ kind: "QUALIFICATION", code: "ICT_CONSTRUCTION" }] };

describe("computeWhatIf", () => {
  it("본문이 틀리면 400 VALIDATION_ERROR 이고 저장소를 부르지 않는다", async () => {
    const { repo } = fakeRepo(null);
    const bad = [
      {},
      { assumptions: "x" },
      { assumptions: [{ kind: "OTHER", code: "A" }] },
      { assumptions: [{ kind: "QUALIFICATION", code: "" }] },
      { assumptions: [{ kind: "QUALIFICATION", code: "A", extra: 1 }] },
      { assumptions: Array.from({ length: 11 }, () => ({ kind: "QUALIFICATION", code: "A" })) },
    ];
    for (const input of bad) {
      const result = await computeWhatIf("org1", "r1", input, { repo });
      expect(result).toMatchObject({ ok: false, status: 400, code: "VALIDATION_ERROR" });
    }
    expect(repo.getAnalysisSnapshot).not.toHaveBeenCalled();
  });

  it("run 이 없거나 다른 조직이면 404 resource analysis 다", async () => {
    const { repo } = fakeRepo(null);
    const result = await computeWhatIf("org1", "r1", body, { repo });
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "analysis" },
    });
    expect(repo.getAnalysisSnapshot).toHaveBeenCalledWith("org1", "r1");
  });

  it.each(["QUEUED", "RUNNING"] as const)("%s 이면 409 ANALYSIS_IN_PROGRESS 다", async (status) => {
    const { repo } = fakeRepo({ status, inputSnapshot: null });
    expect(await computeWhatIf("org1", "r1", body, { repo })).toMatchObject({
      ok: false,
      status: 409,
      code: "ANALYSIS_IN_PROGRESS",
    });
  });

  it("FAILED 이면 404 NO_SNAPSHOT 이다", async () => {
    const { repo } = fakeRepo({ status: "FAILED", inputSnapshot: { any: 1 } });
    expect(await computeWhatIf("org1", "r1", body, { repo })).toMatchObject({
      ok: false,
      status: 404,
      code: "NOT_FOUND",
      details: { resource: "analysis", reason: "NO_SNAPSHOT" },
    });
  });

  it("스냅샷이 스키마에 안 맞으면(null 포함) 404 NO_SNAPSHOT 이다", async () => {
    for (const inputSnapshot of [null, { broken: true }]) {
      const { repo } = fakeRepo({ status: "COMPLETED", inputSnapshot });
      expect(await computeWhatIf("org1", "r1", body, { repo })).toMatchObject({
        ok: false,
        status: 404,
        details: { resource: "analysis", reason: "NO_SNAPSHOT" },
      });
    }
  });

  it("어떤 경우에도 쓰기 메서드를 부르지 않는다", async () => {
    const { repo, writes } = fakeRepo({ status: "COMPLETED", inputSnapshot: { broken: true } });
    await computeWhatIf("org1", "r1", body, { repo });
    await computeWhatIf("org1", "r1", {}, { repo });
    expect(writes.createAnalysisRun).not.toHaveBeenCalled();
    expect(writes.markRunFailed).not.toHaveBeenCalled();
  });

  it("FX-03 정상 스냅샷이면 200 이고 저장소는 스냅샷 읽기 한 번뿐이다", async () => {
    const { repo, getAnalysisSnapshot } = snapshotOnlyRepo({
      status: "COMPLETED",
      inputSnapshot: fx03Snapshot(),
    });
    const result = await computeWhatIf("org1", "r1", body, { repo });
    expect(result).toMatchObject({
      ok: true,
      status: 200,
      data: {
        assumable: ["ICT_CONSTRUCTION"],
        before: { recommendation: "NO_BID", score: 68, qualificationStatus: "NOT_SATISFIED" },
        after: { recommendation: "WATCH", score: 68, qualificationStatus: "SATISFIED" },
      },
    });
    expect(getAnalysisSnapshot).toHaveBeenCalledTimes(1);
    expect(getAnalysisSnapshot).toHaveBeenCalledWith("org1", "r1");
  });
});
