import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/database.types";
import { rescore, type RescoreSource, type RescoreStore } from "@/server/analysis";
import { ALGORITHM_VERSION, ANALYSIS_INPUT_SCHEMA_VERSION, SCORING_CONFIG } from "@/server/scoring";
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
    checks: [],
  } satisfies RescoreSource;
}

const NEXT_PROFILE_ID = "c0ffee00-1234-4abc-9def-000000000006";

function fakeStore(
  sources: RescoreSource[],
  latest = { id: COMPANY_PROFILE_ID, revision: 5, snapshot: loadProfile() },
) {
  const inserted: Parameters<RescoreStore["insertRun"]>[0][] = [];
  const finished: Parameters<RescoreStore["finish"]>[0][] = [];
  const profiles = [{ id: COMPANY_PROFILE_ID, revision: 5 }, latest];
  const store: RescoreStore = {
    findOrgBySlug: async () => ORG_ID,
    latestProfile: async () => ({ id: latest.id, revision: latest.revision }),
    profileByRevision: async (_orgId, revision) =>
      profiles.find((profile) => profile.revision === revision) ?? null,
    loadProfileSnapshot: async () => latest.snapshot,
    listShownRuns: async (_orgId, profileId) =>
      sources
        .filter((entry) => entry.companyProfileId === profileId)
        .map(({ id, bidId, algorithmVersion }) => ({ id, bidId, algorithmVersion })),
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
    const current = source("c", null, ALGORITHM_VERSION);
    const { store, inserted, finished } = fakeStore([batch, human, current]);
    const lines: string[] = [];
    const result = await runRescore(deps(store, lines), {
      orgSlug: "solideo",
      dryRun: false,
      limit: null,
      fromProfileRevision: null,
      changedOnly: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.line).toContain("shown=3 current=1 targets=2 written=2");
    expect(inserted.map((row) => row.idempotency_key)).toEqual([
      `${ORG_ID}:it-batch-rescore-${ALGORITHM_VERSION}-a`,
      `${ORG_ID}:rescore-${ALGORITHM_VERSION}-b`,
    ]);
    expect(inserted[0]).toMatchObject({
      algorithm_version: ALGORITHM_VERSION,
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
      config: { algorithmVersion: ALGORITHM_VERSION },
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
      fromProfileRevision: null,
      changedOnly: false,
    });
    expect([inserted.length, finished.length]).toEqual([0, 0]);
    expect(result.line).toMatch(/before\[n=1 min=58 max=58 avg=58\.0\] after\[n=1 /);
  });

  it("프로필 교체는 옛 프로필 run 의 profile 만 최신 프로필로 바꿔 최신 프로필 run 으로 넣는다", async () => {
    // 최신 프로필은 자격을 모두 NOT_HELD 로 적었다: 바뀐 프로필로 계산했다면 필수 자격 미충족 → NO_BID 다.
    const base = loadProfile();
    const snapshot = {
      ...base,
      revision: 6,
      licenses: base.licenses.map((license) => ({ ...license, status: "NOT_HELD" as const })),
    };
    const old = source("a", `${ORG_ID}:it-batch-bid-a-r01-p5`, ALGORITHM_VERSION);
    const done = { ...source("b", null, ALGORITHM_VERSION), bidId: "bid-c" };
    const fresh = { ...source("c", null, ALGORITHM_VERSION), companyProfileId: NEXT_PROFILE_ID };
    const { store, inserted, finished } = fakeStore([old, done, fresh], {
      id: NEXT_PROFILE_ID,
      revision: 6,
      snapshot,
    });
    const lines: string[] = [];
    const result = await runRescore(deps(store, lines), {
      orgSlug: "solideo",
      dryRun: false,
      limit: null,
      fromProfileRevision: 5,
      changedOnly: false,
    });

    // b 는 같은 공고(bid-c)에 최신 프로필 run(c)이 이미 있어 건너뛴다.
    expect(result.exitCode).toBe(0);
    expect(lines[0]).toContain("profile 5->6");
    expect(result.line).toContain("shown=2 current=1 targets=1 written=1");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      bid_id: "bid-a",
      company_profile_id: NEXT_PROFILE_ID,
      profile_revision: 6,
      algorithm_version: ALGORITHM_VERSION,
      idempotency_key: `${ORG_ID}:it-batch-rescore-${ALGORITHM_VERSION}-p6-a`,
    });
    expect(finished[0]?.run).toMatchObject({
      recommendation: "NO_BID",
      kev_output: KEV_OUTPUT,
      input_snapshot: { profile: { revision: 6 }, config: { algorithmVersion: ALGORITHM_VERSION } },
    });
  });

  it("프로필 교체의 원본 revision 은 최신보다 작고 있어야 한다", async () => {
    const { store, inserted } = fakeStore([source("a", null)]);
    const lines: string[] = [];
    const options = { orgSlug: "solideo", dryRun: false, limit: null, changedOnly: false };
    const same = await runRescore(deps(store, lines), { ...options, fromProfileRevision: 5 });
    expect([same.exitCode, same.line]).toEqual([1, expect.stringContaining("작아야")]);
    const next = fakeStore([source("a", null)], {
      id: NEXT_PROFILE_ID,
      revision: 6,
      snapshot: loadProfile(),
    });
    const missing = await runRescore(deps(next.store, lines), {
      ...options,
      fromProfileRevision: 4,
    });
    expect([missing.exitCode, missing.line]).toEqual([1, expect.stringContaining("프로필이 없다")]);
    expect([inserted.length, next.inserted.length]).toEqual([0, 0]);
  });

  it("--changed-only 는 다시 계산한 점수·권고·자격 판정이 원본과 같은 run 을 새로 만들지 않는다", async () => {
    // 원본 값을 지금 규칙의 계산값으로 맞춘 run(같음)과, 권고만 다르게 저장된 run(다름).
    const computed = rescore(source("x", null, "sol-v0.2.0"));
    if (computed === null) throw new Error("FX-01 스냅샷을 계산하지 못했다");
    const stored = {
      score: computed.result.score,
      recommendation: computed.result.recommendation,
      checks: computed.result.qualificationChecks.map((check) => ({
        requirementName: check.requirementName,
        mandatory: check.mandatory,
        outcome: check.outcome,
        reasonCode: check.reasonCode,
      })),
    };
    const same = { ...source("a", null, "sol-v0.2.0"), ...stored };
    const differs = { ...source("b", null, "sol-v0.2.0"), ...stored, recommendation: "NO_BID" };
    const { store, inserted } = fakeStore([same, differs]);
    const lines: string[] = [];
    const result = await runRescore(deps(store, lines), {
      orgSlug: "solideo",
      dryRun: false,
      limit: null,
      fromProfileRevision: null,
      changedOnly: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.line).toContain("targets=2 written=1 existing=0 busy=0 unchanged=1");
    expect(inserted.map((row) => row.bid_id)).toEqual(["bid-b"]);
    expect(lines.filter((line) => line.endsWith("CHANGED"))).toEqual(["rescore: b CHANGED"]);
  });

  it("인자는 --org-slug 필수, --limit·--from-profile-revision·--changed-only·--dry-run 선택이다", () => {
    expect(parseRescoreArgs(["--", "--org-slug", "solideo", "--dry-run"])).toEqual({
      orgSlug: "solideo",
      dryRun: true,
      limit: null,
      fromProfileRevision: null,
      changedOnly: false,
    });
    expect(parseRescoreArgs(["--org-slug", "solideo", "--changed-only"])).toMatchObject({
      changedOnly: true,
    });
    expect(
      parseRescoreArgs(["--org-slug", "solideo", "--from-profile-revision", "5"]),
    ).toMatchObject({ fromProfileRevision: 5 });
    expect(() => parseRescoreArgs(["--limit", "3"])).toThrow(/사용법/);
    expect(() =>
      parseRescoreArgs(["--org-slug", "solideo", "--from-profile-revision", "0"]),
    ).toThrow(/사용법/);
  });
});
