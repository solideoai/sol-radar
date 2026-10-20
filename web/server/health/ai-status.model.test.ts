import { describe, expect, it } from "vitest";
import {
  AI_STATUS_ROLES,
  DEFAULT_GATEWAY_URL,
  type AiStatusEnv,
  type GatewayHealthBody,
  aiStatusSchema,
  gatewayHealthSchema,
  isHostedBlocked,
  readAiStatusEnv,
  resolveProvider,
  toAiStatus,
  toGatewayTarget,
} from "./ai-status.model";

// 05 §2 GET /admin/ai/status 의 순수 규칙. 근거: 05 §385 AiStatus, 03 §2.1 gateway /health,
// gateway 실제 응답 services/ai/src/sol_ai/app.py(health) · adapters/mock.py · parse.py(parser_inventory).

// AI_PROVIDER=mock gateway 가 실제로 내는 모양: qwen 은 fixture 고정 값, mock Kev 는 레지스트리와 대조하지 않는다,
// 질문 세트는 mock 이 v0.1 하나, 파서는 등록된 어댑터가 없어 parserId 가 모두 null 이다.
const PROMPT_HASH = "e9ff84681c4fa852cb5948c56246c6ff3ae72092581af488057f761fc6b8114e";
const MOCK_HEALTH_WIRE = {
  status: "ok",
  runMode: "mock",
  provider: "mock",
  kevEnabled: true,
  qwen: { model: "fixture", promptHash: PROMPT_HASH },
  kev: { modelId: "mock", registryMatch: null },
  questionSets: ["kev-qs/v0.1"],
  parsers: [
    { format: "PDF", parserId: null },
    { format: "HWPX", parserId: null },
    { format: "HWP", parserId: null },
  ],
};

const health = (overrides: Partial<GatewayHealthBody> = {}): GatewayHealthBody => ({
  ...gatewayHealthSchema.parse(MOCK_HEALTH_WIRE),
  ...overrides,
});

const env = (overrides: Partial<AiStatusEnv> = {}): AiStatusEnv => ({
  gateway: { url: "http://gw.invalid:8000", healthUrl: "http://gw.invalid:8000/health" },
  provider: null,
  hostedApproved: false,
  kevEnabled: true,
  ...overrides,
});

const CHECKED_AT = new Date("2026-10-20T05:30:00.000Z");

describe("AI_STATUS_ROLES", () => {
  it("ADMIN 하나만 연다(05 §2 권한 열)", () => {
    expect(AI_STATUS_ROLES).toEqual(["ADMIN"]);
  });
});

