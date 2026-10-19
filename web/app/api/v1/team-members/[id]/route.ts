import { handleApiRequest, peopleResponse, requireCompleteUser } from "@/app/api/v1/_lib/http";
import { peopleAccess } from "@/app/_lib/people-access";
import { getTeamMember } from "@/server/people";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireCompleteUser(request);
    if (!guarded.ok) return guarded.response;
    const { id } = await context.params;
    return peopleResponse(await getTeamMember(peopleAccess, id, new URL(request.url).searchParams));
  });
}
