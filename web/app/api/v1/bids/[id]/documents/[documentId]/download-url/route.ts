import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound } from "@/app/api/v1/_lib/work-route";
import { isUuid } from "@/server/bids";
import { getDocumentDownload } from "@/server/documents";

export async function GET(
  request: Request,
  context: RouteContext<"/api/v1/bids/[id]/documents/[documentId]/download-url">,
) {
  return businessRoute(request, async () => {
    const { id, documentId } = await context.params;
    if (!isUuid(id) || !isUuid(documentId)) return pathNotFound("bid");
    return serviceResponse(await getDocumentDownload(id, documentId));
  });
}
