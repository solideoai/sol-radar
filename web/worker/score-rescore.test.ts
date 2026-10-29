import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import type { RescoreSource, RescoreStore } from "@/server/analysis";
import { ANALYSIS_INPUT_SCHEMA_VERSION, SCORING_CONFIG } from "@/server/scoring";
import {
  CALCULATION_DATE,
  COMPANY_PROFILE_ID,
  ORG_ID,
  loadBid,
  loadExtraction,
  loadProfile,
  loadTeam,
} from "@/worker/analysis-job.test-support";
import { parseRescoreArgs, runRescore } from "@/worker/score-rescore";

// 점수 재채점 CLI(ADR-071). 가짜 store 만 쓴다(Supabase 를 부르지 않는다).
// 원본 스냅샷은 sol-v0.1.0 config 로 저장된 FX-01 입력이고, 현재 버전으로 다시 계산해 새 run 으로 넣는다.

const NOW = new Date(`${CALCULATION_DATE}T10:00:00.000Z`);
const KEV_OUTPUT: Json = { questionSetVersion: "kev-qs/v0.2", wire: [], stateHash: null };

function source(id: string, idempotencyKey: string | null, algorithmVersion = "sol-v0.1.0") {
  const snapshot = {
    schemaVersion: ANALYSIS_INPUT_SCHEMA_VERSION,
    bid: loadBid("FX-01"),
    extraction: loadExtraction("FX-01"),
    profile: loadProfile(),
    team: loadTeam(),
    kev: null,
    config: { ...SCORING_CONFIG, algorithmVersion: "sol-v0.1.0", today: CALCULATION_DATE },
  };
  return {
    id,
    bidId: `bid-${id}`,
    revisionId: `rev-${id}`,
    companyProfileId: COMPANY_PROFILE_ID,
    profileRevision: 5,
    extractionId: null,
    algorithmVersion,
    runMode: "LIVE",
    aiProvider: "LOCAL",
    idempotencyKey,
    reviewFlags: ["CITATION_FAILED", "MODEL_RULE_DISAGREEMENT"],
    score: 58,
    recommendation: "WATCH",
    inputSnapshot: JSON.parse(JSON.stringify(snapshot)) as Json,
    kevOutput: KEV_OUTPUT,
  } satisfies RescoreSource;
}

function fakeStore(sources: RescoreSource[]) {
  const inserted: Parameters<RescoreStore["insertRun"]>[0][] = [];
  const finished: Parameters<RescoreStore["finish"]>[0][] = [];
  const store: RescoreStore = {
    findOrgBySlug: async () => ORG_ID,
    latestProfile: async () => ({ id: COMPANY_PROFILE_ID, revision: 5 }),
    listShownRuns: async () =>
      sources.map(({ id, algorithmVersion }) => ({ id, algorithmVersion })),
    loadSources: async (_orgId, ids) => sources.filter((entry) => ids.includes(entry.id)),
    insertRun: async (row) => {
      inserted.push(row);
      return { kind: "CREATED", id: `new-${inserted.length}` };
    },
    finish: async (payload) => {
      finished.push(payload);
    },
    markFailed: async () => undefined,
  };
  return { store, inserted, finished };
}

const deps = (store: RescoreStore, lines: string[]) => ({
  store,
  now: () => NOW,
  log: (line: string) => {
    lines.push(line);
  },
});

describe("점수 재채점 CLI", () => {
  it("화면에 보이는 옛 버전 run 만 현재 버전으로 다시 계산해 새 run 으로 넣는다", async () => {
    const batch = source("a", `${ORG_ID}:it-batch-bid-a-r01-p5`);
    const human = source("b", `${ORG_ID}:3f0c2d8e-1b7a-4c55-9e1d-2a6b8c4d0e9f`);
    const current = source("c", null, "sol-v0.2.0");
    const { store, inserted, finished } = fakeStore([batch, human, current]);
    const lines: string[] = [];
    const result = await runRescore(deps(store, lines), {
      orgSlug: "solideo",
      dryRun: false,
      limit: null,
    });

    expect(result.exitCode).toBe(0);
    expect(result.line).toContain("shown=3 current=1 targets=2 written=2");
    expect(inserted.map((row) => row.idempotency_key)).toEqual([
      `${ORG_ID}:it-batch-rescore-sol-v0.2.0-a`,
      `${ORG_ID}:rescore-sol-v0.2.0-b`,
    ]);
    expect(inserted[0]).toMatchObject({
      algorithm_version: "sol-v0.2.0",
      status: "RUNNING",
      run_mode: "LIVE",
      ai_provider: "LOCAL",
    });
    expect(inserted[0]).not.toHaveProperty("requested_by");
    expect(finished[0]?.run).toMatchObject({
      status: "COMPLETED",
      kev_output: KEV_OUTPUT,
      review_flags: expect.arrayContaining(["CITATION_FAILED"]),
    });
    expect(finished[0]?.run.input_snapshot).toMatchObject({
      config: { algorithmVersion: "sol-v0.2.0" },
    });
    expect(finished[0]?.factors).toHaveLength(5);
  });

  it("dry-run 은 쓰지 않고 분포만 알린다", async () => {
    const { store, inserted, finished } = fakeStore([source("a", null)]);
    const lines: string[] = [];
    const result = await runRescore(deps(store, lines), {
      orgSlug: "solideo",
      dryRun: true,
      limit: null,
    });
    expect([inserted.length, finished.length]).toEqual([0, 0]);
    expect(result.line).toMatch(/before\[n=1 min=58 max=58 avg=58\.0\] after\[n=1 /);
  });

  it("인자는 --org-slug 필수, --limit·--dry-run 선택이다", () => {
    expect(parseRescoreArgs(["--", "--org-slug", "solideo", "--dry-run"])).toEqual({
      orgSlug: "solideo",
      dryRun: true,
      limit: null,
    });
    expect(() => parseRescoreArgs(["--limit", "3"])).toThrow(/사용법/);
  });
});
