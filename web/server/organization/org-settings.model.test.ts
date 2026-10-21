import { describe, expect, it } from "vitest";
import {
  countAdmins,
  type OrgAuditRow,
  type OrgMemberRow,
  type OrgMemberView,
  parseOrgInvite,
  parseSolRole,
  sortOrgMembers,
  toOrgAuditView,
  toOrgInvitationView,
  toOrgMemberView,
} from "./org-settings.model";

const ME = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const OTHER = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const GONE = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";

const memberRow = (overrides: Partial<OrgMemberRow> = {}): OrgMemberRow => ({
  userId: OTHER,
  solRole: "SALES",
  joinedAt: "2026-10-19T00:00:00.000Z",
  email: "sales@soltech.invalid",
  displayName: "이영업",
  status: "active",
  ...overrides,
});

const view = (overrides: Partial<OrgMemberView>): OrgMemberView => ({
  userId: OTHER,
  name: "이영업",
  email: "sales@soltech.invalid",
  solRole: "SALES",
  joinedAt: "2026-10-19T00:00:00.000Z",
  isMe: false,
  isSuspended: false,
  ...overrides,
});

describe("toOrgMemberView", () => {
  it("표시 이름·업무 역할·합류일·내 행·정지를 옮긴다", () => {
    expect(toOrgMemberView(memberRow({ status: "suspended" }), OTHER)).toEqual({
      userId: OTHER,
      name: "이영업",
      email: "sales@soltech.invalid",
      solRole: "SALES",
      joinedAt: "2026-10-19T00:00:00.000Z",
      isMe: true,
      isSuspended: true,
    });
  });

  it("표시 이름이 없으면 이메일 앞부분을 이름으로 쓴다(nameOf)", () => {
    expect(toOrgMemberView(memberRow({ displayName: null }), ME).name).toBe("sales");
  });

  it("DB 제약 밖의 업무 역할은 스키마 어긋남이라 던진다", () => {
    expect(() => toOrgMemberView(memberRow({ solRole: "OWNER" }), ME)).toThrow(
      "알 수 없는 업무 역할입니다: OWNER",
    );
  });
});

describe("sortOrgMembers", () => {
  it("내 행을 맨 위에 두고 나머지는 이름 가나다순, 같으면 이메일순이다", () => {
    const sorted = sortOrgMembers([
      view({ userId: "c", name: "최열람", email: "c@x.invalid" }),
      view({ userId: "b", name: "박분석", email: "b2@x.invalid" }),
      view({ userId: "me", name: "하관리", isMe: true }),
      view({ userId: "a", name: "박분석", email: "b1@x.invalid" }),
    ]);
    expect(sorted.map((member) => member.userId)).toEqual(["me", "a", "b", "c"]);
  });
});

describe("countAdmins", () => {
  it("정지 여부와 상관없이 ADMIN 멤버십 수를 센다(protect_last_sol_admin 과 같은 기준)", () => {
    expect(
      countAdmins([
        view({ solRole: "ADMIN" }),
        view({ solRole: "ADMIN", isSuspended: true }),
        view({ solRole: "VIEWER" }),
      ]),
    ).toBe(2);
  });
});

describe("toOrgInvitationView", () => {
  const row = {
    id: GONE,
    email: "new@soltech.invalid",
    solRole: "ANALYST",
    expiresAt: "2026-10-28T00:00:00.000Z",
  };

  it("기한이 지나지 않았으면 만료가 아니다", () => {
    expect(toOrgInvitationView(row, new Date("2026-10-27T23:59:59.000Z"))).toEqual({
      id: GONE,
      email: "new@soltech.invalid",
      solRole: "ANALYST",
      expiresAt: "2026-10-28T00:00:00.000Z",
      isExpired: false,
    });
  });

  it("기한 시각과 같거나 지나면 만료다", () => {
    expect(toOrgInvitationView(row, new Date("2026-10-28T00:00:00.000Z")).isExpired).toBe(true);
  });
});

