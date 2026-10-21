import { describe, expect, it, vi } from "vitest";
import type { MyBusinessAccess } from "./business-access.model";
import type { InvitationMailer } from "./organization.mail";
import type { InvitationMailRow } from "./organization.model";
import type { OrgSettingsRepo } from "./org-settings.repo";
import {
  cancelOrgInvitation,
  changeMySolRole,
  changeOrgMemberSolRole,
  getOrgSettingsPage,
  inviteOrgMember,
  type OrgSettingsDeps,
} from "./org-settings.service";

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const ME = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const OTHER = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
const INVITATION_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const NOW = new Date("2026-10-21T03:00:00.000Z");

const MAIL_ROW: InvitationMailRow = {
  orgName: "솔리데오",
  role: "member",
  expiresAt: "2026-10-28T03:00:00.000Z",
  inviterDisplayName: "김관리",
  inviterEmail: "admin@soltech.invalid",
};

const ready = (solRole: "ADMIN" | "SALES" | "ANALYST" | "VIEWER" = "ADMIN"): MyBusinessAccess => ({
  status: "ready",
  userId: ME,
  current: {
    id: ORG_ID,
    slug: "solideo",
    name: "솔리데오",
    isPersonal: false,
    myRole: "owner",
    solRole,
  },
});

// 저장 자리에 가짜를 꽂는다. 누가 무엇을 읽고 쓰는지는 DB 정책 시험(scripts/database.test.mjs)이 본다.
const fakeRepo = (overrides: Partial<OrgSettingsRepo> = {}): OrgSettingsRepo => ({
  currentUser: vi.fn(async () => ({ id: ME, email: "admin@soltech.invalid" })),
  listMembers: vi.fn(async () => []),
  listInvitations: vi.fn(async () => []),
  listAudit: vi.fn(async () => []),
  updateSolRole: vi.fn(async () => "saved" as const),
  insertInvitation: vi.fn(async () => "invited" as const),
  renewInvitation: vi.fn(async () => true),
  deleteInvitation: vi.fn(async () => undefined),
  findInvitationMail: vi.fn(async () => MAIL_ROW),
  ...overrides,
});

// 메일 자리에도 가짜를 꽂는다. 실제 SMTP 는 부르지 않는다.
const fakeMailer = (overrides: Partial<InvitationMailer> = {}): InvitationMailer => ({
  isConfigured: vi.fn(() => false),
  send: vi.fn(async () => "sent" as const),
  ...overrides,
});

const depsOf = (overrides: Partial<OrgSettingsDeps> = {}): OrgSettingsDeps => ({
  repo: fakeRepo(),
  access: vi.fn(async () => ready()),
  mailer: fakeMailer(),
  ...overrides,
});

