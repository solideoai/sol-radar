import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { FixtureFile } from "./fixture.model";
import { createSupabaseIngestionRepo, type SaveRevisionInput } from "./ingestion.repo";
import { normalizeFixtureRecord } from "./normalize";
import { mergeG2bAux } from "./normalize-g2b-aux";
import { decideRevision } from "./revision";

// Supabase 수집 저장소의 saveRevision(C1'). RPC ingest_save_revision 은 (bid_id, revision_id) 만 돌려주므로,
// documents jobId 에 쓸 created_at 은 저장한 bid_revisions 행에서 따로 읽는다.
// 진짜 supabase-js 에 가짜 fetch 를 넣어 요청을 잡는다. 실제 Supabase 에 붙지 않는다.

const FIXTURES_DIR = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
const BID_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const REVISION_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
// PostgREST 가 timestamptz 를 돌려주는 모양
const CREATED_AT = "2026-10-19T03:04:05.123456+00:00";

type Route = { status: number; body: unknown };
type Routes = { rpc: Route; revision: Route; structured?: Route; runs?: Route };
type Recorded = {
  method: string;
  url: URL;
  accept: string | null;
  prefer: string | null;
  body: unknown;
};

const OK_ROUTES: Routes = {
  rpc: { status: 200, body: [{ bid_id: BID_ID, revision_id: REVISION_ID }] },
  revision: { status: 200, body: { created_at: CREATED_AT } },
  structured: { status: 201, body: [] },
  runs: { status: 204, body: null },
};
const RUN_ID = "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f";

const recordingRepo = (routes: Routes = OK_ROUTES) => {
  const requests: Recorded[] = [];
  const client = createClient<Database>("https://supabase.example.invalid", "fake-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        requests.push({
          method: init?.method ?? "GET",
          url,
          accept: headers.get("Accept"),
          prefer: headers.get("Prefer"),
          body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        });
        const notFound = {
          status: 404,
          body: { code: "PGRST000", message: `가짜에 없는 경로 ${url.pathname}` },
        };
        const route =
          url.pathname === "/rest/v1/rpc/ingest_save_revision"
            ? routes.rpc
            : url.pathname === "/rest/v1/bid_revisions"
              ? routes.revision
              : url.pathname === "/rest/v1/bid_structured_requirements"
                ? (routes.structured ?? notFound)
                : url.pathname === "/rest/v1/ingest_runs"
                  ? (routes.runs ?? notFound)
                  : notFound;
        return new Response(route.body === null ? null : JSON.stringify(route.body), {
          status: route.status,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  });
  return { repo: createSupabaseIngestionRepo(client), requests, client };
};

/** FX-06 SEED 레코드를 정규화해 revision 1(CREATED)로 저장하는 입력 */
const seedInput = async (): Promise<SaveRevisionInput> => {
  const file: FixtureFile = JSON.parse(
    await readFile(join(FIXTURES_DIR, "bids", "FX-06.json"), "utf8"),
  );
  const record = file.records.find((candidate) => candidate.ingestBatch === "SEED");
  if (!record) throw new Error("FX-06 에 SEED 레코드가 없다");
  const outcome = normalizeFixtureRecord(record, {
    fetchedAt: new Date("2026-10-19T09:00:00.000Z"),
    anchor: new Date("2026-10-19T03:00:00.000Z"),
  });
  if (!outcome.ok) throw new Error(`FX-06 정규화 실패: ${outcome.issue.code}`);
  const decision = decideRevision(null, outcome.draft);
  if (decision.kind === "DUPLICATE" || decision.kind === "STALE") {
    throw new Error(`저장할 결정이 아니다: ${decision.kind}`);
  }
  return { decision, rawPayload: { fixtureId: "FX-06", ...record } };
};

