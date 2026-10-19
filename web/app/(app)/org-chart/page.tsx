import type { Metadata } from "next";
import { loadPeopleDirectory, peopleUiResult, PeopleForbidden } from "@/app/_lib/people-data";
import { OrgChartDirectory } from "@/components/people/org-chart-directory";
export const metadata: Metadata = { title: "조직도", robots: { index: false, follow: false } };
export default async function OrgChartPage() {
  const directory = peopleUiResult(await loadPeopleDirectory());
  if (directory.status === "error" && directory.code === "FORBIDDEN")
    return <PeopleForbidden title="조직도" />;
  return <OrgChartDirectory directory={directory} />;
}
