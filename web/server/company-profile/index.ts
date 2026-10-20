import "server-only";
export {
  getCompanyProfile,
  getCompanyStaffing,
  listCompanyProfileRevisions,
} from "./company-profile.service";
export { companyProfileRepo } from "./company-profile.repo";
export type { CompanyProfileRepo } from "./company-profile.repo";
export { CompanyProfileDataError } from "./company-profile.model";
export type {
  CompanyProfile,
  CompanyProfileSummary,
  CompanyStaffing,
  ProfileAuthor,
} from "./company-profile.model";
