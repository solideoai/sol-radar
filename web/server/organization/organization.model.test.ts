import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  type InvitationMail,
  type MyOrgRow,
  parseDeleteConfirmation,
  parseId,
  parseInvite,
  parseNewTeam,
  parseRole,
  parseTeamName,
  RESERVED_SLUGS,
  sortMembers,
  sortOrgs,
  toCurrentOrg,
  toInvitationMail,
  toInvitationMailContent,
  toInvitationView,
  toMemberView,
} from "./organization.model";

const org = (overrides: Partial<MyOrgRow>): MyOrgRow => ({
  orgId: "o",
  slug: "s",
  name: "이름",
  isPersonal: false,
  role: "member",
  ...overrides,
});

describe("sortOrgs", () => {
  it("개인 조직이 먼저, 팀은 이름 가나다순이다", () => {
    const rows = [
      org({ slug: "z", name: "하늘팀" }),
      org({ slug: "p", name: "개인 공간", isPersonal: true }),
      org({ slug: "a", name: "가람팀" }),
    ];
    expect(sortOrgs(rows).map((row) => row.slug)).toEqual(["p", "a", "z"]);
  });
});

describe("toCurrentOrg", () => {
  it("화면이 쓰는 모양으로 바꾼다", () => {
    expect(
      toCurrentOrg(org({ orgId: "o1", slug: "acme", name: "에이크미", role: "owner" })),
    ).toEqual({
      id: "o1",
      slug: "acme",
      name: "에이크미",
      isPersonal: false,
      myRole: "owner",
    });
  });
});

describe("parseNewTeam", () => {
  it("이름과 주소를 다듬어 돌려준다", () => {
    expect(parseNewTeam({ name: "  디자인팀 ", slug: " design-1 " })).toEqual({
      ok: true,
      name: "디자인팀",
      slug: "design-1",
    });
  });

  it("주소는 영문 소문자·숫자·하이픈 3~32자다", () => {
    const slugError = (slug: unknown) => parseNewTeam({ name: "팀", slug });
    expect(slugError("ab")).toEqual({ ok: false, field: "slug", message: "주소는 3자 이상입니다" });
    expect(slugError("a".repeat(33))).toEqual({
      ok: false,
      field: "slug",
      message: "주소는 32자 이하입니다",
    });
    for (const slug of ["Acme", "acme_1", "에이크미", "a b"])
      expect(slugError(slug)).toEqual({
        ok: false,
        field: "slug",
        message: "주소에는 영문 소문자·숫자·하이픈(-)만 씁니다",
      });
    expect(slugError("a".repeat(32))).toMatchObject({ ok: true });
  });

  it("최상위 경로 이름은 주소로 쓰지 못한다", () => {
    for (const slug of RESERVED_SLUGS)
      expect(parseNewTeam({ name: "팀", slug })).toEqual({
        ok: false,
        field: "slug",
        message: "쓸 수 없는 주소입니다",
      });
  });

  it("팀 이름은 앞뒤 공백을 뺀 1~40자이고, 이름을 먼저 본다", () => {
    expect(parseNewTeam({ name: "   ", slug: "x" })).toEqual({
      ok: false,
      field: "name",
      message: "팀 이름을 입력하세요",
    });
    expect(parseNewTeam({ name: "가".repeat(41), slug: "team" })).toMatchObject({
      ok: false,
      field: "name",
    });
    expect(parseNewTeam({ name: "가".repeat(40), slug: "team" })).toMatchObject({ ok: true });
  });

  it("객체가 아닌 입력(직접 POST 로 온 값)은 거절한다", () => {
    expect(parseNewTeam(undefined)).toMatchObject({ ok: false, field: "name" });
    expect(parseNewTeam("acme")).toMatchObject({ ok: false, field: "name" });
  });
});

