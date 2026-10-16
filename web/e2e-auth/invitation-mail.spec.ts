import { expect, type Page, test } from "@playwright/test";
import { createInvitation, createTeam, deleteTeam, signInAs } from "./support/local-supabase";
import { deleteMailsTo, readMail, waitForMailsTo } from "./support/mailbox";
import { SEED_ACCOUNTS, authFileOf, uniqueTag } from "./support/seed";

// 초대하면(새 초대·다시 초대) 앱 서버가 SMTP 로 초대 메일을 보내고, 화면 토스트가 보냈다고 알린다.
// 로컬은 Supabase 에 딸린 메일함(Mailpit)으로만 간다 — `pnpm db:start` 가 web/.env.local 에 로컬 SMTP 값을 적는다.
// 그 값이 없으면 메일 없이 초대만 되고 토스트가 "직접 알려 주세요"라 이 시험이 실패한다(환경 문제).
// 시드 팀은 건드리지 않는다. 소유자(김소유)가 REST 로 만든 팀에서 초대하고, 끝나면 팀(초대 포함)과 받은 메일을 지운다.
// 스펙: polaris/specs/done/team-settings-mail-csp-errors.md 3.4·5장
test.use({ storageState: authFileOf("owner") });

// 팀 이름에 HTML 로 읽힐 글자(<·>·&·")를 넣어 메일 HTML 판이 글자로만 싣는지 본다.
const HTML_LOOKING_NAME = (tag: string) => `<b>E2E</b> & "메일" ${tag}`;
const ESCAPED_NAME = (tag: string) => `&lt;b&gt;E2E&lt;/b&gt; &amp; &quot;메일&quot; ${tag}`;
// 메일 HTML 의 링크(<a href="…">받은 초대 열기</a>).
const INVITATIONS_LINK = /<a href="([^"]+)">받은 초대 열기<\/a>/;

const pendingRowOf = (page: Page, email: string) =>
  page.getByRole("table", { name: "대기 중인 초대" }).getByRole("row").filter({ hasText: email });

// 시험만의 팀과 받는 주소. 끝나면(실패해도) 받은 메일과 팀을 지운다. 팀을 지우면 초대도 함께 지워진다.
const withTeamAndInvitee = async (
  name: string,
  run: (context: {
    team: { name: string; slug: string };
    orgId: string;
    email: string;
  }) => Promise<void>,
) => {
  const tag = uniqueTag();
  const team = { name, slug: `e2e-mail-${tag}` };
  const email = `e2e-invitee-${tag}@example.test`;
  const owner = await signInAs("owner");
  const orgId = await createTeam(owner, team);
  try {
    await run({ team, orgId, email });
  } finally {
    await deleteMailsTo(email);
    await deleteTeam(owner, orgId);
  }
};

test("새로 초대하면 메일을 보냈다는 토스트가 뜨고, 로컬 메일함에 받은 초대 링크와 이스케이프한 팀 이름이 든 메일이 온다", async ({
  page,
}) => {
  const tag = uniqueTag();
  await withTeamAndInvitee(HTML_LOOKING_NAME(tag), async ({ team, email }) => {
    await page.goto(`/${team.slug}/settings/members`);
    await page.getByRole("textbox", { name: "이메일" }).fill(email);
    await page.getByRole("button", { name: "초대", exact: true }).click();

    await expect(page.getByText(`${email}을 초대하고 초대 메일을 보냈습니다`)).toBeVisible();
    await expect(pendingRowOf(page, email)).toHaveCount(1);

    const [id] = await waitForMailsTo(email, 1);
    const mail = await readMail(id);
    expect(mail.To.map((to) => to.Address)).toEqual([email]);
    expect(mail.Subject).toBe(`${team.name} 팀에 초대받았습니다`);

    // HTML 판: 팀 이름은 이스케이프한 글자로만 들어가고 태그로 읽히지 않는다.
    expect(mail.HTML).toContain(
      `<strong>${SEED_ACCOUNTS.owner.name}</strong> 님이 <strong>${ESCAPED_NAME(tag)}</strong> 팀에 초대했습니다.`,
    );
    expect(mail.HTML).not.toContain("<b>E2E</b>");
    expect(mail.HTML).toContain("역할: 멤버");

    // 링크는 사이트 주소의 받은 초대 화면 하나이고, 텍스트 판에도 같은 주소가 있다.
    const link = INVITATIONS_LINK.exec(mail.HTML)?.[1] ?? "";
    expect(URL.canParse(link), link).toBe(true);
    expect(new URL(link).protocol).toMatch(/^https?:$/);
    expect(new URL(link).pathname).toBe("/invitations");
    expect(mail.Text).toContain(link);
    // 텍스트 판은 이름을 글자 그대로 싣는다.
    expect(mail.Text).toContain(
      `${SEED_ACCOUNTS.owner.name} 님이 "${team.name}" 팀에 초대했습니다.`,
    );
  });
});

test("대기 중인 초대를 다시 초대하면 기한을 늘리고 메일을 다시 보냈다는 토스트가 뜨고, 메일이 한 통 더 온다", async ({
  page,
}) => {
  await withTeamAndInvitee(`E2E 다시 초대 ${uniqueTag()}`, async ({ team, orgId, email }) => {
    // 준비: 화면 밖(REST)에서 만든 초대라 아직 메일이 없다.
    await createInvitation(await signInAs("owner"), { orgId, email });
    await page.goto(`/${team.slug}/settings/members`);
    await expect(pendingRowOf(page, email)).toHaveCount(1);

    await page.getByRole("button", { name: `${email} 초대 관리`, exact: true }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "다시 초대" }).click();

    await expect(
      page.getByText(`${email}의 초대 기한을 7일 늘리고 메일을 다시 보냈습니다`),
    ).toBeVisible();
    const [id] = await waitForMailsTo(email, 1);
    const mail = await readMail(id);
    expect(mail.To.map((to) => to.Address)).toEqual([email]);
    expect(mail.Subject).toBe(`${team.name} 팀에 초대받았습니다`);
  });
});
