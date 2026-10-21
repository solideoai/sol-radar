import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, pathNotFound, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { workDeps } from "@/app/_lib/work-deps";
import { bodyTooLarge, computeWhatIf, isUuid } from "@/server/bids";

// POST /analyses/:id/what-if — "이 자격이 있다면?" 가정 재계산(BOOST-2). 저장하지 않는 읽기 계산이다.
// 다른 조직의 run 은 없는 것과 같은 404 이고, 본문이 16KB 를 넘으면 저장소를 부르지 않고 400 이다.
export async function POST(
  request: Request,
  context: RouteContext<"/api/v1/analyses/[id]/what-if">,
): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    if (!isUuid(id)) return pathNotFound("analysis");
    const body = await readJsonBody(request);
    if (!body.ok) return serviceResponse(bodyTooLarge());
    return serviceResponse(
      await computeWhatIf(ctx.orgId, id, body.value, { repo: workDeps().bids }),
    );
  });
}
