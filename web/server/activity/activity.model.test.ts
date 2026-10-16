import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KINDS,
  type ActivityMemberRow,
  type ActivityRow,
  formatCreatedAt,
  memberNames,
  RECENT_ACTIVITY_COUNT,
  toActivityView,
  toActivityViews,
} from "./activity.model";

const HONG = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const KIM = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const LEFT = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

// 지금 멤버: 홍길동(표시 이름)과 kim(이메일 @ 앞). LEFT 는 팀을 떠났다.
const MEMBERS: ActivityMemberRow[] = [
  { userId: HONG, displayName: "홍길동", email: "hong@example.com" },
  { userId: KIM, displayName: null, email: "kim@example.com" },
];
const NAMES = memberNames(MEMBERS);

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

const textOf = (overrides: Partial<ActivityRow>) => toActivityView(row(overrides), NAMES)?.text;

describe("상수", () => {
  it("종류는 마이그레이션의 activities_kind_check 와 같은 11개이고, 피드는 10줄이다", () => {
    expect(ACTIVITY_KINDS).toEqual([
      "task_created",
      "task_completed",
      "task_reopened",
      "task_assigned",
      "task_unassigned",
      "task_deleted",
      "member_joined",
      "member_role_changed",
      "member_left",
      "member_removed",
      "invitation_sent",
    ]);
    expect(RECENT_ACTIVITY_COUNT).toBe(10);
  });
});

describe("toActivityView — 작업 문장(디자인 스펙 3.4)", () => {
  it("만듦·완료함·다시 엶·지움은 행위자 이름과 기록 시점의 제목으로 쓴다", () => {
    expect(textOf({ kind: "task_created" })).toBe("홍길동 님이 ‘회의록 공유’ 작업을 만들었습니다.");
    expect(textOf({ kind: "task_completed" })).toBe(
      "홍길동 님이 ‘회의록 공유’ 작업을 완료했습니다.",
    );
    expect(textOf({ kind: "task_reopened" })).toBe(
      "홍길동 님이 ‘회의록 공유’ 작업을 다시 열었습니다.",
    );
    expect(textOf({ kind: "task_deleted" })).toBe("홍길동 님이 ‘회의록 공유’ 작업을 지웠습니다.");
  });

  it("담당자를 남에게 바꾸면 새 담당자의 이름 사본으로 쓴다", () => {
    expect(textOf({ kind: "task_assigned", target_user_id: KIM, target_name: "김철수" })).toBe(
      "홍길동 님이 ‘회의록 공유’ 작업의 담당자를 김철수 님으로 바꿨습니다.",
    );
  });

  it("행위자와 새 담당자가 같으면 맡았다고 쓴다", () => {
    expect(textOf({ kind: "task_assigned", target_user_id: HONG, target_name: "홍길동" })).toBe(
      "홍길동 님이 ‘회의록 공유’ 작업을 맡았습니다.",
    );
  });

  it("담당자를 비우면 비웠다고 쓴다", () => {
    expect(textOf({ kind: "task_unassigned" })).toBe(
      "홍길동 님이 ‘회의록 공유’ 작업의 담당자를 비웠습니다.",
    );
  });

  it("새 담당자의 계정이 지워져 이름 사본이 없으면 떠난 멤버로 쓴다", () => {
    expect(textOf({ kind: "task_assigned", target_user_id: null, target_name: null })).toBe(
      "홍길동 님이 ‘회의록 공유’ 작업의 담당자를 떠난 멤버로 바꿨습니다.",
    );
  });

  it("제목이 없는 작업 기록은 그리지 않는다", () => {
    expect(toActivityView(row({ task_title: null }), NAMES)).toBeNull();
  });
});

describe("toActivityView — 멤버·초대 문장(디자인 스펙 3.4)", () => {
  it("들어옴·나감은 대상이 주어다(나간 사람은 프로필을 읽을 수 없어 이름 사본을 쓴다)", () => {
    expect(
      toActivityView(
        row({
          kind: "member_joined",
          actor_id: KIM,
          task_title: null,
          target_user_id: KIM,
          target_name: "kim",
        }),
        NAMES,
      ),
    ).toMatchObject({ text: "kim 님이 팀에 들어왔습니다.", subjectName: "kim" });
    expect(
      toActivityView(
        row({
          kind: "member_left",
          actor_id: LEFT,
          task_title: null,
          target_user_id: LEFT,
          target_name: "박영희",
        }),
        NAMES,
      ),
    ).toMatchObject({
      text: "박영희 님이 팀에서 나갔습니다.",
      subjectName: "박영희",
      actorName: null,
    });
  });

  it("내보냄은 행위자가 대상을 내보냈다고 쓴다", () => {
    expect(
      toActivityView(
        row({
          kind: "member_removed",
          task_title: null,
          target_user_id: LEFT,
          target_name: "박영희",
        }),
        NAMES,
      ),
    ).toMatchObject({ text: "홍길동 님이 박영희 님을 내보냈습니다.", subjectName: "홍길동" });
  });

  it("역할 바뀜은 새 역할 글자로 쓰고, 자기 역할이면 자신의 역할이라고 쓴다", () => {
    const changed = { kind: "member_role_changed", task_title: null, old_role: "member" };
    expect(textOf({ ...changed, target_user_id: KIM, target_name: "kim", new_role: "owner" })).toBe(
      "홍길동 님이 kim 님의 역할을 소유자로 바꿨습니다.",
    );
    expect(
      textOf({
        ...changed,
        old_role: "owner",
        target_user_id: HONG,
        target_name: "홍길동",
        new_role: "member",
      }),
    ).toBe("홍길동 님이 자신의 역할을 멤버로 바꿨습니다.");
  });

  it("초대 보냄은 역할만 쓴다(이메일 없음)", () => {
    expect(textOf({ kind: "invitation_sent", task_title: null, new_role: "member" })).toBe(
      "홍길동 님이 한 명을 멤버로 초대했습니다.",
    );
    expect(textOf({ kind: "invitation_sent", task_title: null, new_role: "owner" })).toBe(
      "홍길동 님이 한 명을 소유자로 초대했습니다.",
    );
  });

  it("역할이 없거나 모르는 역할인 역할·초대 기록은 그리지 않는다", () => {
    for (const kind of ["member_role_changed", "invitation_sent"])
      for (const new_role of [null, "admin"])
        expect(
          toActivityView(row({ kind, task_title: null, target_user_id: KIM, new_role }), NAMES),
          `${kind} ${new_role}`,
        ).toBeNull();
  });
});

