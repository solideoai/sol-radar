import "server-only";
import type { TablesInsert } from "@/lib/database.types";
import { ALGORITHM_VERSION } from "@/server/scoring";
import type { ScoreRunStatus } from "./analysis-job.model";

// ── 사전 분석(`pnpm demo:preanalyze`, C5-B)의 순수 규칙: 대상 공고 고르기·멱등 키·요약 줄 ──
// 대상 목록은 상수로 박지 않는다. DB 에 적재된 데모 공고(seed 결과)에서 제외 목록만 뺀다.
// 저장·큐·gateway 는 부르지 않는다. 저장 port 의 구현은 analysis.repo 의 createPreanalyzeStore 다.

/**
 * 사전 분석에서 뺄 fixture. 19 §3 사전 준비 5번: "FX-02를 뺀 적재 공고 18건을 전부 미리 분석…
 * FX-02는 NOT_ANALYZED로 남겨 S4에서 라이브 분석". FX-12 는 격리라 적재 공고가 없어 따로 뺄 필요가 없다.
 */
export const PREANALYZE_EXCLUDED_FIXTURES: readonly string[] = ["FX-02"];

/** 데모 조직 솔리데오(19 §1)의 slug. seed(scripts/demo/plan.mjs DEMO_ORGS)와 같다. */
export const DEMO_ORG_SLUG = "org-01";

export type RunState = ScoreRunStatus;

/** 데모 공고의 revision 한 행(bid_revisions + 그 공고의 latest_revision). */
export type DemoBidRow = {
  bidId: string;
  revisionId: string;
  revision: number;
  /** bid_revisions.raw_payload 그대로. fixture 공고면 fixtureId 가 있다. */
  rawPayload: unknown;
  latestRevision: number;
};

export type PreanalyzeTarget = {
  bidId: string;
  revisionId: string;
  fixtureId: string;
  revision: number;
};

/** score_runs 를 만들 때 넘기는 값. */
export type PreanalyzeRunInput = {
  orgId: string;
  bidId: string;
  revisionId: string;
  companyProfileId: string;
  profileRevision: number;
  extractionId: string | null;
  idempotencyKey: string;
};

export type PreanalyzeRun = { id: string; status: ScoreRunStatus };

/**
 * 사전 분석 저장 port. worker 컨테이너에서 service role 로 돈다.
 * 조직 표(company_profiles·score_runs)는 모든 질의·쓰기에 org_id 를 건다.
 */
export type PreanalyzeStore = {
  /** organizations slug=DEMO_ORG_SLUG·is_demo=true 의 id. 없으면 null. */
  findDemoOrg(): Promise<string | null>;
  /** 그 조직의 revision 이 가장 큰 회사 프로필. 없으면 null. */
  latestProfile(orgId: string): Promise<{ id: string; revision: number } | null>;
  /** 데모 fixture 공고(is_demo=true·source=fixture)의 revision 행. 최신 revision 고르기는 selectPreanalyzeTargets 몫이다. */
  listDemoBids(): Promise<DemoBidRow[]>;
  /** 그 revision 의 가장 최근 성공 추출 id. 없으면 null. */
  latestExtractionId(revisionId: string): Promise<string | null>;
  /**
   * idempotency_key 충돌이면 아무것도 바꾸지 않고(on conflict do nothing) 그 키의 run 을 다시 읽어 돌려준다.
   * 다시 읽은 run 이 이 사전 분석의 run 이 아니면(화면 사용자가 넣었거나 다른 입력) 돌려주지 않고 던진다.
   */
  ensureQueuedRun(input: PreanalyzeRunInput): Promise<PreanalyzeRun>;
  /** 그 조직의 run 상태. 없는 id 는 돌려주지 않는다. */
  readStatuses(orgId: string, ids: readonly string[]): Promise<PreanalyzeRun[]>;
};

const RAW_FIXTURE_ID = /^FX-\d{2}$/;

