import { describe, expect, it, vi } from "vitest";
import { loadOpportunityFilters } from "./opportunity-data";

// 가짜 unstable_cache: keyParts 와 인자로 결과를 Map 에 담는다. 받은 옵션은 cacheOptions 에 남긴다.
const { cacheOptions, getOpportunityFilterOptions } = vi.hoisted(() => ({
  cacheOptions: [] as unknown[],
  getOpportunityFilterOptions: vi.fn(async (_client: unknown, origin: string) => ({
    agencies: [{ id: `${origin}-agency`, name: "기관" }],
    companies: [],
  })),
}));
vi.mock("next/cache", () => {
  const store = new Map<string, unknown>();
  return {
    unstable_cache:
      <A extends unknown[], R>(
        fn: (...args: A) => Promise<R>,
        keyParts: string[],
        options: unknown,
      ) =>
      async (...args: A): Promise<R> => {
        cacheOptions.push(options);
        const key = `${keyParts.join("/")}|${JSON.stringify(args)}`;
        if (!store.has(key)) store.set(key, await fn(...args));
        return store.get(key) as R;
      },
  };
});
// 부를 때마다 내용이 다른 client 를 준다. client 가 캐시 키에 들어가면 JSON 이 달라져 호출이 3번이 된다.
vi.mock("@/server/opportunities", () => {
  let user = 0;
  return {
    getOpportunityClient: async () => ({ user: ++user }),
    getOpportunityFilterOptions,
  };
});
vi.mock("@/server/bids", () => ({}));
vi.mock("@/app/_lib/opportunity-sources", () => ({}));

describe("loadOpportunityFilters", () => {
  it("같은 출처는 사용자(client)가 달라도 한 번만 읽고, 출처가 다르면 따로 읽는다", async () => {
    await loadOpportunityFilters("live");
    await loadOpportunityFilters("live");
    await loadOpportunityFilters("demo");
    expect(getOpportunityFilterOptions).toHaveBeenCalledTimes(2);
    expect(getOpportunityFilterOptions.mock.calls.map((c) => c[1])).toEqual(["live", "demo"]);
    expect(cacheOptions.at(-1)).toEqual({ revalidate: 600, tags: ["opportunity-filter-options"] });
  });
});
