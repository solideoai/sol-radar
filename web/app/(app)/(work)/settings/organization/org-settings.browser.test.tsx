import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { SettingsNav } from "@/app/(app)/[slug]/settings/settings-nav";
import type { OrgAuditView, OrgInvitationView, OrgMemberView } from "@/server/organization";
import { OrgAuditTable } from "./org-audit-table";
import { OrgInvitationTable } from "./org-invitation-table";
import { OrgInviteForm } from "./org-invite-form";
import { OrgMemberTable } from "./org-member-table";

const { router, changeSolRole, demoteMySolRole, inviteToOrg, cancelOrgInvite, toast } = vi.hoisted(
  () => ({
    router: { replace: vi.fn(), refresh: vi.fn() },
    changeSolRole: vi.fn(),
    demoteMySolRole: vi.fn(),
    inviteToOrg: vi.fn(),
    cancelOrgInvite: vi.fn(),
    toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  }),
);
vi.mock("next/link", () => ({
  __esModule: true,
  default: (props: ComponentProps<"a">) => <a {...props} />,
}));
vi.mock("next/navigation", () => ({
  __esModule: true,
  useRouter: () => router,
  usePathname: () => "/settings/organization",
}));
vi.mock("./actions", () => ({ changeSolRole, demoteMySolRole, inviteToOrg, cancelOrgInvite }));
vi.mock("sonner", () => ({ toast }));

const ME = "00000000-0000-4000-8000-000000000001";
const SALES = "00000000-0000-4000-8000-000000000002";
const LONG = "긴이름".repeat(13);

const member = (overrides: Partial<OrgMemberView>): OrgMemberView => ({
  userId: SALES,
  name: "이영업",
  email: "sales@soltech.invalid",
  solRole: "SALES",
  joinedAt: "2026-10-19T00:00:00.000Z",
  isMe: false,
  isSuspended: false,
  ...overrides,
});

const MEMBERS: OrgMemberView[] = [
  member({
    userId: ME,
    name: "김관리",
    email: "admin@soltech.invalid",
    solRole: "ADMIN",
    isMe: true,
  }),
  member({}),
  member({
    userId: "00000000-0000-4000-8000-000000000003",
    name: LONG,
    email: `${"long".repeat(60)}@soltech.invalid`,
    solRole: "VIEWER",
    isSuspended: true,
  }),
];

const INVITATIONS: OrgInvitationView[] = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    email: "first@soltech.invalid",
    solRole: "ANALYST",
    expiresAt: "2026-10-28T03:00:00.000Z",
    isExpired: false,
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    email: `${"x".repeat(200)}@soltech.invalid`,
    solRole: "VIEWER",
    expiresAt: "2026-10-01T03:00:00.000Z",
    isExpired: true,
  },
];

const AUDIT: OrgAuditView[] = [
  {
    id: "audit-1",
    kind: "role-change",
    at: "2026-10-21T05:05:00.000Z",
    actor: { kind: "member", name: "김관리", isMe: true },
    target: { kind: "member", name: "이영업", isMe: false },
    fromRole: "SALES",
    toRole: "ANALYST",
  },
  {
    id: "audit-2",
    kind: "invite",
    at: "2026-10-21T05:03:00.000Z",
    actor: { kind: "deleted" },
    email: "first@soltech.invalid",
    toRole: "ANALYST",
  },
  {
    id: "audit-3",
    kind: "role-change",
    at: "2026-10-20T05:03:00.000Z",
    actor: { kind: "left" },
    target: { kind: "left" },
    fromRole: "VIEWER",
    toRole: "SALES",
  },
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  changeSolRole.mockResolvedValue({ status: "saved" });
  demoteMySolRole.mockResolvedValue({ status: "saved" });
  inviteToOrg.mockResolvedValue({ status: "invited", mail: "not-configured" });
  cancelOrgInvite.mockResolvedValue({ status: "done" });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
});

// 1280px·사이드바 펼침의 단 폭은 960px, 1440px 은 max-w-5xl(1024px)이다(디자인 스펙 §3.2).
const COLUMN = { 1280: 960, 1440: 1024 } as const;

