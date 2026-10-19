import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createPendingDocumentFinder } from "@/server/ingestion";
import { reconcileDocumentsOnce, startDocumentsReconciler } from "@/worker/documents-reconcile";

const BID = "00000000-0000-4000-8000-000000000001";
const REV = "00000000-0000-4000-8000-000000000002";
const DOC = "00000000-0000-4000-8000-000000000003";
const document = (id = DOC, revisionId = REV) => ({ id, bidId: BID, revisionId });
const quietLog = () => undefined;

afterEach(() => vi.useRealTimers());

describe("documents 등록 복구", () => {
  it("DB에 남은 첨부를 첫 큐 장애 뒤에도 다시 등록한다", async () => {
    let unavailable = true;
    const jobs = new Map<string, unknown>();
    const deps = {
      finder: { findPendingDocuments: async () => [document()] },
      queue: {
        add: async (_name: string, data: unknown, options: { jobId: string }) => {
          if (unavailable) throw new Error("redis://:secret@example.invalid");
          jobs.set(options.jobId, data);
        },
      },
      log: quietLog,
    };
    expect(await reconcileDocumentsOnce(deps)).toMatchObject({ failed: 1 });
    unavailable = false;
    expect(await reconcileDocumentsOnce(deps)).toMatchObject({ queued: 1, failed: 0 });
    expect([...jobs.entries()]).toEqual([[`documents-${REV}`, { bidId: BID, revisionId: REV }]]);
    await reconcileDocumentsOnce(deps);
    expect(jobs.size).toBe(1);
  });

  it("같은 revision의 여러 첨부는 한 번 등록하고 다른 revision도 보존한다", async () => {
    const enqueued: unknown[] = [];
    const otherRevision = "00000000-0000-4000-8000-000000000004";
    const result = await reconcileDocumentsOnce({
      finder: {
        findPendingDocuments: async () => [
          document(),
          document("doc-2"),
          document("doc-3", otherRevision),
        ],
      },
      queue: {
        add: async (_name, data) => {
          enqueued.push(data);
        },
      },
      log: quietLog,
    });
    expect(result).toMatchObject({ checked: 3, queued: 2 });
    expect(enqueued).toEqual([
      { bidId: BID, revisionId: REV },
      { bidId: BID, revisionId: otherRevision },
    ]);
  });

  it("앞 100건의 job이 남아 있어도 다음 페이지로 진행한다", async () => {
    const afters: (string | null)[] = [];
    const enqueued: unknown[] = [];
    const firstPage = Array.from({ length: 100 }, (_, index) => document(`doc-${index}`));
    const deps = {
      finder: {
        findPendingDocuments: async ({ after }: { after: string | null }) => {
          afters.push(after);
          return after === null
            ? firstPage
            : [document("tail", "00000000-0000-4000-8000-000000000005")];
        },
      },
      queue: {
        add: async (_name: string, data: unknown) => {
          enqueued.push(data);
        },
      },
      log: quietLog,
    };
    const first = await reconcileDocumentsOnce(deps);
    const second = await reconcileDocumentsOnce(deps, first.nextCursor);
    expect(afters).toEqual([null, "doc-99"]);
    expect(second.nextCursor).toBeNull();
    expect(enqueued).toContainEqual({
      bidId: BID,
      revisionId: "00000000-0000-4000-8000-000000000005",
    });
  });

  it("기동 시와 매분 실행하고 장애 뒤 다음 회차에 복구하며 종료 뒤에는 실행하지 않는다", async () => {
    vi.useFakeTimers();
    const jobs: unknown[] = [];
    let fail = true;
    let reads = 0;
    const handle = startDocumentsReconciler({
      finder: {
        findPendingDocuments: async () => {
          reads += 1;
          if (fail) throw new Error("db secret");
          return [document()];
        },
      },
      queue: {
        add: async (_name, data) => {
          jobs.push(data);
        },
      },
      log: quietLog,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(reads).toBe(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobs).toHaveLength(1);
    await handle.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobs).toHaveLength(1);
  });

  it("진행 중인 회차와 겹치지 않고 종료 시 등록 완료를 기다린다", async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reads = 0;
    const jobs: unknown[] = [];
    const handle = startDocumentsReconciler({
      finder: {
        findPendingDocuments: async () => {
          reads += 1;
          return [document()];
        },
      },
      queue: {
        add: async (_name, data) => {
          await blocked;
          jobs.push(data);
        },
      },
      log: quietLog,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(reads).toBe(1);
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(jobs).toEqual([{ bidId: BID, revisionId: REV }]);
  });

  it("DB·Redis 오류 본문을 로그에 싣지 않는다", async () => {
    const lines: string[] = [];
    await reconcileDocumentsOnce({
      finder: { findPendingDocuments: async () => [document()] },
      queue: {
        add: async () => {
          throw new Error("redis://:secret@example.invalid");
        },
      },
      log: (line) => {
        lines.push(line);
      },
    });
    expect(lines.join("\n")).toContain("Error");
    expect(lines.join("\n")).not.toContain("secret");
  });
});

describe("저장된 미처리 첨부 조회", () => {
  it("PENDING을 ID 순·상한·커서로 읽고 저장이 끝난 run에 의존하지 않는다", async () => {
    const requests: URL[] = [];
    const client = createClient<Database>("https://supabase.example.invalid", "fake-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          requests.push(new URL(String(input)));
          return new Response(JSON.stringify([{ id: DOC, bid_id: BID, revision_id: REV }]), {
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });
    const found = await createPendingDocumentFinder(client).findPendingDocuments({
      after: "previous",
      limit: 100,
    });
    expect(found).toEqual([document()]);
    expect(requests[0].pathname).toBe("/rest/v1/bid_documents");
    expect(Object.fromEntries(requests[0].searchParams)).toMatchObject({
      download_status: "eq.PENDING",
      id: "gt.previous",
      order: "id.asc",
      limit: "100",
    });
  });
});
