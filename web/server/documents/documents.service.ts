import "server-only";
import type { DownloadRepo } from "./documents.model";
import { documentsRepo } from "./documents.repo";

export async function getDocumentDownload(
  bidId: string,
  documentId: string,
  repo: DownloadRepo = documentsRepo,
) {
  const document = await repo.find(bidId, documentId);
  if (
    !document ||
    document.bidId !== bidId ||
    document.downloadStatus !== "OK" ||
    !document.bucket ||
    !document.path
  )
    return {
      ok: false as const,
      status: 404,
      code: "NOT_FOUND" as const,
      message: "다운로드할 문서를 찾을 수 없습니다",
      details: { resource: "document" },
    };
  try {
    const url = await repo.sign(document.bucket, document.path, document.name, 60);
    return { ok: true as const, status: 200, data: { url, expiresIn: 60 } };
  } catch {
    return {
      ok: false as const,
      status: 503,
      code: "SERVICE_UNAVAILABLE" as const,
      message: "문서 저장소에 연결할 수 없습니다",
      details: { component: "storage" },
    };
  }
}