describe("toActivityView — 떠난 멤버(디자인 스펙 3.4 이름 자리)", () => {
  it("행위자가 지금 멤버가 아니거나 계정이 지워졌으면(null) 떠난 멤버가 주어이고, 아바타 이름은 null 이다", () => {
    for (const actor_id of [LEFT, null])
      expect(toActivityView(row({ actor_id }), NAMES)).toMatchObject({
        text: "떠난 멤버가 ‘회의록 공유’ 작업을 만들었습니다.",
        actorName: null,
        subjectName: null,
      });
  });

  it("대상 이름 사본이 지워졌으면 자리마다 떠난 멤버의 조사를 붙인다", () => {
    const erased = { task_title: null, target_user_id: null, target_name: null };
    expect(textOf({ ...erased, kind: "member_joined" })).toBe("떠난 멤버가 팀에 들어왔습니다.");
    expect(textOf({ ...erased, kind: "member_left" })).toBe("떠난 멤버가 팀에서 나갔습니다.");
    expect(textOf({ ...erased, kind: "member_removed" })).toBe(
      "홍길동 님이 떠난 멤버를 내보냈습니다.",
    );
    expect(textOf({ ...erased, kind: "member_role_changed", new_role: "owner" })).toBe(
      "홍길동 님이 떠난 멤버의 역할을 소유자로 바꿨습니다.",
    );
  });

  it("행위자와 대상이 둘 다 지워졌으면 같은 사람으로 보지 않는다", () => {
    expect(
      textOf({ kind: "task_assigned", actor_id: null, target_user_id: null, target_name: null }),
    ).toBe("떠난 멤버가 ‘회의록 공유’ 작업의 담당자를 떠난 멤버로 바꿨습니다.");
    expect(
      textOf({
        kind: "member_role_changed",
        task_title: null,
        actor_id: null,
        target_user_id: null,
        new_role: "member",
      }),
    ).toBe("떠난 멤버가 떠난 멤버의 역할을 멤버로 바꿨습니다.");
  });
});

describe("toActivityView — 모양", () => {
  it("화면이 그리는 모양으로 바꾼다 — 행위자는 지금 멤버의 이름, 대상은 기록의 이름 사본, 시각은 서울 표기", () => {
    expect(
      toActivityView(
        row({
          id: "a9",
          kind: "task_assigned",
          actor_id: KIM,
          target_user_id: HONG,
          target_name: "옛 이름",
          created_at: "2026-10-13T15:05:00.000Z",
        }),
        NAMES,
      ),
    ).toEqual({
      id: "a9",
      kind: "task_assigned",
      text: "kim 님이 ‘회의록 공유’ 작업의 담당자를 옛 이름 님으로 바꿨습니다.",
      actorName: "kim",
      targetName: "옛 이름",
      subjectName: "kim",
      createdAt: "2026-10-13T15:05:00.000Z",
      createdAtText: "2026. 10. 14. 오전 12:05",
    });
  });

  it("모르는 종류(나중에 더한 종류)는 그리지 않는다", () => {
    expect(toActivityView(row({ kind: "task_archived" }), NAMES)).toBeNull();
  });

  it("시각 표기는 서울 시간이다", () => {
    expect(formatCreatedAt("2026-10-14T06:00:00.000Z")).toBe("2026. 10. 14. 오후 3:00");
  });
});

describe("toActivityViews", () => {
  it("순서를 지키고 그리지 못하는 줄(모르는 종류·값이 빠진 기록)만 뺀다", () => {
    const views = toActivityViews(
      [
        row({ id: "a3", kind: "task_completed" }),
        row({ id: "a2", kind: "comment_added" }),
        row({ id: "a1", kind: "invitation_sent", task_title: null, new_role: null }),
        row({ id: "a0", kind: "task_created", actor_id: KIM }),
      ],
      MEMBERS,
    );
    expect(views.map((view) => [view.id, view.text])).toEqual([
      ["a3", "홍길동 님이 ‘회의록 공유’ 작업을 완료했습니다."],
      ["a0", "kim 님이 ‘회의록 공유’ 작업을 만들었습니다."],
    ]);
  });

  it("기록이 없으면 빈 목록이다", () => {
    expect(toActivityViews([], MEMBERS)).toEqual([]);
  });
});
