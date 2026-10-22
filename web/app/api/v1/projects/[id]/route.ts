import { projectDeps } from "@/app/_lib/project-deps";
import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { bodyTooLarge, isUuid } from "@/server/bids";
import { getProject, updateProject } from "@/server/projects";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    return isUuid(id)
      ? serviceResponse(await getProject(ctx, id, projectDeps()))
      : pathNotFound("project");
  });
}
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("project");
    const body = await readJsonBody(request);
    return serviceResponse(
      body.ok ? await updateProject(ctx, id, body.value, projectDeps()) : bodyTooLarge(),
    );
  });
}
