import "server-only";

// ── 배럴: admin 도메인의 공개 API. 바깥(app·components)은 @/server/admin 만 부른다 ──
export { getAdminAccess, getUserList, setUserStatus } from "./admin.service";
export { USER_PAGE_SIZE, USER_SEARCH_MAX_LENGTH } from "./admin.model";
export type {
  AdminAccess,
  AdminUserList,
  StatusChangeResult,
  UserListPage,
  UserStatus,
  UserView,
} from "./admin.model";
