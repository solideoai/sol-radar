import { employmentResponse, handleApiRequest, requireUser } from "@/app/api/v1/_lib/http";
import { getMyEmployment, saveMyEmployment } from "@/server/profile";

export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    return employmentResponse(await getMyEmployment());
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => {
    const guarded = await requireUser(request);
    if (!guarded.ok) return guarded.response;
    const body: unknown = await request.json().catch(() => null);
    return employmentResponse(await saveMyEmployment(body));
  });
}
