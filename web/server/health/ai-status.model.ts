import "server-only";
import { z } from "zod";
import type { GatewayHealth, RunMode } from "@/server/analysis";
import type { SolRole } from "@/server/organization";

// ── AI 상태(05 §2 GET /admin/ai/status): gateway /health 응답과 web env 를 AiStatus 로 바꾸는 순수 규칙 ──
// 값은 gateway /health 에서만 읽는다. Route Handler 가 Kev·Qwen 을 직접 부르지 않는다(05 §7).

/** analysis 의 readGatewayConfig 기본값과 같다(AI_GATEWAY_URL 이 비면 Compose 안의 gateway). */
export const DEFAULT_GATEWAY_URL = "http://ai-gateway:8000";

/** 05 §2 권한 열: ADMIN 만 연다(허용 역할 나열, 순서 관계 아님). */
export const AI_STATUS_ROLES: readonly SolRole[] = ["ADMIN"];

const runModeSchema = z.enum(["live", "fixture", "mock"]);
const providerSchema = z.enum(["mock", "local", "hosted"]);

// gateway GET /health 응답(03 §2.1, services/ai/src/sol_ai/app.py). 모르는 필드는 버린다.
// health 도메인이 analysis 를 런타임으로 불러오지 않도록 같은 모양을 여기 두고, 모양은 아래 타입 검사로 묶는다.
export const gatewayHealthSchema = z.object({
  status: z.literal("ok"),
  runMode: runModeSchema,
  provider: providerSchema,
  kevEnabled: z.boolean(),
  qwen: z.object({ model: z.string(), promptHash: z.string() }).nullable(),
  // mock 은 레지스트리와 대조하지 않으므로 registryMatch 가 null 이다.
  kev: z.object({ modelId: z.string(), registryMatch: z.boolean().nullable() }).nullable(),
  questionSets: z.array(z.string()),
  parsers: z.array(z.object({ format: z.string(), parserId: z.string().nullable() })),
});
export type GatewayHealthBody = z.infer<typeof gatewayHealthSchema>;

type SameShape<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
/** worker 쪽 계약(analysis 의 GatewayHealth)과 모양이 다르면 tsc 가 이 줄에서 멈춘다. */
export type GatewayHealthContractCheck = Expect<SameShape<GatewayHealthBody, GatewayHealth>>;

// 05 §385 AiStatus. gateway.runMode 만 더했다(gateway 가 보고한 실행 모드, 죽어 있으면 null) — web 과 모드가 어긋나면 보인다.
export const aiStatusSchema = z.object({
  runMode: runModeSchema,
  provider: providerSchema,
  hostedApproved: z.boolean(),
  gateway: z.object({
    url: z.string(),
    healthy: z.boolean(),
    checkedAt: z.iso.datetime(),
    runMode: runModeSchema.nullable(),
  }),
  qwen: z.object({
    model: z.string().nullable(),
    runtime: z.string().nullable(),
    healthy: z.boolean().nullable(),
  }),
  kev: z.object({
    enabled: z.boolean(),
    healthy: z.boolean().nullable(),
    model: z.string().nullable(),
    modelId: z.string().nullable(),
    run: z.string().nullable(),
    base: z.string().nullable(),
    lora: z.number().nullable(),
    temperature: z.number().nullable(),
    registryMatch: z.boolean().nullable(),
  }),
  questionSetVersion: z.string().nullable(),
  parsers: z.array(z.object({ format: z.string(), parserId: z.string() })),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;
export type AiProviderName = AiStatus["provider"];

/** url 은 화면에 보이는 주소, healthUrl 은 부를 주소다. healthUrl 이 null 이면 부르지 않고 gateway 불가로 본다. */
export type GatewayTarget = { url: string; healthUrl: string | null };

export type AiStatusEnv = {
  gateway: GatewayTarget;
  /** AI_PROVIDER 가 mock·local·hosted 중 하나일 때만 그 값. */
  provider: AiProviderName | null;
  hostedApproved: boolean;
  kevEnabled: boolean;
};

/**
 * 주소에서 계정 정보·쿼리·해시를 뺀 origin + path 만 남긴다(응답·로그에 비밀이 실리지 않게).
 * http·https 가 아니거나 해석할 수 없으면 url 은 빈 문자열이다. 계정 정보가 있으면 부르지 않는다
 * (fetch 가 거부하고, worker 의 readGatewayConfig 도 같은 주소를 거부한다).
 */
export function toGatewayTarget(raw: string | undefined): GatewayTarget {
  const trimmed = raw?.trim() ?? "";
  const value = trimmed === "" ? DEFAULT_GATEWAY_URL : trimmed;
  if (!URL.canParse(value)) return { url: "", healthUrl: null };
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url: "", healthUrl: null };
  }
  const url = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  const hasCredentials = parsed.username !== "" || parsed.password !== "";
  return { url, healthUrl: hasCredentials ? null : `${url}/health` };
}

