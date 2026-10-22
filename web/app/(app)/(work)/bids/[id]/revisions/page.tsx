import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { workDeps } from "@/app/_lib/work-deps";
import { requireWork } from "@/app/(app)/(work)/work";
import { compareBidRevision, isUuid, parseRevisionParam } from "@/server/bids";
import { REVISIONS_TITLE } from "./revisions-copy";
import { RevisionsView } from "./revisions-view";

export const metadata: Metadata = { title: REVISIONS_TITLE };

// 공고 변경 이력(S5 스펙 docs/plans/2026-10-21-s5-revisions-ui-spec.md). ?rev=N 이 없으면 가장 높은 revision 과 그 직전을 비교한다.
// 공고·revision 은 모든 조직이 읽는다(RLS). 로그인·조직 확인은 requireWork 가 맡는다.
export default async function BidRevisionsPage({
  params,
  searchParams,
}: PageProps<"/bids/[id]/revisions">) {
  await connection();
  const { id } = await params;
  const work = await requireWork(`/bids/${id}/revisions`);
  if (!isUuid(id)) notFound();

  const { rev } = await searchParams;
  // ?rev=1&rev=2 처럼 배열이면 어느 쪽인지 알 수 없다. 없는 번호와 같이 404 로 둔다.
  if (Array.isArray(rev)) notFound();
  const revision = parseRevisionParam(rev);
  if (rev !== undefined && revision === null) notFound();

  const result = await compareBidRevision(work.orgId, id, revision, { repo: workDeps().bids });
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error(result.message);
  }
  return <RevisionsView comparison={result.data} />;
}
