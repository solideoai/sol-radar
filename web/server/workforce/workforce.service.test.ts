import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  analysisInputSchema,
  availableFte,
  staffAvailability,
  SCORING_CONFIG_V0_1,
} from "@/server/scoring";
import { simulateWorkforce } from "./workforce.service";
import type { WorkforceRepo } from "./workforce.model";

const PERIOD = { startsAt: "2026-12-01", endsAt: "2027-01-01" };
const NOW = new Date("2026-10-22T00:00:00Z");
function setup() {
  const input = analysisInputSchema.parse({
    schemaVersion: "analysis-input/v0.1",
    bid: {
      revisionId: "rev-1",
      title: "가상 공고",
      agency: null,
      stage: "NOTICE",
      budgetKrw: "1000000000",
      deadlineAt: null,
      noticeDate: null,
      fetchedAt: NOW.toISOString(),
      structuredQualifications: [],
    },
    extraction: null,
    profile: JSON.parse(
      readFileSync(
        new URL("../../../fixtures/company/solideo-profile.json", import.meta.url),
        "utf8",
      ),
    ),
    team: { asOf: NOW.toISOString(), members: [], assignments: [] },
    kev: null,
    config: { ...SCORING_CONFIG_V0_1, today: "2026-10-16" },
  });
  input.bid.projectPeriod = PERIOD;
  input.extraction = null;
  input.team = {
    asOf: "2026-10-16T00:00:00Z",
    members: [
      {
        personId: "eligible",
        role: "개발자",
        grade: null,
        skills: ["Java"],
        availability: [{ ...PERIOD, fte: 1 }],
      },
    ],
    assignments: [],
  };
  const current = {
    people: [
      {
        personId: "eligible",
        name: "김가상",
        department: "개발부",
        jobTitle: "선임",
        isDemo: true,
        availability: [{ ...PERIOD, fte: 1 }],
      },
      {
        personId: "not-in-snapshot",
        name: "다른직원",
        department: "개발부",
        jobTitle: "사원",
        isDemo: true,
        availability: [{ ...PERIOD, fte: 1 }],
      },
    ],
    assignments: [
      {
        id: "a",
        bidId: "other",
        personId: "eligible",
        startsAt: "2026-12-01",
        endsAt: "2026-12-20",
        allocationPercent: 70,
      },
      {
        id: "b",
        bidId: "other2",
        personId: "eligible",
        startsAt: "2026-12-10",
        endsAt: "2026-12-20",
        allocationPercent: 60,
      },
      {
        id: "touching",
        bidId: "other3",
        personId: "eligible",
        startsAt: "2027-01-01",
        endsAt: "2027-02-01",
        allocationPercent: 100,
      },
    ],
  };
  const repo: WorkforceRepo = {
    readBid: async (_org, bidId) => ({ bidId, title: "가상 공고", isDemo: true }),
    latestAttempt: async () => ({ id: "failed", status: "FAILED", at: NOW.toISOString() }),
    scoredSnapshots: async (_org, _bid, offset) =>
      offset === 0
        ? [
            {
              id: "run",
              status: "COMPLETED",
              revision: 1,
              finishedAt: "2026-10-16T01:00:00Z",
              inputSnapshot: input,
            },
          ]
        : [],
    current: async () => current,
  };
  return { repo, input, current };
}

it("스냅샷 FTE가 기존 엔진과 일치하고 현재 배정이 바뀌어도 과거 FTE를 보존한다", async () => {
  const { repo, input, current } = setup();
  const before = structuredClone(input);
  const result = await simulateWorkforce("org", ["bid"], { repo }, NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  const item = result.data.bids[0];
  const expected = staffAvailability(input.bid, input.extraction, input.team, input.config.today);
  expect(item.availableFte).toBe(availableFte(input.team, PERIOD));
  expect(item.requiredFte).toBe(expected.rawValue.requiredFte);
  expect(item.latestAttempt?.status).toBe("FAILED");
  expect(item.snapshotAsOf).toBe(input.team.asOf);
  current.assignments = [];
  const again = await simulateWorkforce("org", ["bid"], { repo }, NOW);
  expect(again.ok && again.data.bids[0].availableFte).toBe(item.availableFte);
  expect(input).toEqual(before);
});

it("실제 배정 과부하를 반열린 구간으로 찾고 후보 공유와 구분한다", async () => {
  const { repo } = setup();
  const result = await simulateWorkforce("org", ["bid", "bid2"], { repo }, NOW);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.overloads).toHaveLength(1);
  expect(result.data.overloads[0]).toMatchObject({
    startsAt: "2026-12-10T00:00:00.000Z",
    endsAt: "2026-12-20T00:00:00.000Z",
    allocatedFte: 1.3,
    capacityFte: 1,
  });
  expect(result.data.sharedCandidates).toHaveLength(1);
  expect(result.data.bids[0].candidates.map((person) => person.personId)).toEqual(["eligible"]);
});

it("유효한 완료 스냅샷이 없으면 분석 필요와 빈 FTE를 반환한다", async () => {
  const { repo } = setup();
  const original = repo.scoredSnapshots;
  repo.scoredSnapshots = async (org, bidId, offset) => [
    { id: "invalid", status: "PARTIAL", revision: 1, finishedAt: null, inputSnapshot: {} },
    ...(await original(org, bidId, offset)),
  ];
  const recovered = await simulateWorkforce("org", ["bid"], { repo }, NOW);
  expect(recovered.ok && recovered.data.bids[0].analysisId).toBe("run");
  repo.scoredSnapshots = async () => [
    { id: "invalid", status: "PARTIAL", revision: 1, finishedAt: null, inputSnapshot: {} },
  ];
  const result = await simulateWorkforce("org", ["bid"], { repo }, NOW);
  expect(result.ok && result.data.bids[0]).toMatchObject({
    analysisId: null,
    availableFte: null,
    requiredFte: null,
    missingReason: "VALID_SNAPSHOT_REQUIRED",
    candidates: [],
  });
});
