import { apiError, json } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { canReadCompanyProfile, getCompanyProfile } from "@/server/company-profile";

// 05 §2 GET /company-profile — 이 조직의 최신 회사 프로필. 읽기는 ADMIN·EXECUTIVE 만(메뉴·API 제한, RLS 읽기는 조직 전원).
// 다른 조직 프로필은 RLS 로 안 보이고 org_id 로도 걸러져 이 조직 것만 나온다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    if (!canReadCompanyProfile(ctx.role))
      return apiError(403, "FORBIDDEN", "회사 역량은 ADMIN·EXECUTIVE만 조회할 수 있습니다");
    const profile = await getCompanyProfile(ctx.orgId);
    if (profile === null)
      return apiError(404, "NOT_FOUND", "회사 프로필이 없습니다", { resource: "companyProfile" });
    return json(profile);
  });
}
