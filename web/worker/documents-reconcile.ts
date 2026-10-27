import { enqueueDocuments, type JobQueue, type PendingDocumentFinder } from "@/server/ingestion";
import { errorNameOf } from "@/worker/error-name";

type DocumentsReconcileDeps = {
  finder: PendingDocumentFinder;
  queue: JobQueue;
  /** 실행 모드 범위(C6'). mock·fixture 는 true(데모 공고만), live 는 false(실제 공고만) */
  isDemo: boolean;
  /** 회차당 조회 상한. 없으면 100(전체 worker 의 mock·fixture 복구). documents 소비자는 DOCUMENTS_ROUND_MAX_REVISIONS 를 준다 */
  batchLimit?: number;
  log: (line: string) => void;
};

// DB에 남은 PENDING 행이 기준이다. 수집 run의 완료 여부·메모리 saved 배열에 기대지 않는다.
const BATCH_LIMIT = 100;
const INTERVAL_MS = 60_000;

export async function reconcileDocumentsOnce(
  deps: DocumentsReconcileDeps,
  after: string | null = null,
) {
  const limit = deps.batchLimit ?? BATCH_LIMIT;
  const documents = await deps.finder.findPendingDocuments({
    after,
    limit,
    isDemo: deps.isDemo,
  });
  const seen = new Set<string>();
  let queued = 0;
  let failed = 0;
  for (const document of documents) {
    if (seen.has(document.revisionId)) continue;
    seen.add(document.revisionId);
    try {
      await enqueueDocuments(deps.queue, {
        bidId: document.bidId,
        revisionId: document.revisionId,
        revisionCreatedAt: document.revisionCreatedAt,
      });
      queued += 1;
    } catch (error) {
      failed += 1;
      deps.log(
        JSON.stringify({
          event: "documents.reconcile.failed",
          revisionId: document.revisionId,
          errorName: errorNameOf(error),
        }),
      );
    }
  }
  return {
    checked: documents.length,
    queued,
    failed,
    nextCursor: documents.length === limit ? (documents.at(-1)?.id ?? null) : null,
  };
}

export function startDocumentsReconciler(deps: DocumentsReconcileDeps) {
  let after: string | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  const round = () => {
    if (stopped || running !== null) return;
    running = reconcileDocumentsOnce(deps, after)
      .then(
        (summary) => {
          after = summary.nextCursor;
          deps.log(JSON.stringify({ event: "documents.reconcile", ...summary }));
        },
        (error: unknown) => {
          deps.log(
            JSON.stringify({ event: "documents.reconcile.failed", errorName: errorNameOf(error) }),
          );
        },
      )
      .finally(() => {
        running = null;
      });
  };
  round();
  const timer = setInterval(round, INTERVAL_MS);
  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (running !== null) await running;
    },
  };
}
