import { describe, expect, it } from "vitest";
import type { TaskView } from "@/server/task";
import {
  canManageProjects,
  checklistProgressOf,
  createProjectInputSchema,
  effectiveDueAt,
  nextStatuses,
  pickLatestDecision,
  projectEntryOf,
  projectPatchSchema,
  projectResultInputSchema,
  reopenAvailableOf,
  sortProjectCards,
  toProjectCard,
  toProjectDetail,
  warningsOf,
  type DecisionRecord,
  type ProjectCard,
  type ProjectDetailRecord,
  type ProjectRecord,
} from "./project.model";

const NOW = new Date("2026-10-21T00:00:00Z");
const PROJECT = "a1000000-0000-4000-8000-000000000001";
const BID = "b1000000-0000-4000-8000-000000000001";
const REVIEW = "d1000000-0000-4000-8000-000000000001";
const OWNER = "10000000-0000-4000-8000-000000000002";

const record = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({
  id: PROJECT,
  bidId: BID,
  status: "PREPARING",
  owner: { id: OWNER, name: "이영업" },
  submissionDueOverride: null,
  result: null,
  resultNote: null,
  resultRecordedAt: null,
  closedAt: null,
  createdAt: "2026-10-20T00:00:00Z",
  openedByReviewId: REVIEW,
  openedRevision: 1,
  bid: {
    id: BID,
    title: "세종특별자치시 차세대 행정정보시스템 (가상)",
    agency: "세종특별자치시",
    noticeId: "DEMO-2026-0001",
    deadlineAt: "2026-11-10T09:00:00Z",
    isDemo: true,
    status: "OPEN",
    latestRevision: 1,
  },
  ...over,
});

const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: REVIEW,
  bidId: BID,
  decision: "BID",
  decidedAt: "2026-10-19T00:00:00Z",
  createdAt: "2026-10-19T00:00:00Z",
  reviewer: "이영업",
  ...over,
});

describe("effectiveDueAt", () => {
  it("공고 마감도 덮어쓰기도 없으면 null 이다(화면은 '마감 미정')", () => {
    expect(effectiveDueAt(null, null)).toBeNull();
  });
  it("덮어쓰기가 없으면 공고 마감이다", () => {
    expect(effectiveDueAt("2026-11-10T09:00:00Z", null)).toBe("2026-11-10T09:00:00Z");
  });
  it("덮어쓰기가 있으면 덮어쓰기가 우선이다(공고 마감이 없어도)", () => {
    expect(effectiveDueAt("2026-11-10T09:00:00Z", "2026-11-08T09:00:00Z")).toBe(
      "2026-11-08T09:00:00Z",
    );
    expect(effectiveDueAt(null, "2026-11-08T09:00:00Z")).toBe("2026-11-08T09:00:00Z");
  });
});

describe("nextStatuses", () => {
  it.each([
    ["PREPARING", { forward: "SUBMITTED", back: null, canClose: true }],
    ["SUBMITTED", { forward: "AWAITING_RESULT", back: "PREPARING", canClose: true }],
    ["AWAITING_RESULT", { forward: "CLOSED", back: "SUBMITTED", canClose: true }],
    ["CLOSED", { forward: null, back: null, canClose: false }],
  ] as const)("%s", (status, expected) => {
    expect(nextStatuses(status)).toEqual(expected);
  });
});

describe("warningsOf", () => {
  const base = {
    status: "SUBMITTED" as const,
    latestDecision: "BID" as const,
    openedRevision: 1,
    latestRevision: 1,
    bidStatus: "OPEN" as const,
  };
  it("최신 결정이 BID 이고 공고가 그대로면 경고가 없다", () => {
    expect(warningsOf(base)).toEqual({
      latestDecision: null,
      bidAmended: false,
      bidCancelled: false,
    });
  });
  it("최신 결정이 WATCH·NO_BID 면 그 값을 싣는다", () => {
    expect(warningsOf({ ...base, latestDecision: "WATCH" }).latestDecision).toBe("WATCH");
    expect(warningsOf({ ...base, latestDecision: "NO_BID" }).latestDecision).toBe("NO_BID");
  });
  it("여는 결정의 revision 이 공고 최신 revision 과 다르면 정정됨이다", () => {
    expect(warningsOf({ ...base, latestRevision: 2 }).bidAmended).toBe(true);
  });
  it("최신 결정 WATCH 와 정정·취소가 함께 오면 셋 다 싣는다", () => {
    expect(
      warningsOf({ ...base, latestDecision: "WATCH", latestRevision: 2, bidStatus: "CANCELLED" }),
    ).toEqual({ latestDecision: "WATCH", bidAmended: true, bidCancelled: true });
  });
  it("종료된 프로젝트에는 경고를 싣지 않는다(U13)", () => {
    expect(
      warningsOf({
        ...base,
        status: "CLOSED",
        latestDecision: "NO_BID",
        latestRevision: 3,
        bidStatus: "CANCELLED",
      }),
    ).toEqual({ latestDecision: null, bidAmended: false, bidCancelled: false });
  });
  it("결정을 찾지 못하면(있을 수 없는 경우) 결정 경고는 없다", () => {
    expect(warningsOf({ ...base, latestDecision: null }).latestDecision).toBeNull();
  });
});

