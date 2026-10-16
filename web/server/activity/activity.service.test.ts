import { describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "./activity.model";
import type { ActivityRepo } from "./activity.repo";
import { getRecentActivities } from "./activity.service";

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const HONG = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const LEFT = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

const row = (overrides: Partial<ActivityRow> = {}): ActivityRow => ({
  id: "a1",
  kind: "task_created",
  actor_id: HONG,
  task_title: "회의록 공유",
  target_user_id: null,
  target_name: null,
  old_role: null,
  new_role: null,
  created_at: "2026-10-14T06:00:00.000Z",
  ...overrides,
});

// 저장 자리에 가짜를 꽂는다. 실제 Supabase 는 부르지 않는다(누가 무엇을 읽는지는 DB 정책 시험이 본다).
const fakeRepo = (overrides: Partial<ActivityRepo> = {}): ActivityRepo => ({
  listRecent: vi.fn(async () => []),
  listMembers: vi.fn(async () => [
    { userId: HONG, displayName: "홍길동", email: "hong@example.com" },
  ]),
  ...overrides,
});

describe("getRecentActivities", () => {
  it("지금 조직의 최근 기록 10개를 읽어, 행위자 이름은 지금 멤버에서 찾아 문장으로 돌려준다", async () => {
    const repo = fakeRepo({
      listRecent: vi.fn(async () => [
        row({ id: "a2", kind: "task_completed" }),
        row({ id: "a1", actor_id: LEFT }),
      ]),
    });
    await expect(getRecentActivities({ orgId: ORG_ID }, repo)).resolves.toEqual([
      {
        id: "a2",
        kind: "task_completed",
        text: "홍길동 님이 ‘회의록 공유’ 작업을 완료했습니다.",
        actorName: "홍길동",
        targetName: null,
        subjectName: "홍길동",
        createdAt: "2026-10-14T06:00:00.000Z",
        createdAtText: "2026. 10. 14. 오후 3:00",
      },
      {
        id: "a1",
        kind: "task_created",
        text: "떠난 멤버가 ‘회의록 공유’ 작업을 만들었습니다.",
        actorName: null,
        targetName: null,
        subjectName: null,
        createdAt: "2026-10-14T06:00:00.000Z",
        createdAtText: "2026. 10. 14. 오후 3:00",
      },
    ]);
    expect(repo.listRecent).toHaveBeenCalledWith(ORG_ID, 10);
    expect(repo.listMembers).toHaveBeenCalledWith(ORG_ID);
  });

  it("모르는 종류는 빼므로 10개보다 적을 수 있다", async () => {
    const repo = fakeRepo({
      listRecent: vi.fn(async () => [row({ id: "a2", kind: "comment_added" }), row({ id: "a1" })]),
    });
    const views = await getRecentActivities({ orgId: ORG_ID }, repo);
    expect(views.map((view) => view.id)).toEqual(["a1"]);
  });

  it("기록이 없으면 빈 목록이다", async () => {
    await expect(getRecentActivities({ orgId: ORG_ID }, fakeRepo())).resolves.toEqual([]);
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ listRecent: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(getRecentActivities({ orgId: ORG_ID }, repo)).rejects.toThrow("db down");
  });
});
