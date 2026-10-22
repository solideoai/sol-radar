import "server-only";
import { requireCurrentOrganization } from "./employment-guard";
import { redirect } from "next/navigation";

// 조직 주소가 없는 옛 주소(/dashboard·/memos·/settings)의 링크·북마크가 현재 업무 조직의 화면으로 가게 한다.
// 로그인 전·DB 없음은 계정 화면이 안내한다. 옛 /memos 는 그 자리를 이은 작업 화면(tasks)으로 보낸다.
// search 는 옮겨 줄 검색값이다(예: 카카오 연결 콜백의 ?kakao=…). 부르는 쪽이 허용한 키만 넣는다.
export async function redirectToPersonal(
  path: "dashboard" | "tasks" | "settings",
  search?: URLSearchParams,
): Promise<never> {
  const home = await requireCurrentOrganization(path === "tasks" ? "/memos" : `/${path}`);
  const query = search === undefined || search.size === 0 ? "" : `?${search.toString()}`;
  redirect(home ? `/${home.current.slug}/${path}${query}` : "/auth/login");
}