describe("canManageProjects", () => {
  it.each([
    ["ADMIN", true],
    ["SALES", true],
    ["ANALYST", false],
    ["VIEWER", false],
  ] as const)("%s → %s", (role, expected) => {
    expect(canManageProjects(role)).toBe(expected);
  });
});

describe("입력 스키마", () => {
  it("만들기 본문은 reviewId(uuid) 하나뿐이다 — 조직 id·모르는 키는 거절", () => {
    expect(createProjectInputSchema.safeParse({ reviewId: REVIEW }).success).toBe(true);
    expect(createProjectInputSchema.safeParse({ reviewId: "r1" }).success).toBe(false);
    expect(createProjectInputSchema.safeParse({}).success).toBe(false);
    expect(createProjectInputSchema.safeParse({ reviewId: REVIEW, orgId: OWNER }).success).toBe(
      false,
    );
    expect(createProjectInputSchema.safeParse({ reviewId: REVIEW, extra: 1 }).success).toBe(false);
  });

  it("빈 PATCH 는 거절한다", () => {
    expect(projectPatchSchema.safeParse({}).success).toBe(false);
  });

  it("note 만 있는 PATCH 는 거절한다(메모는 상태와 함께만)", () => {
    const parsed = projectPatchSchema.safeParse({ note: "메모" });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues.map((issue) => issue.path.join("."))).toContain("note");
  });

  it("알 수 없는 키·조직 id 키는 거절한다", () => {
    expect(projectPatchSchema.safeParse({ status: "SUBMITTED", unknown: 1 }).success).toBe(false);
    expect(projectPatchSchema.safeParse({ ownerId: null, orgId: OWNER }).success).toBe(false);
    expect(projectPatchSchema.safeParse({ result: "WON" }).success).toBe(false);
  });

  it("상태·메모는 다듬어 받고, 메모는 1~500자다", () => {
    expect(projectPatchSchema.parse({ status: "SUBMITTED", note: "  접수 완료 " })).toEqual({
      status: "SUBMITTED",
      note: "접수 완료",
    });
    expect(projectPatchSchema.safeParse({ status: "SUBMITTED", note: "   " }).success).toBe(false);
    expect(
      projectPatchSchema.safeParse({ status: "SUBMITTED", note: "가".repeat(501) }).success,
    ).toBe(false);
    expect(
      projectPatchSchema.safeParse({ status: "SUBMITTED", note: "가".repeat(500) }).success,
    ).toBe(true);
    expect(projectPatchSchema.safeParse({ status: "OPEN" }).success).toBe(false);
  });

  it("담당자는 uuid 이거나 null(비우기)이다", () => {
    expect(projectPatchSchema.parse({ ownerId: null })).toEqual({ ownerId: null });
    expect(projectPatchSchema.parse({ ownerId: OWNER })).toEqual({ ownerId: OWNER });
    expect(projectPatchSchema.safeParse({ ownerId: "kim" }).success).toBe(false);
  });

  it("제출 마감은 시간대가 있는 ISO 시각이나 한국 시각(datetime-local)이고 UTC ISO 로 바꾼다. null 은 덮어쓰기 지우기다", () => {
    expect(projectPatchSchema.parse({ submissionDueOverride: "2026-11-10T18:00" })).toEqual({
      submissionDueOverride: "2026-11-10T09:00:00.000Z",
    });
    expect(
      projectPatchSchema.parse({ submissionDueOverride: "2026-11-10T18:00:00+09:00" }),
    ).toEqual({ submissionDueOverride: "2026-11-10T09:00:00.000Z" });
    expect(projectPatchSchema.parse({ submissionDueOverride: "2026-11-10T09:00:00Z" })).toEqual({
      submissionDueOverride: "2026-11-10T09:00:00.000Z",
    });
    expect(projectPatchSchema.parse({ submissionDueOverride: null })).toEqual({
      submissionDueOverride: null,
    });
    for (const value of ["2026-11-10", "내일", "0000-01-01T00:00", "2026-13-01T00:00"]) {
      expect(projectPatchSchema.safeParse({ submissionDueOverride: value }).success, value).toBe(
        false,
      );
    }
  });

  it("결과 본문은 네 값 중 하나와 1~2000자 메모(선택)다", () => {
    expect(projectResultInputSchema.parse({ result: "WON", note: " 낙찰 " })).toEqual({
      result: "WON",
      note: "낙찰",
    });
    expect(projectResultInputSchema.safeParse({ result: "LOST" }).success).toBe(true);
    expect(projectResultInputSchema.safeParse({ result: "WIN" }).success).toBe(false);
    expect(projectResultInputSchema.safeParse({}).success).toBe(false);
    expect(
      projectResultInputSchema.safeParse({ result: "LOST", note: "가".repeat(2001) }).success,
    ).toBe(false);
    expect(projectResultInputSchema.safeParse({ result: "LOST", status: "CLOSED" }).success).toBe(
      false,
    );
  });
});