/** raw_payload.fixtureId 가 `^FX-\d{2}$` 면 그 값, 아니면 null. 다른 필드(제목·공고번호)로 추측하지 않는다. */
function rawFixtureIdOf(rawPayload: unknown): string | null {
  if (typeof rawPayload !== "object" || rawPayload === null || Array.isArray(rawPayload)) {
    return null;
  }
  const value: unknown = Reflect.get(rawPayload, "fixtureId");
  return typeof value === "string" && RAW_FIXTURE_ID.test(value) ? value : null;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function byFixtureId(a: PreanalyzeTarget, b: PreanalyzeTarget): number {
  return compareText(a.fixtureId, b.fixtureId) || compareText(a.revisionId, b.revisionId);
}

/**
 * 공고마다 최신 revision(revision = latestRevision) 가운데 raw_payload.fixtureId 가 있고
 * 제외 목록에 없는 것. fixtureId 순. g2b 공고는 raw_payload 에 fixtureId 가 없어 빠진다.
 */
export function selectPreanalyzeTargets(rows: readonly DemoBidRow[]): PreanalyzeTarget[] {
  return rows
    .flatMap((row): PreanalyzeTarget[] => {
      if (row.revision !== row.latestRevision) return [];
      const fixtureId = rawFixtureIdOf(row.rawPayload);
      if (fixtureId === null || PREANALYZE_EXCLUDED_FIXTURES.includes(fixtureId)) return [];
      return [{ bidId: row.bidId, revisionId: row.revisionId, fixtureId, revision: row.revision }];
    })
    .toSorted(byFixtureId);
}

/** `${orgId}:demo-pre-${fixtureId}-r${NN}`. requestId 는 `demo-pre-…` 이다(analysis job 계약). */
export function preanalyzeIdempotencyKey(
  orgId: string,
  target: Pick<PreanalyzeTarget, "fixtureId" | "revision">,
): string {
  return `${orgId}:demo-pre-${target.fixtureId}-r${String(target.revision).padStart(2, "0")}`;
}

/**
 * score_runs 에 넣을 QUEUED 행. 사전 분석은 mock 모드에서만 돈다(CLI 가 gateway /health 로 확인한다).
 * run_mode·ai_provider 는 worker 가 계산을 시작하며 /health 값으로 다시 적는다.
 */
export function toPreanalyzeRunRow(input: PreanalyzeRunInput): TablesInsert<"score_runs"> {
  return {
    org_id: input.orgId,
    bid_id: input.bidId,
    revision_id: input.revisionId,
    company_profile_id: input.companyProfileId,
    profile_revision: input.profileRevision,
    extraction_id: input.extractionId,
    algorithm_version: ALGORITHM_VERSION,
    run_mode: "MOCK",
    ai_provider: "MOCK",
    idempotency_key: input.idempotencyKey,
  };
}

const RUN_STATUSES: readonly ScoreRunStatus[] = [
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "PARTIAL",
  "FAILED",
];

/** score_runs 의 { id, status } 행. status 가 알려진 값이 아니면 null(질의가 틀렸다는 뜻이라 저장 쪽이 던진다). */
export function toPreanalyzeRun(row: { id: string; status: string }): PreanalyzeRun | null {
  const status = RUN_STATUSES.find((candidate) => candidate === row.status);
  return status === undefined ? null : { id: row.id, status };
}

/** bid_revisions 행 + 임베드한 bid_notices 의 latest_revision → DemoBidRow. 공고가 없으면(임베드 null) 뺀다. */
export function toDemoBidRows(
  rows: readonly {
    id: string;
    bid_id: string;
    revision: number;
    raw_payload: unknown;
    notice: { latest_revision: number } | null;
  }[],
): DemoBidRow[] {
  return rows.flatMap((row) =>
    row.notice === null
      ? []
      : [
          {
            bidId: row.bid_id,
            revisionId: row.id,
            revision: row.revision,
            rawPayload: row.raw_payload,
            latestRevision: row.notice.latest_revision,
          },
        ],
  );
}

export type PreanalyzeSummary = {
  targets: number;
  completed: number;
  partial: number;
  failed: number;
  /** 끝나지 않은(QUEUED·RUNNING) run */
  pending: number;
};

/** 대상마다의 마지막 상태를 센다. */
export function summarize(states: readonly RunState[]): PreanalyzeSummary {
  const count = (state: RunState) => states.filter((item) => item === state).length;
  return {
    targets: states.length,
    completed: count("COMPLETED"),
    partial: count("PARTIAL"),
    failed: count("FAILED"),
    pending: count("QUEUED") + count("RUNNING"),
  };
}

/** 마지막 줄. pending 은 적지 않는다(targets 와 나머지 합의 차이로 보인다). */
export function summaryLine(summary: PreanalyzeSummary): string {
  return `preanalyze: targets=${summary.targets} completed=${summary.completed} partial=${summary.partial} failed=${summary.failed}`;
}
