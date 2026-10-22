import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BidSourceConnector } from "./connector.model";
import { createSupabaseIngestionRepo } from "./ingestion.repo";
import { createMemoryIngestionRepo } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { createExternalSourceConnector } from "./external-api-connector";
import { linkStages } from "./stage-link";

const now = () => new Date("2026-10-21T03:00:00.000Z");
const valid = {
  companyId: "COM01",
  no: "0001",
  name: "AI 분석 용역",
  progressState: "AttendProgress",
  endDatetime: "2026-10-22 18:00:00",
};
const window = { from: "2026-10-20T00:00:00.000Z", to: "2026-10-21T00:00:00.000Z" };
const retry = { sleep: async () => undefined, random: () => 0 };

describe("external ingestion persistence", () => {
  it("persists no revision or event for elapsed time, but saves a supplier-only change with evidence", async () => {
    const repo = createMemoryIngestionRepo();
    let item = {
      ...valid,
      progressState: "PreAttendProgress",
      bidAttendReqBeginDatetime: "2026-10-22 09:00:00",
      bidAttendReqCloseDatetime: "2026-10-22 18:00:00",
      placeName: "서울",
    };
    const connector: BidSourceConnector = {
      source: "kepco",
      fetchPage: async () => ({
        ok: true,
        page: {
          records: [{ kind: "external", sourceKey: "kepco-ebid-contract", item }],
          nextCursor: null,
          rateLimitInfo: null,
          completeness: "COMPLETE",
          capture: {
            serviceKey: "kepco-ebid-contract",
            operation: "electContract",
            partitionKey: "COM01",
            contentType: "application/json",
            sanitizedPayload: JSON.stringify({ data: [item] }),
          },
        },
      }),
    };
    const runAt = (jobKey: string, at: string) =>
      runIngest({
        repo,
        connector,
        run: {
          source: "kepco",
          serviceKey: "kepco-ebid-contract",
          operation: "electContract",
          partitionKey: "COM01",
          runMode: "LIVE",
          trigger: "SCHEDULED",
          batch: null,
          params: { window },
          jobKey,
        },
        now: () => new Date(at),
        retry,
      });
    expect(await runAt("f09-before", "2026-10-22T08:59:00+09:00")).toMatchObject({
      summary: { created: 1, changed: 0 },
    });
    expect(await runAt("f09-after", "2026-10-22T09:01:00+09:00")).toMatchObject({
      summary: { created: 0, changed: 0, skippedDuplicate: 1 },
    });
    expect(repo.state.revisions).toHaveLength(1);
    expect(repo.state.outbox.map(({ type }) => type)).toEqual(["BID_CREATED"]);
    item = { ...item, placeName: "부산" };
    expect(await runAt("f09-provider-change", "2026-10-22T09:02:00+09:00")).toMatchObject({
      summary: { changed: 1 },
    });
    expect(repo.state.revisions).toHaveLength(2);
    expect(repo.state.revisions[1].changes).toContainEqual({
      field: "sourceMetadata",
      before: expect.objectContaining({ attributes: { placeName: "서울" } }),
      after: expect.objectContaining({ attributes: { placeName: "부산" } }),
    });
    expect(repo.state.outbox.map(({ type }) => type)).toEqual(["BID_CREATED", "BID_CHANGED"]);
  });

  it("reads historical untagged G2B bid windows without widening new service scopes", async () => {
    const requests: URL[] = [];
    const client = createClient<Database>("https://ingestion.invalid", "test-only-placeholder", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: async (url, init) => {
          requests.push(new URL(new Request(url, init).url));
          return Response.json([
            { status: "SUCCEEDED", params: { window }, completeness: "COMPLETE" },
          ]);
        },
      },
    });
    const repo = createSupabaseIngestionRepo(client);
    expect(
      await repo.findLatestRunWindow("g2b", "SCHEDULED", { serviceKey: "g2b-bid-notice" }),
    ).toMatchObject({ window });
    expect(
      (
        await repo.findLatestRunWindowEnd("g2b", "SCHEDULED", {
          serviceKey: "g2b-bid-notice",
        })
      )?.toISOString(),
    ).toBe(window.to);
    await repo.findLatestRunWindowEnd("g2b", "SCHEDULED", {
      serviceKey: "g2b-procurement-request",
      operation: "getPrcrmntReqInfoListServc",
      partitionKey: "request:123",
    });

    for (const request of requests.slice(0, 2)) {
      expect(request.searchParams.get("or")).toBe(
        "(service_key.eq.g2b-bid-notice,service_key.is.null)",
      );
      expect(request.searchParams.has("service_key")).toBe(false);
    }
    expect(requests[1].searchParams.get("completeness")).toBe("eq.COMPLETE");
    expect(requests[2].searchParams.get("service_key")).toBe("eq.g2b-procurement-request");
    expect(requests[2].searchParams.get("operation")).toBe("eq.getPrcrmntReqInfoListServc");
    expect(requests[2].searchParams.get("partition_key")).toBe("eq.request:123");
    expect(requests[2].searchParams.has("or")).toBe(false);
  });

  it("captures quarantined rows and replays incomplete pages without advancing cursor or doubling counts", async () => {
    const repo = createMemoryIngestionRepo();
    const connector: BidSourceConnector = {
      source: "kepco",
      fetchPage: async () => ({
        ok: true,
        page: {
          records: [
            { kind: "external", sourceKey: "kepco-ebid-contract", item: valid },
            {
              kind: "external",
              sourceKey: "kepco-ebid-contract",
              item: { no: "missing-company", name: "격리" },
            },
          ],
          nextCursor: "0:2",
          rateLimitInfo: null,
          completeness: "PARTIAL",
          capture: {
            serviceKey: "kepco-ebid-contract",
            operation: "electContract",
            partitionKey: "COM01",
            contentType: "application/json",
            sanitizedPayload: JSON.stringify({
              data: [valid, { no: "missing-company", name: "격리" }],
            }),
          },
        },
      }),
    };
    const run = {
      source: "kepco" as const,
      serviceKey: "kepco-ebid-contract",
      operation: "electContract",
      partitionKey: "COM01",
      runMode: "LIVE" as const,
      trigger: "SCHEDULED" as const,
      batch: null,
      params: { window },
      jobKey: "external-partial",
    };
    const first = await runIngest({ repo, connector, run, now, retry });
    expect(first).toMatchObject({ status: "PARTIAL", summary: { created: 1, quarantined: 1 } });
    expect(repo.state.payloads).toHaveLength(1);
    expect(repo.state.runItems.map((item) => item.outcome)).toEqual(["CREATED", "QUARANTINED"]);
    expect(repo.state.runs.get(run.jobKey)).toMatchObject({
      cursor: null,
      completeness: "PARTIAL",
    });
    const again = await runIngest({ repo, connector, run, now, retry });
    expect(again.alreadyFinished).toBe(false);
    expect(again.summary).toEqual(first.summary);
    expect(repo.state.payloads).toHaveLength(1);
    expect(repo.state.runItems).toHaveLength(2);
    expect(
      await repo.findLatestRunWindowEnd("kepco", "SCHEDULED", {
        serviceKey: run.serviceKey,
        partitionKey: "COM01",
      }),
    ).toBeNull();
  });

  it("separates successful watermarks by service partition and excludes quarantined partial runs", async () => {
    const repo = createMemoryIngestionRepo();
    const connector: BidSourceConnector = {
      source: "kepco",
      fetchPage: async () => ({
        ok: true,
        page: {
          records: [{ kind: "external", sourceKey: "kepco-ebid-contract", item: valid }],
          nextCursor: null,
          rateLimitInfo: null,
          completeness: "COMPLETE",
          capture: {
            serviceKey: "kepco-ebid-contract",
            operation: "electContract",
            partitionKey: "COM01",
            contentType: "application/json",
            sanitizedPayload: JSON.stringify({ data: [valid] }),
          },
        },
      }),
    };
    const run = {
      source: "kepco" as const,
      serviceKey: "kepco-ebid-contract",
      operation: "electContract",
      partitionKey: "COM01",
      runMode: "LIVE" as const,
      trigger: "SCHEDULED" as const,
      batch: null,
      params: { window },
      jobKey: "external-complete",
    };
    expect((await runIngest({ repo, connector, run, now, retry })).status).toBe("SUCCEEDED");
    expect(
      (
        await repo.findLatestRunWindowEnd("kepco", "SCHEDULED", {
          serviceKey: run.serviceKey,
          partitionKey: "COM01",
        })
      )?.toISOString(),
    ).toBe(window.to);
    expect(
      await repo.findLatestRunWindowEnd("kepco", "SCHEDULED", {
        serviceKey: run.serviceKey,
        partitionKey: "COM02",
      }),
    ).toBeNull();
  });

  it("does not infer chronology for newly introduced stages from a shared plan reference", () => {
    const result = linkStages([
      { bidId: "plan", stage: "PLAN", noticeId: "p1", planRef: "shared", title: "AI 사업" },
      {
        bidId: "request",
        stage: "PROCUREMENT_REQUEST",
        noticeId: "r1",
        planRef: "shared",
        title: "AI 사업",
      },
    ]);
    expect(result.links).toEqual([]);
  });
  it("stores a sanitized gateway failure without exposing an echoed credential", async () => {
    const repo = createMemoryIngestionRepo();
    const secret = "fake-secret+/=";
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: secret,
      fetch: async () =>
        new Response(
          `<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>key=${secret}</returnAuthMsg><apiKey>echoed-value</apiKey></cmmMsgHeader></OpenAPI_ServiceResponse>`,
          { status: 403 },
        ),
    });
    const result = await runIngest({
      repo,
      connector,
      now,
      retry,
      secrets: [secret],
      run: {
        source: "lh",
        serviceKey: "lh-bid-notice",
        runMode: "LIVE",
        trigger: "SCHEDULED",
        batch: null,
        params: { window },
        jobKey: "gateway-failure",
      },
    });
    expect(result.status).toBe("FAILED");
    expect(repo.state.errors.at(-1)?.errorCode).toBe("API_SERVICE_KEY_INVALID");
    expect(repo.state.payloads).toHaveLength(1);
    expect(JSON.stringify(repo.state.payloads)).not.toContain(secret);
    expect(JSON.stringify(repo.state.payloads)).not.toContain("echoed-value");
  });
});
