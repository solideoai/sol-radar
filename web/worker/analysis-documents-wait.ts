import type { DocumentIssue, LoadedAnalysisContext, RunMode } from "@/server/analysis";
import { pendingDocumentsOf, type DocumentProcessingRepo } from "@/server/documents";

// ── 분석이 첨부 처리를 기다린다(ADR-056 대안 A, 10-21 Redis·Storage 계획 §8.1 bounded dependency) ──
// live 분석은 run 을 잡기(RUNNING) 전에 그 revision 의 처리 범위 안 첨부가 아직 남았는지 본다. 남았으면 active processor
// 안에서 기다리지 않고 BullMQ 지연 재확인으로 넘긴다(run 은 QUEUED 그대로). 분석 요청(score_runs.queued_at)부터 300초가
// 지나면 남은 첨부를 사유(DOCUMENTS_WAIT_TIMEOUT)와 함께 문제 문서로 붙여 부분 입력으로 분석한다(attachmentsIncomplete).
// - 처리 범위는 documents job 과 같은 규칙이다(pendingDocumentsOf = scopeSkipReasonOf + selectDocuments + 처리 전).
//   범위 밖 첨부(ADR-055: 형식 밖·DOCUMENTS_MAX_PER_BID 상한 밖·최신 OPEN/AMENDED 아님·마감 지남)는 영원히 PENDING 이라 기다리지 않는다.
// - mock·fixture 는 documents 소비자가 없어(documents 전용 worker 는 live 에서만 뜬다) 기다리지 않는다. live 의 DEMO 공고(is_demo=true)도
//   documents 가 처리하지 않는 범위라 기다리지 않는다.
// - 추출 캐시 키는 그대로다(대안 B 아님). 기다린 뒤에도 늦게 끝난 첨부는 같은 revision 의 캐시 추출에 들어가지 않는다.

/** 분석 요청부터 기다리는 상한. QUEUED 복구 기준(ANALYSIS_STALE_QUEUED_MS 기본 600초)보다 짧다. 기다리는 job 은 delayed 라 복구가 건드리지 않는다 */
export const DOCUMENTS_WAIT_MAX_MS = 300_000;
/** 다시 볼 간격. 문서 하나의 /parse 가 길면 185초라 그보다 잘게 본다 */
export const DOCUMENTS_RECHECK_MS = 30_000;
/** 기다려도 끝나지 않은 문서의 사유(documentIssues[].errorCode) */
export const DOCUMENTS_WAIT_TIMEOUT = "DOCUMENTS_WAIT_TIMEOUT";

export type DocumentsWaitPort = {
  repo: Pick<DocumentProcessingRepo, "loadRevision">;
  /** documents worker 와 같은 DOCUMENTS_MAX_PER_BID. 다르면 범위가 어긋난다(더 크면 처리하지 않을 문서를 300초까지 기다린다) */
  maxPerBid: number;
};

export type DocumentsWaitDecision =
  | { kind: "PROCEED"; loaded: LoadedAnalysisContext; timedOut: number }
  | { kind: "WAIT"; resumeAt: number; pending: number };

type PendingDocument = { id: string; downloadStatus: string; parseStatus: string | null };

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** 기다려도 끝나지 않은 문서를 문제 문서로 붙인다. 공고 요약에도 attachmentsIncomplete 를 단다(loader 가 문제 문서에 다는 것과 같다) */
export function withTimedOutDocuments(
  loaded: LoadedAnalysisContext,
  pending: readonly PendingDocument[],
): LoadedAnalysisContext {
  if (pending.length === 0) return loaded;
  const timedOut: DocumentIssue[] = pending.map((document) => ({
    documentId: document.id,
    downloadStatus: document.downloadStatus,
    parseStatus: document.parseStatus ?? "NOT_PARSED",
    errorCode: DOCUMENTS_WAIT_TIMEOUT,
  }));
  return {
    ...loaded,
    bid: { ...loaded.bid, attachmentsIncomplete: true },
    documentIssues: [...loaded.documentIssues, ...timedOut].toSorted((left, right) =>
      compareText(left.documentId, right.documentId),
    ),
  };
}

/** 남은 문서·분석 요청 시각·지금으로 정한다. 마지막 재확인은 상한 시각에 맞춘다 */
export function toDocumentsWaitDecision(
  loaded: LoadedAnalysisContext,
  pending: readonly PendingDocument[],
  now: Date,
): DocumentsWaitDecision {
  if (pending.length === 0) return { kind: "PROCEED", loaded, timedOut: 0 };
  const deadline = Date.parse(loaded.queuedAt) + DOCUMENTS_WAIT_MAX_MS;
  const nowMs = now.getTime();
  if (nowMs < deadline)
    return {
      kind: "WAIT",
      resumeAt: Math.min(nowMs + DOCUMENTS_RECHECK_MS, deadline),
      pending: pending.length,
    };
  return {
    kind: "PROCEED",
    loaded: withTimedOutDocuments(loaded, pending),
    timedOut: pending.length,
  };
}

export async function decideDocumentsWait(
  port: DocumentsWaitPort | null,
  runMode: RunMode,
  loaded: LoadedAnalysisContext,
  now: Date,
): Promise<DocumentsWaitDecision> {
  if (port === null || runMode !== "live") return { kind: "PROCEED", loaded, timedOut: 0 };
  const revision = await port.repo.loadRevision({
    bidId: loaded.bidId,
    revisionId: loaded.bid.revisionId,
  });
  // live 의 documents 소비자는 실제 공고(is_demo=false)만 처리한다(documents-job.ts expectDemo).
  const pending = revision === null ? [] : pendingDocumentsOf(revision, port.maxPerBid, false, now);
  return toDocumentsWaitDecision(loaded, pending, now);
}
