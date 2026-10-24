import {
  handleApiRequest,
  peopleResponse,
  requireCompleteUser,
  serviceResponse,
} from "@/app/api/v1/_lib/http";
import { businessRoute, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { peopleAccess } from "@/app/_lib/people-access";
import { bodyTooLarge } from "@/server/bids";
import { getTeamMember, updateTeamMember } from "@/server/people";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireCompleteUser(request);
    if (!guarded.ok) return guarded.response;
    const { id } = await context.params;
    return peopleResponse(await getTeamMember(peopleAccess, id, new URL(request.url).searchParams));
  });
}

// N4b 부서·직급 이동과 퇴사(ADMIN). 점수 계산 속성은 받지 않는다.
export async function PATCH(request: Request, context: Context): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const { id } = await context.params;
    const body = await readJsonBody(request);
    return serviceResponse(body.ok ? await updateTeamMember(ctx, id, body.value) : bodyTooLarge());
  });
}
