import { notFound, redirect } from "next/navigation";
import { organizationStatePath } from "@/app/auth/employment-routing";
import { loadWorkspace } from "./workspace";

// The redirect itself is a business boundary; layout cannot prevent page execution.
export default async function OrgHomePage({ params }: PageProps<"/[slug]">) {
  const { slug } = await params;
  const workspace = await loadWorkspace(slug);
  if (workspace.status === "not-found") notFound();
  if (workspace.status === "no-org" || workspace.status === "multiple-orgs")
    redirect(organizationStatePath(`/${encodeURIComponent(slug)}/dashboard`));
  if (workspace.status === "ready")
    redirect(`/${encodeURIComponent(workspace.current.slug)}/dashboard`);
  // The existing layout owns anonymous/no-database guides and noindex.
  return null;
}
