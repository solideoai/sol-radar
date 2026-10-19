import "server-only";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { exceedsMaxBytes } from "./attachment-allowlist";
import {
  DOCUMENT_FORMAT_MIME,
  type AttachmentFetcher,
  type AttachmentFetchResult,
  type DownloadErrorCode,
} from "./attachment.model";
import { detectDocumentFormat } from "./document-format";

// ── FixtureAttachmentFetcher: fixture 첨부(fixtures/docs/)를 읽는다. 네트워크를 부르지 않는다 ──
const FIXTURE_DOC_PREFIX = "fixtures/docs/";
const FIXTURE_DOC_URL = /^fixtures\/docs\/[A-Za-z0-9._-]+$/;
// 없는 파일·폴더 자리의 파일 이름은 "찾을 수 없음" 이다. 그 밖의 파일 시스템 오류는 환경 문제라 던진다.
const NOT_FOUND_ERRNO: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

const failed = (errorCode: DownloadErrorCode): AttachmentFetchResult => ({
  status: "FAILED",
  errorCode,
});

const isNotFoundError = (error: unknown): boolean =>
  error instanceof Error &&
  "code" in error &&
  typeof error.code === "string" &&
  NOT_FOUND_ERRNO.has(error.code);

async function readDoc(path: string): Promise<AttachmentFetchResult> {
  const info = await stat(path);
  if (!info.isFile()) return failed("NOT_FOUND");
  // 크기를 먼저 봐서 50 MB 를 넘는 파일은 메모리에 올리지 않는다.
  if (exceedsMaxBytes(info.size)) return failed("TOO_LARGE");
  const bytes = await readFile(path);
  if (exceedsMaxBytes(bytes.byteLength)) return failed("TOO_LARGE");
  const format = detectDocumentFormat(bytes);
  return {
    status: "OK",
    bytes,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    format,
    mimeType: DOCUMENT_FORMAT_MIME[format],
  };
}

export function createFixtureAttachmentFetcher(options: {
  fixturesDir: string;
}): AttachmentFetcher {
  return {
    async fetch(ref) {
      // fixturesDir 밖으로 나가는 경로(../·하위 폴더·절대 경로)는 파일을 열기 전에 막는다.
      if (!FIXTURE_DOC_URL.test(ref.url) || ref.url.includes("..")) {
        return failed("HOST_NOT_ALLOWED");
      }
      const fileName = ref.url.slice(FIXTURE_DOC_PREFIX.length);
      try {
        return await readDoc(join(options.fixturesDir, "docs", fileName));
      } catch (error) {
        if (isNotFoundError(error)) return failed("NOT_FOUND");
        throw error;
      }
    },
  };
}