function renderScreen({
  members = MEMBERS,
  adminCount = 1,
  invitations = INVITATIONS,
  audit = AUDIT,
  column = 960,
}: {
  members?: OrgMemberView[];
  adminCount?: number;
  invitations?: OrgInvitationView[];
  audit?: OrgAuditView[];
  column?: number;
} = {}) {
  root.render(
    <main style={{ width: column }}>
      <SettingsNav slug="solideo" isTeam showOrganization />
      <div className="flex flex-col gap-6 pt-6">
        <OrgMemberTable members={members} adminCount={adminCount} />
        <OrgInviteForm />
        <OrgInvitationTable invitations={invitations} />
        <OrgAuditTable entries={audit} />
      </div>
    </main>,
  );
}

const roleBox = (name: string) => page.getByRole("combobox", { name: `${name} 업무 역할` });

describe("배치", () => {
  it.each([1440, 1280] as const)(
    "%s 폭에서 네 구역이 단 안에 들어오고 긴 값은 말줄임된다",
    async (width) => {
      await page.viewport(width, 1000);
      renderScreen({ column: COLUMN[width] });
      await expect.element(page.getByRole("heading", { name: "구성원" })).toBeVisible();
      expect(
        page
          .getByRole("heading", { level: 2 })
          .elements()
          .map((heading) => heading.textContent),
      ).toEqual(["구성원", "초대", "대기 중인 초대", "최근 변경 기록"]);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      for (const table of host.querySelectorAll("table")) {
        expect(table.scrollWidth).toBeLessThanOrEqual(table.parentElement?.clientWidth ?? 0);
      }
      // 하위 메뉴: 조직이 지금 화면이다.
      await expect
        .element(page.getByRole("link", { name: "조직" }))
        .toHaveAttribute("aria-current", "page");
      await expect.element(page.getByText("정지됨")).toBeVisible();
      await expect.element(page.getByText("만료됨")).toBeVisible();
      // 초대 폼은 한 줄이고 [초대] 단추는 글자 폭이다(남은 폭을 채우지 않는다, 디자인 스펙 §4.4).
      const email = page.getByRole("textbox", { name: "이메일" }).element().getBoundingClientRect();
      const submit = page
        .getByRole("button", { name: "초대", exact: true })
        .element()
        .getBoundingClientRect();
      expect(submit.left).toBeGreaterThan(email.right);
      expect(submit.width).toBeLessThan(100);
    },
  );
});

