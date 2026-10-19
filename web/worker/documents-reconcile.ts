import { enqueueDocuments, type JobQueue, type PendingDocumentFinder } from "@/server/ingestion";
import { errorNameOf } from "@/worker/error-name";

type DocumentsReconcileDeps = {
  finder: PendingDocumentFinder;
  queue: JobQueue;
  log: (line: string) => void;
};

// DB에 남은 PENDING 행이 기준이다. 수집 run의 완료 여부·메모리 saved 배열에 기대지 않는다.
const BATCH_LIMIT = 100;
const INTERVAL_MS = 60_000;

export async function reconcileDocumentsOnce(
  deps: DocumentsReconcileDeps,
  after: string | null = null,
) {
  const documents = await deps.finder.findPendingDocuments({ after, limit: BATCH_LIMIT });
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
    nextCursor: documents.length === BATCH_LIMIT ? (documents.at(-1)?.id ?? null) : null,
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
