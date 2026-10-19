import "server-only";
import { z } from "zod";
import type { CurrentOrg, CurrentOrganizationResult } from "./organization.model";

export const solRoleSchema = z.enum(["VIEWER", "ANALYST", "SALES", "ADMIN"]);
export type SolRole = z.infer<typeof solRoleSchema>;

export type MyBusinessAccess =
  | Exclude<CurrentOrganizationResult, { status: "ready" }>
  | { status: "forbidden" }
  | { status: "ready"; userId: string; current: CurrentOrg & { solRole: SolRole } };
