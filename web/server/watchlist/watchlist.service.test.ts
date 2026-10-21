import { describe, expect, it, vi } from "vitest";
import type { WatchlistRepo } from "./watchlist.model";
import { getWatchSummary, listMyWatchedBidIds, unwatchBid, watchBid } from "./watchlist.service";

const ORG_ID = "0e000000-0000-0000-0000-000000000001";
const USER_ID = "00000000-0000-0000-0000-000000000001";
const BID_ID = "b1d00000-0000-0000-0000-000000000001";
const scope = { orgId: ORG_ID, userId: USER_ID };

// 저장 자리에 가짜를 꽂는다. 누가 무엇을 읽고 쓰는지(본인 행만, 다른 조직 0행)는 DB 정책 시험이 본다.
const fakeRepo = (overrides: Partial<WatchlistRepo> = {}): WatchlistRepo => ({
  bidExists: vi.fn(async () => true),
  addWatch: vi.fn(async () => undefined),
  removeWatch: vi.fn(async () => undefined),
  isWatching: vi.fn(async () => false),
  countWatchers: vi.fn(async () => 0),
  listMyWatchedBidIds: vi.fn(async () => []),
  ...overrides,
});

const NOT_FOUND = {
  ok: false,
  status: 404,
  code: "NOT_FOUND",
  message: "공고를 찾을 수 없습니다",
  details: { resource: "bid" },
} as const;

describe("watchBid", () => {
  it("관심을 넣고, 넣은 뒤의 조직 관심 인원 수를 돌려준다", async () => {
    const repo = fakeRepo({ countWatchers: vi.fn(async () => 3) });
    await expect(watchBid(scope, BID_ID, { repo })).resolves.toEqual({
      ok: true,
      status: 200,
      data: { bidId: BID_ID, watched: true, watcherCount: 3 },
    });
    expect(repo.addWatch).toHaveBeenCalledWith(scope, BID_ID);
    expect(repo.countWatchers).toHaveBeenCalledWith(BID_ID);
  });

  it("두 번 불러도 두 번 다 200 이고 같은 본문이다(멱등 — 이미 있는 행은 저장이 무시한다)", async () => {
    const repo = fakeRepo({ countWatchers: vi.fn(async () => 1) });
    const first = await watchBid(scope, BID_ID, { repo });
    const second = await watchBid(scope, BID_ID, { repo });
    expect(second).toEqual(first);
    expect(repo.addWatch).toHaveBeenCalledTimes(2);
  });

  it("없는 공고면 404 이고 저장을 부르지 않는다", async () => {
    const repo = fakeRepo({ bidExists: vi.fn(async () => false) });
    await expect(watchBid(scope, BID_ID, { repo })).resolves.toEqual(NOT_FOUND);
    expect(repo.addWatch).not.toHaveBeenCalled();
    expect(repo.countWatchers).not.toHaveBeenCalled();
  });

  it("저장이 던지면 그대로 던진다(500 봉투는 Route Handler 입구가 만든다)", async () => {
    const failure = new Error("db down");
    const repo = fakeRepo({ addWatch: vi.fn(async () => Promise.reject(failure)) });
    await expect(watchBid(scope, BID_ID, { repo })).rejects.toBe(failure);
  });
});

describe("unwatchBid", () => {
  it("관심을 지우고 지운 뒤 인원 수를 돌려준다", async () => {
    const repo = fakeRepo({ countWatchers: vi.fn(async () => 2) });
    await expect(unwatchBid(scope, BID_ID, { repo })).resolves.toEqual({
      ok: true,
      status: 200,
      data: { bidId: BID_ID, watched: false, watcherCount: 2 },
    });
    expect(repo.removeWatch).toHaveBeenCalledWith(scope, BID_ID);
  });

  it("관심이 없던 공고를 풀어도 200 이다(멱등)", async () => {
    const repo = fakeRepo();
    const first = await unwatchBid(scope, BID_ID, { repo });
    const second = await unwatchBid(scope, BID_ID, { repo });
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
  });

  it("없는 공고면 404 이고 저장을 부르지 않는다", async () => {
    const repo = fakeRepo({ bidExists: vi.fn(async () => false) });
    await expect(unwatchBid(scope, BID_ID, { repo })).resolves.toEqual(NOT_FOUND);
    expect(repo.removeWatch).not.toHaveBeenCalled();
  });
});

describe("getWatchSummary", () => {
  it("내가 관심 등록했는지와 조직 관심 인원 수를 함께 돌려준다", async () => {
    const repo = fakeRepo({
      isWatching: vi.fn(async () => true),
      countWatchers: vi.fn(async () => 4),
    });
    await expect(getWatchSummary(scope, BID_ID, { repo })).resolves.toEqual({
      watched: true,
      watcherCount: 4,
    });
    expect(repo.isWatching).toHaveBeenCalledWith(scope, BID_ID);
  });
});

describe("listMyWatchedBidIds", () => {
  it("저장이 읽은 내 관심 공고 id 를 그대로 돌려준다", async () => {
    const repo = fakeRepo({ listMyWatchedBidIds: vi.fn(async () => [BID_ID]) });
    await expect(listMyWatchedBidIds(scope, { repo })).resolves.toEqual([BID_ID]);
    expect(repo.listMyWatchedBidIds).toHaveBeenCalledWith(scope);
  });
});
