import "server-only";
import { getMyBusinessAccess } from "@/server/organization";

// 설정 하위 메뉴의 "조직" 링크를 보일지(디자인 스펙 docs/plans/2026-10-21-n2-org-settings-design.md §4.2·§10 7번).
// 지금 업무 조직이 이 화면의 조직이고 그 조직의 업무 역할이 ADMIN 일 때만 보인다. 권한은 그 화면이 다시 본다.
export async function canSeeOrganizationTab(orgId: string): Promise<boolean> {
  const business = await getMyBusinessAccess();
  return (
    business.status === "ready" &&
    business.current.id === orgId &&
    business.current.solRole === "ADMIN"
  );
}
