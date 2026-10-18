import "server-only";
import { solRoleSchema, type MyBusinessAccess } from "./business-access.model";
import { businessAccessRepo } from "./business-access.repo";
import { getCurrentOrganization } from "./organization.service";

export async function getMyBusinessAccess(): Promise<MyBusinessAccess> {
  const organization = await getCurrentOrganization();
  if (organization.status !== "ready") return organization;
  const role = solRoleSchema.safeParse(
    await businessAccessRepo.findSolRole(organization.current.id, organization.userId),
  );
  if (!role.success) return { status: "forbidden" };
  return {
    ...organization,
    current: { ...organization.current, solRole: role.data },
  };
}
