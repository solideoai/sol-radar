import "server-only";
import { signupOptionsSchema, type SignupOptions } from "@/server/shared";
import generatedOptions from "./signup-options.generated.json";

// This file is the approved public projection; roster data never enters the request domain.
export function getSignupOptions(): SignupOptions {
  return signupOptionsSchema.parse(generatedOptions);
}
