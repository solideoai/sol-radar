import { json } from "@/app/api/v1/_lib/http";
import { businessRoute } from "@/app/api/v1/_lib/work-route";
import { listCompanyProfileRevisions } from "@/server/company-profile";

// 05 §2 GET /company-profile/revisions — revision 이력(CompanyProfileSummary[]), 최신부터. 프로필이 없으면 빈 배열.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async (ctx) => json(await listCompanyProfileRevisions(ctx.orgId)));
}