describe("parseInvite", () => {
  it("이메일은 소문자로 맞추고 역할을 받는다", () => {
    expect(parseInvite({ email: "  Kim@Example.COM ", role: "member" })).toEqual({
      ok: true,
      email: "kim@example.com",
      role: "member",
    });
  });

  it("이메일 형식이 아니거나 역할이 없으면 거절한다", () => {
    expect(parseInvite({ email: "kim", role: "member" })).toEqual({
      ok: false,
      message: "이메일 형식이 아닙니다",
    });
    expect(parseInvite({ email: "kim@example.com", role: "admin" })).toEqual({
      ok: false,
      message: "역할을 고르세요",
    });
    expect(parseInvite(undefined)).toMatchObject({ ok: false });
  });

  it("이메일은 254자까지 받고 255자는 거절한다(DB 제약 invitations_email_check 와 같다)", () => {
    // 앞부분 64자 + @ + 도메인. 도메인 길이로 전체를 맞춘다.
    const emailOfLength = (length: number) =>
      `${"a".repeat(64)}@${"b".repeat(length - 65 - ".com".length)}.com`;
    expect(emailOfLength(254)).toHaveLength(254);
    expect(parseInvite({ email: emailOfLength(254), role: "member" })).toMatchObject({ ok: true });
    expect(parseInvite({ email: emailOfLength(255), role: "member" })).toEqual({
      ok: false,
      message: "이메일이 너무 깁니다",
    });
  });
});

describe("parseRole·parseId", () => {
  it("owner·member 만 역할이다", () => {
    expect(parseRole("owner")).toEqual({ ok: true, role: "owner" });
    expect(parseRole("admin")).toEqual({ ok: false });
  });

  it("uuid 형식만 id 다", () => {
    const id = "3f2b8c1e-5d4a-4c7b-9e1f-0a2b3c4d5e6f";
    expect(parseId(id)).toEqual({ ok: true, id });
    expect(parseId("acme")).toEqual({ ok: false });
  });
});

describe("멤버 보기", () => {
  it("표시 이름이 없으면 이메일의 @ 앞부분을 이름으로 쓰고, 나를 표시한다", () => {
    expect(
      toMemberView(
        { userId: "u1", role: "owner", email: "hong@example.com", displayName: null },
        "u1",
      ),
    ).toEqual({
      userId: "u1",
      name: "hong",
      email: "hong@example.com",
      role: "owner",
      roleLabel: "소유자",
      isMe: true,
    });
  });

  it("소유자가 먼저, 같은 역할 안에서는 이름순이다", () => {
    const view = (userId: string, role: "owner" | "member", displayName: string) =>
      toMemberView({ userId, role, email: null, displayName }, "nobody");
    const sorted = sortMembers([
      view("1", "member", "나래"),
      view("2", "owner", "하늘"),
      view("3", "member", "가람"),
      view("4", "owner", "다솜"),
    ]);
    expect(sorted.map((member) => member.name)).toEqual(["다솜", "하늘", "가람", "나래"]);
  });
});

describe("toInvitationView", () => {
  const NOW = new Date("2026-10-14T03:00:00.000Z");

  it("만료일을 서울 날짜로 찍고, 지났는지 표시한다", () => {
    const row = { id: "i1", email: "kim@example.com", role: "member" as const };
    expect(toInvitationView({ ...row, expiresAt: "2026-10-20T16:00:00.000Z" }, NOW)).toEqual({
      ...row,
      roleLabel: "멤버",
      expiresAt: "2026-10-20T16:00:00.000Z",
      // UTC 16시는 서울로 다음 날 01시다.
      expiresAtText: "2026. 10. 21.",
      isExpired: false,
    });
    expect(toInvitationView({ ...row, expiresAt: NOW.toISOString() }, NOW).isExpired).toBe(true);
  });
});

