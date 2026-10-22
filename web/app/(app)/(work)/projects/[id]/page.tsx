import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireWork } from "@/app/(app)/(work)/work";
import { projectDeps } from "@/app/_lib/project-deps";
import { getProject } from "@/server/projects";
import { getTaskAssignees } from "@/server/task";
import { ProjectDetailView } from "./project-detail-view";

export const metadata = { title: "입찰 프로젝트 상세" };
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const work = await requireWork(`/projects/${id}`);
  const [result, members] = await Promise.all([
    getProject(work, id, projectDeps()),
    getTaskAssignees({ orgId: work.orgId, userId: work.userId, isOwner: false }),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error(result.message);
  }
  return (
    <ProjectDetailView
      key={`${result.data.id}-${result.data.status}-${result.data.resultRecordedAt}-${result.data.owner?.id}-${result.data.submissionDueOverride}`}
      project={result.data}
      members={members}
    />
  );
}
