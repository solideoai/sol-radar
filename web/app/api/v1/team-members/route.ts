import { handleApiRequest, peopleResponse, requireCompleteUser } from "@/app/api/v1/_lib/http";
import { peopleAccess } from "@/app/_lib/people-access";
import { listTeamMembers } from "@/server/people";

export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireCompleteUser(request);
    if (!guarded.ok) return guarded.response;
    return peopleResponse(await listTeamMembers(peopleAccess, new URL(request.url).searchParams));
  });
}
