import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadProgramNoticesConfig,
  runProgramNoticeRound,
  parseBizinfoBody,
  parseMssRss,
} from "@/server/program-notices";
import {
  KakaoTokenKeyMismatchError,
  createMockKakaoSender,
  createMemoKakaoSender,
  toTestFeedTemplate,
  decryptKakaoToken,
  encryptKakaoToken,
  type KakaoLinkStore,
  type KakaoSender,
} from "@/server/kakao-notify";
import {
  processKakaoEvent,
  type KakaoOutboxStore,
  type KakaoRowStatus,
  type OutboxEventRow,
} from "@/server/notifications";

const root = path.resolve(process.cwd(), "..");
const now = () => new Date("2026-10-22T03:00:00.000Z");
const userId = "00000000-0000-4000-8000-000000000001";
const orgId = "00000000-0000-4000-8000-000000000002";
const bidId = "00000000-0000-4000-8000-000000000003";

describe("committed feature integration", () => {
  it("replays the public MSS recording in mock without using an API key or HTTP", async () => {
    const loaded = await loadProgramNoticesConfig(
      path.join(root, "infra/sources/program-notices.yaml"),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("recorded source configuration unavailable");
    let fetched = false;
    let saved = 0;
    const runs = await runProgramNoticeRound({
      config: loaded.config,
      runMode: "mock",
      env: {},
      fetch: async () => {
        fetched = true;
        throw new Error("mock HTTP forbidden");
      },
      recordingsDir: path.join(root, "fixtures/recorded/program-notices"),
      now,
      log: () => undefined,
      store: {
        upsertNotices: async (notices) => {
          saved += notices.length;
          return notices.length;
        },
        recordRun: async () => undefined,
      },
    });
    expect(fetched).toBe(false);
    expect(saved).toBeGreaterThan(0);
    expect(runs.find((run) => run.source === "mss")).toMatchObject({ status: "SUCCEEDED" });
    expect(runs.find((run) => run.source === "bizinfo")).toMatchObject({
      errorCode: "NO_RECORDING",
    });
  });

  it("rejects XML entity declarations before parsing recorded notices", async () => {
    const recording = JSON.parse(
      await readFile(
        path.join(root, "fixtures/recorded/program-notices/mss/rss-310.20261021.masked.json"),
        "utf8",
      ),
    );
    expect(parseMssRss(recording.body, now().toISOString())).toMatchObject({
      ok: true,
      dropped: 0,
    });
    expect(
      parseMssRss(
        '<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss></rss>',
        now().toISOString(),
      ),
    ).toEqual({ ok: false, errorCode: "XML_DTD_REJECTED" });
  });

  it("removes contact details from program descriptions before persistence", () => {
    const parsed = parseBizinfoBody(
      JSON.stringify({
        jsonArray: [
          {
            pblancId: "p1",
            pblancNm: "지원사업",
            pblancUrl: "https://www.bizinfo.go.kr/notice/p1",
            bsnsSumryCn: "기술 지원 연락 02-1234-5678 help@example.invalid",
            refrncNm: "담당자 비공개",
          },
        ],
      }),
      now().toISOString(),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("program notice parse failed");
    expect(parsed.notices).toHaveLength(1);
    expect(JSON.stringify(parsed.notices)).not.toMatch(
      /02-1234-5678|help@example\.invalid|담당자 비공개/,
    );
  });

  it("binds encrypted Kakao tokens to their user and distinguishes a wrong deployment key", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const context = { userId, kind: "access" as const };
    const sealed = encryptKakaoToken("fake-token", key, context);
    expect(decryptKakaoToken(sealed, key, context)).toBe("fake-token");
    expect(() => decryptKakaoToken(sealed, key, { ...context, userId: orgId })).toThrow(
      "KAKAO_TOKEN_DECRYPT_FAILED",
    );
    expect(() =>
      decryptKakaoToken(sealed, Buffer.alloc(32, 8).toString("base64"), context),
    ).toThrow(KakaoTokenKeyMismatchError);
  });

  it("sends a recommended mock notification once when the outbox event is replayed", async () => {
    let sent = 0;
    const links: KakaoLinkStore = {
      read: async () => ({
        userId,
        enabled: true,
        status: "CONNECTED",
        accessTokenEnc: null,
        refreshTokenEnc: null,
        accessExpiresAt: null,
        refreshExpiresAt: null,
      }),
      saveTokens: async () => {
        throw new Error("mock token refresh forbidden");
      },
      markExpired: async () => {
        throw new Error("mock expiry forbidden");
      },
      markResult: async () => {
        sent++;
      },
    };
    const scenario = notificationScenario(createMockKakaoSender({ links, now }));
    await scenario.process();
    await scenario.process();
    expect(sent).toBe(1);
    expect(scenario.status()).toBe("SENT");
  });

  it("does not resend a Kakao message when the transport outcome is unknown", async () => {
    let sent = 0;
    const scenario = notificationScenario({
      send: async () => {
        sent++;
        return { kind: "UNKNOWN_OUTCOME" };
      },
    });
    await scenario.process();
    await scenario.process();
    expect(sent).toBe(1);
    expect(scenario.status()).toBe("DEAD");
  });

  it("does not resend a successful message after its final database write fails", async () => {
    let sent = 0;
    const scenario = notificationScenario(
      {
        send: async () => {
          sent++;
          return { kind: "SENT" };
        },
      },
      { failStatusWrite: true },
    );
    await expect(scenario.process()).rejects.toThrow("final notification write unavailable");
    await scenario.process();
    expect(sent).toBe(1);
  });

  it("claims recommended delivery once when two pollers process the same pending event", async () => {
    let sent = 0;
    const scenario = notificationScenario({
      send: async () => {
        sent++;
        return { kind: "SENT" };
      },
    });
    await Promise.all([scenario.process(), scenario.process()]);
    expect(sent).toBe(1);
  });

  it("does not resend a test message when the same outbox event is replayed", async () => {
    let sent = 0;
    const scenario = notificationScenario({
      send: async () => {
        sent++;
        return { kind: "SENT" };
      },
    });
    await scenario.processTest();
    await scenario.processTest();
    expect(sent).toBe(1);
  });

  it("checks a user's disabled setting again before memo delivery", async () => {
    const forbidden = async (): Promise<never> => {
      throw new Error("disabled delivery reached transport or token mutation");
    };
    const sender = createMemoKakaoSender({
      links: {
        read: async () => ({
          userId,
          enabled: false,
          status: "CONNECTED",
          accessTokenEnc: null,
          refreshTokenEnc: null,
          accessExpiresAt: null,
          refreshExpiresAt: null,
        }),
        saveTokens: forbidden,
        markExpired: forbidden,
        markResult: forbidden,
      },
      api: {
        authorizeUrl: () => {
          throw new Error("disabled authorize");
        },
        exchangeCode: forbidden,
        refresh: forbidden,
        sendMemo: forbidden,
      },
      encKey: Buffer.alloc(32, 7).toString("base64"),
      now,
      sleep: forbidden,
    });
    expect(await sender.send(userId, toTestFeedTemplate("https://example.invalid"))).toEqual({
      kind: "REJECTED",
      code: "DISABLED",
    });
  });
});

function notificationScenario(sender: KakaoSender, options: { failStatusWrite?: boolean } = {}) {
  let status: KakaoRowStatus = "PENDING";
  let claimed = false;
  let testClaimed = false;
  let failStatusWrite = options.failStatusWrite === true;
  const store: KakaoOutboxStore = {
    claimNotification: async () => {
      if (claimed) return false;
      claimed = true;
      status = "DEAD";
      return true;
    },
    claimTest: async () => {
      if (testClaimed) return false;
      testClaimed = true;
      return true;
    },
    listRecipients: async () => [userId],
    isActive: async () => true,
    readFeedSource: async () => ({
      orgId,
      bidId,
      recommendation: "BID",
      status: "COMPLETED",
      score: 80,
      title: "공고",
      agency: null,
      deadlineAt: null,
      budgetKrw: null,
      sourceUrl: null,
      checks: [],
    }),
    hasKakaoSentForBid: async () => status === "SENT" || status === "DEAD",
    ensureKakaoRow: async () => ({ id: bidId, status }),
    setKakaoRowStatus: async (_id, next) => {
      if (failStatusWrite) {
        failStatusWrite = false;
        throw new Error("final notification write unavailable");
      }
      status = next;
    },
    closeOpenKakaoRows: async () => undefined,
    insertNotification: async () => undefined,
  };
  const event: OutboxEventRow = {
    id: userId,
    org_id: orgId,
    event_type: "BID_RECOMMENDED",
    status: "PENDING",
    payload: { scoreRunId: bidId, bidId, orgId, recommendation: "BID", status: "COMPLETED" },
    attempts: 0,
  };
  return {
    status: () => status,
    process: () =>
      processKakaoEvent({ store, sender, siteUrl: "https://example.invalid", now }, event),
    processTest: () =>
      processKakaoEvent(
        { store, sender, siteUrl: "https://example.invalid", now },
        { ...event, event_type: "KAKAO_TEST", org_id: null, payload: { userId } },
      ),
  };
}
