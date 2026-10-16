import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invitationMailer, missingMailSettings, readMailConfig } from "./organization.mail";
import { type InvitationMail, toInvitationMailContent } from "./organization.model";

// 실제 SMTP 는 부르지 않는다. nodemailer 의 createTransport 자리에 가짜를 꽂고, 보낸 값·결과만 본다.
const smtp = vi.hoisted(() => ({
  sendMail: vi.fn<(message: object) => Promise<unknown>>(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock("nodemailer", () => ({ createTransport: smtp.createTransport }));

// 로컬 메일함(Mailpit)과 같은 모양: 인증 없는 SMTP.
const LOCAL = {
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "54325",
  MAIL_FROM: "no-reply@example.com",
  SITE_URL: "http://localhost:3000",
};

const MAIL: InvitationMail = {
  to: "kim@example.com",
  orgName: "에이크미",
  inviterName: "홍길동",
  role: "member",
  expiresAt: "2026-10-21T16:00:00.000Z",
};

const MAIL_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
  "SITE_URL",
] as const;

// 이 프로세스의 환경 변수와 상관없이 정한 값만 보이게 한다(개발자의 셸에 SMTP 값이 있어도 같은 결과).
const useEnv = (env: Partial<Record<(typeof MAIL_KEYS)[number], string>>) =>
  MAIL_KEYS.forEach((key) => vi.stubEnv(key, env[key] ?? ""));

// console.error 로 남긴 줄들. 한 줄은 JSON 하나다.
const loggedLines = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.map((call) => {
    expect(call).toHaveLength(1);
    return String(call[0]);
  });

beforeEach(() => {
  smtp.sendMail.mockReset();
  smtp.close.mockReset();
  smtp.createTransport.mockReset();
  smtp.createTransport.mockImplementation(() => ({ sendMail: smtp.sendMail, close: smtp.close }));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("readMailConfig", () => {
  it("필수 넷(호스트·포트·보내는 주소·사이트 주소)이 있으면 설정이고, 인증이 없으면 auth 는 null 이다", () => {
    expect(readMailConfig(LOCAL)).toEqual({
      host: "127.0.0.1",
      port: 54325,
      auth: null,
      from: "no-reply@example.com",
      siteUrl: "http://localhost:3000",
    });
  });

  it("사용자·비밀번호가 둘 다 있으면 auth 에 싣는다", () => {
    expect(readMailConfig({ ...LOCAL, SMTP_USER: "mailer", SMTP_PASSWORD: "pw" })?.auth).toEqual({
      user: "mailer",
      pass: "pw",
    });
  });

  it("사용자·비밀번호 가운데 하나만 있으면 설정을 잘못 옮긴 것이라 null 이다", () => {
    expect(readMailConfig({ ...LOCAL, SMTP_USER: "mailer" })).toBeNull();
    expect(readMailConfig({ ...LOCAL, SMTP_PASSWORD: "pw" })).toBeNull();
  });

  it("필수 넷 가운데 하나라도 없거나 비었으면 null 이다", () => {
    for (const key of ["SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "SITE_URL"] as const) {
      expect(readMailConfig({ ...LOCAL, [key]: undefined }), key).toBeNull();
      expect(readMailConfig({ ...LOCAL, [key]: "   " }), key).toBeNull();
    }
  });

  it("앞뒤 공백을 뗀다", () => {
    expect(
      readMailConfig({
        SMTP_HOST: " smtp.example.com ",
        SMTP_PORT: " 587 ",
        MAIL_FROM: " team@example.com ",
        SITE_URL: " https://app.example.com ",
      }),
    ).toEqual({
      host: "smtp.example.com",
      port: 587,
      auth: null,
      from: "team@example.com",
      siteUrl: "https://app.example.com",
    });
  });

  it("포트는 1~65535 의 정수만 받는다", () => {
    const portOf = (SMTP_PORT: string) => readMailConfig({ ...LOCAL, SMTP_PORT })?.port ?? null;
    expect(portOf("1")).toBe(1);
    expect(portOf("465")).toBe(465);
    expect(portOf("65535")).toBe(65535);
    for (const bad of ["0", "65536", "-1", "25.5", "587a", "abc", "1e3", "999999"])
      expect(portOf(bad), bad).toBeNull();
  });

  it("사이트 주소는 http(s) 만 받고, 끝의 / ·검색어·조각은 떼고 경로는 남긴다", () => {
    const siteOf = (SITE_URL: string) => readMailConfig({ ...LOCAL, SITE_URL })?.siteUrl ?? null;
    expect(siteOf("https://app.example.com/")).toBe("https://app.example.com");
    expect(siteOf("https://app.example.com/base/")).toBe("https://app.example.com/base");
    expect(siteOf("https://app.example.com/?ref=mail#top")).toBe("https://app.example.com");
    for (const bad of ["app.example.com", "ftp://app.example.com", "javascript:alert(1)", "/"])
      expect(siteOf(bad), bad).toBeNull();
  });
});

describe("missingMailSettings", () => {
  it("메일 설정을 하나도 적지 않았으면(메일을 쓰지 않는 프로젝트) 빈 목록이다", () => {
    expect(missingMailSettings({})).toEqual([]);
    expect(missingMailSettings(Object.fromEntries(MAIL_KEYS.map((key) => [key, " "])))).toEqual([]);
  });

  it("다 맞게 적었으면 빈 목록이다", () => {
    expect(missingMailSettings(LOCAL)).toEqual([]);
    expect(missingMailSettings({ ...LOCAL, SMTP_USER: "mailer", SMTP_PASSWORD: "pw" })).toEqual([]);
  });

  it("일부만 적었으면 빠졌거나 틀린 변수의 이름을 돌려준다", () => {
    expect(missingMailSettings({ SMTP_HOST: "smtp.example.com" })).toEqual([
      "SMTP_PORT",
      "MAIL_FROM",
      "SITE_URL",
    ]);
    expect(
      missingMailSettings({ ...LOCAL, SMTP_PORT: "70000", SITE_URL: "app.example.com" }),
    ).toEqual(["SMTP_PORT", "SITE_URL"]);
    expect(missingMailSettings({ ...LOCAL, SMTP_USER: "mailer" })).toEqual([
      "SMTP_USER·SMTP_PASSWORD",
    ]);
  });

  it("readMailConfig 가 null 인 설정은 늘 이름 하나 이상을 짚는다(아무것도 적지 않은 경우만 빼고)", () => {
    const envs = [
      LOCAL,
      { ...LOCAL, SMTP_HOST: "" },
      { ...LOCAL, SMTP_PORT: "0" },
      { ...LOCAL, MAIL_FROM: " " },
      { ...LOCAL, SITE_URL: "mailto:x@example.com" },
      { ...LOCAL, SMTP_USER: "mailer" },
      { ...LOCAL, SMTP_PASSWORD: "pw" },
      { SMTP_USER: "mailer", SMTP_PASSWORD: "pw" },
    ];
    for (const env of envs)
      expect(missingMailSettings(env).length > 0, JSON.stringify(env)).toBe(
        readMailConfig(env) === null,
      );
  });
});

describe("invitationMailer.isConfigured", () => {
  it("설정이 다 있으면 true 이고 아무것도 남기지 않는다", () => {
    useEnv(LOCAL);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(invitationMailer.isConfigured()).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it("하나도 적지 않았으면 false 이고 아무것도 남기지 않는다", () => {
    useEnv({});
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(invitationMailer.isConfigured()).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });

  it("일부만 적었으면 false 이고 빠진 변수의 이름만 JSON 한 줄로 남긴다 — 적은 값은 남기지 않는다", () => {
    useEnv({
      SMTP_HOST: "smtp.private-host.example",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "pw-zz-1",
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(invitationMailer.isConfigured()).toBe(false);
    const lines = loggedLines(log);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "error",
      source: "server",
      event: "invitation-mail-misconfigured",
      missing: ["SMTP_PORT", "MAIL_FROM", "SITE_URL"],
    });
    for (const value of ["smtp.private-host.example", "mailer", "pw-zz-1"])
      expect(lines[0]).not.toContain(value);
  });
});

describe("invitationMailer.send", () => {
  it("설정이 없으면 SMTP 에 붙지 않고 not-configured 다", async () => {
    useEnv({});
    await expect(invitationMailer.send(MAIL)).resolves.toBe("not-configured");
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });

  it("모델이 만든 제목·글자판·HTML 판을 보내는 주소에서 받는 사람에게 보내고 sent 다", async () => {
    useEnv(LOCAL);
    smtp.sendMail.mockResolvedValue({ messageId: "m1" });
    await expect(invitationMailer.send(MAIL)).resolves.toBe("sent");
    const content = toInvitationMailContent(MAIL, "http://localhost:3000");
    expect(smtp.sendMail).toHaveBeenCalledTimes(1);
    // 받는 사람은 to 하나뿐이다(cc·bcc·머리글을 따로 싣지 않는다).
    expect(smtp.sendMail).toHaveBeenCalledWith({
      from: "no-reply@example.com",
      to: "kim@example.com",
      subject: content.subject,
      text: content.text,
      html: content.html,
    });
    expect(content.text).toContain("http://localhost:3000/invitations");
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  it("인증 없는 서버(로컬 메일함)는 TLS 를 강제하지 않고, 접속·인사·소켓에 10초 시간 제한을 둔다", async () => {
    useEnv(LOCAL);
    smtp.sendMail.mockResolvedValue({});
    await invitationMailer.send(MAIL);
    expect(smtp.createTransport).toHaveBeenCalledWith({
      host: "127.0.0.1",
      port: 54325,
      secure: false,
      requireTLS: false,
      auth: undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  });

  it("인증 정보를 보낼 때는 TLS 를 강제한다(비밀번호를 평문으로 보내지 않는다)", async () => {
    useEnv({ ...LOCAL, SMTP_PORT: "587", SMTP_USER: "mailer", SMTP_PASSWORD: "pw" });
    smtp.sendMail.mockResolvedValue({});
    await invitationMailer.send(MAIL);
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 587,
        secure: false,
        requireTLS: true,
        auth: { user: "mailer", pass: "pw" },
      }),
    );
  });

  it("포트 465 는 처음부터 TLS 로 붙는다", async () => {
    useEnv({ ...LOCAL, SMTP_PORT: "465", SMTP_USER: "mailer", SMTP_PASSWORD: "pw" });
    smtp.sendMail.mockResolvedValue({});
    await invitationMailer.send(MAIL);
    expect(smtp.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  it("SMTP 가 거절하면 던지지 않고 failed 이고, 오류 이름·코드·응답 번호만 JSON 한 줄로 남긴다 — 받는 사람 주소·오류 문장은 남기지 않는다", async () => {
    useEnv(LOCAL);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    smtp.sendMail.mockRejectedValue(
      Object.assign(new Error("550 5.1.1 <kim@example.com>: Recipient address rejected"), {
        code: "EENVELOPE",
        responseCode: 550,
      }),
    );
    await expect(invitationMailer.send(MAIL)).resolves.toBe("failed");
    const lines = loggedLines(log);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      level: "error",
      source: "server",
      time: expect.any(String),
      event: "invitation-mail-failed",
      name: "Error",
      code: "EENVELOPE",
      responseCode: 550,
    });
    expect(lines[0]).not.toContain("kim@example.com");
    expect(lines[0]).not.toContain("Recipient address rejected");
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  it("오류가 아닌 값으로 실패해도 failed 이고 이름은 NonError, 코드는 null 이다", async () => {
    useEnv(LOCAL);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    smtp.sendMail.mockRejectedValue("connection reset");
    await expect(invitationMailer.send(MAIL)).resolves.toBe("failed");
    expect(JSON.parse(loggedLines(log)[0])).toMatchObject({
      name: "NonError",
      code: null,
      responseCode: null,
    });
  });

  it("SMTP 서버가 응답하지 않으면 10초 뒤에 failed 로 끝낸다 — 그 전에는 끝내지 않는다", async () => {
    vi.useFakeTimers();
    useEnv(LOCAL);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    smtp.sendMail.mockReturnValue(new Promise(() => undefined));
    const settled = { value: null as string | null };
    const sending = invitationMailer.send(MAIL).then((status) => {
      settled.value = status;
      return status;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled.value).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await expect(sending).resolves.toBe("failed");
    expect(JSON.parse(loggedLines(log)[0])).toMatchObject({
      event: "invitation-mail-failed",
      name: "MailTimeoutError",
      code: "ETIMEDOUT",
    });
    expect(smtp.close).toHaveBeenCalledTimes(1);
  });

  it("제때 보냈으면 시간 제한 타이머를 남기지 않는다", async () => {
    vi.useFakeTimers();
    useEnv(LOCAL);
    smtp.sendMail.mockResolvedValue({});
    await expect(invitationMailer.send(MAIL)).resolves.toBe("sent");
    expect(vi.getTimerCount()).toBe(0);
  });
});
