import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunMode } from "@/server/analysis";
import type { SolRole } from "@/server/organization";
import { aiStatusSchema, type GatewayHealthBody } from "./ai-status.model";
import { type AiStatusDeps, getAiStatus } from "./ai-status.service";
import { PROBE_TIMEOUT_MS } from "./health.model";

// 05 §2 GET /admin/ai/status 의 서비스 순서: 역할(ADMIN) → env 기준 hosted 승인 → gateway /health 한 번
// → gateway 가 알린 provider 의 hosted 승인. 바깥 세계(env·fetch·시각)는 deps 로 넘긴다.

const NOW = new Date("2026-10-20T05:30:00.000Z");
const MOCK_HEALTH: GatewayHealthBody = {
  status: "ok",
  runMode: "mock",
  provider: "mock",
  kevEnabled: true,
  qwen: {
    model: "fixture",
    promptHash: "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e",
  },
  kev: { modelId: "mock", registryMatch: null },
  questionSets: ["kev-qs/v0.1"],
  parsers: [{ format: "PDF", parserId: null }],
};

type Fetch = AiStatusDeps["fetchHealth"];

function deps(
  env: Record<string, string | undefined> = {},
  fetchHealth: Fetch = async () => MOCK_HEALTH,
) {
  const fetchMock = vi.fn(fetchHealth);
  const built: AiStatusDeps = {
    env: { AI_GATEWAY_URL: "http://gw.invalid:8000", ...env },
    fetchHealth: fetchMock,
    now: () => NOW,
  };
  return { built, fetchMock };
}

const mockMode = vi.fn((): RunMode => "mock");

afterEach(() => {
  vi.useRealTimers();
  mockMode.mockClear();
});