describe("toOrgAuditView", () => {
  const members = new Map([
    [ME, view({ userId: ME, name: "김관리", isMe: true, solRole: "ADMIN" })],
    [OTHER, view({ userId: OTHER, name: "이영업" })],
  ]);
  const auditRow = (overrides: Partial<OrgAuditRow>): OrgAuditRow => ({
    id: "audit-1",
    action: "USER_ROLE_CHANGE",
    actorId: ME,
    targetId: OTHER,
    beforeAfter: { before: { solRole: "SALES" }, after: { solRole: "ANALYST" } },
    createdAt: "2026-10-21T05:05:00.000Z",
    ...overrides,
  });

  it("역할 변경은 한 사람·대상 이름과 전후 역할을 낸다", () => {
    expect(toOrgAuditView(auditRow({}), members)).toEqual({
      id: "audit-1",
      kind: "role-change",
      at: "2026-10-21T05:05:00.000Z",
      actor: { kind: "member", name: "김관리", isMe: true },
      target: { kind: "member", name: "이영업", isMe: false },
      fromRole: "SALES",
      toRole: "ANALYST",
    });
  });

  it("초대는 초대한 이메일과 업무 역할을 낸다", () => {
    expect(
      toOrgAuditView(
        auditRow({
          action: "USER_INVITE",
          targetId: GONE,
          beforeAfter: {
            before: null,
            after: {
              email: "new@soltech.invalid",
              orgRole: "member",
              solRole: "ANALYST",
              expiresAt: "2026-10-28T00:00:00.000Z",
            },
          },
        }),
        members,
      ),
    ).toEqual({
      id: "audit-1",
      kind: "invite",
      at: "2026-10-21T05:05:00.000Z",
      actor: { kind: "member", name: "김관리", isMe: true },
      email: "new@soltech.invalid",
      toRole: "ANALYST",
    });
  });

  it("재초대(before 에 이전 역할이 있는 USER_INVITE, 20261021000610)도 초대 한 줄로 새 역할을 낸다", () => {
    expect(
      toOrgAuditView(
        auditRow({
          action: "USER_INVITE",
          targetId: GONE,
          beforeAfter: {
            before: { solRole: "VIEWER" },
            after: {
              email: "new@soltech.invalid",
              orgRole: "member",
              solRole: "ADMIN",
              expiresAt: "2026-10-28T00:00:00.000Z",
            },
          },
        }),
        members,
      ),
    ).toEqual({
      id: "audit-1",
      kind: "invite",
      at: "2026-10-21T05:05:00.000Z",
      actor: { kind: "member", name: "김관리", isMe: true },
      email: "new@soltech.invalid",
      toRole: "ADMIN",
    });
  });

  it("행위자 id 가 없으면 탈퇴한 사용자, 지금 구성원이 아니면 조직을 떠난 사용자다", () => {
    const entry = toOrgAuditView(auditRow({ actorId: null, targetId: GONE }), members);
    expect(entry.actor).toEqual({ kind: "deleted" });
    expect(entry.kind === "role-change" ? entry.target : null).toEqual({ kind: "left" });
    expect(toOrgAuditView(auditRow({ actorId: GONE }), members).actor).toEqual({ kind: "left" });
  });

  it("트리거가 쓴 모양과 다른 before_after·다른 종류는 던진다", () => {
    expect(() => toOrgAuditView(auditRow({ beforeAfter: { after: {} } }), members)).toThrow();
    expect(() => toOrgAuditView(auditRow({ action: "LOGIN" }), members)).toThrow(
      "조직 설정 기록에 없는 감사 종류입니다: LOGIN",
    );
  });
});

describe("parseSolRole", () => {
  it("업무 역할 네 값만 받는다", () => {
    expect(parseSolRole("ANALYST")).toEqual({ ok: true, role: "ANALYST" });
    expect(parseSolRole("owner")).toEqual({ ok: false });
    expect(parseSolRole(undefined)).toEqual({ ok: false });
  });
});

describe("parseOrgInvite", () => {
  it("이메일 앞뒤 공백을 지우고 소문자로 맞춘다", () => {
    expect(parseOrgInvite({ email: "  New@SolTech.Invalid ", solRole: "VIEWER" })).toEqual({
      ok: true,
      email: "new@soltech.invalid",
      solRole: "VIEWER",
    });
  });

  it("이메일 형식·업무 역할이 틀리면 첫 문구를 낸다", () => {
    expect(parseOrgInvite({ email: "no-at", solRole: "VIEWER" })).toEqual({
      ok: false,
      message: "이메일 형식이 아닙니다",
    });
    expect(parseOrgInvite({ email: "a@b.invalid", solRole: "member" }).ok).toBe(false);
  });
});
