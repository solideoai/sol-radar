import { projectDeps } from "@/app/_lib/project-deps";
import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { bodyTooLarge, isUuid } from "@/server/bids";
import { recordProjectResult } from "@/server/projects";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("project");
    const body = await readJsonBody(request);
    return serviceResponse(
      body.ok ? await recordProjectResult(ctx, id, body.value, projectDeps()) : bodyTooLarge(),
    );
  });
}
