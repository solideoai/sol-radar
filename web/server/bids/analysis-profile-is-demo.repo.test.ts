import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBidsRepo } from "./bids.supabase";

// 분석 조회가 run 이 가리키는 회사 프로필의 is_demo 를 embed 로 읽어 profileIsDemo 로 싣는지 본다.
const db = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  selects: [] as string[],
}));
vi.mock("@/server/supabase", () => ({
  getSupabase: async () => ({
    from: () => {
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        db.selects.push(columns);
        return builder;
      };
      for (const method of ["eq", "order", "limit", "in"]) builder[method] = () => builder;
      builder.maybeSingle = async () => ({ data: db.row, error: null });
      return builder;
    },
  }),
}));

const runRow = (profile: { is_demo: boolean } | null) => ({
  id: "run-1",
  org_id: "org-1",
  bid_id: "bid-1",
  revision_id: "rev-1",
  company_profile_id: "cp-1",
  profile_revision: 3,
  extraction_id: null,
  algorithm_version: "v0.1",
  run_mode: "MOCK",
  ai_provider: "MOCK",
  qwen_model: null,
  kev_model: null,
  question_set_version: null,
  kev_calibration: null,
  prompt_hash: null,
  input_snapshot_hash: null,
  injection_suspected: false,
  status: "QUEUED",
  score: null,
  recommendation: null,
  recommendation_basis: null,
  explanation: null,
  review_flags: [],
  missing_factors: [],
  model_metadata: {},
  kev_assist: null,
  fallback_reason: null,
  idempotency_key: null,
  request_hash: null,
  requested_by: null,
  error_code: null,
  queued_at: "2026-10-27T00:00:00Z",
  started_at: null,
  finished_at: null,
  created_at: "2026-10-27T00:00:00Z",
  revision: { revision: 1 },
  profile,
  score_factors: [],
  qualification_checks: [],
  requirement_assessments: [],
});

const repo = createBidsRepo({ runMode: "mock", algorithmVersion: "v0.1" });

beforeEach(() => {
  db.row = null;
  db.selects = [];
});

describe("분석 조회의 profileIsDemo", () => {
  it("프로필 embed 를 company_profiles 의 is_demo 로 요청한다", async () => {
    db.row = runRow({ is_demo: true });
    await repo.getAnalysis("org-1", "run-1");
    expect(db.selects[0]).toContain(
      "profile:company_profiles!score_runs_company_profile_fkey(is_demo)",
    );
  });

  it("is_demo=false 면 profileIsDemo 는 false 다", async () => {
    db.row = runRow({ is_demo: false });
    expect((await repo.getAnalysis("org-1", "run-1"))?.profileIsDemo).toBe(false);
  });

  it("is_demo=true 면 true 다", async () => {
    db.row = runRow({ is_demo: true });
    expect((await repo.getAnalysis("org-1", "run-1"))?.profileIsDemo).toBe(true);
  });

  it("embed 가 null 이면 알 수 없으므로 true(가상)로 읽는다", async () => {
    db.row = runRow(null);
    expect((await repo.getAnalysis("org-1", "run-1"))?.profileIsDemo).toBe(true);
  });
});
