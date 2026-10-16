import "server-only";
import { createTransport } from "nodemailer";
import {
  type InvitationMail,
  type InvitationMailStatus,
  toInvitationMailContent,
} from "./organization.model";

// ── 메일: 초대 메일을 SMTP 로 보내는 자리 ──
// 내용은 모델(toInvitationMailContent)이 만들고, 여기서는 설정을 읽고 보내기만 한다.
// 설정은 서버 전용 환경 변수다(web/.env.example). 하나라도 없으면 보내지 않고 not-configured 다 — 초대는 메일 없이도 된다.
// 보내지 못해도(접속 실패·거절·시간 초과) 던지지 않고 failed 로 돌려준다. 초대는 이미 저장됐고 되돌리지 않는다.

// 초대한 사람은 결과를 기다린다(화면의 "초대 중…"). SMTP 서버가 응답하지 않아도 이만큼 뒤에는 failed 로 끝낸다.
const SEND_TIMEOUT_MS = 10_000;

export type MailConfig = {
  host: string;
  port: number;
  // 로컬 메일함처럼 인증 없는 SMTP 서버면 null.
  auth: { user: string; pass: string } | null;
  from: string;
  siteUrl: string;
};

type Env = Record<string, string | undefined>;

const MAIL_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "MAIL_FROM",
  "SITE_URL",
] as const;

const valueOf = (env: Env, key: string): string => env[key]?.trim() ?? "";

const portOf = (value: string): number | null => {
  const port = /^\d{1,5}$/.test(value) ? Number(value) : NaN;
  return port >= 1 && port <= 65535 ? port : null;
};

// 링크의 앞부분. http(s) 주소만 받고 끝의 / 는 뗀다(링크는 <사이트 주소>/invitations).
const siteUrlOf = (value: string): string | null => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? `${url.origin}${url.pathname}`.replace(/\/+$/, "")
      : null;
  } catch {
    return null;
  }
};

/** 환경 변수 → 메일 설정. 빠졌거나 틀린 값이 있으면 null(보내지 않는다). */
export function readMailConfig(env: Env): MailConfig | null {
  const port = portOf(valueOf(env, "SMTP_PORT"));
  const siteUrl = siteUrlOf(valueOf(env, "SITE_URL"));
  const host = valueOf(env, "SMTP_HOST");
  const from = valueOf(env, "MAIL_FROM");
  const user = valueOf(env, "SMTP_USER");
  const pass = env.SMTP_PASSWORD ?? "";
  // 사용자와 비밀번호는 둘 다 있거나 둘 다 없어야 한다. 하나만 있으면 설정을 잘못 옮긴 것이다.
  if (!host || port === null || !from || siteUrl === null || Boolean(user) !== Boolean(pass))
    return null;
  return { host, port, auth: user ? { user, pass } : null, from, siteUrl };
}

/** 메일 설정 가운데 빠졌거나 틀린 변수의 이름. 하나도 적지 않았으면(메일을 쓰지 않는 프로젝트) 빈 목록이다. */
export function missingMailSettings(env: Env): string[] {
  if (MAIL_KEYS.every((key) => valueOf(env, key) === "")) return [];
  const problems = [
    valueOf(env, "SMTP_HOST") === "" ? "SMTP_HOST" : null,
    portOf(valueOf(env, "SMTP_PORT")) === null ? "SMTP_PORT" : null,
    valueOf(env, "MAIL_FROM") === "" ? "MAIL_FROM" : null,
    siteUrlOf(valueOf(env, "SITE_URL")) === null ? "SITE_URL" : null,
    Boolean(valueOf(env, "SMTP_USER")) !== Boolean(env.SMTP_PASSWORD)
      ? "SMTP_USER·SMTP_PASSWORD"
      : null,
  ];
  return problems.filter((name): name is string => name !== null);
}

class MailTimeoutError extends Error {
  readonly code = "ETIMEDOUT";
  constructor() {
    super(`초대 메일을 ${SEND_TIMEOUT_MS / 1000}초 안에 보내지 못했습니다`);
    this.name = "MailTimeoutError";
  }
}

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeoutError()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

const errorName = (error: unknown): string => (error instanceof Error ? error.name : "NonError");

// nodemailer 의 오류 코드(ECONNECTION·EAUTH·ETIMEDOUT·EENVELOPE 등)와 SMTP 응답 번호(550 등).
const errorCode = (error: unknown): string | null =>
  typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;

const smtpResponseCode = (error: unknown): number | null =>
  typeof error === "object" &&
  error !== null &&
  "responseCode" in error &&
  typeof error.responseCode === "number"
    ? error.responseCode
    : null;

// 오류 기록과 같은 JSON 한 줄(docs/boilerplate/first-deployment.md 의 오류 로그). 오류 문장(message)은 남기지 않는다 —
// SMTP 서버의 거절 문장에는 받는 사람 주소가 들어 있다. 이름·코드·SMTP 응답 번호면 원인을 가를 수 있다.
const logMail = (event: string, fields: Record<string, unknown>): void => {
  console.error(
    JSON.stringify({
      level: "error",
      source: "server",
      time: new Date().toISOString(),
      event,
      ...fields,
    }),
  );
};

// 설정이 없으면 서비스는 메일에 넣을 값을 읽지도 않는다. 일부만 적었다면 설정 실수라 변수 이름만 로그에 남긴다(값은 남기지 않는다).
function isConfigured(): boolean {
  if (readMailConfig(process.env) !== null) return true;
  const missing = missingMailSettings(process.env);
  if (missing.length > 0) logMail("invitation-mail-misconfigured", { missing });
  return false;
}

async function send(mail: InvitationMail): Promise<InvitationMailStatus> {
  const config = readMailConfig(process.env);
  if (!config) return "not-configured";
  const content = toInvitationMailContent(mail, config.siteUrl);
  const transport = createTransport({
    host: config.host,
    port: config.port,
    // 465 는 처음부터 TLS 로 붙는다. 나머지(587 등)는 STARTTLS 로 올린다.
    secure: config.port === 465,
    // 인증 정보를 보낼 때는 암호화를 강제한다. STARTTLS 를 못 하면 비밀번호를 평문으로 보내지 않고 실패한다.
    // 인증이 없는 로컬 메일함(Supabase 의 Mailpit)은 TLS 가 없어 강제하지 않는다.
    requireTLS: config.auth !== null,
    auth: config.auth ?? undefined,
    connectionTimeout: SEND_TIMEOUT_MS,
    greetingTimeout: SEND_TIMEOUT_MS,
    socketTimeout: SEND_TIMEOUT_MS,
  });
  try {
    await withTimeout(
      transport.sendMail({
        from: config.from,
        to: mail.to,
        subject: content.subject,
        text: content.text,
        html: content.html,
      }),
      SEND_TIMEOUT_MS,
    );
    return "sent";
  } catch (error) {
    logMail("invitation-mail-failed", {
      name: errorName(error),
      code: errorCode(error),
      responseCode: smtpResponseCode(error),
    });
    return "failed";
  } finally {
    transport.close();
  }
}

export const invitationMailer = { isConfigured, send };

export type InvitationMailer = typeof invitationMailer;
