import { connection } from "next/server";
import { redirectToPersonal } from "@/app/(app)/home";

export default async function LegacyDashboardPage() {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  return redirectToPersonal("dashboard");
}
