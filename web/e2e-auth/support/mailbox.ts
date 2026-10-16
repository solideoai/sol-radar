import { expect } from "@playwright/test";
import { z } from "zod";
import { localMailboxUrl } from "./local-supabase";

// 로컬 메일함(Supabase 에 딸린 Mailpit)을 읽고 치운다. 초대 메일 시험(invitation-mail.spec.ts)이 쓴다.
// 앱 서버는 web/.env.local 의 SMTP 값(pnpm db:start 가 적는다)으로 이 메일함에 보낸다. 바깥으로는 보내지 않는다.
// 주소는 `supabase status` 에서 읽고 로컬 주소만 연다(local-supabase.ts).
// 메일은 받는 주소로 찾고, 시험이 받은 것만 ID 로 지운다 — 지우기 API 는 본문이 비면 메일함 전체를 비운다.

const searchSchema = z.object({ messages: z.array(z.object({ ID: z.string() })) });
const messageSchema = z.object({
  Subject: z.string(),
  Text: z.string(),
  HTML: z.string(),
  To: z.array(z.object({ Address: z.string() })),
});
export type MailMessage = z.infer<typeof messageSchema>;

// 응답 본문을 글자로 돌려준다. 읽기(GET)는 JSON 이고, 지우기(DELETE)는 글자 "ok" 다.
const request = async (method: "GET" | "DELETE", path: string, body?: unknown): Promise<string> => {
  const response = await fetch(`${localMailboxUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `메일함 ${method} ${path.split("?")[0]} → ${response.status}: ${text.slice(0, 200)}`,
    );
  }
  return text;
};

const getJson = async (path: string): Promise<unknown> => JSON.parse(await request("GET", path));

// 이 주소로 온 메일의 ID(최근 것이 앞).
export const mailIdsTo = async (address: string): Promise<string[]> =>
  searchSchema
    .parse(await getJson(`/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`))
    .messages.map((message) => message.ID);

// 이 주소로 온 메일이 count 통이 될 때까지 기다린다. 서버 함수는 발송을 마친 뒤 돌아오지만 메일함 색인은 조금 늦을 수 있다.
export const waitForMailsTo = async (address: string, count: number): Promise<string[]> => {
  await expect
    .poll(async () => (await mailIdsTo(address)).length, {
      message: `로컬 메일함에 ${address} 로 온 메일이 ${count}통이어야 한다`,
    })
    .toBe(count);
  return mailIdsTo(address);
};

export const readMail = async (id: string): Promise<MailMessage> =>
  messageSchema.parse(await getJson(`/api/v1/message/${id}`));

// 이 주소로 온 메일을 지운다. 없으면 부르지 않는다(빈 목록은 메일함 전체를 지운다).
export const deleteMailsTo = async (address: string): Promise<void> => {
  const ids = await mailIdsTo(address);
  if (ids.length === 0) return;
  await request("DELETE", "/api/v1/messages", { IDs: ids });
};
