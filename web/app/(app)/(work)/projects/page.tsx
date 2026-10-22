import { connection } from "next/server";
import { requireWork } from "@/app/(app)/(work)/work";
import { projectDeps } from "@/app/_lib/project-deps";
import { getProjectBoard } from "@/server/projects";
import { ProjectBoardView } from "./project-board";

export const metadata = { title: "입찰 프로젝트" };
export default async function ProjectsPage() {
  await connection();
  const work = await requireWork("/projects");
  const result = await getProjectBoard(work, projectDeps());
  if (!result.ok) throw new Error(result.message);
  return <ProjectBoardView board={result.data} />;
}
