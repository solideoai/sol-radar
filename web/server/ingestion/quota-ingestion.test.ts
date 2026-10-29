import { describe, expect, it, vi } from "vitest";
import { createExternalSourceConnector } from "./external-api-connector";
import { createG2bAuxFetcher } from "./g2b-aux";
import { G2B_AUX_OPERATIONS, G2B_BID_NOTICE_LIST_OPERATION } from "./g2b.model";
import { createMemoryIngestionRepo } from "./ingestion.repo.memory";
import { runIngest } from "./ingestion.service";
import { createOfficialApiConnector } from "./official-api-connector";
import { createMemoryQuotaStore } from "./quota-store";

const at = new Date("2026-10-22T03:00:00.000Z");
const window = { from: "2026-10-21T00:00:00.000Z", to: "2026-10-22T00:00:00.000Z" };
const empty = () =>
  Response.json({ response: { header: { resultCode: "00" }, body: { items: [], totalCount: 0 } } });
const retry = { sleep: async () => undefined, random: () => 0 };
const run = (jobKey: string) => ({
  source: "lh" as const,
  serviceKey: "lh-bid-notice",
  operation: "getOpenBidInfo",
  runMode: "LIVE" as const,
  trigger: "SCHEDULED" as const,
  batch: null,
  jobKey,
  params: { window },
});

