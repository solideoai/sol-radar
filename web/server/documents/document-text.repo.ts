import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { AttachmentTextReader, RevisionDocumentText } from "@/server/ingestion";
import {
  parsedDocumentSchema,
  type AttachmentTextSettings,
  type ParsedDocument,
} from "./document-processing.model";
import { documentPriorityOf } from "./document-selection.model";

// ── 첨부 텍스트 reader(분석 입력): revision 의 PARSED·PARTIAL 첨부 텍스트를 bid-parsed 에서 읽는다 ──
// 분석 worker 가 service role 클라이언트를 넘긴다. 텍스트는 파싱이 끝나 텍스트 객체가 저장된 문서에만 있다.
// 파싱하지 못한 문서의 내용을 추측해 채우지 않는다(15 §5.1). 문서 순서가 /extract 첨부 순서다(본문 문서 먼저).
// 문서당·전체 글자 상한을 넘는 부분은 뒤에서 자른다. 무엇을 넣고 무엇을 뺐는지는 로그 한 줄(analysis.attachments)로 남긴다.
// 로그에는 id·상태·글자 수만 싣는다(문서 이름·본문은 싣지 않는다).

type Client = SupabaseClient<Database>;

const DOCUMENT_COLUMNS =
  "id, name, sha256, download_status, download_error_code, parse_status, parse_error_code, text_storage_bucket, text_object_key, parsed_storage_id";
const ANALYZABLE: ReadonlySet<string> = new Set(["PARSED", "PARTIAL"]);
const DOWNLOAD_STATUSES = ["PENDING", "OK", "FAILED"] as const;
const PARSE_STATUSES = ["PENDING", "PARSED", "PARTIAL", "UNSUPPORTED", "FAILED"] as const;
/** 텍스트 객체는 불변(원장 id 마다 한 파일)이라 id 로 담아 두고 다시 읽지 않는다. loader·추출이 같은 revision 을 두 번 읽는다 */
const CACHE_SIZE = 16;
const DOWNLOAD_TIMEOUT_MS = 60_000;

type Row = {
  id: string;
  name: string;
  sha256: string | null;
  download_status: string;
  download_error_code: string | null;
  parse_status: string | null;
  parse_error_code: string | null;
  text_storage_bucket: string | null;
  text_object_key: string | null;
  parsed_storage_id: string | null;
};

type Content = { text: string; pages: ParsedDocument["pages"] };
/** 문서당 상한으로 자른 내용. truncated 는 원문이 상한보다 길었는가 */
type CappedContent = Content & { truncated: boolean };

export type AttachmentReadLog = {
  documentId: string;
  chars: number;
  truncated: boolean;
};
export type AttachmentOmitLog = {
  documentId: string;
  reason: "TOTAL_CAP" | "INVALID_OBJECT";
};

const pick = <T extends string>(values: readonly T[], value: string | null): T | null =>
  values.find((candidate) => candidate === value) ?? null;

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

/** 본문 문서(공고서·제안요청서) 먼저. 같은 순위면 이름·id 순이라 같은 행이면 늘 같은 순서다 */
const orderForAnalysis = (rows: Row[]): Row[] =>
  rows.toSorted(
    (left, right) =>
      documentPriorityOf(left.name) - documentPriorityOf(right.name) ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id),
  );

/** 앞에서 limit 자까지. 서로게이트 쌍을 가르지 않는다. 자른 뒤 시작하는 쪽은 뺀다(오프셋은 그대로 맞다) */
export function truncateContent(content: Content, limit: number): CappedContent {
  if (content.text.length <= limit)
    return { text: content.text, pages: content.pages, truncated: false };
  const code = content.text.charCodeAt(limit - 1);
  const end = code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit;
  return {
    text: content.text.slice(0, end),
    pages: content.pages.filter((page) => page.charOffset < end),
    truncated: true,
  };
}

const toView = (row: Row): RevisionDocumentText => ({
  documentId: row.id,
  name: row.name,
  downloadStatus: pick(DOWNLOAD_STATUSES, row.download_status) ?? "PENDING",
  downloadErrorCode: row.download_error_code,
  parseStatus: pick(PARSE_STATUSES, row.parse_status),
  parseErrorCode: row.parse_error_code,
  text: null,
  pages: [],
});

export function createAttachmentTextReader(
  client: Client,
  settings: AttachmentTextSettings,
  log: (line: string) => void = () => undefined,
): AttachmentTextReader {
  const cache = new Map<string, CappedContent>();
  const remember = (key: string, content: CappedContent) => {
    cache.set(key, content);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value ?? key);
  };

  /** 저장 오류는 던진다(분석 job 재시도). 객체가 계약과 다르면 null(그 문서는 읽지 못한 것으로 본다) */
  async function readContent(
    row: Row,
    bucket: string,
    path: string,
  ): Promise<CappedContent | null> {
    const key = row.parsed_storage_id ?? `${bucket}/${path}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const downloaded = await client.storage
      .from(bucket)
      .download(path, {}, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (downloaded.error || !downloaded.data)
      throw new Error("documents store 오류: bid-parsed.download");
    let json: unknown;
    try {
      json = JSON.parse(await downloaded.data.text());
    } catch {
      return null;
    }
    const parsed = parsedDocumentSchema.safeParse(json);
    if (
      !parsed.success ||
      parsed.data.documentId !== row.id ||
      parsed.data.rawSha256 !== row.sha256
    )
      return null;
    const content = truncateContent(parsed.data, settings.maxCharsPerDocument);
    remember(key, content);
    return content;
  }

  return {
    async readRevisionDocuments(revisionId) {
      const { data, error } = await client
        .from("bid_documents")
        .select(DOCUMENT_COLUMNS)
        .eq("revision_id", revisionId);
      if (error) throw new Error(`documents store 오류: bid_documents.select ${error.code ?? ""}`);
      const included: AttachmentReadLog[] = [];
      const omitted: AttachmentOmitLog[] = [];
      const views: RevisionDocumentText[] = [];
      let total = 0;
      for (const row of orderForAnalysis(data)) {
        const view = toView(row);
        const bucket = row.text_storage_bucket;
        const path = row.text_object_key;
        if (!ANALYZABLE.has(row.parse_status ?? "") || bucket === null || path === null) {
          views.push(view);
          continue;
        }
        // 텍스트 객체는 설정한 bid-parsed 버킷에서만 읽는다. 다른 버킷을 가리키면 계약 위반으로 본다.
        const content =
          bucket === settings.parsedBucket ? await readContent(row, bucket, path) : null;
        if (content === null) {
          omitted.push({ documentId: row.id, reason: "INVALID_OBJECT" });
          // 분석 입력에서는 읽지 못한 문서다. 첨부 문제(attachmentsIncomplete)로 드러나게 FAILED 로 본다(DB 는 바꾸지 않는다).
          views.push({ ...view, parseStatus: "FAILED", parseErrorCode: "PARSER_ERROR" });
          continue;
        }
        const room = settings.maxTotalChars - total;
        if (room <= 0) {
          omitted.push({ documentId: row.id, reason: "TOTAL_CAP" });
          views.push(view);
          continue;
        }
        const cut = truncateContent(content, room);
        total += cut.text.length;
        included.push({
          documentId: row.id,
          chars: cut.text.length,
          truncated: cut.truncated || content.truncated,
        });
        views.push({ ...view, text: cut.text, pages: cut.pages });
      }
      if (included.length > 0 || omitted.length > 0)
        log(JSON.stringify({ event: "analysis.attachments", revisionId, included, omitted }));
      return views;
    },
  };
}