// FX-06 r1 에 보조 조회 행(면허제한 1·지역 1·e발주 첨부 1)을 합친 입력. 값은 가상이다.
const seedInputWithAux = async (): Promise<SaveRevisionInput> => {
  const base = await seedInput();
  const draft = mergeG2bAux(base.decision.bid, {
    licenseLimit: [
      { bidNtceNo: "FX-06", lmtGrpNo: "1", lmtSno: "1", lcnsLmtNm: "정보통신공사업/0036" },
    ],
    region: [{ bidNtceNo: "FX-06", lmtSno: "1", prtcptPsblRgnNm: "대구광역시" }],
    eorderAttach: [],
  });
  const decision = decideRevision(null, draft);
  if (decision.kind === "DUPLICATE" || decision.kind === "STALE")
    throw new Error("저장할 결정이 아니다");
  return { ...base, decision };
};

const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("reject 하지 않았다");
    },
    (error: unknown) => error,
  );

describe("createSupabaseIngestionRepo.saveRevision — revisionCreatedAt(C1')", () => {
  it("RPC 의 bid_id·revision_id 와 bid_revisions 의 created_at 을 돌려준다", async () => {
    const { repo } = recordingRepo();

    await expect(repo.saveRevision(await seedInput())).resolves.toStrictEqual({
      bidId: BID_ID,
      revisionId: REVISION_ID,
      revisionCreatedAt: CREATED_AT,
    });
  });

  it("RPC 를 부른 뒤 저장한 revision 행 하나를 id·bid_id 로 읽는다", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveRevision(await seedInput());

    expect(
      requests.map(({ method, url }) => ({
        method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
      })),
    ).toEqual([
      { method: "POST", path: "/rest/v1/rpc/ingest_save_revision", query: {} },
      {
        method: "GET",
        path: "/rest/v1/bid_revisions",
        query: { select: "created_at", id: `eq.${REVISION_ID}`, bid_id: `eq.${BID_ID}` },
      },
    ]);
  });

  it("bid_revisions 는 단일 행으로 읽는다(행이 정확히 하나가 아니면 PostgREST 가 오류를 돌려준다)", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveRevision(await seedInput());

    expect(requests[1]?.accept).toBe("application/vnd.pgrst.object+json");
  });

  it.each([
    [
      "행이 없음(406 PGRST116)",
      { status: 406, body: { code: "PGRST116", message: "SECRET-ROW 0 rows" } },
    ],
    [
      "서버 오류(500)",
      { status: 500, body: { code: "XX000", message: "SECRET-ROW value", details: "SECRET" } },
    ],
  ])("bid_revisions 조회가 %s 면 표 이름·코드만 담아 던진다", async (_label, revision) => {
    const { repo } = recordingRepo({ ...OK_ROUTES, revision });

    const error = await rejectionOf(repo.saveRevision(await seedInput()));

    const message = error instanceof Error ? error.message : "";
    expect(message).toBe(`수집 저장소: bid_revisions 조회 실패 (${revision.body.code})`);
    expect(message).not.toContain("SECRET");
  });

  it("RPC 가 실패하면 bid_revisions 를 읽지 않고 던진다", async () => {
    const { repo, requests } = recordingRepo({
      ...OK_ROUTES,
      rpc: { status: 500, body: { code: "XX000", message: "boom" } },
    });

    await expect(repo.saveRevision(await seedInput())).rejects.toThrow(
      "수집 저장소: ingest_save_revision 실패",
    );
    expect(requests.map(({ url }) => url.pathname)).toEqual(["/rest/v1/rpc/ingest_save_revision"]);
  });
});

