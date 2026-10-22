import "server-only";
import { currentRunMode } from "@/app/_lib/run-mode";
import { defaultOrigin } from "@/server/bids";
import { projectRepo, type ProjectDeps } from "@/server/projects";
import { listProjectChecklist } from "@/server/task";

export function projectDeps(): ProjectDeps {
  return {
    repo: projectRepo,
    checklist: listProjectChecklist,
    origin: defaultOrigin(currentRunMode()),
  };
}