describe("getOrgSettingsPage", () => {
  it("구성원(내 행 먼저)·ADMIN 수·초대(만료 늦은 순)·기록을 지금 조직으로 읽는다", async () => {
    const repo = fakeRepo({
      listMembers: vi.fn(async () => [
        {
          userId: OTHER,
          solRole: "ADMIN",
          joinedAt: "2026-10-19T00:00:00.000Z",
          email: "b@soltech.invalid",
          displayName: "가나",
          status: "active",
        },
        {
          userId: ME,
          solRole: "ADMIN",
          joinedAt: "2026-10-19T00:00:00.000Z",
          email: "admin@soltech.invalid",
          displayName: "하관리",
          status: "active",
        },
      ]),
      listInvitations: vi.fn(async () => [
        {
          id: "i-old",
          email: "old@x.invalid",
          solRole: "VIEWER",
          expiresAt: "2026-10-20T00:00:00.000Z",
        },
        {
          id: "i-new",
          email: "new@x.invalid",
          solRole: "SALES",
          expiresAt: "2026-10-28T00:00:00.000Z",
        },
      ]),
      listAudit: vi.fn(async () => [
        {
          id: "a-1",
          action: "USER_ROLE_CHANGE",
          actorId: ME,
          targetId: OTHER,
          beforeAfter: { before: { solRole: "SALES" }, after: { solRole: "ADMIN" } },
          createdAt: "2026-10-21T02:00:00.000Z",
        },
      ]),
    });

    const page = await getOrgSettingsPage({ orgId: ORG_ID, userId: ME }, repo, NOW);

    expect(repo.listMembers).toHaveBeenCalledWith(ORG_ID);
    expect(repo.listInvitations).toHaveBeenCalledWith(ORG_ID);
    expect(repo.listAudit).toHaveBeenCalledWith(ORG_ID, 20);
    expect(page.members.map((member) => member.userId)).toEqual([ME, OTHER]);
    expect(page.adminCount).toBe(2);
    expect(page.invitations.map((invitation) => [invitation.id, invitation.isExpired])).toEqual([
      ["i-new", false],
      ["i-old", true],
    ]);
    expect(page.audit).toEqual([
      expect.objectContaining({
        kind: "role-change",
        actor: { kind: "member", name: "하관리", isMe: true },
        target: { kind: "member", name: "가나", isMe: false },
      }),
    ]);
  });

  it("읽기 하나가 실패하면 던진다(화면 오류 경계가 받는다)", async () => {
    const repo = fakeRepo({ listAudit: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(getOrgSettingsPage({ orgId: ORG_ID, userId: ME }, repo, NOW)).rejects.toThrow(
      "db down",
    );
  });
});

describe("changeOrgMemberSolRole", () => {
  it("ADMIN 이면 지금 업무 조직의 대상 행을 바꾼다(조직 id 는 입력에서 받지 않는다)", async () => {
    const deps = depsOf();
    await expect(changeOrgMemberSolRole(OTHER, "ANALYST", deps)).resolves.toEqual({
      status: "saved",
    });
    expect(deps.repo.updateSolRole).toHaveBeenCalledExactlyOnceWith(ORG_ID, OTHER, "ANALYST");
  });

  it("형식이 틀린 id·역할은 DB 를 부르지 않고 invalid 다", async () => {
    const deps = depsOf();
    await expect(changeOrgMemberSolRole("not-uuid", "ANALYST", deps)).resolves.toEqual({
      status: "invalid",
    });
    await expect(changeOrgMemberSolRole(OTHER, "owner", deps)).resolves.toEqual({
      status: "invalid",
    });
    expect(deps.access).not.toHaveBeenCalled();
    expect(deps.repo.updateSolRole).not.toHaveBeenCalled();
  });

  it.each([
    ["signed-out", { status: "signed-out" } as MyBusinessAccess, "signed-out"],
    ["no-database", { status: "no-database" } as MyBusinessAccess, "signed-out"],
    ["no-org", { status: "no-org", userId: ME } as MyBusinessAccess, "forbidden"],
    ["ADMIN 아님", ready("SALES"), "forbidden"],
  ])("%s 이면 DB 를 부르지 않고 %s 다", async (_, access, status) => {
    const deps = depsOf({ access: vi.fn(async () => access) });
    await expect(changeOrgMemberSolRole(OTHER, "ANALYST", deps)).resolves.toEqual({ status });
    expect(deps.repo.updateSolRole).not.toHaveBeenCalled();
  });

  it("마지막 ADMIN 보호·두 번째 잠금 거절은 그대로 돌려준다", async () => {
    for (const saved of ["last-admin", "forbidden"] as const) {
      const deps = depsOf({ repo: fakeRepo({ updateSolRole: vi.fn(async () => saved) }) });
      await expect(changeOrgMemberSolRole(OTHER, "VIEWER", deps)).resolves.toEqual({
        status: saved,
      });
    }
  });

  it("바뀐 행이 없을 때 아직 ADMIN 이면 대상이 구성원이 아니고, 그새 ADMIN 이 아니게 됐으면 forbidden 이다", async () => {
    const none = () => fakeRepo({ updateSolRole: vi.fn(async () => "none" as const) });
    await expect(
      changeOrgMemberSolRole(OTHER, "VIEWER", depsOf({ repo: none() })),
    ).resolves.toEqual({ status: "not-member" });

    const access = vi
      .fn<() => Promise<MyBusinessAccess>>()
      .mockResolvedValueOnce(ready())
      .mockResolvedValueOnce(ready("VIEWER"));
    await expect(
      changeOrgMemberSolRole(OTHER, "VIEWER", depsOf({ repo: none(), access })),
    ).resolves.toEqual({ status: "forbidden" });
  });
});

describe("changeMySolRole", () => {
  it("대상은 입력이 아니라 로그인한 사람이다", async () => {
    const deps = depsOf();
    await expect(changeMySolRole("SALES", deps)).resolves.toEqual({ status: "saved" });
    expect(deps.repo.updateSolRole).toHaveBeenCalledExactlyOnceWith(ORG_ID, ME, "SALES");
  });

  it("마지막 ADMIN 이면 DB 거절을 last-admin 으로 돌려준다", async () => {
    const deps = depsOf({
      repo: fakeRepo({ updateSolRole: vi.fn(async () => "last-admin" as const) }),
    });
    await expect(changeMySolRole("VIEWER", deps)).resolves.toEqual({ status: "last-admin" });
  });

  it("역할이 틀리면 invalid 다", async () => {
    await expect(changeMySolRole("ROOT", depsOf())).resolves.toEqual({ status: "invalid" });
  });
});

describe("inviteOrgMember", () => {
  it("조직 역할 없이 이메일(소문자)·업무 역할로 지금 조직에 초대하고, 메일 설정이 없으면 not-configured 다", async () => {
    const deps = depsOf();
    await expect(
      inviteOrgMember({ email: " New@SolTech.Invalid ", solRole: "ANALYST" }, deps),
    ).resolves.toEqual({ status: "invited", mail: "not-configured" });
    expect(deps.repo.insertInvitation).toHaveBeenCalledExactlyOnceWith(
      ORG_ID,
      "new@soltech.invalid",
      "ANALYST",
    );
    expect(deps.repo.findInvitationMail).not.toHaveBeenCalled();
  });

  it("메일 설정이 있으면 방금 넣은 초대를 읽어 보낸다", async () => {
    const mailer = fakeMailer({ isConfigured: vi.fn(() => true) });
    const deps = depsOf({ mailer });
    await expect(
      inviteOrgMember({ email: "new@soltech.invalid", solRole: "VIEWER" }, deps),
    ).resolves.toEqual({ status: "invited", mail: "sent" });
    expect(deps.repo.findInvitationMail).toHaveBeenCalledWith(ORG_ID, "new@soltech.invalid", ME);
    expect(mailer.send).toHaveBeenCalledOnce();
  });

  it("같은 이메일 초대가 있으면 업무 역할을 새 값으로 적어 갱신한다", async () => {
    const repo = fakeRepo({ insertInvitation: vi.fn(async () => "exists" as const) });
    await expect(
      inviteOrgMember({ email: "new@soltech.invalid", solRole: "SALES" }, depsOf({ repo })),
    ).resolves.toEqual({ status: "renewed", mail: "not-configured" });
    expect(repo.renewInvitation).toHaveBeenCalledExactlyOnceWith(
      ORG_ID,
      "new@soltech.invalid",
      "SALES",
    );
  });

  it("갱신할 행이 없으면(정책이 거름) forbidden 이다", async () => {
    const repo = fakeRepo({
      insertInvitation: vi.fn(async () => "exists" as const),
      renewInvitation: vi.fn(async () => false),
    });
    await expect(
      inviteOrgMember({ email: "new@soltech.invalid", solRole: "SALES" }, depsOf({ repo })),
    ).resolves.toEqual({ status: "forbidden" });
  });

  it("내 이메일은 DB 를 부르지 않고 invalid 다", async () => {
    const deps = depsOf();
    await expect(
      inviteOrgMember({ email: "ADMIN@soltech.invalid", solRole: "VIEWER" }, deps),
    ).resolves.toEqual({ status: "invalid", message: "내 이메일은 초대할 수 없습니다" });
    expect(deps.repo.insertInvitation).not.toHaveBeenCalled();
  });

  it("이미 구성원·개인 공간·정책 거절을 가른다", async () => {
    const cases = [
      ["already-member", { status: "already-member" }],
      ["personal-org", { status: "invalid", message: "개인 공간에는 초대할 수 없습니다" }],
      ["forbidden", { status: "forbidden" }],
    ] as const;
    for (const [inserted, expected] of cases) {
      const repo = fakeRepo({ insertInvitation: vi.fn(async () => inserted) });
      await expect(
        inviteOrgMember({ email: "new@soltech.invalid", solRole: "VIEWER" }, depsOf({ repo })),
      ).resolves.toEqual(expected);
    }
  });

  it("입력이 틀리면 업무 권한을 읽기 전에 invalid 다", async () => {
    const deps = depsOf();
    await expect(inviteOrgMember({ email: "", solRole: "VIEWER" }, deps)).resolves.toEqual({
      status: "invalid",
      message: "이메일 형식이 아닙니다",
    });
    expect(deps.access).not.toHaveBeenCalled();
  });

  it("ADMIN 이 아니면 forbidden 이고 초대를 넣지 않는다", async () => {
    const deps = depsOf({ access: vi.fn(async () => ready("ANALYST")) });
    await expect(
      inviteOrgMember({ email: "new@soltech.invalid", solRole: "VIEWER" }, deps),
    ).resolves.toEqual({ status: "forbidden" });
    expect(deps.repo.insertInvitation).not.toHaveBeenCalled();
  });
});

describe("cancelOrgInvitation", () => {
  it("지금 조직의 초대만 지운다(이미 없어도 done)", async () => {
    const deps = depsOf();
    await expect(cancelOrgInvitation(INVITATION_ID, deps)).resolves.toEqual({ status: "done" });
    expect(deps.repo.deleteInvitation).toHaveBeenCalledExactlyOnceWith(ORG_ID, INVITATION_ID);
  });

  it("형식이 틀린 id 는 invalid, ADMIN 이 아니면 forbidden 이고 지우지 않는다", async () => {
    const deps = depsOf({ access: vi.fn(async () => ready("VIEWER")) });
    await expect(cancelOrgInvitation("x", deps)).resolves.toEqual({ status: "invalid" });
    await expect(cancelOrgInvitation(INVITATION_ID, deps)).resolves.toEqual({
      status: "forbidden",
    });
    expect(deps.repo.deleteInvitation).not.toHaveBeenCalled();
  });
});