describe("pickLatestDecision", () => {
  it("결정 시각 → 만든 시각 → id 가 큰 쪽이 최신이다(DB 함수의 최신 결정과 같은 순서)", () => {
    const older = decision({ id: "d1", decision: "BID", decidedAt: "2026-10-18T00:00:00Z" });
    const sameTimeEarlier = decision({
      id: "d2",
      decision: "WATCH",
      createdAt: "2026-10-19T00:00:00Z",
    });
    const sameTimeLater = decision({
      id: "d3",
      decision: "NO_BID",
      createdAt: "2026-10-19T00:00:01Z",
    });
    expect(pickLatestDecision([sameTimeLater, older, sameTimeEarlier])?.id).toBe("d3");
    const tieA = decision({ id: "d4" });
    const tieB = decision({ id: "d5" });
    expect(pickLatestDecision([tieB, tieA])?.id).toBe("d5");
    expect(pickLatestDecision([])).toBeNull();
  });
});

describe("checklistProgressOf", () => {
  it("프로젝트마다 완료(done)/전체를 센다. in_progress 는 완료가 아니다", () => {
    const progress = checklistProgressOf([
      { bidProjectId: "p1", status: "done" },
      { bidProjectId: "p1", status: "in_progress" },
      { bidProjectId: "p1", status: "todo" },
      { bidProjectId: "p2", status: "done" },
    ]);
    expect(progress.get("p1")).toEqual({ done: 1, total: 3 });
    expect(progress.get("p2")).toEqual({ done: 1, total: 1 });
    expect(progress.get("p3")).toBeUndefined();
  });
});

describe("reopenAvailableOf", () => {
  const closed = { status: "CLOSED" as const, closedAt: "2026-10-20T00:00:00Z" };
  it("종료 뒤에 내린 BID 결정이 최신이면 다시 열 수 있다", () => {
    expect(
      reopenAvailableOf({
        ...closed,
        latestDecision: decision({ decidedAt: "2026-10-20T00:00:01Z" }),
      }),
    ).toBe(true);
  });
  it("종료 전(같은 시각 포함) 결정·BID 아닌 결정·열린 프로젝트는 아니다", () => {
    expect(
      reopenAvailableOf({
        ...closed,
        latestDecision: decision({ decidedAt: "2026-10-20T00:00:00Z" }),
      }),
    ).toBe(false);
    expect(
      reopenAvailableOf({
        ...closed,
        latestDecision: decision({ decision: "WATCH", decidedAt: "2026-10-21T00:00:00Z" }),
      }),
    ).toBe(false);
    expect(
      reopenAvailableOf({
        status: "PREPARING",
        closedAt: null,
        latestDecision: decision({ decidedAt: "2026-10-21T00:00:00Z" }),
      }),
    ).toBe(false);
    expect(reopenAvailableOf({ ...closed, latestDecision: null })).toBe(false);
  });
});

