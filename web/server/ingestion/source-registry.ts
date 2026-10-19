import "server-only";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ── 수집 소스 registry(15 §8, infra/sources/registry.yaml). Connector 는 여기 등록한 엔드포인트만 부른다 ──
// 등록이 끝나지 않은 소스(승인 전·endpoint 없음·fieldMapping 비어 있음·서비스키 env 없음)는 부르지 않는다.
export const SOURCE_REGISTRY_SCHEMA_VERSION = "sol-sources/v0.1";
export const APPROVAL_STATUSES = ["NOT_REQUESTED", "PENDING", "APPROVED"] as const;

const sourceEntrySchema = z.strictObject({
  key: z.string().min(1),
  displayName: z.string().min(1),
  provider: z.string().min(1),
  serviceId: z.string().min(1).nullable(),
  // env 이름만 둔다. 서비스키 값은 registry 에 두지 않는다(07 §2.2, ADR-022)
  serviceKeyEnv: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/)
    .nullable(),
  approvalStatus: z.enum(APPROVAL_STATUSES),
  endpoint: z
    .strictObject({
      baseUrl: z.url({ protocol: /^https?$/ }),
      operations: z.array(z.string().min(1)),
    })
    .nullable(),
  method: z.literal("GET"),
  quota: z
    .strictObject({
      daily: z.number().int().min(0).nullable(),
      tps: z.number().int().min(0).nullable(),
    })
    .nullable(),
  fieldMapping: z.record(z.string(), z.string()),
  changeNoticeUrl: z.url().nullable(),
  redistributionLimit: z.string(),
  sampleResponses: z.array(z.string().min(1)),
  lastVerifiedAt: z.iso.date(),
});

export const sourceRegistrySchema = z.strictObject({
  schemaVersion: z.literal(SOURCE_REGISTRY_SCHEMA_VERSION),
  sources: z.array(sourceEntrySchema),
});

export type SourceEntry = z.infer<typeof sourceEntrySchema>;
export type SourceRegistry = z.infer<typeof sourceRegistrySchema>;

// zod 메시지에는 받은 값이 들어갈 수 있어서 경로만 남긴다.
const issuePathsOf = (error: z.ZodError): string =>
  [
    ...new Set(
      error.issues.map(({ path }) => (path.length === 0 ? "(root)" : path.map(String).join("."))),
    ),
  ].join(", ");

function parseYamlFile(text: string, path: string): unknown {
  try {
    return parseYaml(text);
  } catch {
    throw new Error(`수집 소스 registry 가 YAML 이 아니다: ${path}`);
  }
}

/** 07 §7 과 같게 잘못된 registry 는 조용히 건너뛰지 않고 기동을 멈춘다. */
export async function loadSourceRegistry(path: string): Promise<SourceRegistry> {
  const parsed = sourceRegistrySchema.safeParse(parseYamlFile(await readFile(path, "utf8"), path));
  if (!parsed.success) {
    throw new Error(`수집 소스 registry 형식이 잘못됐다: ${issuePathsOf(parsed.error)}`);
  }
  return parsed.data;
}

export type CallableSource = {
  key: string;
  baseUrl: string;
  serviceKeyEnv: string;
  operations: string[];
};

export type CallableSourceResult =
  | { ok: true; source: CallableSource }
  | {
      ok: false;
      reason:
        | "NOT_REGISTERED"
        | "NOT_APPROVED"
        | "NO_ENDPOINT"
        | "NO_FIELD_MAPPING"
        | "NO_SERVICE_KEY_ENV";
    };

export function callableSource(registry: SourceRegistry, key: string): CallableSourceResult {
  const entry = registry.sources.find((source) => source.key === key);
  if (entry === undefined) return { ok: false, reason: "NOT_REGISTERED" };
  if (entry.approvalStatus !== "APPROVED") return { ok: false, reason: "NOT_APPROVED" };
  if (entry.endpoint === null) return { ok: false, reason: "NO_ENDPOINT" };
  if (Object.keys(entry.fieldMapping).length === 0)
    return { ok: false, reason: "NO_FIELD_MAPPING" };
  if (entry.serviceKeyEnv === null) return { ok: false, reason: "NO_SERVICE_KEY_ENV" };
  return {
    ok: true,
    source: {
      key: entry.key,
      baseUrl: entry.endpoint.baseUrl,
      serviceKeyEnv: entry.serviceKeyEnv,
      operations: [...entry.endpoint.operations],
    },
  };
}
