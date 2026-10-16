import { describe, expect, it, vi } from "vitest";
import type { InvitationMailer } from "./organization.mail";
import type { CurrentOrg, InvitationMailRow, MyOrgRow } from "./organization.model";
import type { OrganizationRepo } from "./organization.repo";
import {
  acceptInvitation,
  cancelInvitation,
  changeMemberRole,
  createTeam,
  declineInvitation,
  deleteTeam,
  getMembersPage,
  getMyHome,
  getMyWorkspace,
  getReceivedInvitations,
  inviteMember,
  leaveOrg,
  removeMember,
  renameTeam,
} from "./organization.service";

const ORG_ID = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const USER_ID = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
const INVITATION_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const NOW = new Date("2026-10-14T03:00:00.000Z");

const PERSONAL: MyOrgRow = {
  orgId: "org-p",
  slug: "k3x9p2qa",
  name: "개인 공간",
  isPersonal: true,
  role: "owner",
};
const TEAM: MyOrgRow = {
  orgId: ORG_ID,
  slug: "acme",
  name: "에이크미",
  isPersonal: false,
  role: "member",
};

// 초대 메일에 넣을 값(방금 넣거나 갱신한 초대를 DB 에서 읽은 것).
const MAIL_ROW: InvitationMailRow = {
  orgName: "에이크미",
  role: "member",
  expiresAt: "2026-10-21T03:00:00.000Z",
  inviterDisplayName: "나",
  inviterEmail: "me@example.com",
};

// 저장 자리에 가짜를 꽂는다. 실제 Supabase 는 부르지 않는다(누가 무엇을 읽고 쓰는지는 DB 정책 시험이 본다).
const fakeRepo = (overrides: Partial<OrganizationRepo> = {}): OrganizationRepo => ({
  isConfigured: () => true,
  currentUser: vi.fn(async () => ({ id: "me", email: "me@example.com" })),
  listMyOrgs: vi.fn(async () => [TEAM, PERSONAL]),
  countReceivedInvitations: vi.fn(async () => 0),
  insertTeam: vi.fn(async () => "created" as const),
  listMembers: vi.fn(async () => []),
  listInvitations: vi.fn(async () => []),
  insertInvitation: vi.fn(async () => "invited" as const),
  renewInvitation: vi.fn(async () => true),
  deleteInvitation: vi.fn(async () => undefined),
  updateRole: vi.fn(async () => "saved" as const),
  deleteMembership: vi.fn(async () => "saved" as const),
  listReceivedInvitations: vi.fn(async () => []),
  findReceivedInvitation: vi.fn(async () => null),
  insertMembership: vi.fn(async () => "joined" as const),
  findOrg: vi.fn(async () => ({ name: "에이크미", isPersonal: false })),
  updateTeamName: vi.fn(async () => true),
  deleteTeam: vi.fn(async () => true),
  findInvitationMail: vi.fn(async () => MAIL_ROW),
  ...overrides,
});

// 메일 자리에도 가짜를 꽂는다. 실제 SMTP 는 부르지 않는다(환경 변수에 SMTP 값이 있어도 시험이 메일을 보내지 않는다).
const fakeMailer = (overrides: Partial<InvitationMailer> = {}): InvitationMailer => ({
  isConfigured: vi.fn(() => true),
  send: vi.fn(async () => "sent" as const),
  ...overrides,
});

