import { afterEach, describe, expect, it, vi } from "vitest";
import type { KakaoLinkStore } from "@/server/kakao-notify";
import {
  processOutboxBatch,
  type KakaoOutboxStore,
  type NotificationOutboxStore,
  type OutboxEventRow,
} from "@/server/notifications";
import { notifyWorkerRegistration } from "@/worker/main";
import { createKakaoChannel, readKakaoSettings } from "@/worker/notify-outbox";

// 2026-10-27 점검: live 에서 NOTIFY_KAKAO_PROVIDER 를 빠뜨리면 mock 이 되어, 보내지 않은 카카오 알림이 SENT 로 남았다.
// 지금 규칙: live + 빈 값 → 카카오 꺼짐(기동은 성공, 경고 한 줄), live + mock → 받되 경고, mock·fixture 실행 모드 → 그대로 mock.
// 실제 Supabase·카카오는 부르지 않는다. 1단계(env 읽기)만 돌리고 2단계(service role 연결)는 돌리지 않는다.

const ORG_ID = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";
const NOW = new Date("2026-10-27T09:00:00.000Z");
const bidRecommended: OutboxEventRow = {
  id: "7d6c5b4a-3928-4170-8e5d-4c3b2a190807",
  org_id: ORG_ID,
  event_type: "BID_RECOMMENDED",
  payload: {
    scoreRunId: "1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f",
    bidId: "3f0c9a52-6d1e-4b7a-9c3d-2e5f8a1b4c6d",
    orgId: ORG_ID,
    recommendation: "BID",
    status: "COMPLETED",
  },
  status: "PENDING",
  attempts: 0,
};

const unexpected = async (): Promise<never> => {
  throw new Error("부르면 안 된다");
};

const kakaoStoreSpy = () =>
  ({
    claimNotification: vi.fn(unexpected),
    claimTest: vi.fn(unexpected),
    listRecipients: vi.fn(unexpected),
    isActive: vi.fn(unexpected),
    readFeedSource: vi.fn(unexpected),
    hasKakaoSentForBid: vi.fn(unexpected),
    ensureKakaoRow: vi.fn(unexpected),
    setKakaoRowStatus: vi.fn(unexpected),
    closeOpenKakaoRows: vi.fn(unexpected),
    insertNotification: vi.fn(unexpected),
  }) satisfies KakaoOutboxStore;

const linksSpy = () =>
  ({
    read: vi.fn(unexpected),
    saveTokens: vi.fn(unexpected),
    markExpired: vi.fn(unexpected),
    markResult: vi.fn(unexpected),
  }) satisfies KakaoLinkStore;

const channelDeps = (store: KakaoOutboxStore, links: KakaoLinkStore) => ({
  store,
  links,
  fetch: vi.fn(unexpected),
  now: () => NOW,
  sleep: vi.fn(unexpected),
});

/** 1단계 등록을 돌리고 그동안 남긴 경고 줄(JSON)을 돌려준다. */
async function registerNotify(env: Record<string, string>): Promise<Record<string, unknown>[]> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await expect(notifyWorkerRegistration(env)).resolves.toBeTypeOf("function");
  return warn.mock.calls.map(([line]) => JSON.parse(String(line)) as Record<string, unknown>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("카카오 발송 수단 — live 에서 조용히 mock 이 되지 않는다", () => {
  it("live 인데 NOTIFY_KAKAO_PROVIDER 가 비면 카카오를 끄고, 기동은 성공하며 경고를 한 번 남긴다", async () => {
    const warnings = await registerNotify({ SOL_RUN_MODE: "live", NOTIFY_KAKAO_PROVIDER: " " });
    expect(warnings).toEqual([expect.objectContaining({ event: "notify.kakao.disabled" })]);
    expect(readKakaoSettings({ SOL_RUN_MODE: "live" })).toEqual({ provider: "disabled" });
  });

  it("꺼진 채널은 카카오 이벤트를 claim·발송 기록 없이 재시도로 돌린다(SENT 로 닫지 않는다)", async () => {
    const kakaoStore = kakaoStoreSpy();
    const links = linksSpy();
    const channel = createKakaoChannel(
      readKakaoSettings({ SOL_RUN_MODE: "live" }),
      channelDeps(kakaoStore, links),
    );
    const markRetry = vi.fn(async () => {});
    const markProcessed = vi.fn(unexpected);
    const store = {
      findDue: vi.fn(async () => [bidRecommended]),
      readBidTitle: vi.fn(unexpected),
      isMember: vi.fn(unexpected),
      isActive: vi.fn(unexpected),
      insertNotification: vi.fn(unexpected),
      markProcessed,
      markRetry,
    } satisfies NotificationOutboxStore;

    const summary = await processOutboxBatch({
      store,
      kakao: channel,
      now: () => NOW,
      log: () => {},
      limit: 50,
    });

    expect(summary).toMatchObject({ checked: 1, sent: 0, retried: 1 });
    expect(markRetry).toHaveBeenCalledWith(bidRecommended, {
      status: "FAILED",
      attempts: 1,
      next_attempt_at: "2026-10-27T09:00:05.000Z",
    });
    expect(markProcessed).not.toHaveBeenCalled();
    for (const method of [...Object.values(kakaoStore), ...Object.values(links)])
      expect(method).not.toHaveBeenCalled();
  });

  it("live 에서 mock 을 직접 적으면 받되, 발송은 흉내만 낸다는 경고를 남긴다", async () => {
    const env = { SOL_RUN_MODE: "live", NOTIFY_KAKAO_PROVIDER: "mock" };
    const warnings = await registerNotify(env);
    expect(warnings).toEqual([expect.objectContaining({ event: "notify.kakao.mock_in_live" })]);
    expect(readKakaoSettings(env)).toEqual({ provider: "mock", siteUrl: "http://localhost:3000" });
  });

  it("mock·fixture 실행 모드는 그대로다 — 비면 mock 이고 경고가 없다", async () => {
    for (const mode of ["", "fixture"]) {
      const env = { SOL_RUN_MODE: mode };
      expect(await registerNotify(env)).toEqual([]);
      expect(readKakaoSettings(env)).toEqual({
        provider: "mock",
        siteUrl: "http://localhost:3000",
      });
      expect(
        createKakaoChannel(readKakaoSettings(env), channelDeps(kakaoStoreSpy(), linksSpy())),
      ).toMatchObject({ siteUrl: "http://localhost:3000" });
      vi.restoreAllMocks();
    }
  });
});
