import "server-only";
import {
  type AdminAccess,
  type AdminUserList,
  pageCountOf,
  parseStatusChange,
  parseUserListQuery,
  type StatusChangeResult,
  toUserView,
  USER_PAGE_SIZE,
} from "./admin.model";
import { adminRepo, type AdminRepo } from "./admin.repo";

// ── 서비스: 모델과 저장을 잇는 흐름 ──

export async function getAdminAccess(repo: AdminRepo = adminRepo): Promise<AdminAccess> {
  if (!repo.isConfigured()) return { status: "no-database" };
  const userId = await repo.currentUserId();
  if (!userId) return { status: "signed-out" };
  return (await repo.isAdmin(userId)) ? { status: "ready", userId } : { status: "forbidden" };
}

// query 는 Next 의 searchParams 다. 범위를 넘은 쪽은 1쪽으로 본다.
// 관리자 틀(app/admin/layout.tsx)이 이미 봤어도 운영자인지 다시 본다 — 틀은 화면 실행을 막지 못하고,
// 같은 화면 안의 이동(검색·쪽)에서 다시 그려지지 않는다.
export async function getUserList(
  query: Readonly<Record<string, string | string[] | undefined>>,
  repo: AdminRepo = adminRepo,
): Promise<AdminUserList> {
  const access = await getAdminAccess(repo);
  if (access.status !== "ready") return access;
  const { q, page: requested } = parseUserListQuery(query);
  const read = (page: number) => repo.listUsers(q, (page - 1) * USER_PAGE_SIZE, USER_PAGE_SIZE);
  const first = await read(requested);
  const page = first === "out-of-range" ? 1 : requested;
  const result = first === "out-of-range" ? await read(1) : first;
  // 1쪽은 범위를 넘을 수 없다(offset 0). 그래도 오면 저장과 코드가 어긋난 것이라 던진다.
  if (result === "out-of-range") throw new Error("사용자 목록의 1쪽을 읽지 못했습니다");
  return {
    status: "ready",
    list: {
      rows: result.rows.map((row) => toUserView(row, access.userId)),
      total: result.total,
      page,
      pageCount: pageCountOf(result.total),
      pageSize: USER_PAGE_SIZE,
      q,
    },
  };
}

// 운영자인지는 여기서 한 번, DB 함수가 한 번 더 본다. 사이에 운영자에서 빠지면 DB 가 거절한다(forbidden).
export async function setUserStatus(
  userId: unknown,
  status: unknown,
  repo: AdminRepo = adminRepo,
): Promise<StatusChangeResult> {
  const change = parseStatusChange(userId, status);
  if (!change) return { status: "invalid" };
  const access = await getAdminAccess(repo);
  if (access.status !== "ready") return access;
  return { status: await repo.setUserStatus(change.userId, change.status) };
}
