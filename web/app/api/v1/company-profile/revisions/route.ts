import { apiError, json } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { canReadCompanyProfile, listCompanyProfileRevisions } from "@/server/company-profile";

// 05 §2 GET /company-profile/revisions — revision 이력(CompanyProfileSummary[]), 최신부터. 프로필이 없으면 빈 배열. ADMIN·EXECUTIVE 만 읽는다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => {
    if (!canReadCompanyProfile(ctx.role))
      return apiError(403, "FORBIDDEN", "회사 역량은 ADMIN·EXECUTIVE만 조회할 수 있습니다");
    return json(await listCompanyProfileRevisions(ctx.orgId));
  });
}
