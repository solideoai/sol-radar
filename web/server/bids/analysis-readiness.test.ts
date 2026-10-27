import "server-only";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANALYSIS_READS_ATTACHMENT_TEXT } from "@/server/analysis";
import { fixtureFileSchema, normalizeFixtureRecord } from "@/server/ingestion";
import { analysisReadinessOf, isAnalyzableDocument } from "./analysis-readiness.model";

const BIDS_DIR = fileURLToPath(new URL("../../../fixtures/bids/", import.meta.url));
const READY = { ready: true, reason: null };
const MISSING = { ready: false, reason: "SOURCE_TEXT_MISSING" };
const BLANK_CONTENTS = ["", "   \n\t", null, undefined];

describe("분석 원문 준비 판정", () => {
  it("본문이 공백뿐이고 분석 가능한 첨부가 없으면 첨부를 읽든 말든 SOURCE_TEXT_MISSING 이다", () => {
    for (const content of BLANK_CONTENTS) {
      for (const readsAttachmentText of [false, true]) {
        expect(
          analysisReadinessOf({ content, hasAnalyzableDocument: false, readsAttachmentText }),
        ).toEqual(MISSING);
      }
    }
  });

  it("본문이 있으면 첨부와 상관없이 분석할 수 있다", () => {
    for (const readsAttachmentText of [false, true]) {
      for (const hasAnalyzableDocument of [false, true]) {
        expect(
          analysisReadinessOf({ content: "공고 본문", hasAnalyzableDocument, readsAttachmentText }),
        ).toEqual(READY);
      }
    }
  });

  // 분석 runtime 은 첨부 텍스트 reader(@/server/documents)를 쓴다(2026-10-27). 실공고는 본문이 비어 첨부로만 분석된다.
  it("분석 runtime 이 첨부 텍스트를 읽으므로 본문이 비어도 파싱된 첨부로 분석할 수 있다", () => {
    for (const content of BLANK_CONTENTS) {
      expect(
        analysisReadinessOf({
          content,
          hasAnalyzableDocument: true,
          readsAttachmentText: ANALYSIS_READS_ATTACHMENT_TEXT,
        }),
      ).toEqual(READY);
      // 분석이 첨부를 읽지 않는 runtime 이면 같은 공고를 받지 않는다(근거 없는 분석 금지).
      expect(
        analysisReadinessOf({ content, hasAnalyzableDocument: true, readsAttachmentText: false }),
      ).toEqual(MISSING);
    }
  });

  it("첨부는 PARSED·PARTIAL 이고 텍스트 객체가 저장된 것만 분석 가능하다", () => {
    const doc = (parse_status: string | null, text_object_key: string | null) =>
      isAnalyzableDocument({ parse_status, text_object_key });
    expect(doc("PARSED", "parsed/a.txt")).toBe(true);
    expect(doc("PARTIAL", "parsed/a.txt")).toBe(true);
    expect(doc("PARSED", null)).toBe(false);
    for (const status of ["PENDING", "UNSUPPORTED", "FAILED", null]) {
      expect(doc(status, "parsed/a.txt")).toBe(false);
    }
  });

  // Compose 데모·E2E 의 fixture DEMO 공고는 본문(content)으로 분석된다. 특례 없이 모두 분석 가능해야 한다.
  it("fixtures/bids 의 정규화된 DEMO 공고는 모두 본문이 있어 분석할 수 있다", async () => {
    const files = (await readdir(BIDS_DIR)).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThanOrEqual(20);
    const at = new Date("2026-10-26T00:00:00.000Z");
    let normalized = 0;
    for (const name of files) {
      const file = fixtureFileSchema.parse(JSON.parse(await readFile(BIDS_DIR + name, "utf8")));
      for (const record of file.records) {
        const outcome = normalizeFixtureRecord(record, { fetchedAt: at, anchor: at });
        if (!outcome.ok) continue;
        normalized += 1;
        expect(
          analysisReadinessOf({
            content: outcome.draft.content,
            hasAnalyzableDocument: false,
            readsAttachmentText: ANALYSIS_READS_ATTACHMENT_TEXT,
          }),
          `${name} ${String(record.noticeId)}`,
        ).toEqual(READY);
      }
    }
    expect(normalized).toBeGreaterThanOrEqual(20);
  });
});