describe("getMyWorkspace", () => {
  it("주소의 조직이 내 조직이면 지금 조직·조직 목록·받은 초대 수를 돌려준다", async () => {
    const repo = fakeRepo({ countReceivedInvitations: vi.fn(async () => 2) });
    await expect(getMyWorkspace("acme", repo)).resolves.toEqual({
      status: "ready",
      userId: "me",
      current: { id: ORG_ID, slug: "acme", name: "에이크미", isPersonal: false, myRole: "member" },
      // 개인 조직이 먼저다.
      orgs: [
        { slug: "k3x9p2qa", name: "개인 공간", isPersonal: true },
        { slug: "acme", name: "에이크미", isPersonal: false },
      ],
      pendingInvitationCount: 2,
    });
    expect(repo.listMyOrgs).toHaveBeenCalledWith("me");
    expect(repo.countReceivedInvitations).toHaveBeenCalledWith("me@example.com");
  });

  it("내가 멤버가 아닌 주소는 not-found 다(남의 조직이 있는지 알려 주지 않는다)", async () => {
    await expect(getMyWorkspace("someone-else", fakeRepo())).resolves.toEqual({
      status: "not-found",
    });
  });

  it("DB 설정이 없으면 로그인 여부를 묻지 않고, 로그인 전이면 조직을 읽지 않는다", async () => {
    const noDatabase = fakeRepo({ isConfigured: () => false });
    await expect(getMyWorkspace("acme", noDatabase)).resolves.toEqual({ status: "no-database" });
    expect(noDatabase.currentUser).not.toHaveBeenCalled();

    const signedOut = fakeRepo({ currentUser: vi.fn(async () => null) });
    await expect(getMyWorkspace("acme", signedOut)).resolves.toEqual({ status: "signed-out" });
    expect(signedOut.listMyOrgs).not.toHaveBeenCalled();
  });

  it("저장 오류는 삼키지 않고 그대로 올린다", async () => {
    const repo = fakeRepo({ listMyOrgs: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(getMyWorkspace("acme", repo)).rejects.toThrow("db down");
  });
});

describe("getMyHome", () => {
  it("개인 조직의 주소를 돌려주고, 없으면 missing 이다", async () => {
    await expect(getMyHome(fakeRepo())).resolves.toEqual({
      status: "ready",
      personalSlug: "k3x9p2qa",
    });
    const noPersonal = fakeRepo({ listMyOrgs: vi.fn(async () => [TEAM]) });
    await expect(getMyHome(noPersonal)).resolves.toEqual({ status: "missing" });
  });

  it("로그인 전·DB 없음을 구분한다", async () => {
    await expect(getMyHome(fakeRepo({ isConfigured: () => false }))).resolves.toEqual({
      status: "no-database",
    });
    await expect(getMyHome(fakeRepo({ currentUser: vi.fn(async () => null) }))).resolves.toEqual({
      status: "signed-out",
    });
  });
});

describe("createTeam", () => {
  it("다듬은 이름과 주소로 팀을 만들고 주소를 돌려준다", async () => {
    const repo = fakeRepo();
    await expect(createTeam({ name: " 에이크미 ", slug: "acme" }, repo)).resolves.toEqual({
      status: "created",
      slug: "acme",
    });
    expect(repo.insertTeam).toHaveBeenCalledWith("에이크미", "acme");
  });

  it("이미 쓰는 주소면 주소 칸의 오류로 돌려준다", async () => {
    const repo = fakeRepo({ insertTeam: vi.fn(async () => "slug-taken" as const) });
    await expect(createTeam({ name: "팀", slug: "acme" }, repo)).resolves.toEqual({
      status: "invalid",
      field: "slug",
      message: "이미 쓰는 주소입니다",
    });
  });

  it("틀린 입력은 로그인도 묻지 않고 저장도 하지 않는다", async () => {
    const repo = fakeRepo();
    await expect(createTeam({ name: "팀", slug: "settings" }, repo)).resolves.toMatchObject({
      status: "invalid",
      field: "slug",
    });
    expect(repo.currentUser).not.toHaveBeenCalled();
    expect(repo.insertTeam).not.toHaveBeenCalled();
  });

  it("로그인 전이면 만들지 않는다", async () => {
    const repo = fakeRepo({ currentUser: vi.fn(async () => null) });
    await expect(createTeam({ name: "팀", slug: "acme" }, repo)).resolves.toEqual({
      status: "signed-out",
    });
    expect(repo.insertTeam).not.toHaveBeenCalled();
  });
});

describe("getMembersPage", () => {
  const current = (overrides: Partial<CurrentOrg> = {}): CurrentOrg => ({
    id: ORG_ID,
    slug: "acme",
    name: "에이크미",
    isPersonal: false,
    myRole: "owner",
    ...overrides,
  });

  it("개인 조직은 목록을 읽지 않고 personal 이다", async () => {
    const repo = fakeRepo();
    await expect(
      getMembersPage({ org: current({ isPersonal: true }), userId: "me" }, repo),
    ).resolves.toEqual({ status: "personal" });
    expect(repo.listMembers).not.toHaveBeenCalled();
  });

  it("owner 는 멤버와 대기 중인 초대를 보고 관리할 수 있다", async () => {
    const repo = fakeRepo({
      listMembers: vi.fn(async () => [
        { userId: "u2", role: "member" as const, email: "kim@example.com", displayName: "김철수" },
        { userId: "me", role: "owner" as const, email: "me@example.com", displayName: null },
      ]),
      listInvitations: vi.fn(async () => [
        {
          id: "i1",
          email: "new@example.com",
          role: "member" as const,
          expiresAt: "2026-10-13T00:00:00.000Z",
        },
      ]),
    });
    const page = await getMembersPage({ org: current(), userId: "me" }, repo, NOW);
    expect(page).toMatchObject({ status: "team", canManage: true, ownerCount: 1 });
    if (page.status !== "team") throw new Error("팀이 아니다");
    expect(page.members.map((member) => [member.name, member.roleLabel, member.isMe])).toEqual([
      ["me", "소유자", true],
      ["김철수", "멤버", false],
    ]);
    expect(page.invitations.map((invitation) => [invitation.email, invitation.isExpired])).toEqual([
      ["new@example.com", true],
    ]);
    expect(repo.listInvitations).toHaveBeenCalledWith(ORG_ID);
  });

  it("대기 중인 초대는 기한이 늦은 것(최근에 초대한 것)부터, 소유자 수는 owner 를 모두 센다", async () => {
    const invitation = (id: string, expiresAt: string) => ({
      id,
      email: `${id}@example.com`,
      role: "member" as const,
      expiresAt,
    });
    const repo = fakeRepo({
      listMembers: vi.fn(async () => [
        { userId: "me", role: "owner" as const, email: "me@example.com", displayName: null },
        { userId: "u2", role: "owner" as const, email: "kim@example.com", displayName: null },
        { userId: "u3", role: "member" as const, email: "lee@example.com", displayName: null },
      ]),
      // 저장은 만든 순(오래된 것부터)으로 준다.
      listInvitations: vi.fn(async () => [
        invitation("old", "2026-10-13T00:00:00.000Z"),
        invitation("mid", "2026-10-18T00:00:00.000Z"),
        invitation("new", "2026-10-21T00:00:00.000Z"),
      ]),
    });
    const page = await getMembersPage({ org: current(), userId: "me" }, repo, NOW);
    if (page.status !== "team") throw new Error("팀이 아니다");
    expect(page.invitations.map((row) => [row.id, row.isExpired])).toEqual([
      ["new", false],
      ["mid", false],
      ["old", true],
    ]);
    expect(page.ownerCount).toBe(2);
  });

  it("member 는 초대 목록을 읽지 않고 관리하지 못한다", async () => {
    const repo = fakeRepo();
    await expect(
      getMembersPage({ org: current({ myRole: "member" }), userId: "me" }, repo, NOW),
    ).resolves.toMatchObject({ status: "team", canManage: false, invitations: [] });
    expect(repo.listInvitations).not.toHaveBeenCalled();
  });
});

describe("inviteMember", () => {
  it("소문자로 맞춘 이메일과 역할로 초대한다", async () => {
    const repo = fakeRepo();
    await expect(
      inviteMember(ORG_ID, { email: "Kim@Example.com", role: "member" }, repo, fakeMailer()),
    ).resolves.toEqual({ status: "invited", mail: "sent" });
    expect(repo.insertInvitation).toHaveBeenCalledWith(ORG_ID, "kim@example.com", "member");
  });

  it("같은 이메일의 초대가 이미 있으면 만료를 늘리고 renewed 다", async () => {
    const repo = fakeRepo({ insertInvitation: vi.fn(async () => "exists" as const) });
    await expect(
      inviteMember(ORG_ID, { email: "kim@example.com", role: "owner" }, repo, fakeMailer()),
    ).resolves.toEqual({ status: "renewed", mail: "sent" });
    expect(repo.renewInvitation).toHaveBeenCalledWith(ORG_ID, "kim@example.com", "owner");
  });

  it("DB 가 막은 이유를 값으로 옮기고 메일은 보내지 않는다 — 이미 멤버·개인 조직·권한 없음", async () => {
    const mailer = fakeMailer();
    const invite = (outcome: "already-member" | "personal-org" | "forbidden") =>
      inviteMember(
        ORG_ID,
        { email: "kim@example.com", role: "member" },
        fakeRepo({ insertInvitation: vi.fn(async () => outcome) }),
        mailer,
      );
    await expect(invite("already-member")).resolves.toEqual({
      status: "invalid",
      message: "이미 멤버입니다",
    });
    await expect(invite("personal-org")).resolves.toEqual({
      status: "invalid",
      message: "개인 공간에는 초대할 수 없습니다. 팀을 만들어 초대하세요",
    });
    await expect(invite("forbidden")).resolves.toEqual({ status: "forbidden" });
    expect(mailer.isConfigured).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("이미 있는 초대를 다시 적지 못하면(정책이 걸러 0행) forbidden 이고 메일을 보내지 않는다", async () => {
    const repo = fakeRepo({
      insertInvitation: vi.fn(async () => "exists" as const),
      renewInvitation: vi.fn(async () => false),
    });
    const mailer = fakeMailer();
    await expect(
      inviteMember(ORG_ID, { email: "kim@example.com", role: "member" }, repo, mailer),
    ).resolves.toEqual({ status: "forbidden" });
    expect(repo.findInvitationMail).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("자기 자신은 초대하지 않는다(저장·메일을 부르지 않는다)", async () => {
    const repo = fakeRepo();
    const mailer = fakeMailer();
    await expect(
      inviteMember(ORG_ID, { email: "ME@example.com", role: "member" }, repo, mailer),
    ).resolves.toEqual({ status: "invalid", message: "내 이메일은 초대할 수 없습니다" });
    expect(repo.insertInvitation).not.toHaveBeenCalled();
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("틀린 입력은 로그인도 묻지 않고, 형식이 틀린 조직 id 는 던진다", async () => {
    const repo = fakeRepo();
    const mailer = fakeMailer();
    await expect(
      inviteMember(ORG_ID, { email: "kim", role: "member" }, repo, mailer),
    ).resolves.toMatchObject({
      status: "invalid",
    });
    expect(repo.currentUser).not.toHaveBeenCalled();
    await expect(
      inviteMember("acme", { email: "kim@example.com", role: "member" }, repo, mailer),
    ).rejects.toThrow("조직 id 형식");
    expect(mailer.send).not.toHaveBeenCalled();
  });
});

// 스펙 3장 4번·5장: 초대가 저장된 뒤 메일을 보내고, 메일이 어떻게 되든 초대는 되돌리지 않는다.
describe("inviteMember — 초대 메일", () => {
  const invite = (repo: OrganizationRepo, mailer: InvitationMailer) =>
    inviteMember(ORG_ID, { email: "Kim@Example.com", role: "member" }, repo, mailer);

  it("새 초대는 DB 에서 읽은 값으로 받는 사람에게 메일을 보내고 결과에 sent 를 싣는다", async () => {
    const repo = fakeRepo();
    const mailer = fakeMailer();
    await expect(invite(repo, mailer)).resolves.toEqual({ status: "invited", mail: "sent" });
    // 초대한 사람은 입력이 아니라 로그인에서 읽는다.
    expect(repo.findInvitationMail).toHaveBeenCalledWith(ORG_ID, "kim@example.com", "me");
    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(mailer.send).toHaveBeenCalledWith({
      to: "kim@example.com",
      orgName: "에이크미",
      inviterName: "나",
      role: "member",
      expiresAt: "2026-10-21T03:00:00.000Z",
    });
  });

  it("다시 초대(만료 갱신)도 메일을 다시 보낸다 — 갱신한 뒤에 읽어 새 만료일을 싣는다", async () => {
    const repo = fakeRepo({ insertInvitation: vi.fn(async () => "exists" as const) });
    const mailer = fakeMailer();
    await expect(invite(repo, mailer)).resolves.toEqual({ status: "renewed", mail: "sent" });
    expect(mailer.send).toHaveBeenCalledTimes(1);
    const renewedAt = vi.mocked(repo.renewInvitation).mock.invocationCallOrder[0];
    const readAt = vi.mocked(repo.findInvitationMail).mock.invocationCallOrder[0];
    expect(readAt).toBeGreaterThan(renewedAt);
  });

  it("메일 설정이 없으면 메일에 넣을 값도 읽지 않고 not-configured 다 — 초대는 그대로 된다", async () => {
    for (const outcome of ["invited", "exists"] as const) {
      const repo = fakeRepo({ insertInvitation: vi.fn(async () => outcome) });
      const mailer = fakeMailer({ isConfigured: vi.fn(() => false) });
      await expect(invite(repo, mailer)).resolves.toEqual({
        status: outcome === "invited" ? "invited" : "renewed",
        mail: "not-configured",
      });
      expect(repo.findInvitationMail).not.toHaveBeenCalled();
      expect(mailer.send).not.toHaveBeenCalled();
    }
  });

  it("보내지 못하면(접속 실패·거절·시간 초과) failed 이고 초대는 지우지 않는다", async () => {
    for (const outcome of ["invited", "exists"] as const) {
      const repo = fakeRepo({ insertInvitation: vi.fn(async () => outcome) });
      const mailer = fakeMailer({ send: vi.fn(async () => "failed" as const) });
      await expect(invite(repo, mailer)).resolves.toEqual({
        status: outcome === "invited" ? "invited" : "renewed",
        mail: "failed",
      });
      expect(repo.deleteInvitation).not.toHaveBeenCalled();
    }
  });

  it("그새 초대가 없어져 메일에 넣을 값을 읽지 못하면 보내지 않고 failed 다", async () => {
    const repo = fakeRepo({ findInvitationMail: vi.fn(async () => null) });
    const mailer = fakeMailer();
    await expect(invite(repo, mailer)).resolves.toEqual({ status: "invited", mail: "failed" });
    expect(mailer.send).not.toHaveBeenCalled();
  });

  it("초대한 사람의 표시 이름이 없으면 이메일의 @ 앞을 이름으로 보낸다", async () => {
    const repo = fakeRepo({
      findInvitationMail: vi.fn(async () => ({ ...MAIL_ROW, inviterDisplayName: null })),
    });
    const mailer = fakeMailer();
    await invite(repo, mailer);
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ inviterName: "me" }));
  });
});

// 스펙 3장 2번·5장. 판단 순서: 틀린 입력 → 로그인 → 조직(읽지 못함·개인 조직) → 저장(정책이 0행이면 forbidden).
describe("renameTeam", () => {
  it("앞뒤 공백을 뗀 이름으로 바꾸고 renamed 와 새 이름을 돌려준다", async () => {
    const repo = fakeRepo();
    await expect(renameTeam(ORG_ID, { name: "  새 팀 이름 " }, repo)).resolves.toEqual({
      status: "renamed",
      name: "새 팀 이름",
    });
    expect(repo.findOrg).toHaveBeenCalledWith(ORG_ID);
    expect(repo.updateTeamName).toHaveBeenCalledWith(ORG_ID, "새 팀 이름");
  });

  it("틀린 이름은 이름 칸의 오류이고 로그인도 묻지 않고 저장도 하지 않는다", async () => {
    const repo = fakeRepo();
    await expect(renameTeam(ORG_ID, { name: "   " }, repo)).resolves.toEqual({
      status: "invalid",
      field: "name",
      message: "팀 이름을 입력하세요",
    });
    await expect(renameTeam(ORG_ID, { name: "가".repeat(41) }, repo)).resolves.toEqual({
      status: "invalid",
      field: "name",
      message: "팀 이름은 40자 이하입니다",
    });
    await expect(renameTeam(ORG_ID, undefined, repo)).resolves.toMatchObject({
      status: "invalid",
      field: "name",
    });
    expect(repo.currentUser).not.toHaveBeenCalled();
    expect(repo.updateTeamName).not.toHaveBeenCalled();
  });

  it("40자 이름은 바꾼다", async () => {
    const repo = fakeRepo();
    await expect(renameTeam(ORG_ID, { name: "가".repeat(40) }, repo)).resolves.toEqual({
      status: "renamed",
      name: "가".repeat(40),
    });
  });

  it("읽지 못하는 조직(조직 밖·이미 지워진 팀)은 저장을 부르지 않고 forbidden 이다", async () => {
    const repo = fakeRepo({ findOrg: vi.fn(async () => null) });
    await expect(renameTeam(ORG_ID, { name: "새 이름" }, repo)).resolves.toEqual({
      status: "forbidden",
    });
    expect(repo.updateTeamName).not.toHaveBeenCalled();
  });

  it("개인 조직은 저장을 부르지 않고 personal-org 다", async () => {
    const repo = fakeRepo({
      findOrg: vi.fn(async () => ({ name: "개인 공간", isPersonal: true })),
    });
    await expect(renameTeam(ORG_ID, { name: "새 이름" }, repo)).resolves.toEqual({
      status: "personal-org",
    });
    expect(repo.updateTeamName).not.toHaveBeenCalled();
  });

  it("정책이 걸러 바뀐 행이 없으면(member·정지된 owner) forbidden 이다", async () => {
    const repo = fakeRepo({ updateTeamName: vi.fn(async () => false) });
    await expect(renameTeam(ORG_ID, { name: "새 이름" }, repo)).resolves.toEqual({
      status: "forbidden",
    });
  });

  it("형식이 틀린 조직 id 는 던지고, 저장 오류는 삼키지 않는다", async () => {
    await expect(renameTeam("acme", { name: "새 이름" }, fakeRepo())).rejects.toThrow(
      "조직 id 형식",
    );
    const broken = fakeRepo({
      updateTeamName: vi.fn(async () => Promise.reject(new Error("db down"))),
    });
    await expect(renameTeam(ORG_ID, { name: "새 이름" }, broken)).rejects.toThrow("db down");
  });
});

describe("deleteTeam", () => {
  const MISMATCH = "팀 이름이 맞지 않습니다. 위 이름을 그대로 입력해 주세요";

  it("확인 이름이 지금 팀 이름과 같으면 지우고 deleted 다 — 지울 때 DB 에서 읽은 이름까지 맞춘다", async () => {
    const repo = fakeRepo();
    await expect(deleteTeam(ORG_ID, { confirmName: "에이크미" }, repo)).resolves.toEqual({
      status: "deleted",
    });
    expect(repo.findOrg).toHaveBeenCalledWith(ORG_ID);
    expect(repo.deleteTeam).toHaveBeenCalledWith(ORG_ID, "에이크미");
  });

  it("확인 이름의 앞뒤 공백은 떼고 견준다(휴대폰 자동 입력)", async () => {
    const repo = fakeRepo();
    await expect(deleteTeam(ORG_ID, { confirmName: "  에이크미 " }, repo)).resolves.toEqual({
      status: "deleted",
    });
    expect(repo.deleteTeam).toHaveBeenCalledWith(ORG_ID, "에이크미");
  });

  it("지금 팀 이름과 한 글자라도 다르면 확인 칸의 오류이고 지우지 않는다", async () => {
    const repo = fakeRepo({ findOrg: vi.fn(async () => ({ name: "Acme 팀", isPersonal: false })) });
    for (const confirmName of ["acme 팀", "Acme  팀", "Acme팀", "Acme 팀.", "에이크미"])
      await expect(deleteTeam(ORG_ID, { confirmName }, repo), confirmName).resolves.toEqual({
        status: "invalid",
        field: "confirmName",
        message: MISMATCH,
      });
    expect(repo.deleteTeam).not.toHaveBeenCalled();
  });

  it("확인 이름이 비었으면 로그인도 묻지 않고 '팀 이름을 입력하세요'다", async () => {
    const repo = fakeRepo();
    for (const input of [{ confirmName: "" }, { confirmName: "   " }, {}])
      await expect(deleteTeam(ORG_ID, input, repo)).resolves.toEqual({
        status: "invalid",
        field: "confirmName",
        message: "팀 이름을 입력하세요",
      });
    // 객체가 아닌 입력(화면 밖에서 직접 POST)도 지우지 않고 확인 칸의 오류다.
    await expect(deleteTeam(ORG_ID, undefined, repo)).resolves.toEqual({
      status: "invalid",
      field: "confirmName",
      message: "팀 이름을 입력하세요",
    });
    expect(repo.currentUser).not.toHaveBeenCalled();
    expect(repo.deleteTeam).not.toHaveBeenCalled();
  });

  it("읽지 못하는 조직은 이름이 맞든 틀리든 forbidden 이다 — 조직 밖의 사람에게 이름이 맞는지 알려 주지 않는다", async () => {
    const repo = fakeRepo({ findOrg: vi.fn(async () => null) });
    for (const confirmName of ["에이크미", "아무 이름"])
      await expect(deleteTeam(ORG_ID, { confirmName }, repo)).resolves.toEqual({
        status: "forbidden",
      });
    expect(repo.deleteTeam).not.toHaveBeenCalled();
  });

  it("개인 조직은 이름이 맞아도 지우지 않고 personal-org 다", async () => {
    const repo = fakeRepo({
      findOrg: vi.fn(async () => ({ name: "개인 공간", isPersonal: true })),
    });
    await expect(deleteTeam(ORG_ID, { confirmName: "개인 공간" }, repo)).resolves.toEqual({
      status: "personal-org",
    });
    expect(repo.deleteTeam).not.toHaveBeenCalled();
  });

  it("정책이 걸렀거나 그새 이름이 바뀌어 지운 행이 없으면 forbidden 이다", async () => {
    const repo = fakeRepo({ deleteTeam: vi.fn(async () => false) });
    await expect(deleteTeam(ORG_ID, { confirmName: "에이크미" }, repo)).resolves.toEqual({
      status: "forbidden",
    });
  });

  it("형식이 틀린 조직 id 는 던지고, 저장 오류는 삼키지 않는다", async () => {
    await expect(deleteTeam("acme", { confirmName: "에이크미" }, fakeRepo())).rejects.toThrow(
      "조직 id 형식",
    );
    const broken = fakeRepo({ findOrg: vi.fn(async () => Promise.reject(new Error("db down"))) });
    await expect(deleteTeam(ORG_ID, { confirmName: "에이크미" }, broken)).rejects.toThrow(
      "db down",
    );
  });
});

describe("멤버십 바꾸기", () => {
  it("역할 바꾸기·내보내기·나가기는 저장의 결과를 그대로 상태로 돌려준다", async () => {
    const repo = fakeRepo({
      updateRole: vi.fn(async () => "last-owner" as const),
      deleteMembership: vi.fn(async () => "forbidden" as const),
    });
    await expect(changeMemberRole(ORG_ID, USER_ID, "member", repo)).resolves.toEqual({
      status: "last-owner",
    });
    expect(repo.updateRole).toHaveBeenCalledWith(ORG_ID, USER_ID, "member");
    await expect(removeMember(ORG_ID, USER_ID, repo)).resolves.toEqual({ status: "forbidden" });
    expect(repo.deleteMembership).toHaveBeenCalledWith(ORG_ID, USER_ID);
  });

  it("나가는 사람은 입력이 아니라 로그인에서 읽는다", async () => {
    const repo = fakeRepo();
    await expect(leaveOrg(ORG_ID, repo)).resolves.toEqual({ status: "saved" });
    expect(repo.deleteMembership).toHaveBeenCalledWith(ORG_ID, "me");
  });

  it("형식이 틀린 id·역할은 던지고, 로그인 전이면 저장하지 않는다", async () => {
    const repo = fakeRepo();
    await expect(changeMemberRole(ORG_ID, USER_ID, "admin", repo)).rejects.toThrow("역할");
    await expect(removeMember(ORG_ID, "u2", repo)).rejects.toThrow("멤버 id 형식");
    const signedOut = fakeRepo({ currentUser: vi.fn(async () => null) });
    await expect(leaveOrg(ORG_ID, signedOut)).resolves.toEqual({ status: "signed-out" });
    expect(signedOut.deleteMembership).not.toHaveBeenCalled();
  });
});

describe("받은 초대", () => {
  it("받은 초대와 돌아갈 개인 조직 주소를 돌려준다", async () => {
    const repo = fakeRepo({
      listReceivedInvitations: vi.fn(async () => [
        {
          id: "i1",
          email: "me@example.com",
          role: "member" as const,
          expiresAt: "2026-10-20T00:00:00.000Z",
          orgName: "에이크미",
          orgSlug: "acme",
        },
      ]),
    });
    const result = await getReceivedInvitations(repo, NOW);
    expect(result).toMatchObject({
      status: "ready",
      homeSlug: "k3x9p2qa",
      invitations: [
        { id: "i1", orgName: "에이크미", orgSlug: "acme", roleLabel: "멤버", isExpired: false },
      ],
    });
    expect(repo.listReceivedInvitations).toHaveBeenCalledWith("me@example.com");
  });

  it("수락하면 초대받은 역할로 들어가고 그 조직의 주소를 돌려준다", async () => {
    const repo = fakeRepo({
      findReceivedInvitation: vi.fn(async () => ({
        orgId: ORG_ID,
        orgSlug: "acme",
        role: "member" as const,
        expiresAt: "2026-10-20T00:00:00.000Z",
      })),
    });
    await expect(acceptInvitation(INVITATION_ID, repo, NOW)).resolves.toEqual({
      status: "accepted",
      slug: "acme",
    });
    expect(repo.findReceivedInvitation).toHaveBeenCalledWith(INVITATION_ID, "me@example.com");
    expect(repo.insertMembership).toHaveBeenCalledWith(ORG_ID, "me", "member");
  });

  it("없거나 만료된 초대, 정책이 거절한 수락은 unavailable 이다", async () => {
    await expect(acceptInvitation(INVITATION_ID, fakeRepo(), NOW)).resolves.toEqual({
      status: "unavailable",
    });
    const expired = fakeRepo({
      findReceivedInvitation: vi.fn(async () => ({
        orgId: ORG_ID,
        orgSlug: "acme",
        role: "member" as const,
        expiresAt: NOW.toISOString(),
      })),
    });
    await expect(acceptInvitation(INVITATION_ID, expired, NOW)).resolves.toEqual({
      status: "unavailable",
    });
    expect(expired.insertMembership).not.toHaveBeenCalled();
    const rejected = fakeRepo({
      findReceivedInvitation: vi.fn(async () => ({
        orgId: ORG_ID,
        orgSlug: "acme",
        role: "member" as const,
        expiresAt: "2026-10-20T00:00:00.000Z",
      })),
      insertMembership: vi.fn(async () => "rejected" as const),
    });
    await expect(acceptInvitation(INVITATION_ID, rejected, NOW)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("돌아갈 개인 조직이 없으면 homeSlug 는 null 이고, DB 없음·로그인 전을 구분한다", async () => {
    await expect(
      getReceivedInvitations(fakeRepo({ listMyOrgs: vi.fn(async () => [TEAM]) }), NOW),
    ).resolves.toEqual({ status: "ready", invitations: [], homeSlug: null });
    await expect(
      getReceivedInvitations(fakeRepo({ isConfigured: () => false }), NOW),
    ).resolves.toEqual({ status: "no-database" });
    const signedOut = fakeRepo({ currentUser: vi.fn(async () => null) });
    await expect(getReceivedInvitations(signedOut, NOW)).resolves.toEqual({
      status: "signed-out",
    });
    expect(signedOut.listReceivedInvitations).not.toHaveBeenCalled();
  });

  it("만료 1밀리초 전의 초대는 수락한다", async () => {
    const repo = fakeRepo({
      findReceivedInvitation: vi.fn(async () => ({
        orgId: ORG_ID,
        orgSlug: "acme",
        role: "owner" as const,
        expiresAt: new Date(NOW.getTime() + 1).toISOString(),
      })),
    });
    await expect(acceptInvitation(INVITATION_ID, repo, NOW)).resolves.toEqual({
      status: "accepted",
      slug: "acme",
    });
    // 들어가는 역할은 입력이 아니라 초대에 적힌 역할이다.
    expect(repo.insertMembership).toHaveBeenCalledWith(ORG_ID, "me", "owner");
  });

  it("거절·취소는 초대를 지우고 done 이다", async () => {
    const repo = fakeRepo();
    await expect(declineInvitation(INVITATION_ID, repo)).resolves.toEqual({ status: "done" });
    await expect(cancelInvitation(INVITATION_ID, repo)).resolves.toEqual({ status: "done" });
    expect(repo.deleteInvitation).toHaveBeenCalledTimes(2);
    await expect(declineInvitation("x", repo)).rejects.toThrow("초대 id 형식");
  });
});

// 쓰기는 화면 밖에서 직접 POST 로도 불린다. 로그인을 확인하기 전에는 어떤 저장도 부르지 않는다.
describe("로그인 전·DB 없음의 쓰기", () => {
  const writes = [
    {
      name: "inviteMember",
      run: (repo: OrganizationRepo) =>
        inviteMember(ORG_ID, { email: "kim@example.com", role: "member" }, repo, fakeMailer()),
      store: "insertInvitation",
    },
    {
      name: "renameTeam",
      run: (repo: OrganizationRepo) => renameTeam(ORG_ID, { name: "새 이름" }, repo),
      store: "updateTeamName",
    },
    {
      name: "deleteTeam",
      run: (repo: OrganizationRepo) => deleteTeam(ORG_ID, { confirmName: "에이크미" }, repo),
      store: "deleteTeam",
    },
    {
      name: "cancelInvitation",
      run: (repo: OrganizationRepo) => cancelInvitation(INVITATION_ID, repo),
      store: "deleteInvitation",
    },
    {
      name: "changeMemberRole",
      run: (repo: OrganizationRepo) => changeMemberRole(ORG_ID, USER_ID, "owner", repo),
      store: "updateRole",
    },
    {
      name: "removeMember",
      run: (repo: OrganizationRepo) => removeMember(ORG_ID, USER_ID, repo),
      store: "deleteMembership",
    },
    {
      name: "acceptInvitation",
      run: (repo: OrganizationRepo) => acceptInvitation(INVITATION_ID, repo, NOW),
      store: "insertMembership",
    },
    {
      name: "declineInvitation",
      run: (repo: OrganizationRepo) => declineInvitation(INVITATION_ID, repo),
      store: "deleteInvitation",
    },
  ] as const;

  it.each(writes)("$name 은 로그인 전이면 저장을 부르지 않고 signed-out 이다", async (write) => {
    const repo = fakeRepo({ currentUser: vi.fn(async () => null) });
    await expect(write.run(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo[write.store]).not.toHaveBeenCalled();
    expect(repo.findOrg).not.toHaveBeenCalled();
  });

  it.each(writes)("$name 은 DB 설정이 없으면 로그인도 묻지 않고 signed-out 이다", async (write) => {
    const repo = fakeRepo({ isConfigured: () => false });
    await expect(write.run(repo)).resolves.toEqual({ status: "signed-out" });
    expect(repo.currentUser).not.toHaveBeenCalled();
    expect(repo[write.store]).not.toHaveBeenCalled();
  });
});
