import "server-only";
import { currentDefaultOrigin } from "@/app/_lib/run-mode";
import { projectRepo, type ProjectDeps } from "@/server/projects";
import { listProjectChecklist } from "@/server/task";

export function projectDeps(): ProjectDeps {
  return {
    repo: projectRepo,
    checklist: listProjectChecklist,
    origin: currentDefaultOrigin(),
  };
}