const isProviderName = (value: string | undefined): value is AiProviderName =>
  value === "mock" || value === "local" || value === "hosted";

/** web 이 읽는 env(AI_GATEWAY_URL·AI_PROVIDER·AI_HOSTED_APPROVED·KEV_ENABLED). 값은 결과에 그대로 싣지 않는다. */
export function readAiStatusEnv(env: Record<string, string | undefined>): AiStatusEnv {
  return {
    gateway: toGatewayTarget(env.AI_GATEWAY_URL),
    provider: isProviderName(env.AI_PROVIDER) ? env.AI_PROVIDER : null,
    hostedApproved: env.AI_HOSTED_APPROVED === "true",
    kevEnabled: env.KEV_ENABLED !== "false",
  };
}

/** gateway 가 살아 있으면 그 provider, 아니면 env, env 도 없으면 실행 모드 기본값(work-deps 와 같은 규칙). */
export function resolveProvider(
  health: GatewayHealthBody | null,
  env: AiStatusEnv,
  runMode: RunMode,
): AiProviderName {
  return health?.provider ?? env.provider ?? (runMode === "mock" ? "mock" : "local");
}

/** 05 §5 422 HOSTED_NOT_APPROVED 의 조건. */
export const isHostedBlocked = (provider: AiProviderName, hostedApproved: boolean): boolean =>
  provider === "hosted" && !hostedApproved;

// gateway /health 가 주지 않는 값(Qwen runtime, Kev model·run·base·lora·temperature)은 null 이다.
// gateway 가 죽어 있으면 gateway 에서만 알 수 있는 값(healthy·modelId·registryMatch 등)도 null 이다.
// kev.healthy 는 registryMatch 를 따른다. registryMatch null 은 mock 이면 "대조하지 않음"(정상)이고,
// local·hosted 면 "기동 때 Kev 에 닿지 못해 미확인"이라 모른다(null). kev 항목이 없으면(hosted 의 UnavailableKev) 모른다.
function toKevHealthy(health: GatewayHealthBody | null, enabled: boolean): boolean | null {
  if (health === null || !enabled || health.kev === null) return null;
  return health.kev.registryMatch ?? (health.provider === "mock" ? true : null);
}

function toKevStatus(health: GatewayHealthBody | null, kevEnabledByEnv: boolean): AiStatus["kev"] {
  const enabled = health === null ? kevEnabledByEnv : health.kevEnabled;
  return {
    enabled,
    healthy: toKevHealthy(health, enabled),
    model: null,
    modelId: health?.kev?.modelId ?? null,
    run: null,
    base: null,
    lora: null,
    temperature: null,
    registryMatch: health?.kev?.registryMatch ?? null,
  };
}

export function toAiStatus(input: {
  runMode: RunMode;
  env: AiStatusEnv;
  /** null 이면 gateway 불가(부르지 않음·200 아님·스키마 위반·연결 실패·timeout). */
  health: GatewayHealthBody | null;
  checkedAt: Date;
}): AiStatus {
  const { runMode, env, health, checkedAt } = input;
  return {
    runMode,
    provider: resolveProvider(health, env, runMode),
    hostedApproved: env.hostedApproved,
    gateway: {
      url: env.gateway.url,
      healthy: health !== null,
      checkedAt: checkedAt.toISOString(),
      runMode: health?.runMode ?? null,
    },
    qwen: {
      model: health?.qwen?.model ?? null,
      runtime: null,
      healthy: health === null ? null : health.qwen !== null,
    },
    kev: toKevStatus(health, env.kevEnabled),
    questionSetVersion: health?.questionSets.at(0) ?? null,
    // 05 의 타입은 parserId: string 이다. 등록된 어댑터가 없는(null) 형식은 내지 않는다.
    parsers: (health?.parsers ?? []).flatMap(({ format, parserId }) =>
      parserId === null ? [] : [{ format, parserId }],
    ),
  };
}