describe("HTTP attempt quota reservation", () => {
  it("does not send a 503 retry after the final available call", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1 });
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "test-only-key",
      fetch: async () => (++calls === 1 ? new Response("unavailable", { status: 503 }) : empty()),
    });
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector,
      repo,
      run: run("retry-last-slot"),
      now: () => at,
      retry,
      quota: { store, serviceId: "15159012", dailyLimit: 1 },
    });
    expect(calls).toBe(1);
    expect(await store.get("15159012", at)).toBe(1);
    expect(result.status).toBe("FAILED");
    expect(result.summary.retried).toBe(0);
    expect(repo.state.runs.get("retry-last-slot")?.quotaUsed).toBe(1);
  });

  it("shares the final slot between simultaneous manual and scheduled workers", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1 });
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "test-only-key",
      fetch: async () => {
        calls++;
        return empty();
      },
    });
    const results = await Promise.all(
      (["MANUAL", "SCHEDULED"] as const).map((trigger) =>
        runIngest({
          connector,
          repo: createMemoryIngestionRepo(),
          run: { ...run(trigger), trigger },
          now: () => at,
          retry,
          quota: { store, serviceId: "15159012", dailyLimit: 1 },
        }),
      ),
    );
    expect(calls).toBe(1);
    expect(await store.get("15159012", at)).toBe(1);
    expect(results.map((r) => r.status).sort()).toEqual(["FAILED", "SUCCEEDED"]);
  });

  it("charges each successful retry once without post-request addition", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 3 });
    const add = vi.spyOn(store, "add");
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "test-only-key",
      fetch: async () => (++calls === 1 ? new Response("unavailable", { status: 503 }) : empty()),
    });
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector,
      repo,
      run: run("retry-success"),
      now: () => at,
      retry,
      quota: { store, serviceId: "15159012", dailyLimit: 3 },
    });
    expect(calls).toBe(2);
    expect(await store.get("15159012", at)).toBe(2);
    expect(repo.state.runs.get("retry-success")?.quotaUsed).toBe(2);
    expect(result).toMatchObject({ status: "SUCCEEDED", summary: { retried: 1 } });
    expect(add).not.toHaveBeenCalled();
  });

  it.each(["read", "reserve", "retry"] as const)(
    "fails closed when the quota store fails during %s without exposing its error",
    async (phase) => {
      const store = createMemoryQuotaStore({ dailyLimit: 10 });
      const reserve = store.reserve.bind(store);
      let reservations = 0;
      const fail = () => {
        throw new Error("private-connection-detail");
      };
      if (phase === "read") store.get = fail;
      store.reserve = async (serviceId, time) => {
        reservations++;
        if (phase === "reserve" || (phase === "retry" && reservations > 1)) return fail();
        return reserve(serviceId, time);
      };
      let calls = 0;
      const connector = createExternalSourceConnector({
        sourceKey: "lh-bid-notice",
        serviceKey: "test-only-key",
        fetch: async () => {
          calls++;
          return new Response("unavailable", { status: 503 });
        },
      });
      const repo = createMemoryIngestionRepo();
      const result = await runIngest({
        connector,
        repo,
        run: run(phase),
        now: () => at,
        retry,
        quota: { store, serviceId: "15159012", dailyLimit: 10 },
      });
      expect(calls).toBe(phase === "retry" ? 1 : 0);
      expect(result.status).toBe("FAILED");
      expect(repo.state.errors.some((e) => e.errorCode === "QUOTA_STORE_UNAVAILABLE")).toBe(true);
      expect(JSON.stringify(repo.state.errors)).not.toContain("private-connection-detail");
    },
  );

  it("reserves the new KST date when a retry crosses midnight", async () => {
    const before = new Date("2026-10-22T14:59:59Z");
    const after = new Date("2026-10-22T15:00:01Z");
    let clock = before;
    const store = createMemoryQuotaStore({ dailyLimit: 1 });
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "test-only-key",
      fetch: async () => (++calls === 1 ? new Response("unavailable", { status: 503 }) : empty()),
    });
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector,
      repo,
      run: run("midnight"),
      now: () => clock,
      retry: {
        random: () => 0,
        sleep: async () => {
          clock = after;
        },
      },
      quota: { store, serviceId: "15159012", dailyLimit: 1 },
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(calls).toBe(2);
    expect(await store.get("15159012", before)).toBe(1);
    expect(await store.get("15159012", after)).toBe(1);
    expect(repo.state.runs.get("midnight")?.quotaUsed).toBe(2);
  });

  it("reserves the current day again if midnight occurs while Redis responds", async () => {
    const before = new Date("2026-10-22T14:59:59Z");
    const after = new Date("2026-10-22T15:00:01Z");
    let clock = before;
    const store = createMemoryQuotaStore({ dailyLimit: 1 });
    const reserve = store.reserve.bind(store);
    store.reserve = async (serviceId, time) => {
      const result = await reserve(serviceId, time);
      clock = after;
      return result;
    };
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "test-only-key",
      fetch: async () => {
        calls++;
        return empty();
      },
    });
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector,
      repo,
      run: run("reservation-midnight"),
      now: () => clock,
      retry,
      quota: { store, serviceId: "15159012", dailyLimit: 1 },
    });
    expect(result.status).toBe("SUCCEEDED");
    expect(calls).toBe(1);
    expect(await store.get("15159012", before)).toBe(1);
    expect(await store.get("15159012", after)).toBe(1);
    expect(repo.state.runs.get("reservation-midnight")?.quotaUsed).toBe(1);
  });

  it("charges an auxiliary retry to that operation's own budget, not the list budget", async () => {
    // 2026-10-29: 일일 한도는 오퍼레이션마다 따로다(목록·보조 3종 각 dailyLimit). 재시도는 그 오퍼레이션 카운터에 든다.
    const store = createMemoryQuotaStore({ dailyLimit: 2 });
    const operations: string[] = [];
    const item = {
      bidNtceNo: "TEST-001",
      bidNtceOrd: "000",
      bidNtceNm: "데이터 시스템 용역",
      ntceKindNm: "등록공고",
      dminsttNm: "시험기관",
      bidNtceDt: "2026-10-22 09:00:00",
      bidClseDt: "2026-10-23 18:00:00",
      bidNtceDtlUrl: "https://www.g2b.go.kr/pn/test",
    };
    const fetch = async (url: string) => {
      const operation = new URL(url).pathname.split("/").at(-1)!;
      operations.push(operation);
      if (operations.length === 2) return new Response("unavailable", { status: 503 });
      const items = operation === G2B_BID_NOTICE_LIST_OPERATION ? [item] : [];
      return Response.json({
        response: { header: { resultCode: "00" }, body: { items, totalCount: items.length } },
      });
    };
    const config = {
      endpoint: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
      serviceKey: "test-only-key",
      fetch,
    };
    const connector = createOfficialApiConnector({ ...config, isInfoBizNotice: () => true });
    const aux = createG2bAuxFetcher({ ...config, retry });
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector,
      aux,
      repo,
      now: () => at,
      retry,
      run: {
        ...run("split-aux"),
        source: "g2b",
        serviceKey: "g2b-bid-notice",
        operation: G2B_BID_NOTICE_LIST_OPERATION,
      },
      quota: { store, serviceId: "15129394", dailyLimit: 2 },
    });
    expect(operations).toEqual([
      G2B_BID_NOTICE_LIST_OPERATION,
      G2B_AUX_OPERATIONS[0].operation,
      G2B_AUX_OPERATIONS[0].operation,
      G2B_AUX_OPERATIONS[1].operation,
      G2B_AUX_OPERATIONS[2].operation,
    ]);
    expect(result).toMatchObject({ status: "SUCCEEDED", summary: { created: 1 } });
    expect(await store.get("15129394", at)).toBe(1);
    expect(await store.get(`15129394:${G2B_AUX_OPERATIONS[0].registryKey}`, at)).toBe(2);
    expect(await store.get(`15129394:${G2B_AUX_OPERATIONS[1].registryKey}`, at)).toBe(1);
    expect(repo.state.runs.get("split-aux")?.quotaUsed).toBe(5);
  });

  it("marks provider code 22 exhausted without counting synthetic reservations as HTTP", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 10 });
    let calls = 0;
    const connector = createExternalSourceConnector({
      sourceKey: "lh-bid-notice",
      serviceKey: "test-only-key",
      fetch: async () => {
        calls++;
        return Response.json({ response: { header: { resultCode: "22" } } });
      },
    });
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector,
      repo,
      run: run("provider-22"),
      now: () => at,
      retry,
      quota: { store, serviceId: "15159012", dailyLimit: 10 },
    });
    expect(result.status).toBe("FAILED");
    expect(calls).toBe(1);
    expect(await store.get("15159012", at)).toBe(10);
    expect(repo.state.runs.get("provider-22")?.quotaUsed).toBe(1);
  });

  it("fails the run when Redis becomes unavailable before auxiliary lookup", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 10 });
    vi.spyOn(store, "get")
      .mockResolvedValueOnce(0)
      .mockRejectedValue(new Error("private-connection-detail"));
    const fetch = vi.fn(async () =>
      Response.json({
        response: {
          header: { resultCode: "00" },
          body: {
            totalCount: 1,
            items: [
              {
                bidNtceNo: "AUX-FAIL-001",
                bidNtceOrd: "000",
                bidNtceNm: "데이터 시스템 용역",
                ntceKindNm: "등록공고",
                dminsttNm: "시험기관",
                bidNtceDt: "2026-10-22 09:00:00",
                bidClseDt: "2026-10-23 18:00:00",
                bidNtceDtlUrl: "https://www.g2b.go.kr/pn/test",
              },
            ],
          },
        },
      }),
    );
    const config = {
      endpoint: "https://apis.data.go.kr/1230000/ad/BidPublicInfoService",
      serviceKey: "test-only-key",
      fetch,
    };
    const repo = createMemoryIngestionRepo();
    const result = await runIngest({
      connector: createOfficialApiConnector({ ...config, isInfoBizNotice: () => true }),
      aux: createG2bAuxFetcher({ ...config, retry }),
      repo,
      run: { ...run("aux-store-unavailable"), source: "g2b" },
      now: () => at,
      retry,
      quota: { store, serviceId: "15129394", dailyLimit: 10 },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("FAILED");
    expect(repo.state.errors.some((e) => e.errorCode === "QUOTA_STORE_UNAVAILABLE")).toBe(true);
    expect(JSON.stringify(repo.state.errors)).not.toContain("private-connection-detail");
  });

  it("does not reserve invalid external operations", async () => {
    const store = createMemoryQuotaStore({ dailyLimit: 1 });
    const reserve = vi.spyOn(store, "reserve");
    const fetch = vi.fn(async () => empty());
    // 공사 목록(cntrwkList)은 녹음으로 확인하지 않은 조회 방식이다
    const connector = createExternalSourceConnector({
      sourceKey: "kwater-bid-notice",
      operation: "cntrwkList",
      serviceKey: "test-only-key",
      fetch,
    });
    const result = await runIngest({
      connector,
      repo: createMemoryIngestionRepo(),
      run: { ...run("invalid"), source: "kwater" },
      now: () => at,
      retry,
      quota: { store, serviceId: "15101635", dailyLimit: 1 },
    });
    expect(result.status).toBe("FAILED");
    expect(fetch).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });
});
