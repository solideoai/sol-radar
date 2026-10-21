import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProgramNoticesConfig } from "./config";

const REPO_CONFIG = join(__dirname, "..", "..", "..", "infra", "sources", "program-notices.yaml");

const writeConfig = (text: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "program-notices-config-")), "config.yaml");
  writeFileSync(file, text);
  return file;
};

const VALID = `schemaVersion: program-notices/v0.1
sources:
  bizinfo:
    enabled: true
    baseUrl: https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do
    keyEnv: BIZINFO_API_KEY
    categories: ["02"]
    maxItems: 100
  mss:
    enabled: true
    baseUrl: https://mss.go.kr/rss/smba/board/310.do
`;

describe("loadProgramNoticesConfig", () => {
  it("저장소의 설정 파일을 읽는다(기업마당 분야 02·최대 100건, 중기부 RSS 310)", async () => {
    expect(await loadProgramNoticesConfig(REPO_CONFIG)).toEqual({
      ok: true,
      config: {
        bizinfo: {
          ok: true,
          value: {
            enabled: true,
            baseUrl: "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do",
            keyEnv: "BIZINFO_API_KEY",
            categories: ["02"],
            maxItems: 100,
          },
        },
        mss: {
          ok: true,
          value: { enabled: true, baseUrl: "https://mss.go.kr/rss/smba/board/310.do" },
        },
      },
    });
  });

  it("파일이 없거나 YAML 이 아니거나 schemaVersion 이 다르면 ok:false 다(던지지 않는다)", async () => {
    for (const file of [
      join(tmpdir(), "program-notices-config-missing", "none.yaml"),
      writeConfig("schemaVersion: [unclosed"),
      writeConfig(VALID.replace("program-notices/v0.1", "program-notices/v9")),
      writeConfig("- 1\n- 2\n"),
    ]) {
      const result = await loadProgramNoticesConfig(file);
      expect(result.ok).toBe(false);
    }
  });

  it("허용 호스트 밖·https 아님·다른 소스의 호스트면 그 소스만 끄고 사유에 값을 싣지 않는다", async () => {
    for (const baseUrl of [
      "https://evil.example/rss",
      "http://mss.go.kr/rss/smba/board/310.do",
      "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do",
    ]) {
      const result = await loadProgramNoticesConfig(
        writeConfig(VALID.replace("https://mss.go.kr/rss/smba/board/310.do", baseUrl)),
      );
      if (!result.ok) throw new Error("파일 단위로 실패하면 안 된다");
      expect(result.config.bizinfo.ok).toBe(true);
      expect(result.config.mss.ok).toBe(false);
      expect(JSON.stringify(result.config.mss)).not.toContain(baseUrl);
    }
  });

  it("keyEnv 는 BIZINFO_API_KEY 만 받는다", async () => {
    const result = await loadProgramNoticesConfig(
      writeConfig(VALID.replace("keyEnv: BIZINFO_API_KEY", "keyEnv: SUPABASE_SERVICE_ROLE_KEY")),
    );
    if (!result.ok) throw new Error("파일 단위로 실패하면 안 된다");
    expect(result.config.bizinfo.ok).toBe(false);
    expect(JSON.stringify(result.config.bizinfo)).not.toContain("SUPABASE");
    expect(result.config.mss.ok).toBe(true);
  });

  it("분야 코드·건수가 틀리거나 소스가 빠지면 그 소스만 끈다", async () => {
    const badCategory = await loadProgramNoticesConfig(
      writeConfig(VALID.replace('["02"]', '["2a"]')),
    );
    const tooMany = await loadProgramNoticesConfig(
      writeConfig(VALID.replace("maxItems: 100", "maxItems: 5000")),
    );
    const noMss = await loadProgramNoticesConfig(writeConfig(VALID.split("  mss:")[0] ?? ""));
    for (const result of [badCategory, tooMany]) {
      if (!result.ok) throw new Error("파일 단위로 실패하면 안 된다");
      expect(result.config.bizinfo.ok).toBe(false);
      expect(result.config.mss.ok).toBe(true);
    }
    if (!noMss.ok) throw new Error("파일 단위로 실패하면 안 된다");
    expect(noMss.config.mss.ok).toBe(false);
    expect(noMss.config.bizinfo.ok).toBe(true);
  });
});
