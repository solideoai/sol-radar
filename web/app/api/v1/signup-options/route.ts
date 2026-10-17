import { handleApiRequest, json } from "@/app/api/v1/_lib/http";
import { getSignupOptions } from "@/server/profile";

export async function GET(request: Request): Promise<Response> {
  return handleApiRequest(request, async () => json(getSignupOptions()));
}
