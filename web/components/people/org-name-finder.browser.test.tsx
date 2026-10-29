import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import type { PeopleDirectory, TeamMemberListItem } from "@/server/people";
import { OrgNameFinder } from "./org-name-finder";

// 조직도 이름 찾기를 진짜 브라우저에 그린다. 고치기 전 부품은 Enter 만 누르면 아무도 고르지 않았고,
// 목록이 닫히면 친 이름을 지웠다(2026-10-29 재현).

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = (n: number, name: string): TeamMemberListItem => ({
  id: id(100 + n),
  personCode: `P${n}`,
  name,
  email: null,
  departmentId: id(1),
  jobTitleId: id(900),
  portraitUrl: null,
  scoringEligible: false,
  isDemo: true,
  hasUploadedPhoto: false,
});
const directory: PeopleDirectory = {
  departments: [
    {
      id: id(1),
      code: "D1",
      name: "개발팀",
      kind: "TEAM",
      parentId: null,
      targetCount: null,
      memberCount: 3,
    },
  ],
  jobTitles: [{ id: id(900), code: "J1", label: "대리" }],
  members: [member(1, "김민준"), member(2, "김민서"), member(3, "이서연")],
  summary: { totalCount: 3, scoringCount: 0 },
  canManagePhotos: false,
};

const mounted: Root[] = [];
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
});
const render = () => {
  const onPick = vi.fn<(person: TeamMemberListItem) => void>();
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  flushSync(() => root.render(<OrgNameFinder directory={directory} onPick={onPick} />));
  mounted.push(root);
  const input = host.querySelector<HTMLInputElement>('input[aria-label="이름으로 찾기"]');
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "검색");
  if (!input || !button) throw new Error("이름 입력칸이나 검색 버튼이 없다");
  return { onPick, input, button };
};
const typeName = async (input: HTMLInputElement, name: string) => {
  await userEvent.click(input);
  await userEvent.keyboard(name);
};
const options = () => [...document.querySelectorAll('[role="option"]')];
const pickedName = (onPick: ReturnType<typeof render>["onPick"]) => onPick.mock.calls[0]?.[0].name;

describe("OrgNameFinder", () => {
  it("1명만 맞으면 Enter 로 바로 그 사람을 고른다", async () => {
    const { onPick, input } = render();
    await typeName(input, "김민준");
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(pickedName(onPick)).toBe("김민준");
  });

  it("1명만 맞으면 [검색] 으로 바로 그 사람을 고른다", async () => {
    const { onPick, input, button } = render();
    await typeName(input, "서연");
    await userEvent.click(button);
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(pickedName(onPick)).toBe("이서연");
  });

  it("여러 명이 맞으면 고르지 않고 목록을 연다", async () => {
    const { onPick, input, button } = render();
    await typeName(input, "김민");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    await userEvent.click(button);
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    expect(onPick).not.toHaveBeenCalled();
    expect(input.value).toBe("김민");
    expect(document.activeElement).toBe(input);
  });

  it("맞는 사람이 없으면 없다고 알린다", async () => {
    const { onPick, input, button } = render();
    await typeName(input, "박");
    await userEvent.click(button);
    await vi.waitFor(() => expect(document.body.textContent).toContain("일치하는 이름이 없습니다"));
    expect(onPick).not.toHaveBeenCalled();
  });

  it("목록에서 방향키로 고른 사람은 Enter 로 고른다", async () => {
    const { onPick, input } = render();
    await typeName(input, "김민");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(pickedName(onPick)).toBe("김민서");
  });

  it("목록 항목을 누르면 그 사람을 고른다", async () => {
    const { onPick, input } = render();
    await typeName(input, "김민");
    await vi.waitFor(() => expect(options()).toHaveLength(2));
    const option = options().find((item) => item.textContent?.startsWith("김민서"));
    if (!option) throw new Error("김민서 항목이 없다");
    await userEvent.click(option);
    expect(pickedName(onPick)).toBe("김민서");
  });

  it("목록이 닫혀도 친 이름이 남는다", async () => {
    const { input } = render();
    await typeName(input, "김민");
    await userEvent.click(document.body);
    await vi.waitFor(() => expect(options()).toHaveLength(0));
    expect(input.value).toBe("김민");
  });
});