describe("구성원 업무 역할", () => {
  it("마지막 ADMIN 이면 안내 줄을 보이고 내 행의 낮은 역할을 고를 수 없다", async () => {
    renderScreen({ adminCount: 1 });
    await expect
      .element(roleBox("김관리"))
      .toHaveAccessibleDescription(
        "ADMIN이 나 한 명이라 내 업무 역할은 바꿀 수 없습니다. 다른 구성원을 먼저 ADMIN으로 바꾸세요.",
      );
    await roleBox("김관리").click();
    await expect
      .element(page.getByRole("option", { name: "VIEWER" }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(page.getByRole("option", { name: "ADMIN" }))
      .not.toHaveAttribute("aria-disabled", "true");
  });

  it("다른 사람의 역할은 확인 없이 바로 저장하고 성공 토스트를 띄운다", async () => {
    renderScreen();
    await roleBox("이영업").click();
    await page.getByRole("option", { name: "ANALYST" }).click();
    await expect.poll(() => changeSolRole.mock.calls).toEqual([[SALES, "ANALYST"]]);
    await expect
      .poll(() => toast.success.mock.calls)
      .toEqual([["이영업 님의 업무 역할을 SALES에서 ANALYST로 바꿨습니다"]]);
    expect(page.getByRole("dialog").elements()).toHaveLength(0);
  });

  it("저장이 거절되면 저장된 값으로 돌아가고 사유를 그 자리에 보인다", async () => {
    changeSolRole.mockResolvedValue({ status: "last-admin" });
    renderScreen();
    await roleBox("이영업").click();
    await page.getByRole("option", { name: "VIEWER" }).click();
    await expect
      .element(page.getByRole("alert"))
      .toHaveTextContent(
        "이영업 님의 업무 역할을 바꾸지 못했습니다. 조직에는 업무 ADMIN이 한 명 이상 있어야 합니다.",
      );
    await expect.element(roleBox("이영업")).toHaveTextContent("SALES");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("로그인이 풀렸으면 문장 뒤에 로그인 링크를 붙인다", async () => {
    changeSolRole.mockResolvedValue({ status: "signed-out" });
    renderScreen();
    await roleBox("이영업").click();
    await page.getByRole("option", { name: "VIEWER" }).click();
    await expect
      .element(page.getByRole("alert").getByRole("link", { name: "로그인" }))
      .toHaveAttribute("href", "/auth/login");
  });

  it("ADMIN 이 둘 이상이면 내 강등은 확인을 받고, 바꾸면 대시보드로 옮긴다", async () => {
    renderScreen({
      adminCount: 2,
      members: [MEMBERS[0], member({ solRole: "ADMIN" })],
    });
    await roleBox("김관리").click();
    await page.getByRole("option", { name: "SALES" }).click();
    const dialog = page.getByRole("dialog", { name: "내 업무 역할을 SALES로 바꿀까요?" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByRole("button", { name: "취소" })).toHaveFocus();
    // 확인 전에는 저장하지 않고, 선택 상자는 아직 ADMIN 이다.
    // 대화상자가 열리면 바깥은 보조기술에서 숨겨지므로 숨은 요소까지 찾는다.
    expect(demoteMySolRole).not.toHaveBeenCalled();
    await expect
      .element(page.getByRole("combobox", { name: "김관리 업무 역할", includeHidden: true }))
      .toHaveTextContent("ADMIN");
    await dialog.getByRole("button", { name: "SALES로 바꾸기" }).click();
    await expect.poll(() => demoteMySolRole.mock.calls).toEqual([["SALES"]]);
    await expect.poll(() => router.replace.mock.calls).toEqual([["/dashboard"]]);
    expect(router.refresh).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("내 업무 역할을 SALES로 바꿨습니다");
  });

  it("강등이 거절되면 대화상자가 열린 채 사유를 보이고, 취소하면 내 선택 상자로 초점이 돌아온다", async () => {
    demoteMySolRole.mockResolvedValue({ status: "last-admin" });
    renderScreen({ adminCount: 2, members: [MEMBERS[0], member({ solRole: "ADMIN" })] });
    await roleBox("김관리").click();
    await page.getByRole("option", { name: "VIEWER" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "VIEWER로 바꾸기" }).click();
    await expect
      .element(dialog.getByRole("alert"))
      .toHaveTextContent(
        "내 업무 역할을 바꾸지 못했습니다. 조직에는 업무 ADMIN이 한 명 이상 있어야 합니다.",
      );
    expect(router.replace).not.toHaveBeenCalled();
    await dialog.getByRole("button", { name: "취소" }).click();
    await expect.element(roleBox("김관리")).toHaveFocus();
  });
});

describe("초대", () => {
  it("빈 이메일은 보내지 않고 칸 오류를 보인다", async () => {
    renderScreen();
    await page.getByRole("button", { name: "초대", exact: true }).click();
    await expect.element(page.getByText("이메일을 입력하세요")).toBeVisible();
    expect(inviteToOrg).not.toHaveBeenCalled();
  });

  it("기본 역할 VIEWER 로 보내고, 성공하면 폼을 비우고 이메일 칸에 초점을 둔다", async () => {
    renderScreen();
    const email = page.getByRole("textbox", { name: "이메일" });
    await email.fill("New@SolTech.invalid");
    await page.getByRole("button", { name: "초대", exact: true }).click();
    await expect
      .poll(() => inviteToOrg.mock.calls)
      .toEqual([[{ email: "New@SolTech.invalid", solRole: "VIEWER" }]]);
    await expect
      .poll(() => toast.success.mock.calls)
      .toEqual([
        ["new@soltech.invalid을 VIEWER로 초대했습니다. 초대받은 사람에게 직접 알려 주세요."],
      ]);
    await expect.element(email).toHaveValue("");
    await expect.element(email).toHaveFocus();
  });

  it("이미 구성원이면 이메일 칸 아래에 알리고 입력을 남긴다", async () => {
    inviteToOrg.mockResolvedValue({ status: "already-member" });
    renderScreen();
    const email = page.getByRole("textbox", { name: "이메일" });
    await email.fill("sales@soltech.invalid");
    await page.getByRole("button", { name: "초대", exact: true }).click();
    await expect
      .element(
        page.getByText("이미 이 조직의 구성원입니다. 업무 역할은 위 구성원 표에서 바꾸세요."),
      )
      .toBeVisible();
    await expect.element(email).toHaveValue("sales@soltech.invalid");
    await expect.element(email).toHaveAttribute("aria-invalid", "true");
  });

  it("메일을 보내지 못하면 경고 토스트로 오래 알린다", async () => {
    inviteToOrg.mockResolvedValue({ status: "renewed", mail: "failed" });
    renderScreen();
    await page.getByRole("textbox", { name: "이메일" }).fill("first@soltech.invalid");
    await page.getByRole("combobox", { name: "업무 역할", exact: true }).click();
    await page.getByRole("option", { name: "SALES" }).click();
    await page.getByRole("button", { name: "초대", exact: true }).click();
    await expect
      .poll(() => toast.warning.mock.calls)
      .toEqual([
        [
          "이미 초대한 이메일이라 기한을 7일 늘리고 업무 역할을 SALES로 맞췄습니다. 메일을 보내지 못했습니다. 초대받은 사람에게 직접 알려 주세요.",
          { duration: 10_000 },
        ],
      ]);
  });
});

describe("대기 중인 초대", () => {
  it("취소하면 토스트를 띄우고, 새 목록이 오면 다음 행의 단추로 초점을 옮긴다", async () => {
    renderScreen();
    await page.getByRole("button", { name: "first@soltech.invalid 초대 취소" }).click();
    await expect.poll(() => cancelOrgInvite.mock.calls).toEqual([[INVITATIONS[0].id]]);
    expect(toast.success).toHaveBeenCalledWith("first@soltech.invalid 초대를 취소했습니다");
    // 서버 함수의 refresh() 가 보낼 새 목록.
    renderScreen({ invitations: [INVITATIONS[1]] });
    await expect
      .element(page.getByRole("button", { name: `${INVITATIONS[1].email} 초대 취소` }))
      .toHaveFocus();
  });

  it("마지막 행을 취소하면 카드 제목으로 초점을 옮긴다", async () => {
    renderScreen({ invitations: [INVITATIONS[0]] });
    await page.getByRole("button", { name: "first@soltech.invalid 초대 취소" }).click();
    await expect.poll(() => cancelOrgInvite.mock.calls.length).toBe(1);
    renderScreen({ invitations: [] });
    await expect.element(page.getByRole("heading", { name: "대기 중인 초대" })).toHaveFocus();
    await expect.element(page.getByText("대기 중인 초대가 없습니다.")).toBeVisible();
  });
});

describe("최근 변경 기록", () => {
  it("역할 변경은 전후 역할을 화살표 대신 말로 읽고, 이름을 모르면 그 사실을 적는다", async () => {
    renderScreen();
    const rows = page.getByRole("table", { name: /최근 변경 기록/ }).getByRole("row");
    await expect.element(rows.nth(1)).toHaveTextContent(/SALES\s*→\s*에서\s*ANALYST\s*로/);
    await expect.element(rows.nth(2)).toHaveTextContent("탈퇴한 사용자");
    await expect.element(rows.nth(3)).toHaveTextContent("조직을 떠난 사용자");
  });

  it("기록이 없으면 한 줄로 알린다", async () => {
    renderScreen({ audit: [] });
    await expect
      .element(
        page.getByText(
          "아직 변경 기록이 없습니다. 업무 역할을 바꾸거나 새로 초대하면 여기에 남습니다.",
        ),
      )
      .toBeVisible();
  });
});

it("확인 대화상자는 Esc 로 닫히고 저장하지 않는다", async () => {
  renderScreen({ adminCount: 2, members: [MEMBERS[0], member({ solRole: "ADMIN" })] });
  await roleBox("김관리").click();
  await page.getByRole("option", { name: "ANALYST" }).click();
  await expect.element(page.getByRole("dialog")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.poll(() => page.getByRole("dialog").elements().length).toBe(0);
  expect(demoteMySolRole).not.toHaveBeenCalled();
});
