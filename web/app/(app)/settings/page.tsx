import { connection } from "next/server";
import { redirectToPersonal } from "@/app/(app)/home";

// 옛 주소이자 카카오 알림이 가리키는 주소(/settings). 카카오 연결 결과(?kakao=…)만 옮겨 준다.
export default async function LegacySettingsPage({ searchParams }: PageProps<"/settings">) {
  // 로그인 상태는 요청마다 다르다. 빌드 때 미리 그려 두지 않는다.
  await connection();
  const { kakao } = await searchParams;
  const search = new URLSearchParams(typeof kakao === "string" ? { kakao } : {});
  return redirectToPersonal("settings", search);
}
