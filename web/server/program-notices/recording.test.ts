import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadProgramRecordings, PROGRAM_RECORDED_SCHEMA_VERSION } from "./recording";

const recording = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: PROGRAM_RECORDED_SCHEMA_VERSION,
  source: "mss",
  params: { board: "310" },
  fetchedAt: "2026-10-21T01:00:00.000Z",
  httpStatus: 200,
  contentType: "application/rss+xml;charset=UTF-8",
  body: "<rss><channel></channel></rss>",
  rawSha256: "a".repeat(64),
  masked: true,
  maskedFields: [],
  note: "시험",
  ...overrides,
});

const dirWith = (files: Record<string, unknown>): string => {
  const root = mkdtempSync(join(tmpdir(), "program-recordings-"));
  for (const [name, content] of Object.entries(files)) {
    const [source] = name.split("/");
    mkdirSync(join(root, source ?? ""), { recursive: true });
    writeFileSync(
      join(root, name),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }
  return root;
};

describe("loadProgramRecordings", () => {
  it("폴더가 없으면 빈 목록이다", async () => {
    expect(await loadProgramRecordings(join(tmpdir(), "program-recordings-none"), "mss")).toEqual({
      recordings: [],
      skipped: 0,
    });
  });

  it("그 소스 폴더의 녹음을 등록 시각이 늦은 것부터 돌려준다", async () => {
    const root = dirWith({
      "mss/a.masked.json": recording({ fetchedAt: "2026-10-20T01:00:00.000Z", note: "옛" }),
      "mss/b.masked.json": recording({ fetchedAt: "2026-10-21T01:00:00.000Z", note: "새" }),
      "bizinfo/c.masked.json": recording({ source: "bizinfo" }),
    });
    const { recordings, skipped } = await loadProgramRecordings(root, "mss");
    expect(recordings.map((item) => item.note)).toEqual(["새", "옛"]);
    expect(skipped).toBe(0);
  });

  it("crtfcKey 파라미터·가림 표시 없음·다른 소스·JSON 아님은 건너뛰고 센다", async () => {
    const root = dirWith({
      "bizinfo/key.masked.json": recording({ source: "bizinfo", params: { CrtfcKey: "x" } }),
      "bizinfo/unmasked.masked.json": recording({ source: "bizinfo", masked: false }),
      "bizinfo/other.masked.json": recording({ source: "mss" }),
      "bizinfo/broken.masked.json": "{not json",
      "bizinfo/ok.masked.json": recording({ source: "bizinfo" }),
      "bizinfo/readme.md": "json 이 아닌 파일은 보지 않는다",
    });
    const { recordings, skipped } = await loadProgramRecordings(root, "bizinfo");
    expect(recordings).toHaveLength(1);
    expect(skipped).toBe(4);
  });
});
