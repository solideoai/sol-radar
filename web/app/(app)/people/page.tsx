import type { Metadata } from "next";
import { peopleAccess } from "@/app/_lib/people-access";
import { PeopleDirectory } from "@/components/people/people-directory";
import { peopleListParams, peopleSearchParams } from "@/components/people/people-query";
import { listTeamMembers } from "@/server/people";
import { getMyBusinessAccess } from "@/server/organization";
import { loadPeopleDirectory, peopleUiResult, PeopleForbidden } from "@/app/_lib/people-data";
export const metadata: Metadata = { title: "조직·인력", robots: { index: false, follow: false } };
export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = peopleSearchParams(await searchParams);
  const directory = peopleUiResult(await loadPeopleDirectory());
  if (directory.status === "error" && directory.code === "FORBIDDEN") return <PeopleForbidden />;
  const list = peopleUiResult(await listTeamMembers(peopleAccess, peopleListParams(params)));
  if (list.status === "error" && list.code === "FORBIDDEN") return <PeopleForbidden />;
  // 편집 진입점만 가린다. 쓰기 권한은 API(ADMIN)와 DB 함수가 다시 확인한다.
  const access = await getMyBusinessAccess();
  const canEdit = access.status === "ready" && access.current.solRole === "ADMIN";
  return (
    <PeopleDirectory
      query={params.toString()}
      directory={directory}
      list={list}
      canEdit={canEdit}
    />
  );
}