describe("createSupabaseIngestionRepo.saveRevision — bid_structured_requirements(보조 조회 결과)", () => {
  it("구조화 자격이 없으면 bid_structured_requirements 에 요청하지 않는다", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveRevision(await seedInput());

    expect(requests.map(({ url }) => url.pathname)).not.toContain(
      "/rest/v1/bid_structured_requirements",
    );
  });

  it("구조화 자격이 있으면 RPC·created_at 조회 뒤 (revision_id, kind, seq) 충돌을 덮어쓰는 upsert 를 보낸다", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveRevision(await seedInputWithAux());

    const upsert = requests.at(-1);
    expect([
      requests.map(({ url }) => url.pathname),
      upsert?.method,
      upsert?.url.searchParams.get("on_conflict"),
      upsert?.prefer?.includes("resolution=merge-duplicates"),
    ]).toEqual([
      [
        "/rest/v1/rpc/ingest_save_revision",
        "/rest/v1/bid_revisions",
        "/rest/v1/bid_structured_requirements",
      ],
      "POST",
      "revision_id,kind,seq",
      true,
    ]);
  });

  it("upsert 본문은 RPC 가 돌려준 bid_id·revision_id 와 seq 0·1 의 행이다", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveRevision(await seedInputWithAux());

    expect(requests.at(-1)?.body).toEqual([
      {
        bid_id: BID_ID,
        revision_id: REVISION_ID,
        kind: "LICENSE_LIMIT",
        seq: 0,
        code: "0036",
        name: "정보통신공사업",
        value: { bidNtceNo: "FX-06", lmtGrpNo: "1", lmtSno: "1", lcnsLmtNm: "정보통신공사업/0036" },
        source_operation: "getBidPblancListInfoLicenseLimit",
      },
      {
        bid_id: BID_ID,
        revision_id: REVISION_ID,
        kind: "PARTICIPATION_REGION",
        seq: 1,
        code: null,
        name: "대구광역시",
        value: { bidNtceNo: "FX-06", lmtSno: "1", prtcptPsblRgnNm: "대구광역시" },
        source_operation: "getBidPblancListInfoPrtcptPsblRgn",
      },
    ]);
  });

  it("upsert 가 실패하면 표 이름·코드만 담아 던진다", async () => {
    const { repo } = recordingRepo({
      ...OK_ROUTES,
      structured: {
        status: 409,
        body: { code: "23503", message: "SECRET-ROW", details: "SECRET" },
      },
    });

    const error = await rejectionOf(repo.saveRevision(await seedInputWithAux()));

    const message = error instanceof Error ? error.message : "";
    expect(message).toBe("수집 저장소: bid_structured_requirements 저장 실패 (23503)");
    expect(message).not.toContain("SECRET");
  });
});

describe("createSupabaseIngestionRepo — ingest_runs.quota_used", () => {
  const SUMMARY = {
    created: 1,
    changed: 0,
    cancelled: 0,
    skippedDuplicate: 0,
    quarantined: 0,
    retried: 0,
  };

  it("saveCheckpoint 에 quotaUsed 를 주면 quota_used 를 함께 갱신한다", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveCheckpoint(RUN_ID, { cursor: "0:2", summary: SUMMARY, quotaUsed: 4 });

    expect([
      requests[0]?.method,
      requests[0]?.url.searchParams.get("id"),
      requests[0]?.body,
    ]).toEqual(["PATCH", `eq.${RUN_ID}`, { cursor: "0:2", summary: SUMMARY, quota_used: 4 }]);
  });

  it("saveCheckpoint 에 quotaUsed 가 없으면(fixture) quota_used 를 건드리지 않는다", async () => {
    const { repo, requests } = recordingRepo();

    await repo.saveCheckpoint(RUN_ID, { cursor: null, summary: SUMMARY });

    expect(requests[0]?.body).toEqual({ cursor: null, summary: SUMMARY });
  });

  it("finishRun 에 quotaUsed 를 주면 status·summary·finished_at 과 함께 quota_used 를 갱신한다", async () => {
    const now = new Date("2026-10-19T09:30:00.000Z");
    const client = recordingRepo();
    const repo = createSupabaseIngestionRepo(client.client, { now: () => now });

    await repo.finishRun(RUN_ID, { status: "SUCCEEDED", summary: SUMMARY, quotaUsed: 7 });

    expect(client.requests[0]?.body).toEqual({
      status: "SUCCEEDED",
      summary: SUMMARY,
      finished_at: now.toISOString(),
      quota_used: 7,
    });
  });
});
