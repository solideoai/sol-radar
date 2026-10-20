import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { CompanyProfileView } from "@/components/company/company-profile-view";
import {
  COMPANY_DESCRIPTION,
  COMPANY_TITLE,
  companyTabHref,
  parseCompanyTab,
} from "@/components/company/company-tabs";
import { requireWork } from "@/app/(app)/(work)/work";
import {
  getCompanyProfile,
  getCompanyStaffing,
  listCompanyProfileRevisions,
} from "@/server/company-profile";

export const metadata: Metadata = { title: COMPANY_TITLE };

// 06 §5.6. 읽기는 업무 역할 전원이다(RLS "조직 회사 프로필 읽기"). 조회 전용 화면이다.
export default async function CompanyPage({ searchParams }: PageProps<"/company">) {
  await connection();
  const tab = parseCompanyTab((await searchParams).tab);
  const { orgId } = await requireWork(companyTabHref(tab));
  const [profile, revisions, staffing] = await Promise.all([
    getCompanyProfile(orgId),
    listCompanyProfileRevisions(orgId),
    getCompanyStaffing(orgId),
  ]);
  return (
    <AppPage title={COMPANY_TITLE} description={COMPANY_DESCRIPTION}>
      <CompanyProfileView tab={tab} profile={profile} revisions={revisions} staffing={staffing} />
    </AppPage>
  );
}
