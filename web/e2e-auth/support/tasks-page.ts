import { expect, type Page } from "@playwright/test";
import { escapeRegExp } from "./seed";

// 작업 화면(/[slug]/tasks)을 읽는 도구. 여러 시험이 같은 방법으로 목록을 본다.

// 표의 줄(머리 줄 빼고). 줄의 글자는 제목으로 시작한다(첫 칸의 제목 단추).
export const taskRows = (page: Page) =>
  page
    .getByRole("table", { name: "작업 목록" })
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

// 표의 제목들이 화면 순서대로 titles 와 같다.
export const expectTaskTitles = async (page: Page, titles: readonly string[]) =>
  expect(taskRows(page)).toHaveText(titles.map((title) => new RegExp(`^${escapeRegExp(title)}`)));

// 조건·쪽이 바뀌면 화면 낭독기에 읽어 주는 글. 예: "작업 11개 중 1–11번째를 보여 줍니다."
export const listStatus = (page: Page) => page.getByRole("status").filter({ hasText: /^작업 / });

// 도구 줄·대화상자의 고르기(Select)가 보이는 값. 트리거에는 펼침 표시(▼)도 있어 글자 대신 접근성 트리의 값을 본다.
export const expectSelected = async (page: Page, label: string, value: string) =>
  expect(page.getByRole("combobox", { name: label })).toMatchAriaSnapshot(
    `- combobox ${JSON.stringify(label)}: ${JSON.stringify(value)}`,
  );
