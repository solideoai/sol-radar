import { projectDeps } from "@/app/_lib/project-deps";
import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { bodyTooLarge } from "@/server/bids";
import { getProjectBoard, openProject } from "@/server/projects";

export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) =>
    serviceResponse(await getProjectBoard(ctx, projectDeps())),
  );
}
export async function POST(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const body = await readJsonBody(request);
    return serviceResponse(
      body.ok ? await openProject(ctx, body.value, projectDeps()) : bodyTooLarge(),
    );
  });
}
