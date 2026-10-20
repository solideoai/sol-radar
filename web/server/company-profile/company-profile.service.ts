import "server-only";
import { companyProfileRepo, type CompanyProfileRepo } from "./company-profile.repo";
import {
  toCompanyProfile,
  toCompanyProfileSummary,
  type CompanyProfile,
  type CompanyProfileSummary,
  type CompanyStaffing,
} from "./company-profile.model";

// 조직 확인은 부르는 쪽(화면 requireWork·Route Handler businessRoute)이 끝낸 뒤다. orgId 는 그 결과다.

// 최신 revision. 조직에 프로필이 하나도 없으면 null(05 GET /company-profile → 404).
export async function getCompanyProfile(
  orgId: string,
  repo: CompanyProfileRepo = companyProfileRepo,
): Promise<CompanyProfile | null> {
  const row = await repo.latest(orgId);
  return row === null ? null : toCompanyProfile(row);
}

// revision 이력, 최신부터.
export async function listCompanyProfileRevisions(
  orgId: string,
  repo: CompanyProfileRepo = companyProfileRepo,
): Promise<CompanyProfileSummary[]> {
  return (await repo.revisions(orgId)).map(toCompanyProfileSummary);
}

export function getCompanyStaffing(
  orgId: string,
  repo: CompanyProfileRepo = companyProfileRepo,
): Promise<CompanyStaffing> {
  return repo.staffing(orgId);
}
