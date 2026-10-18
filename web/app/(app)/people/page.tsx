import type { Metadata } from "next";
import { peopleAccess } from "@/app/_lib/people-access";
import { PeopleDirectory } from "@/components/people/people-directory";
import { peopleListParams, peopleSearchParams } from "@/components/people/people-query";
import { listTeamMembers } from "@/server/people";
import { loadPeopleDirectory, peopleUiResult, PeopleForbidden } from "./people-data";
export const metadata: Metadata = { title: "조직·인력", robots: { index: false, follow: false } };
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = peopleSearchParams(await searchParams);
  const directory = peopleUiResult(await loadPeopleDirectory());
  if (directory.status === "error" && directory.code === "FORBIDDEN") return <PeopleForbidden />;
  const view = params.get("view") === "tree" ? "tree" : "list";
  const list =
    view === "list"
      ? peopleUiResult(await listTeamMembers(peopleAccess, peopleListParams(params)))
      : { status: "error" as const, code: "NOT_REQUESTED" };
  if (list.status === "error" && list.code === "FORBIDDEN") return <PeopleForbidden />;
  return (
    <PeopleDirectory query={params.toString()} view={view} directory={directory} list={list} />
  );
}