describe("parseTeamName", () => {
  it("앞뒤 공백을 떼고 이름을 돌려준다", () => {
    expect(parseTeamName({ name: "  새 팀 이름 " })).toEqual({ ok: true, name: "새 팀 이름" });
  });

  it("비었거나 공백뿐이면 '팀 이름을 입력하세요'", () => {
    for (const name of ["", "   ", "\t\n"])
      expect(parseTeamName({ name })).toEqual({ ok: false, message: "팀 이름을 입력하세요" });
  });

  it("40자까지 받고(앞뒤 공백은 세지 않는다) 41자는 '팀 이름은 40자 이하입니다'", () => {
    expect(parseTeamName({ name: "가".repeat(40) })).toEqual({ ok: true, name: "가".repeat(40) });
    expect(parseTeamName({ name: ` ${"가".repeat(40)} ` })).toEqual({
      ok: true,
      name: "가".repeat(40),
    });
    expect(parseTeamName({ name: "가".repeat(41) })).toEqual({
      ok: false,
      message: "팀 이름은 40자 이하입니다",
    });
  });

  it("글자가 아니거나 객체가 아닌 입력(직접 POST 로 온 값)은 거절한다", () => {
    expect(parseTeamName({ name: 123 })).toEqual({
      ok: false,
      message: "팀 이름은 글자여야 합니다",
    });
    for (const input of [undefined, null, "에이크미", {}])
      expect(parseTeamName(input)).toMatchObject({ ok: false });
  });

  it("팀을 만들 때의 이름 규칙과 같다", () => {
    for (const name of ["팀", " 팀 ", "", "  ", "가".repeat(40), "가".repeat(41), 7, undefined]) {
      const created = parseNewTeam({ name, slug: "valid-slug" });
      const renamed = parseTeamName({ name });
      expect(renamed.ok, String(name)).toBe(created.ok);
      if (created.ok && renamed.ok) expect(renamed.name).toBe(created.name);
      if (!created.ok && !renamed.ok) expect(renamed.message).toBe(created.message);
    }
  });
});

describe("parseDeleteConfirmation", () => {
  it("앞뒤 공백만 떼고, 가운데 글자는 그대로 둔다", () => {
    expect(parseDeleteConfirmation({ confirmName: "  에이크미 " })).toEqual({
      ok: true,
      confirmName: "에이크미",
    });
    expect(parseDeleteConfirmation({ confirmName: "에이  크미" })).toEqual({
      ok: true,
      confirmName: "에이  크미",
    });
  });

  it("대소문자를 바꾸지 않는다(비교는 정확히 같을 때만이다)", () => {
    expect(parseDeleteConfirmation({ confirmName: "ACME" })).toEqual({
      ok: true,
      confirmName: "ACME",
    });
  });

  it("비었거나 공백뿐이거나 글자가 아니면 '팀 이름을 입력하세요'", () => {
    for (const confirmName of ["", "   ", undefined, null, 42])
      expect(parseDeleteConfirmation({ confirmName })).toEqual({
        ok: false,
        message: "팀 이름을 입력하세요",
      });
  });

  it("객체가 아닌 입력은 거절한다 — 문구도 빈 칸과 같다", () => {
    for (const input of [undefined, null, "에이크미"])
      expect(parseDeleteConfirmation(input)).toEqual({
        ok: false,
        message: "팀 이름을 입력하세요",
      });
  });
});

describe("toInvitationMail", () => {
  const row = {
    orgName: "에이크미",
    role: "member" as const,
    expiresAt: "2026-10-22T03:00:00.000Z",
    inviterDisplayName: "홍길동",
    inviterEmail: "hong@example.com",
  };

  it("받는 사람·조직·역할·만료와 초대한 사람의 표시 이름을 담는다", () => {
    expect(toInvitationMail(row, "kim@example.com", "login@example.com")).toEqual({
      to: "kim@example.com",
      orgName: "에이크미",
      inviterName: "홍길동",
      role: "member",
      expiresAt: "2026-10-22T03:00:00.000Z",
    });
  });

  it("표시 이름이 없으면 프로필 이메일의 @ 앞, 프로필 이메일도 없으면 로그인 이메일의 @ 앞이다", () => {
    expect(
      toInvitationMail({ ...row, inviterDisplayName: null }, "kim@example.com", "login@example.com")
        .inviterName,
    ).toBe("hong");
    expect(
      toInvitationMail(
        { ...row, inviterDisplayName: null, inviterEmail: null },
        "kim@example.com",
        "login@example.com",
      ).inviterName,
    ).toBe("login");
  });
});

