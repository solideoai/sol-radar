import "server-only";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

// ── 부처 공고 수집 설정(infra/sources/program-notices.yaml) ──
// 나라장터 registry(infra/sources/registry.yaml)와 따로 둔다. 그 계약을 고치지 않으려는 것이다(스펙 §3).
// 틀려도 던지지 않는다. 파일이 틀리면 부처 수집 전체를, 한 소스만 틀리면 그 소스만 끈다(worker 기동·나라장터 수집은 그대로).
// 사유에는 틀린 칸의 경로만 담는다. 값(주소·env 이름)은 로그로 새지 않게 싣지 않는다.

export const PROGRAM_NOTICES_SCHEMA_VERSION = "program-notices/v0.1";
export const BIZINFO_KEY_ENV = "BIZINFO_API_KEY";
export const MSIT_KEY_ENV = "MSIT_ANNOUNCEMENT_API_KEY";

const BIZINFO_HOST = "www.bizinfo.go.kr";
const MSS_HOST = "mss.go.kr";
const MSIT_HOST = "apis.data.go.kr";

const httpsOn = (host: string) =>
  z.string().refine(
    (raw) => {
      if (!URL.canParse(raw)) return false;
      const url = new URL(raw);
      return (
        url.protocol === "https:" &&
        url.hostname === host &&
        url.port === "" &&
        url.username === "" &&
        url.password === ""
      );
    },
    { message: "허용 호스트의 https 주소가 아니다" },
  );

const bizinfoSchema = z.strictObject({
  enabled: z.boolean(),
  baseUrl: httpsOn(BIZINFO_HOST),
  keyEnv: z.literal(BIZINFO_KEY_ENV),
  categories: z.array(z.string().regex(/^\d{2}$/)).max(8),
  maxItems: z.number().int().min(1).max(500),
});

const mssSchema = z.strictObject({
  enabled: z.boolean(),
  baseUrl: httpsOn(MSS_HOST),
});

// 과기정통부 사업공고(공공데이터포털 15074634). 한 회차에 요청 1번이고, 서버는 numOfRows 와 상관없이 최대 10건을 준다(2026-11-01 녹음).
const msitSchema = z.strictObject({
  enabled: z.boolean(),
  baseUrl: httpsOn(MSIT_HOST),
  keyEnv: z.literal(MSIT_KEY_ENV),
  maxItems: z.number().int().min(1).max(99),
});

const fileSchema = z.object({
  schemaVersion: z.literal(PROGRAM_NOTICES_SCHEMA_VERSION),
  sources: z.record(z.string(), z.unknown()),
});

export type BizinfoConfig = z.infer<typeof bizinfoSchema>;
export type MssConfig = z.infer<typeof mssSchema>;
export type MsitConfig = z.infer<typeof msitSchema>;
export type SourceConfig<T> = { ok: true; value: T } | { ok: false; reason: string };
export type ProgramNoticesConfig = {
  bizinfo: SourceConfig<BizinfoConfig>;
  mss: SourceConfig<MssConfig>;
  msit: SourceConfig<MsitConfig>;
};
export type LoadConfigResult =
  { ok: true; config: ProgramNoticesConfig } | { ok: false; reason: string };

// zod 메시지에는 받은 값이 들어갈 수 있다. 경로만 남긴다.
const pathsOf = (prefix: string, error: z.ZodError): string =>
  [...new Set(error.issues.map(({ path }) => [prefix, ...path.map(String)].join(".")))].join(", ");

function sourceConfig<T>(name: string, schema: z.ZodType<T>, raw: unknown): SourceConfig<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, reason: `설정 형식 오류: ${pathsOf(`sources.${name}`, parsed.error)}` };
}

/** 설정 파일을 읽는다. 던지지 않는다. */
export async function loadProgramNoticesConfig(file: string): Promise<LoadConfigResult> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return { ok: false, reason: "설정 파일을 읽을 수 없다" };
  }
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch {
    return { ok: false, reason: "설정 파일이 YAML 이 아니다" };
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, reason: `설정 형식 오류: ${pathsOf("(root)", parsed.error)}` };
  const { sources } = parsed.data;
  return {
    ok: true,
    config: {
      bizinfo: sourceConfig("bizinfo", bizinfoSchema, sources.bizinfo),
      mss: sourceConfig("mss", mssSchema, sources.mss),
      msit: sourceConfig("msit", msitSchema, sources.msit),
    },
  };
}
