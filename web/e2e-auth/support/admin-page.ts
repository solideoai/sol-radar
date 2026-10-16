import { expect, type Locator, type Page } from "@playwright/test";
import { escapeRegExp } from "./seed";

// 관리자 사용자 목록(/admin)을 읽는 도구. admin.spec.ts(읽기)와 admin-status.write.spec.ts(정지·해제)가 같은 방법으로 줄을 본다.

// 계정은 시험 직전(시드)이나 시험 안에서 만든다. 가입일은 오늘(서울)이다 — 만든 뒤 서울 자정을 넘기면 하루 밀린다.
export const today = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "medium",
  timeZone: "Asia/Seoul",
}).format(new Date());

export const usersTable = (page: Page) => page.getByRole("table", { name: "사용자 목록" });

// 표의 줄(머리 줄 빼고).
export const userRows = (page: Page) =>
  usersTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

export const userRowOf = (page: Page, email: string) => userRows(page).filter({ hasText: email });

// 줄의 칸 다섯: 사용자 · 계정 유형 · 상태 · 가입일 · 관리. 좁은 폭에서 숨긴 칸(display: none)은 접근성 트리에서 빠져
// getByRole("cell") 로는 세지 못한다. 칸의 글자와 보이는지는 td 로 본다.
export const cellsOf = (row: Locator) => row.locator("td");

export type ListedUser = {
  name: string;
  email: string;
  isMe?: boolean;
  isAdmin?: boolean;
  suspended?: boolean;
};

// 칸마다의 글자. 숨긴 칸·줄도 글자는 있다(어느 폭에서 보이는지는 폭 시험이 본다).
//   사용자   — 표시 이름 · (나) · 좁은 단의 "정지" · 이메일 · 좁은 단의 셋째 줄("회원 · 가입 날짜"). 앞의 머리글자는 장식이라 보지 않는다.
//   계정 유형 — 운영자·회원.  상태 — 정상·정지.  가입일.
//   관리     — 회원 줄에만 "정지"(정지된 회원은 "해제") 버튼. 나·다른 운영자 줄은 비었다.
const cellTextsOf = (user: ListedUser) => {
  const type = user.isAdmin ? "운영자" : "회원";
  const canChange = !user.isMe && !user.isAdmin;
  return {
    user:
      `${escapeRegExp(user.name)}${user.isMe ? "\\(나\\)" : ""}${user.suspended ? "정지" : ""}` +
      `${escapeRegExp(user.email)}${type} · 가입 ${escapeRegExp(today)}`,
    type,
    status: user.suspended ? "정지" : "정상",
    action: canChange ? (user.suspended ? "해제" : "정지") : "",
  };
};

/** 줄 전체의 글자. 여러 줄의 순서를 한 번에 볼 때 쓴다. */
export const rowText = (user: ListedUser): RegExp => {
  const cells = cellTextsOf(user);
  return new RegExp(
    `${cells.user}${cells.type}${cells.status}${escapeRegExp(today)}${cells.action}$`,
  );
};

/** 칸마다의 글자와, 관리 칸의 버튼이 누구를 정지(해제)하는지 이름으로 읽히는지. */
export const expectRowCells = async (row: Locator, user: ListedUser) => {
  const cells = cellTextsOf(user);
  await expect(cellsOf(row)).toHaveText([
    new RegExp(`${cells.user}$`),
    cells.type,
    cells.status,
    today,
    cells.action,
  ]);
  const buttons = cells.action === "" ? 0 : 1;
  await expect(row.getByRole("button")).toHaveCount(buttons);
  const label = user.suspended ? `${user.name} 정지 해제` : `${user.name} 정지`;
  await expect(row.getByRole("button", { name: label, exact: true })).toHaveCount(buttons);
};

/** 화면도, 표의 스크롤 상자(overflow-x-auto)도 가로로 넘치지 않는다. 표가 안쪽에서 밀리면 화면만 재서는 모른다. */
export const expectListFitsWidth = async (page: Page) => {
  expect(await pageOverflow(page), "화면의 가로 넘침").toBe(0);
  const tableOverflow = await usersTable(page).evaluate((table) => {
    const box = table.parentElement;
    return box ? box.scrollWidth - box.clientWidth : 0;
  });
  expect(tableOverflow, "표의 가로 넘침").toBe(0);
};

/**
 * 열린 대화상자가 화면 안에 다 들어오고 안쪽도 가로로 밀리지 않는다.
 * 대화상자가 열리면 바깥(표)은 접근성 트리에서 빠지므로 표는 재지 않는다.
 */
export const expectDialogFitsWidth = async (page: Page, dialog: Locator) => {
  await expect(dialog).toBeInViewport({ ratio: 1 });
  expect(await pageOverflow(page), "화면의 가로 넘침").toBe(0);
  expect(
    await dialog.evaluate((element) => element.scrollWidth - element.clientWidth),
    "대화상자의 가로 넘침",
  ).toBe(0);
};

const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
