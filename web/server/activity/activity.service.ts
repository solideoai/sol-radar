import "server-only";
import {
  type ActivityScope,
  type ActivityView,
  RECENT_ACTIVITY_COUNT,
  toActivityViews,
} from "./activity.model";
import { activityRepo, type ActivityRepo } from "./activity.repo";

// ── 서비스: 모델과 저장을 잇는 흐름 ──
// 조직 도메인이 확인한 지금 조직(scope)을 받는다 — 로그인·DB 연결·멤버인지는 그쪽이 이미 봤다.

// 알 수 없는 종류는 빼므로 RECENT_ACTIVITY_COUNT 개보다 적을 수 있다.
export async function getRecentActivities(
  scope: ActivityScope,
  repo: ActivityRepo = activityRepo,
): Promise<ActivityView[]> {
  const [rows, members] = await Promise.all([
    repo.listRecent(scope.orgId, RECENT_ACTIVITY_COUNT),
    repo.listMembers(scope.orgId),
  ]);
  return toActivityViews(rows, members);
}
