import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/database.types";
import { createAttachmentTextReader } from "./document-text.repo";
import { PARSED_DOCUMENT_SCHEMA_VERSION } from "./document-processing.model";

// 진짜 supabase-js 에 가짜 전송을 넣어, 분석 입력으로 넘기는 첨부 텍스트의 순서·상한·근거 로그를 본다.
const REVISION = "be500000-0000-4000-8000-000000000001";
const SHA = "a".repeat(64);
const id = (n: number) => `d0c00000-0000-4000-8000-00000000000${n}`;

type Row = {
  id: string;
  name: string;
  parse_status: string | null;
  text_object_key: string | null;
  text_storage_bucket?: string | null;
};

function harness(rows: Row[], objects: Record<string, unknown>) {
  const transport: typeof fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/rest/v1/bid_documents")
      return Response.json(
        rows.map((row) => ({
          sha256: SHA,
          download_status: row.parse_status === null ? "PENDING" : "OK",
          download_error_code: null,
          parse_error_code: null,
          parsed_storage_id: row.text_object_key,
          text_storage_bucket: row.text_object_key === null ? null : "bid-parsed",
          ...row,
        })),
      );
    const key = decodeURIComponent(pathname.replace("/storage/v1/object/bid-parsed/", ""));
    return key in objects
      ? Response.json(objects[key])
      : Response.json({ message: "not found" }, { status: 404 });
  };
  const client = createClient<Database>("http://supabase.test", "worker-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: transport },
  });
  const logs: string[] = [];
  const reader = createAttachmentTextReader(
    client,
    { parsedBucket: "bid-parsed", maxCharsPerDocument: 1_000, maxTotalChars: 1_800 },
    (line) => logs.push(line),
  );
  return { reader, logs };
}

const textObject = (documentId: string, text: string, overrides: Record<string, unknown> = {}) => ({
  schemaVersion: PARSED_DOCUMENT_SCHEMA_VERSION,
  documentId,
  rawSha256: SHA,
  status: "PARSED",
  parserId: "pdf-test@1",
  text,
  // 쪽 시작 오프셋은 text 안에만 둔다(계약)
  pages: [0, 900, 1_200]
    .filter((offset) => offset <= text.length)
    .map((charOffset, index) => ({ page: index + 1, charOffset })),
  ...overrides,
});

describe("첨부 텍스트 reader", () => {
  it("본문 문서를 먼저, 문서당·전체 상한까지만 넣고 넣은 것·뺀 것을 로그로 남긴다", async () => {
    const { reader, logs } = harness(
      [
        { id: id(1), name: "별지 서식_서약서.hwp", parse_status: "PARSED", text_object_key: "k1" },
        { id: id(2), name: "제안요청서.pdf", parse_status: "PARTIAL", text_object_key: "k2" },
        { id: id(3), name: "공고서.hwpx", parse_status: "PARSED", text_object_key: "k3" },
        { id: id(4), name: "과업지시서.pdf", parse_status: null, text_object_key: null },
      ],
      {
        k1: textObject(id(1), "서".repeat(1_500)),
        k2: textObject(id(2), "제".repeat(1_500), { status: "PARTIAL" }),
        k3: textObject(id(3), "공".repeat(600)),
      },
    );

    const documents = await reader.readRevisionDocuments(REVISION);

    expect(
      documents.map((document) => [document.documentId, document.text?.length ?? null]),
    ).toEqual([
      [id(3), 600],
      // 과업지시서는 아직 파싱 전이라 텍스트가 없다(추측해 채우지 않는다).
      [id(4), null],
      [id(2), 1_000],
      // 양식은 맨 뒤라 전체 상한(1,800자)의 남은 200자만 들어간다.
      [id(1), 200],
    ]);
    // 자른 뒤에 시작하는 쪽(1,200자)은 빼고, 자른 곳 앞에서 시작한 쪽은 남긴다.
    expect(documents[2].pages.map((page) => page.page)).toEqual([1, 2]);
    expect(documents[3].pages.map((page) => page.page)).toEqual([1]);
    expect(JSON.parse(logs[0])).toEqual({
      event: "analysis.attachments",
      revisionId: REVISION,
      included: [
        { documentId: id(3), chars: 600, truncated: false },
        { documentId: id(2), chars: 1_000, truncated: true },
        { documentId: id(1), chars: 200, truncated: true },
      ],
      omitted: [],
    });
  });

  it("전체 상한이 찬 뒤의 문서와 계약이 다른 텍스트 객체는 넣지 않는다", async () => {
    const { reader, logs } = harness(
      [
        { id: id(1), name: "공고문.pdf", parse_status: "PARSED", text_object_key: "k1" },
        { id: id(2), name: "제안요청서.pdf", parse_status: "PARSED", text_object_key: "k2" },
        { id: id(3), name: "설명서.pdf", parse_status: "PARSED", text_object_key: "k3" },
        { id: id(5), name: "입찰공고.pdf", parse_status: "PARSED", text_object_key: "k5" },
      ],
      {
        k1: textObject(id(1), "가".repeat(1_000)),
        // 다른 원본에서 만든 텍스트(rawSha256 불일치)
        k2: textObject(id(2), "나".repeat(100), { rawSha256: "b".repeat(64) }),
        k3: textObject(id(3), "다".repeat(500)),
        k5: textObject(id(5), "라".repeat(800)),
      },
    );

    const documents = await reader.readRevisionDocuments(REVISION);
    const byId = new Map(documents.map((document) => [document.documentId, document]));

    expect(byId.get(id(2))).toMatchObject({
      text: null,
      parseStatus: "FAILED",
      parseErrorCode: "PARSER_ERROR",
    });
    expect(byId.get(id(5))?.text).toHaveLength(800);
    expect(byId.get(id(3))?.text ?? null).toBeNull();
    expect(JSON.parse(logs[0]).omitted).toEqual([
      { documentId: id(2), reason: "INVALID_OBJECT" },
      { documentId: id(3), reason: "TOTAL_CAP" },
    ]);
  });
});
