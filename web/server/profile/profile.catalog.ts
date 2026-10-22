import "server-only";
import { signupOptionsSchema, type SignupOptions } from "@/server/shared";
import generatedOptions from "./signup-options.generated.json";
import demoAdminCatalog from "./demo-admin-catalog.json";

// This file is the approved public projection; roster data never enters the request domain.
export function getSignupOptions(): SignupOptions {
  return signupOptionsSchema.parse({
    ...generatedOptions,
    departments: [...generatedOptions.departments, demoAdminCatalog.department],
    jobTitles: [...generatedOptions.jobTitles, demoAdminCatalog.jobTitle],
  });
}
