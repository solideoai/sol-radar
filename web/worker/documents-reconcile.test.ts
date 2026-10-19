import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createPendingDocumentFinder, type PendingDocumentFinder } from "@/server/ingestion";
import { reconcileDocumentsOnce, startDocumentsReconciler } from "@/worker/documents-reconcile";

const BID = "00000000-0000-4000-8000-000000000001";
const REV = "00000000-0000-4000-8000-000000000002";
const DOC = "00000000-0000-4000-8000-000000000003";
// bid_revisions.created_at(PostgREST 모양)과 그 epoch ms. documents jobId 는 documents-<rev>-<ms> 다(C1')
const REV_CREATED_AT = "2026-10-19T03:04:05.123456+00:00";
const REV_CREATED_MS = 1_792_379_045_123;
const document = (id = DOC, revisionId = REV, revisionCreatedAt = REV_CREATED_AT) => ({
  id,
  bidId: BID,
  revisionId,
  revisionCreatedAt,
});
const jobData = (revisionId = REV, revisionCreatedAt = REV_CREATED_AT) => ({
  bidId: BID,
  revisionId,
  revisionCreatedAt,
});
const quietLog = () => undefined;
type FinderInput = Parameters<PendingDocumentFinder["findPendingDocuments"]>[0];

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
      isDemo: true,
      log: quietLog,
    };
    expect(await reconcileDocumentsOnce(deps)).toMatchObject({ failed: 1 });
    unavailable = false;
    expect(await reconcileDocumentsOnce(deps)).toMatchObject({ queued: 1, failed: 0 });
    expect([...jobs.entries()]).toEqual([[`documents-${REV}-${REV_CREATED_MS}`, jobData()]]);
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
      isDemo: true,
      log: quietLog,
    });
    expect(result).toMatchObject({ checked: 3, queued: 2 });
    expect(enqueued).toEqual([jobData(), jobData(otherRevision)]);
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
      isDemo: true,
      log: quietLog,
    };
    const first = await reconcileDocumentsOnce(deps);
    const second = await reconcileDocumentsOnce(deps, first.nextCursor);
    expect(afters).toEqual([null, "doc-99"]);
    expect(second.nextCursor).toBeNull();
    expect(enqueued).toContainEqual(jobData("00000000-0000-4000-8000-000000000005"));
  });

  it.each([true, false])("deps.isDemo %s 를 조회에 그대로 넘긴다(C6')", async (isDemo) => {
    const inputs: FinderInput[] = [];
    await reconcileDocumentsOnce(
      {
        finder: {
          findPendingDocuments: async (input) => {
            inputs.push(input);
            return [];
          },
        },
        queue: { add: async () => undefined },
        isDemo,
        log: quietLog,
      },
      "doc-7",
    );
    expect(inputs).toEqual([{ after: "doc-7", limit: 100, isDemo }]);
  });

  it("주기 실행도 deps.isDemo 를 조회에 넘긴다(live 는 false)", async () => {
    vi.useFakeTimers();
    const inputs: FinderInput[] = [];
    const handle = startDocumentsReconciler({
      finder: {
        findPendingDocuments: async (input) => {
          inputs.push(input);
          return [];
        },
      },
      queue: { add: async () => undefined },
      isDemo: false,
      log: quietLog,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await handle.stop();
    expect(inputs.map(({ isDemo }) => isDemo)).toEqual([false, false]);
  });

  it("revision 마다 jobId 에 그 revision 의 created_at(epoch ms)을 싣고 data 에도 싣는다(C1')", async () => {
    const calls: { jobId: string; data: unknown }[] = [];
    const otherRevision = "00000000-0000-4000-8000-000000000004";
    await reconcileDocumentsOnce({
      finder: {
        findPendingDocuments: async () => [
          document(),
          document("doc-2", otherRevision, "2026-10-19T03:10:00.000001+00:00"),
        ],
      },
      queue: {
        add: async (_name, data, options) => {
          calls.push({ jobId: options.jobId, data });
        },
      },
      isDemo: true,
      log: quietLog,
    });
    expect(calls).toEqual([
      { jobId: `documents-${REV}-${REV_CREATED_MS}`, data: jobData() },
      {
        jobId: `documents-${otherRevision}-${Date.UTC(2026, 9, 19, 3, 10, 0, 0)}`,
        data: jobData(otherRevision, "2026-10-19T03:10:00.000001+00:00"),
      },
    ]);
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
      isDemo: true,
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
      isDemo: true,
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
    expect(jobs).toEqual([jobData()]);
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
      isDemo: true,
      log: (line) => {
        lines.push(line);
      },
    });
    expect(lines.join("\n")).toContain("Error");
    expect(lines.join("\n")).not.toContain("secret");
  });
});

describe("저장된 미처리 첨부에서 documents 등록까지", () => {
  // 진짜 조회(createPendingDocumentFinder)에 가짜 fetch 를 넣는다. DB 가 C2' 조건으로 고른 두 종류의 행을 돌려준 상황이다.
  const DOWNLOAD_PENDING_REV = "00000000-0000-4000-8000-000000000011";
  const PARSE_PENDING_REV = "00000000-0000-4000-8000-000000000012";
  const PARSE_PENDING_CREATED_AT = "2026-10-19T03:10:00.000001+00:00";

  it("다운로드 OK·파싱 PENDING 행도 다운로드 PENDING 행과 같이 재등록한다(C2')", async () => {
    const requests: URL[] = [];
    const client = createClient<Database>("https://supabase.example.invalid", "fake-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (input) => {
          requests.push(new URL(String(input)));
          // 다운로드 PENDING 행, 다운로드 OK·파싱 PENDING 행 순이다(select 에 상태 열은 없다)
          const rows = [
            [DOC, DOWNLOAD_PENDING_REV, REV_CREATED_AT],
            ["doc-parse", PARSE_PENDING_REV, PARSE_PENDING_CREATED_AT],
          ].map(([id, revisionId, createdAt]) => ({
            id,
            bid_id: BID,
            revision_id: revisionId,
            bid_notices: { is_demo: true },
            bid_revisions: { created_at: createdAt },
          }));
          return new Response(JSON.stringify(rows), {
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    });
    const enqueued: { jobId: string; data: unknown }[] = [];

    const result = await reconcileDocumentsOnce({
      finder: createPendingDocumentFinder(client),
      queue: {
        add: async (_name, data, options) => {
          enqueued.push({ jobId: options.jobId, data });
        },
      },
      isDemo: true,
      log: quietLog,
    });

    expect(requests[0]?.searchParams.get("or")).toBe(
      "(download_status.eq.PENDING,and(download_status.eq.OK,parse_status.eq.PENDING))",
    );
    expect(result).toMatchObject({ checked: 2, queued: 2, failed: 0 });
    expect(enqueued).toEqual([
      {
        jobId: `documents-${DOWNLOAD_PENDING_REV}-${REV_CREATED_MS}`,
        data: jobData(DOWNLOAD_PENDING_REV),
      },
      {
        jobId: `documents-${PARSE_PENDING_REV}-${Date.UTC(2026, 9, 19, 3, 10, 0, 0)}`,
        data: jobData(PARSE_PENDING_REV, PARSE_PENDING_CREATED_AT),
      },
    ]);
  });
});
