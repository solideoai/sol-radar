import "server-only";
import { headers } from "next/headers";
import { authenticate } from "@/server/auth";
import { getMyEmployment } from "@/server/profile";
import { getMyBusinessAccess } from "@/server/organization";
import type { PeopleAccess } from "@/server/people";
export const peopleAccess: PeopleAccess = {
  authenticate: async () =>
    authenticate((await headers()).has("authorization") ? "bearer" : "request"),
  getMyEmployment,
  getMyBusinessAccess,
};