describe("projectEntryOf — 공고 상세 들어가기(UI 스펙 §4.3.2)", () => {
  const latestBid = decision({ id: "latest", decidedAt: "2026-10-21T00:00:00Z" });
  const open = { id: PROJECT, status: "SUBMITTED" as const, closedAt: null, result: null };
  const closed = {
    id: PROJECT,
    status: "CLOSED" as const,
    closedAt: "2026-10-20T00:00:00Z",
    result: "LOST" as const,
  };
  const entry = (over: Partial<Parameters<typeof projectEntryOf>[0]>) =>
    projectEntryOf({
      project: null,
      latestDecision: latestBid,
      bidStatus: "OPEN",
      canManage: true,
      ...over,
    });

  it("프로젝트 없음 + 최신 BID + 쓰기 권한 + 취소 아님 → create(최신 결정 id)", () => {
    expect(entry({})).toEqual({ state: "create", latestReviewId: "latest" });
  });
  it("프로젝트 없음인데 최신이 BID 아님·결정 없음·권한 없음·공고 취소면 숨김", () => {
    expect(entry({ latestDecision: decision({ id: "w", decision: "WATCH" }) })).toEqual({
      state: "hidden",
      latestReviewId: "w",
    });
    expect(entry({ latestDecision: null })).toEqual({ state: "hidden", latestReviewId: null });
    expect(entry({ canManage: false }).state).toBe("hidden");
    expect(entry({ bidStatus: "CANCELLED" }).state).toBe("hidden");
  });
  it("열린 프로젝트는 역할과 상관없이 open, 최신 결정이 BID 가 아니면 그 값을 싣는다", () => {
    expect(entry({ project: open, canManage: false })).toEqual({
      state: "open",
      latestReviewId: "latest",
      project: { id: PROJECT, status: "SUBMITTED" },
      latestDecisionNotBid: null,
    });
    expect(
      entry({ project: open, latestDecision: decision({ id: "w", decision: "WATCH" }) }),
    ).toMatchObject({ state: "open", latestDecisionNotBid: "WATCH" });
  });
  it("종료 + 종료 뒤 최신 BID + 쓰기 권한 → reopen", () => {
    expect(entry({ project: closed })).toEqual({
      state: "reopen",
      latestReviewId: "latest",
      project: { id: PROJECT, result: "LOST", closedAt: "2026-10-20T00:00:00Z" },
    });
  });
  it("종료인데 종료 뒤 BID 가 없거나 쓰기 권한이 없으면 closed", () => {
    expect(
      entry({ project: closed, latestDecision: decision({ decidedAt: "2026-10-19T00:00:00Z" }) }),
    ).toEqual({
      state: "closed",
      latestReviewId: REVIEW,
      project: { id: PROJECT, result: "LOST", closedAt: "2026-10-20T00:00:00Z" },
      canManage: true,
    });
    expect(entry({ project: closed, canManage: false })).toMatchObject({
      state: "closed",
      canManage: false,
    });
  });
});

describe("toProjectCard", () => {
  it("실효 마감·덮어쓰기 표시·담당·체크리스트·경고를 싣는다", () => {
    const card = toProjectCard(
      record({ submissionDueOverride: "2026-11-08T09:00:00Z", openedRevision: 1 }),
      decision({ decision: "WATCH" }),
      { done: 3, total: 7 },
    );
    expect(card).toEqual({
      id: PROJECT,
      bidId: BID,
      title: "세종특별자치시 차세대 행정정보시스템 (가상)",
      agency: "세종특별자치시",
      isDemo: true,
      status: "PREPARING",
      effectiveDueAt: "2026-11-08T09:00:00Z",
      dueOverridden: true,
      owner: { id: OWNER, name: "이영업" },
      checklist: { done: 3, total: 7 },
      warnings: { latestDecision: "WATCH", bidAmended: false, bidCancelled: false },
      result: null,
      closedAt: null,
    } satisfies ProjectCard);
  });
  it("공고 마감이 없고 덮어쓰기도 없으면 실효 마감은 null 이다", () => {
    const card = toProjectCard(record({ bid: { ...record().bid, deadlineAt: null } }), decision(), {
      done: 0,
      total: 0,
    });
    expect(card.effectiveDueAt).toBeNull();
    expect(card.dueOverridden).toBe(false);
  });
});

