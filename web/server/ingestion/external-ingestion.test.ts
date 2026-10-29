import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { BidSourceConnector } from "./connector.model";
import { createSupabaseIngestionRepo } from "./ingestion.repo";
import { createMemoryIngestionRepo } from "./ingestion.repo.memory";
import { createMemoryQuotaStore } from "./quota-store";
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
          // 잘린 쪽(PARTIAL)은 connector 가 다음 cursor 를 주지 않는다(KEPCO 다음 조각만 cursor 를 준다)
          nextCursor: null,
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

  it("advances KEPCO date slices past PARTIAL pages and resumes from the last slice on retry", async () => {
    const repo = createMemoryIngestionRepo();
    const requests: URL[] = [];
    const connector = createExternalSourceConnector({
      sourceKey: "kepco-ebid-contract",
      serviceKey: "fake-kepco-key-".padEnd(40, "x"),
      companyId: "COM01",
      fetch: async (url) => {
        const request = new URL(url);
        requests.push(request);
        const no = request.searchParams.get("noticeBeginDate") === "20260628" ? "0001" : "0002";
        return Response.json({ data: [{ ...valid, no }] });
      },
    });
    // 2026-07-01 ~ 10-09(KST) 에 앞 3일을 더하면 06-28 ~ 10-09, 104일이라 90일 조각 두 개다. KEPCO 는 빠짐없는지 몰라 쪽마다 PARTIAL 이다.
    const run = {
      source: "kepco" as const,
      serviceKey: "kepco-ebid-contract",
      operation: "electContract",
      partitionKey: "COM01",
      runMode: "LIVE" as const,
      trigger: "MANUAL" as const,
      batch: null,
      params: { window: { from: "2026-06-30T15:00:00.000Z", to: "2026-10-09T14:59:00.000Z" } },
      jobKey: "kepco-backfill",
    };
    const first = await runIngest({ repo, connector, run, now, retry });
    expect(requests.map((url) => url.searchParams.get("noticeBeginDate"))).toEqual([
      "20260628",
      "20260926",
    ]);
    expect(first).toMatchObject({ status: "PARTIAL", summary: { created: 2 } });
    expect(repo.state.runs.get(run.jobKey)).toMatchObject({
      cursor: "1:1",
      completeness: "PARTIAL",
    });
    // 같은 run 을 다시 돌리면 첫 조각부터가 아니라 마지막 조각만 다시 받는다(건수를 두 번 세지 않는다).
    const again = await runIngest({ repo, connector, run, now, retry });
    expect(requests.map((url) => url.searchParams.get("noticeBeginDate"))).toEqual([
      "20260628",
      "20260926",
      "20260926",
    ]);
    expect(again.summary.created).toBe(2);
    expect(repo.state.payloads).toHaveLength(2);
  });

  it("exhausts only the failing external service budget on resultCode 22", async () => {
    const repo = createMemoryIngestionRepo();
    const store = createMemoryQuotaStore({ dailyLimit: 1000 });
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "fake-lh-key",
      fetch: async () => {
        calls++;
        return Response.json({
          response: {
            header: { resultCode: "22", resultMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS" },
          },
        });
      },
    });
    const run = (jobKey: string) => ({
      source: "lh" as const,
      serviceKey: "lh-bid-notice",
      runMode: "LIVE" as const,
      trigger: "SCHEDULED" as const,
      batch: null,
      params: { window },
      jobKey,
    });
    const quota = { store, serviceId: "15159012", dailyLimit: 1000 };
    expect((await runIngest({ repo, connector, run: run("lh-1"), now, retry, quota })).status).toBe(
      "FAILED",
    );
    expect(await store.get("15159012", now())).toBeGreaterThanOrEqual(1000);
    // 나라장터 입찰공고(15129394) 예산은 건드리지 않는다
    expect(await store.get("15129394", now())).toBe(0);
    // 같은 날 다음 회차는 API 를 부르지 않고 끝난다
    expect((await runIngest({ repo, connector, run: run("lh-2"), now, retry, quota })).status).toBe(
      "FAILED",
    );
    expect(calls).toBe(1);
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
