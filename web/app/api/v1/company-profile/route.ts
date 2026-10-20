import { apiError, json } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { getCompanyProfile } from "@/server/company-profile";

// 05 §2 GET /company-profile — 이 조직의 최신 회사 프로필. 읽기는 업무 역할 전원(RLS "조직 회사 프로필 읽기").
// 다른 조직 프로필은 RLS 로 안 보이고 org_id 로도 걸러져 이 조직 것만 나온다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    const profile = await getCompanyProfile(ctx.orgId);
    if (profile === null)
      return apiError(404, "NOT_FOUND", "회사 프로필이 없습니다", { resource: "companyProfile" });
    return json(profile);
  });
}
