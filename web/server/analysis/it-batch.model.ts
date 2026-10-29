import "server-only";
import type { TablesInsert } from "@/lib/database.types";
import { ALGORITHM_VERSION } from "@/server/scoring";
import type { ScoreRunStatus } from "./analysis-job.model";

// ── IT 공고 1회 일괄 분석(`pnpm it:batch-analyze`, ADR-069)의 순수 규칙: 원문 판정·멱등 키·run 행 ──
// 대상은 DB(opportunity_list_items 의 it_scope)에서 고르고 목록을 박지 않는다. 저장 port 의 구현은 analysis.repo 의 createItBatchStore 다.
// 사전 분석(preanalyze.model)과 달리 실공고를 live·local 로 분석하므로 분석할 원문이 있는 공고만 넣는다.

export type ItBatchTarget = { bidId: string; revisionId: string; revision: number };

/** 대상 후보 한 건: 최신 revision 과 그 정규화 본문(normalized->>content). */
export type ItBatchCandidate = ItBatchTarget & { content: unknown };

/** score_runs 를 만들 때 넘기는 값. */
export type ItBatchRunInput = {
  orgId: string;
  bidId: string;
  revisionId: string;
  companyProfileId: string;
  profileRevision: number;
  idempotencyKey: string;
};

/** created 는 이번 호출이 행을 새로 넣었는가. false 면 같은 키나 같은 입력의 진행 중 run 이 이미 있었다. */
export type ItBatchRun = { id: string; status: ScoreRunStatus; created: boolean };

/**
 * 일괄 분석 저장 port. worker 컨테이너에서 service role 로 돈다.
 * 조직 표(company_profiles·score_runs)는 모든 질의·쓰기에 org_id 를 건다.
 */
export type ItBatchStore = {
  /** organizations slug 의 id. 없으면 null. */
  findOrgBySlug(slug: string): Promise<string | null>;
  /** 그 조직의 revision 이 가장 큰 회사 프로필. 없으면 null. */
  latestProfile(orgId: string): Promise<{ id: string; revision: number } | null>;
  /**
   * asOf 에 마감 전인 IT 범위 실공고 가운데 최신 프로필 분석 결과가 없는 것(마감 임박 순).
   * 분석할 원문이 있으면 ready, 없으면 skippedNoSource 로 센다(splitBySource).
   */
  listTargets(
    orgId: string,
    asOf: Date,
  ): Promise<{ ready: ItBatchTarget[]; skippedNoSource: number }>;
  /**
   * QUEUED run 을 넣는다. 같은 멱등 키의 run 이 있거나 같은 입력의 진행 중 run 과 부딪히면
   * 아무것도 바꾸지 않고 그 run 을 created=false 로 돌려준다. 같은 키의 run 이 이 일괄 분석의 run 이 아니면 던진다.
   */
  ensureQueuedRun(input: ItBatchRunInput): Promise<ItBatchRun>;
  /** 그 조직의 run 상태. 없는 id 는 돌려주지 않는다. */
  readStatuses(
    orgId: string,
    ids: readonly string[],
  ): Promise<{ id: string; status: ScoreRunStatus }[]>;
};

/**
 * 정규화 본문이 공백이 아닌 글인가. @/server/bids hasSourceBody 와 같은 조건이다
 * (bids 가 이 도메인 배럴을 불러 analysis → bids import 는 순환이라 옮겨 적는다).
 */
const hasSourceBody = (content: unknown): boolean =>
  typeof content === "string" && content.trim() !== "";

/**
 * 화면 [분석]의 원문 준비(@/server/bids analysisReadinessOf)와 같은 규칙으로 나눈다:
 * 본문이 있거나, 분석이 첨부 텍스트를 읽고(readsAttachmentText) 그 revision 에 분석 가능한 첨부가 있으면 ready 다.
 * 순서는 그대로 둔다.
 */
export function splitBySource(
  candidates: readonly ItBatchCandidate[],
  revisionsWithDocument: ReadonlySet<string>,
  readsAttachmentText: boolean,
): { ready: ItBatchTarget[]; skippedNoSource: number } {
  const isReady = (candidate: ItBatchCandidate): boolean =>
    hasSourceBody(candidate.content) ||
    (readsAttachmentText && revisionsWithDocument.has(candidate.revisionId));
  const ready = candidates
    .filter(isReady)
    .map(({ bidId, revisionId, revision }) => ({ bidId, revisionId, revision }));
  return { ready, skippedNoSource: candidates.length - ready.length };
}

/**
 * `${orgId}:it-batch-${bidId}-r${NN}-p${profileRevision}`. requestId 는 `it-batch-…` 이다(analysis job 계약).
 * 회사 프로필을 고친 뒤 다시 돌리면 키가 달라 새로 분석한다.
 */
export function itBatchIdempotencyKey(
  orgId: string,
  target: ItBatchTarget,
  profileRevision: number,
): string {
  const revision = String(target.revision).padStart(2, "0");
  return `${orgId}:it-batch-${target.bidId}-r${revision}-p${profileRevision}`;
}

/**
 * score_runs 에 넣을 QUEUED 행. CLI 가 gateway /health 로 live·local 을 확인한 뒤에만 넣는다.
 * requested_by 는 넣지 않는다(service role 이라 기본값 auth.uid() 가 null).
 * finish_score_run 은 requested_by 가 있을 때만 BID_RECOMMENDED outbox 를 쓰므로 일괄 분석은 알림을 만들지 않는다.
 * extraction_id 는 worker 가 계산을 마치며 적는다.
 */
export function toItBatchRunRow(input: ItBatchRunInput): TablesInsert<"score_runs"> {
  return {
    org_id: input.orgId,
    bid_id: input.bidId,
    revision_id: input.revisionId,
    company_profile_id: input.companyProfileId,
    profile_revision: input.profileRevision,
    extraction_id: null,
    algorithm_version: ALGORITHM_VERSION,
    run_mode: "LIVE",
    ai_provider: "LOCAL",
    idempotency_key: input.idempotencyKey,
  };
}