describe("toGatewayTarget", () => {
  it("값이 없으면 Compose 안의 gateway 기본 주소를 부른다", () => {
    expect(DEFAULT_GATEWAY_URL).toBe("http://ai-gateway:8000");
    expect(toGatewayTarget(undefined)).toEqual({
      url: "http://ai-gateway:8000",
      healthUrl: "http://ai-gateway:8000/health",
    });
  });

  it("빈 문자열·공백만 있는 값도 기본 주소다", () => {
    expect(toGatewayTarget("")).toEqual(toGatewayTarget(undefined));
    expect(toGatewayTarget("   ")).toEqual(toGatewayTarget(undefined));
  });

  it("앞뒤 공백과 끝 슬래시를 지우고 /health 를 붙인다", () => {
    expect(toGatewayTarget("  http://gw.invalid:8000///  ")).toEqual({
      url: "http://gw.invalid:8000",
      healthUrl: "http://gw.invalid:8000/health",
    });
  });

  it("경로가 있는 주소는 경로 뒤에 /health 를 붙인다", () => {
    expect(toGatewayTarget("https://gw.invalid/ai/")).toEqual({
      url: "https://gw.invalid/ai",
      healthUrl: "https://gw.invalid/ai/health",
    });
  });

  it("쿼리·해시를 응답 url 과 부를 주소에서 모두 뺀다", () => {
    const target = toGatewayTarget("http://gw.invalid:8000/?token=s3cret-query#s3cret-hash");
    expect(target).toEqual({
      url: "http://gw.invalid:8000",
      healthUrl: "http://gw.invalid:8000/health",
    });
    expect(JSON.stringify(target)).not.toContain("s3cret");
  });

  it("계정 정보가 있으면 응답 url 에서 빼고 부르지 않는다(healthUrl null)", () => {
    const target = toGatewayTarget("http://svc-user:s3cret-pass@gw.invalid:8000/");
    expect(target).toEqual({ url: "http://gw.invalid:8000", healthUrl: null });
    expect(JSON.stringify(target)).not.toContain("s3cret");
    expect(JSON.stringify(target)).not.toContain("svc-user");
  });

  it("이름만 있는 계정 정보도 부르지 않는다", () => {
    const target = toGatewayTarget("http://svc-user@gw.invalid:8000");
    expect(target).toEqual({ url: "http://gw.invalid:8000", healthUrl: null });
  });

  it("http·https 가 아닌 주소는 url 이 빈 문자열이고 부르지 않는다", () => {
    for (const raw of ["ftp://gw.invalid", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(toGatewayTarget(raw), raw).toEqual({ url: "", healthUrl: null });
    }
  });

  it("해석할 수 없는 주소는 url 이 빈 문자열이고 부르지 않는다", () => {
    expect(toGatewayTarget("not a url")).toEqual({ url: "", healthUrl: null });
  });
});

describe("readAiStatusEnv", () => {
  it("빈 env 는 provider 없음·미승인·Kev 켜짐·기본 gateway 다", () => {
    expect(readAiStatusEnv({})).toEqual({
      gateway: { url: DEFAULT_GATEWAY_URL, healthUrl: `${DEFAULT_GATEWAY_URL}/health` },
      provider: null,
      hostedApproved: false,
      kevEnabled: true,
    });
  });

  it("AI_PROVIDER 는 mock·local·hosted 만 받는다", () => {
    for (const value of ["mock", "local", "hosted"] as const) {
      expect(readAiStatusEnv({ AI_PROVIDER: value }).provider).toBe(value);
    }
  });

  it("AI_PROVIDER 가 모르는 값·대소문자 변형·빈 값이면 null 이다", () => {
    for (const value of ["openai", "HOSTED", "Mock", ""]) {
      expect(readAiStatusEnv({ AI_PROVIDER: value }).provider, value).toBeNull();
    }
  });

  it("AI_HOSTED_APPROVED 는 정확히 true 일 때만 승인이다", () => {
    expect(readAiStatusEnv({ AI_HOSTED_APPROVED: "true" }).hostedApproved).toBe(true);
    for (const value of ["TRUE", "1", "yes", "false", ""]) {
      expect(readAiStatusEnv({ AI_HOSTED_APPROVED: value }).hostedApproved, value).toBe(false);
    }
  });

  it("KEV_ENABLED 는 정확히 false 일 때만 꺼진다", () => {
    expect(readAiStatusEnv({ KEV_ENABLED: "false" }).kevEnabled).toBe(false);
    for (const value of ["true", undefined, ""]) {
      expect(readAiStatusEnv({ KEV_ENABLED: value }).kevEnabled, String(value)).toBe(true);
    }
  });

  it("AI_GATEWAY_URL 의 계정 정보·쿼리는 결과에 실리지 않는다", () => {
    const read = readAiStatusEnv({ AI_GATEWAY_URL: "http://u:s3cret@gw.invalid/?k=s3cret" });
    expect(JSON.stringify(read)).not.toContain("s3cret");
    expect(read.gateway.healthUrl).toBeNull();
  });
});

describe("resolveProvider", () => {
  it("gateway 가 알린 provider 가 env 보다 먼저다", () => {
    expect(
      resolveProvider(health({ provider: "local" }), env({ provider: "hosted" }), "mock"),
    ).toBe("local");
  });

  it("gateway 가 없으면 AI_PROVIDER 다", () => {
    expect(resolveProvider(null, env({ provider: "hosted" }), "mock")).toBe("hosted");
  });

  it("gateway 도 AI_PROVIDER 도 없으면 mock 모드는 mock 이다", () => {
    expect(resolveProvider(null, env(), "mock")).toBe("mock");
  });

  it("gateway 도 AI_PROVIDER 도 없으면 fixture·live 모드는 local 이다", () => {
    expect(resolveProvider(null, env(), "fixture")).toBe("local");
    expect(resolveProvider(null, env(), "live")).toBe("local");
  });
});

describe("isHostedBlocked", () => {
  it("hosted 이고 승인이 없으면 막는다", () => {
    expect(isHostedBlocked("hosted", false)).toBe(true);
  });

  it("hosted 라도 승인이 있으면 막지 않는다", () => {
    expect(isHostedBlocked("hosted", true)).toBe(false);
  });

  it("mock·local 은 승인이 없어도 막지 않는다", () => {
    expect(isHostedBlocked("mock", false)).toBe(false);
    expect(isHostedBlocked("local", false)).toBe(false);
  });
});

describe("gatewayHealthSchema", () => {
  it("mock gateway 의 실제 /health 응답을 받는다", () => {
    expect(gatewayHealthSchema.safeParse(MOCK_HEALTH_WIRE).success).toBe(true);
  });

  it("모르는 필드는 버린다", () => {
    const parsed = gatewayHealthSchema.parse({ ...MOCK_HEALTH_WIRE, secretPath: "/models/x" });
    expect(parsed).not.toHaveProperty("secretPath");
  });

  it("status 가 ok 가 아니면 거부한다", () => {
    expect(gatewayHealthSchema.safeParse({ ...MOCK_HEALTH_WIRE, status: "degraded" }).success).toBe(
      false,
    );
  });

  it("모르는 provider·runMode 는 거부한다", () => {
    expect(gatewayHealthSchema.safeParse({ ...MOCK_HEALTH_WIRE, provider: "openai" }).success).toBe(
      false,
    );
    expect(gatewayHealthSchema.safeParse({ ...MOCK_HEALTH_WIRE, runMode: "demo" }).success).toBe(
      false,
    );
  });

  it("필수 필드가 빠지면 거부한다", () => {
    const withoutParsers = Object.fromEntries(
      Object.entries(MOCK_HEALTH_WIRE).filter(([key]) => key !== "parsers"),
    );
    expect(gatewayHealthSchema.safeParse(withoutParsers).success).toBe(false);
  });
});

describe("toAiStatus — gateway 정상", () => {
  it("mock gateway 응답을 05 AiStatus 로 바꾸고 aiStatusSchema 를 통과한다", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env(),
      health: health(),
      checkedAt: CHECKED_AT,
    });
    expect(aiStatusSchema.parse(status)).toEqual(status);
    expect(status).toEqual({
      runMode: "mock",
      provider: "mock",
      hostedApproved: false,
      gateway: {
        url: "http://gw.invalid:8000",
        healthy: true,
        checkedAt: "2026-10-20T05:30:00.000Z",
        runMode: "mock",
      },
      qwen: { model: "fixture", runtime: null, healthy: true },
      kev: {
        enabled: true,
        healthy: true,
        model: null,
        modelId: "mock",
        run: null,
        base: null,
        lora: null,
        temperature: null,
        registryMatch: null,
      },
      questionSetVersion: "kev-qs/v0.1",
      parsers: [],
    });
  });

  it("runMode 는 web 의 실행 모드이고 gateway.runMode 는 gateway 가 알린 값이다", () => {
    const status = toAiStatus({
      runMode: "fixture",
      env: env(),
      health: health({ runMode: "mock" }),
      checkedAt: CHECKED_AT,
    });
    expect(status.runMode).toBe("fixture");
    expect(status.gateway.runMode).toBe("mock");
  });

  it("provider 는 gateway 가 알린 값이다(env 와 달라도)", () => {
    const status = toAiStatus({
      runMode: "fixture",
      env: env({ provider: "mock" }),
      health: health({ provider: "local" }),
      checkedAt: CHECKED_AT,
    });
    expect(status.provider).toBe("local");
  });

  it("hostedApproved 는 web env 의 값이다", () => {
    const status = toAiStatus({
      runMode: "fixture",
      env: env({ hostedApproved: true }),
      health: health({ provider: "hosted" }),
      checkedAt: CHECKED_AT,
    });
    expect(status.hostedApproved).toBe(true);
  });

  it("qwen 이 null 이면 qwen.healthy 는 false 이고 model 은 null 이다", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env(),
      health: health({ qwen: null }),
      checkedAt: CHECKED_AT,
    });
    expect(status.qwen).toEqual({ model: null, runtime: null, healthy: false });
  });

  it("kev.enabled 는 gateway 의 kevEnabled 를 따른다(env 가 꺼도)", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env({ kevEnabled: false }),
      health: health({ kevEnabled: true }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev.enabled).toBe(true);
  });

  it("Kev 가 켜져 있고 registryMatch 가 true 면 kev.healthy 는 true", () => {
    const status = toAiStatus({
      runMode: "fixture",
      env: env(),
      health: health({ kev: { modelId: "kev-9b-v1.0", registryMatch: true } }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev).toMatchObject({
      enabled: true,
      healthy: true,
      modelId: "kev-9b-v1.0",
      registryMatch: true,
    });
  });

  it("Kev 가 켜져 있고 registryMatch 가 false 면 kev.healthy 는 false", () => {
    const status = toAiStatus({
      runMode: "fixture",
      env: env(),
      health: health({ kev: { modelId: "kev-9b-v1.0", registryMatch: false } }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev.healthy).toBe(false);
    expect(status.kev.registryMatch).toBe(false);
  });

  // gateway 의 UnavailableKev(hosted)는 kevEnabled=true·kev=null 이다. Kev 를 쓸 수 있는지 모르므로 healthy 는 null.
  it("Kev 가 켜져 있고 kev 항목이 null 이면 enabled 는 true 이고 healthy·modelId·registryMatch 는 null", () => {
    const status = toAiStatus({
      runMode: "live",
      env: env({ hostedApproved: true }),
      health: health({ provider: "hosted", kevEnabled: true, qwen: null, kev: null }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev).toMatchObject({
      enabled: true,
      healthy: null,
      modelId: null,
      registryMatch: null,
    });
  });

  // local 의 registryMatch null 은 기동 때 Kev /v1/models 에 닿지 못한 미확인이다(local_setup.check_kev_registry).
  it("local 에서 registryMatch 가 null 이면 kev.healthy 는 null 이다", () => {
    const status = toAiStatus({
      runMode: "live",
      env: env(),
      health: health({ provider: "local", kev: { modelId: "kev-9b-v1.0", registryMatch: null } }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev.healthy).toBeNull();
    expect(status.kev.registryMatch).toBeNull();
  });

  it("mock 에서 registryMatch 가 null 이면(대조하지 않음) kev.healthy 는 true 다", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env(),
      health: health({ provider: "mock", kev: { modelId: "mock", registryMatch: null } }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev.healthy).toBe(true);
  });

  it("Kev 가 꺼져 있으면 kev.healthy 는 null 이다", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env(),
      health: health({ kevEnabled: false, kev: null, questionSets: [] }),
      checkedAt: CHECKED_AT,
    });
    expect(status.kev.enabled).toBe(false);
    expect(status.kev.healthy).toBeNull();
    expect(status.questionSetVersion).toBeNull();
  });

  it("gateway 가 주지 않는 값(qwen.runtime, kev model·run·base·lora·temperature)은 null 이다", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env(),
      health: health(),
      checkedAt: CHECKED_AT,
    });
    expect(status.qwen.runtime).toBeNull();
    expect(status.kev).toMatchObject({
      model: null,
      run: null,
      base: null,
      lora: null,
      temperature: null,
    });
  });

  it("questionSetVersion 은 gateway 질문 세트의 첫 항목이다", () => {
    const status = toAiStatus({
      runMode: "fixture",
      env: env(),
      health: health({ questionSets: ["kev-qs/v0.2", "kev-qs/v0.1"] }),
      checkedAt: CHECKED_AT,
    });
    expect(status.questionSetVersion).toBe("kev-qs/v0.2");
  });

  it("parserId 가 null 인 파서는 빠지고 어댑터가 있는 파서만 남는다", () => {
    const status = toAiStatus({
      runMode: "mock",
      env: env(),
      health: health({
        parsers: [
          { format: "PDF", parserId: "pdf-text/v1" },
          { format: "HWPX", parserId: null },
          { format: "HWP", parserId: "hwp5/v0.3" },
        ],
      }),
      checkedAt: CHECKED_AT,
    });
    expect(status.parsers).toEqual([
      { format: "PDF", parserId: "pdf-text/v1" },
      { format: "HWP", parserId: "hwp5/v0.3" },
    ]);
    expect(aiStatusSchema.safeParse(status).success).toBe(true);
  });
});

