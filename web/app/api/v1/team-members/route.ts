import {
  handleApiRequest,
  peopleResponse,
  requireCompleteUser,
  serviceResponse,
} from "@/app/api/v1/_lib/http";
import { businessRoute, readJsonBody } from "@/app/api/v1/_lib/work-route";
import { peopleAccess } from "@/app/_lib/people-access";
import { bodyTooLarge } from "@/server/bids";
import { createTeamMember, listTeamMembers } from "@/server/people";

export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireCompleteUser(request);
    if (!guarded.ok) return guarded.response;
    return peopleResponse(await listTeamMembers(peopleAccess, new URL(request.url).searchParams));
  });
}

// N4b 직원 추가(ADMIN). 로그인·CSRF·가입 완료·업무 조직은 businessRoute 가 본다.
export async function POST(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const body = await readJsonBody(request);
    return serviceResponse(body.ok ? await createTeamMember(ctx, body.value) : bodyTooLarge());
  });
}