describe("escapeHtml", () => {
  it("& < > \" ' 다섯 글자를 바꾼다", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });

  it("이미 바꾼 글자도 다시 바꾼다(&lt; 를 글자 그대로 보인다)", () => {
    expect(escapeHtml("&lt;b&gt;")).toBe("&amp;lt;b&amp;gt;");
  });

  it("바꿀 글자가 없으면 그대로다", () => {
    expect(escapeHtml("에이크미 팀 (2026)")).toBe("에이크미 팀 (2026)");
  });
});

describe("toInvitationMailContent", () => {
  const mail: InvitationMail = {
    to: "kim@example.com",
    orgName: "에이크미",
    inviterName: "홍길동",
    role: "member",
    // UTC 16시는 서울로 다음 날 01시다.
    expiresAt: "2026-10-21T16:00:00.000Z",
  };
  const SITE = "https://app.example.com";

  it("제목은 '<조직 이름> 팀에 초대받았습니다'다", () => {
    expect(toInvitationMailContent(mail, SITE).subject).toBe("에이크미 팀에 초대받았습니다");
  });

  it("글자판에 초대한 사람·조직·역할·서울 날짜의 만료일·받은 초대 링크가 있다", () => {
    const { text } = toInvitationMailContent(mail, SITE);
    expect(text).toContain('홍길동 님이 "에이크미" 팀에 초대했습니다.');
    expect(text).toContain("역할: 멤버");
    expect(text).toContain("초대 기한: 2026. 10. 22.까지");
    expect(text.split("\n")).toContain("https://app.example.com/invitations");
  });

  it("owner 초대는 역할을 '소유자'로 적는다", () => {
    const content = toInvitationMailContent({ ...mail, role: "owner" }, SITE);
    expect(content.text).toContain("역할: 소유자");
    expect(content.html).toContain("역할: 소유자");
  });

  it("HTML 판에도 같은 값과 받은 초대 링크(href)가 있다", () => {
    const { html } = toInvitationMailContent(mail, SITE);
    expect(html).toContain(
      "<strong>홍길동</strong> 님이 <strong>에이크미</strong> 팀에 초대했습니다.",
    );
    expect(html).toContain("역할: 멤버<br>초대 기한: 2026. 10. 22.까지");
    expect(html).toContain('<a href="https://app.example.com/invitations">');
  });

  it("사이트 주소 끝의 / 는 몇 개든 떼고, 경로는 남긴다", () => {
    const linkOf = (siteUrl: string) =>
      toInvitationMailContent(mail, siteUrl)
        .text.split("\n")
        .find((line) => line.startsWith("http"));
    expect(linkOf("https://app.example.com/")).toBe("https://app.example.com/invitations");
    expect(linkOf("https://app.example.com///")).toBe("https://app.example.com/invitations");
    expect(linkOf("https://example.com/app/")).toBe("https://example.com/app/invitations");
    expect(linkOf("http://localhost:3000")).toBe("http://localhost:3000/invitations");
  });

  it("조직 이름·표시 이름의 태그는 HTML 판에서 글자로 바뀐다 — 태그·링크가 끼어들지 못한다", () => {
    const { html } = toInvitationMailContent(
      {
        ...mail,
        orgName: `</title><script>alert(1)</script>`,
        inviterName: `<a href="https://evil.example">홍</a>`,
      },
      SITE,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('evil.example">');
    expect(html).toContain("&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;a href=&quot;https://evil.example&quot;&gt;홍&lt;/a&gt;");
    // 링크는 받은 초대 하나뿐이다.
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("조직 이름·표시 이름의 줄바꿈·제어 문자는 공백으로 바뀐다 — 제목 머리글에 다른 머리글이 끼어들지 못한다", () => {
    const content = toInvitationMailContent(
      { ...mail, orgName: "에이크미\r\nBcc: victim@example.com", inviterName: "홍\n길\u0000동" },
      SITE,
    );
    expect(content.subject).toBe("에이크미 Bcc: victim@example.com 팀에 초대받았습니다");
    expect(content.subject).not.toMatch(/\p{Cc}/u);
    expect(content.text.split("\n")[0]).toBe(
      '홍 길 동 님이 "에이크미 Bcc: victim@example.com" 팀에 초대했습니다.',
    );
  });
});
