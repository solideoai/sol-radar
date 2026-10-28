import "server-only";
import { headers } from "next/headers";
import { authenticate } from "@/server/auth";
import { getMyEmployment } from "@/server/profile";
import type { PeopleAccess } from "@/server/people";
import { loadMyBusinessAccess } from "./my-account";
// 화면에서는 틀(people-read-layout)이 읽은 업무 조직을 같이 쓴다. API(라우트 핸들러)에서는 부를 때마다 읽는다.
export const peopleAccess: PeopleAccess = {
  authenticate: async () =>
    authenticate((await headers()).has("authorization") ? "bearer" : "request"),
  getMyEmployment,
  getMyBusinessAccess: loadMyBusinessAccess,
};