describe("getAiStatus — 역할", () => {
  it("ADMIN 은 ready 이고 본문이 aiStatusSchema 를 통과한다", async () => {
    const { built } = deps();
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(aiStatusSchema.safeParse(result.data).success).toBe(true);
    expect(result.data).toMatchObject({
      runMode: "mock",
      provider: "mock",
      gateway: { url: "http://gw.invalid:8000", healthy: true, runMode: "mock" },
    });
  });

  it.each<SolRole>(["SALES", "ANALYST", "VIEWER"])(
    "%s 는 forbidden 이고 required 는 [ADMIN] 이며 gateway 를 부르지 않는다",
    async (role) => {
      const { built, fetchMock } = deps();
      expect(await getAiStatus(role, mockMode, built)).toEqual({
        status: "forbidden",
        required: ["ADMIN"],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("ADMIN 이 아니면 실행 모드를 읽지 않는다", async () => {
    const { built } = deps();
    await getAiStatus("VIEWER", mockMode, built);
    expect(mockMode).not.toHaveBeenCalled();
  });

  it("실행 모드 읽기가 던져도 ADMIN 이 아니면 403(forbidden)이 먼저다", async () => {
    const { built } = deps();
    const broken = () => {
      throw new Error("worker env 오류: SOL_RUN_MODE");
    };
    expect(await getAiStatus("SALES", broken, built)).toEqual({
      status: "forbidden",
      required: ["ADMIN"],
    });
  });

  it("ADMIN 인데 실행 모드 읽기가 던지면 그대로 던진다(route 가 500 으로 바꾼다)", async () => {
    const { built, fetchMock } = deps();
    const broken = () => {
      throw new Error("worker env 오류: SOL_RUN_MODE");
    };
    await expect(getAiStatus("ADMIN", broken, built)).rejects.toThrow("SOL_RUN_MODE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ADMIN 이 아니면 hosted 미승인 env 여도 forbidden 이다(403 이 422 보다 먼저)", async () => {
    const { built } = deps({ AI_PROVIDER: "hosted", AI_HOSTED_APPROVED: "false" });
    expect(await getAiStatus("ANALYST", mockMode, built)).toEqual({
      status: "forbidden",
      required: ["ADMIN"],
    });
  });
});

describe("getAiStatus — gateway 호출", () => {
  it("env 의 주소에 /health 를 붙여 한 번 부른다", async () => {
    const { built, fetchMock } = deps({ AI_GATEWAY_URL: "http://gw.invalid:8000/" });
    await getAiStatus("ADMIN", mockMode, built);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("http://gw.invalid:8000/health");
  });

  it("주소의 쿼리·해시는 부를 주소와 응답 url 에서 빠진다", async () => {
    const { built, fetchMock } = deps({
      AI_GATEWAY_URL: "http://gw.invalid:8000/?token=s3cret#s3cret",
    });
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(fetchMock).toHaveBeenCalledWith("http://gw.invalid:8000/health");
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("주소에 계정 정보가 있으면 부르지 않고 healthy=false, url 에 계정 정보가 없다", async () => {
    const { built, fetchMock } = deps({ AI_GATEWAY_URL: "http://svc:s3cret@gw.invalid:8000" });
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.data.gateway).toMatchObject({ url: "http://gw.invalid:8000", healthy: false });
    expect(JSON.stringify(result)).not.toContain("s3cret");
  });

  it("http·https 가 아닌 주소면 부르지 않고 healthy=false 다", async () => {
    const { built, fetchMock } = deps({ AI_GATEWAY_URL: "file:///etc/passwd" });
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "ready",
      data: { gateway: { url: "", healthy: false } },
    });
  });

  it("gateway 가 null(불가)이면 ready 이고 healthy=false 다", async () => {
    const { built } = deps({}, async () => null);
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(result).toMatchObject({
      status: "ready",
      data: { gateway: { healthy: false, runMode: null } },
    });
  });

  it("fetchHealth 가 거부되어도 던지지 않고 healthy=false 다", async () => {
    const { built } = deps({}, async () => {
      throw new Error("ECONNREFUSED");
    });
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(result).toMatchObject({ status: "ready", data: { gateway: { healthy: false } } });
  });

  it("fetchHealth 가 동기로 던져도 healthy=false 다", async () => {
    const { built } = deps({}, () => {
      throw new Error("sync boom");
    });
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(result).toMatchObject({ status: "ready", data: { gateway: { healthy: false } } });
  });

  it("멈춘 gateway 는 2초 뒤 healthy=false 로 끝난다", async () => {
    vi.useFakeTimers();
    expect(PROBE_TIMEOUT_MS).toBe(2000);
    const { built } = deps({}, () => new Promise<GatewayHealthBody | null>(() => {}));
    let settled = false;
    const pending = getAiStatus("ADMIN", mockMode, built).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await pending).toMatchObject({
      status: "ready",
      data: { gateway: { healthy: false }, qwen: { healthy: null } },
    });
  });

  it("checkedAt 은 deps.now() 의 시각이다", async () => {
    const { built } = deps();
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(result).toMatchObject({ data: { gateway: { checkedAt: "2026-10-20T05:30:00.000Z" } } });
  });

  it("runMode 는 readRunMode 의 값이다", async () => {
    const { built } = deps({}, async () => ({
      ...MOCK_HEALTH,
      provider: "local",
      runMode: "fixture",
    }));
    const result = await getAiStatus("ADMIN", () => "fixture", built);
    expect(result).toMatchObject({
      data: { runMode: "fixture", gateway: { runMode: "fixture" } },
    });
  });

  it("gateway 가 죽어 있으면 kev.enabled 는 KEV_ENABLED 를 따른다", async () => {
    const { built } = deps({ KEV_ENABLED: "false" }, async () => null);
    const result = await getAiStatus("ADMIN", mockMode, built);
    expect(result).toMatchObject({ data: { kev: { enabled: false, healthy: null } } });
  });
});

describe("getAiStatus — hosted 승인(422)", () => {
  it("env 가 hosted 이고 미승인이면 gateway 를 부르지 않고 hosted-not-approved 다", async () => {
    const { built, fetchMock } = deps({ AI_PROVIDER: "hosted" });
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toEqual({
      status: "hosted-not-approved",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("env 가 hosted 이고 AI_HOSTED_APPROVED=false 여도 같다", async () => {
    const { built, fetchMock } = deps({ AI_PROVIDER: "hosted", AI_HOSTED_APPROVED: "false" });
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toEqual({
      status: "hosted-not-approved",
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("env 가 hosted 이고 승인이면 gateway 를 부르고 ready 다", async () => {
    const { built, fetchMock } = deps(
      { AI_PROVIDER: "hosted", AI_HOSTED_APPROVED: "true" },
      async () => ({
        ...MOCK_HEALTH,
        runMode: "fixture",
        provider: "hosted",
      }),
    );
    const result = await getAiStatus("ADMIN", () => "fixture", built);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "ready",
      data: { provider: "hosted", hostedApproved: true },
    });
  });

  it("env 에 provider 가 없고 gateway 가 hosted 를 알리면 미승인일 때 hosted-not-approved 다", async () => {
    const { built, fetchMock } = deps({}, async () => ({
      ...MOCK_HEALTH,
      runMode: "fixture",
      provider: "hosted",
    }));
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toEqual({
      status: "hosted-not-approved",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("env 는 local 인데 gateway 가 hosted 를 알리면 gateway 값으로 막는다", async () => {
    const { built } = deps({ AI_PROVIDER: "local" }, async () => ({
      ...MOCK_HEALTH,
      runMode: "fixture",
      provider: "hosted",
    }));
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toEqual({
      status: "hosted-not-approved",
    });
  });

  it("gateway 가 hosted 를 알리고 web env 가 승인이면 ready 다", async () => {
    const { built } = deps({ AI_HOSTED_APPROVED: "true" }, async () => ({
      ...MOCK_HEALTH,
      runMode: "fixture",
      provider: "hosted",
    }));
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toMatchObject({
      status: "ready",
      data: { provider: "hosted" },
    });
  });

  it("env 가 hosted·승인이고 gateway 가 죽어 있으면 ready, provider 는 hosted 다", async () => {
    const { built } = deps({ AI_PROVIDER: "hosted", AI_HOSTED_APPROVED: "true" }, async () => null);
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toMatchObject({
      status: "ready",
      data: { provider: "hosted", gateway: { healthy: false } },
    });
  });

  it("AI_PROVIDER 가 local 이면 미승인이어도 ready 다", async () => {
    const { built } = deps({ AI_PROVIDER: "local" }, async () => ({
      ...MOCK_HEALTH,
      runMode: "fixture",
      provider: "local",
    }));
    expect(await getAiStatus("ADMIN", () => "fixture", built)).toMatchObject({
      status: "ready",
      data: { provider: "local", hostedApproved: false },
    });
  });
});
