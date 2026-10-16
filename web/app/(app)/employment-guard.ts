import "server-only";
import { redirect } from "next/navigation";
import { getMyProfile } from "@/server/profile";
import { completionPath } from "@/app/auth/employment-routing";

export async function requireCompleteEmployment(next: string): Promise<void> {
  const me = await getMyProfile();
  if (me.status !== "ready") redirect("/auth/login");
  if (!me.profile.profileComplete) redirect(completionPath(next));
}