describe("sortProjectCards — 칸 안 순서(U18)", () => {
  const card = (id: string, over: Partial<ProjectCard>): ProjectCard => ({
    ...toProjectCard(record({ id }), decision(), { done: 0, total: 0 }),
    title: id,
    ...over,
  });
  it("상태 순서로 묶고, 열린 칸은 실효 마감 가까운 순(지난 마감·마감 없음 뒤), 종료 칸은 종료 최근 순이다", () => {
    const sorted = sortProjectCards(
      [
        card("closed-old", { status: "CLOSED", closedAt: "2026-10-01T00:00:00Z" }),
        card("prep-none", { status: "PREPARING", effectiveDueAt: null }),
        card("sub", { status: "SUBMITTED", effectiveDueAt: "2026-10-25T00:00:00Z" }),
        card("prep-past", { status: "PREPARING", effectiveDueAt: "2026-10-20T00:00:00Z" }),
        card("closed-new", { status: "CLOSED", closedAt: "2026-10-20T00:00:00Z" }),
        card("prep-soon", { status: "PREPARING", effectiveDueAt: "2026-10-22T00:00:00Z" }),
        card("await", { status: "AWAITING_RESULT", effectiveDueAt: null }),
      ],
      NOW,
    );
    expect(sorted.map((entry) => entry.id)).toEqual([
      "prep-soon",
      "prep-past",
      "prep-none",
      "sub",
      "await",
      "closed-new",
      "closed-old",
    ]);
  });
});

describe("toProjectDetail", () => {
  const CHECKLIST = [
    { id: "t1", status: "done" },
    { id: "t2", status: "in_progress" },
  ] as TaskView[];
  const detail = (over: Partial<ProjectDetailRecord> = {}) =>
    toProjectDetail(
      {
        ...record(),
        openedBy: {
          reviewId: REVIEW,
          reviewer: "이영업",
          decidedAt: "2026-10-19T00:00:00Z",
          revision: 1,
          analysis: null,
        },
        decisions: [decision()],
        events: [
          {
            id: "e1",
            actor: "이영업",
            from: null,
            to: "PREPARING",
            note: null,
            createdAt: "2026-10-20T00:00:00Z",
          },
          {
            id: "e2",
            actor: null,
            from: "PREPARING",
            to: "SUBMITTED",
            note: "제출",
            createdAt: "2026-10-21T00:00:00Z",
          },
        ],
        ...over,
      },
      CHECKLIST,
      true,
    );

  it("이력은 새것부터, 체크리스트는 받은 순서와 진행 수, 공고 요약·최신 결정·권한을 싣는다", () => {
    const view = detail();
    expect(view.events.map((event) => event.id)).toEqual(["e2", "e1"]);
    expect(view.checklist.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(view.checklistProgress).toEqual({ done: 1, total: 2 });
    expect(view.bid).toEqual({
      id: BID,
      noticeId: "DEMO-2026-0001",
      deadlineAt: "2026-11-10T09:00:00Z",
      latestRevision: 1,
    });
    expect(view.latestDecision).toEqual({
      decision: "BID",
      reviewer: "이영업",
      decidedAt: "2026-10-19T00:00:00Z",
    });
    expect(view.canManage).toBe(true);
    expect(view.reopenAvailable).toBe(false);
    expect(view.submissionDueOverride).toBeNull();
  });

  it("종료 + 종료 뒤 BID 결정이면 reopenAvailable, 경고는 비운다", () => {
    const view = detail({
      status: "CLOSED",
      closedAt: "2026-10-20T12:00:00Z",
      decisions: [decision(), decision({ id: "new", decidedAt: "2026-10-21T00:00:00Z" })],
      bid: { ...record().bid, status: "CANCELLED", latestRevision: 2 },
    });
    expect(view.reopenAvailable).toBe(true);
    expect(view.warnings).toEqual({ latestDecision: null, bidAmended: false, bidCancelled: false });
  });

  it("결정이 하나도 없으면(여는 결정이 있어 있을 수 없다) 저장과 코드가 어긋난 것이라 던진다", () => {
    expect(() => detail({ decisions: [] })).toThrow("최신 결정");
  });
});