describe("toAiStatus — gateway 불가", () => {
  const down = (overrides: Partial<AiStatusEnv> = {}, runMode: "mock" | "fixture" = "mock") =>
    toAiStatus({ runMode, env: env(overrides), health: null, checkedAt: CHECKED_AT });

  it("gateway.healthy 는 false 이고 gateway.runMode 는 null 이다", () => {
    const status = down();
    expect(status.gateway).toEqual({
      url: "http://gw.invalid:8000",
      healthy: false,
      checkedAt: "2026-10-20T05:30:00.000Z",
      runMode: null,
    });
  });

  it("gateway 에서만 알 수 있는 값은 모두 null 이고 파서는 빈 목록이다", () => {
    const status = down();
    expect(status.qwen).toEqual({ model: null, runtime: null, healthy: null });
    expect(status.kev).toMatchObject({ healthy: null, modelId: null, registryMatch: null });
    expect(status.questionSetVersion).toBeNull();
    expect(status.parsers).toEqual([]);
  });

  it("aiStatusSchema 를 통과한다", () => {
    expect(aiStatusSchema.safeParse(down()).success).toBe(true);
  });

  it("kev.enabled 는 KEV_ENABLED(env)를 따른다", () => {
    expect(down({ kevEnabled: true }).kev.enabled).toBe(true);
    expect(down({ kevEnabled: false }).kev.enabled).toBe(false);
  });

  it("kev 가 env 로 켜져 있어도 kev.healthy 는 null 이다", () => {
    expect(down({ kevEnabled: true }).kev.healthy).toBeNull();
  });

  it("provider 는 AI_PROVIDER, 없으면 실행 모드 기본값이다", () => {
    expect(down({ provider: "hosted", hostedApproved: true }).provider).toBe("hosted");
    expect(down({}, "mock").provider).toBe("mock");
    expect(down({}, "fixture").provider).toBe("local");
  });

  it("주소를 부르지 못한 경우(url 빈 문자열)에도 aiStatusSchema 를 통과한다", () => {
    const status = down({ gateway: { url: "", healthUrl: null } });
    expect(status.gateway.url).toBe("");
    expect(aiStatusSchema.safeParse(status).success).toBe(true);
  });
});

describe("aiStatusSchema", () => {
  it("parserId 가 null 인 파서를 거부한다(05 의 parserId: string)", () => {
    const status = toAiStatus({ runMode: "mock", env: env(), health: null, checkedAt: CHECKED_AT });
    expect(
      aiStatusSchema.safeParse({ ...status, parsers: [{ format: "PDF", parserId: null }] }).success,
    ).toBe(false);
  });

  it("checkedAt 이 ISO 시각이 아니면 거부한다", () => {
    const status = toAiStatus({ runMode: "mock", env: env(), health: null, checkedAt: CHECKED_AT });
    expect(
      aiStatusSchema.safeParse({ ...status, gateway: { ...status.gateway, checkedAt: "어제" } })
        .success,
    ).toBe(false);
  });
});
