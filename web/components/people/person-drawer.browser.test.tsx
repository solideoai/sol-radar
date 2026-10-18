import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { TeamMemberDetail, TeamMemberListItem } from "@/server/people";
import { PersonDrawer } from "./person-drawer";
const mounted: Root[] = [];
const fetchDetail = vi.fn<typeof fetch>();
beforeEach(() => {
  fetchDetail.mockReset();
  vi.stubGlobal("fetch", fetchDetail);
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
const first: TeamMemberListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  personCode: "SOL-P0001",
  name: "김민준",
  departmentId: "team",
  jobTitleId: "title",
  portraitUrl: null,
  scoringEligible: true,
  isDemo: true,
};
const second: TeamMemberListItem = {
  ...first,
  id: "22222222-2222-4222-8222-222222222222",
  personCode: "SOL-P0002",
  name: "이서준",
  scoringEligible: false,
};
const details: TeamMemberDetail = {
  ...first,
  scoring: {
    role: "DEVELOPER",
    grade: null,
    skills: ["TypeScript"],
    availability: [{ startsAt: "2026-10-01", endsAt: "2026-11-01", fte: 0.5 }],
  },
};
const departments = [
  {
    id: "team",
    code: "d",
    name: "개발팀",
    kind: "TEAM" as const,
    parentId: null,
    targetCount: 2,
    memberCount: 2,
  },
];
const titles = [{ id: "title", code: "j", label: "책임" }];
function Harness({
  person = first,
  removeTrigger = false,
}: {
  person?: TeamMemberListItem;
  removeTrigger?: boolean;
}) {
  const [selected, setSelected] = useState<TeamMemberListItem | null>(null);
  return (
    <>
      <h2 id="fallback" tabIndex={-1}>
        명부
      </h2>
      {!removeTrigger ? (
        <button id="trigger" onClick={() => setSelected(person)}>
          {person.name} 상세 보기
        </button>
      ) : null}
      <PersonDrawer
        person={selected ? person : null}
        departments={departments}
        jobTitles={titles}
        onClose={() => setSelected(null)}
        returnFocus={() =>
          document.getElementById("trigger") ?? document.getElementById("fallback")
        }
      />
    </>
  );
}
const render = () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  mounted.push(root);
  root.render(<Harness />);
  return root;
};
const open = async () => {
  await page.getByRole("button", { name: "김민준 상세 보기", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "김민준", exact: true })).toBeVisible();
};
describe("person read drawer", () => {
  it.each([1280, 1440])("keeps480px width inside %ipx viewport", async (width) => {
    await page.viewport(width, 900);
    fetchDetail.mockResolvedValue(Response.json(details));
    render();
    await open();
    const dialog = page.getByRole("dialog").element();
    await expect.poll(() => Math.round(dialog.getBoundingClientRect().width)).toBe(480);
    await expect.poll(() => dialog.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  });

  it("loads selected UUID, shows scoring and the real exclusive availability period", async () => {
    fetchDetail.mockResolvedValue(Response.json(details));
    render();
    await open();
    await expect
      .element(page.getByRole("heading", { name: "점수 계산 정보", exact: true }))
      .toBeVisible();
    await expect.element(page.getByText("TypeScript", { exact: true })).toBeVisible();
    await expect.element(page.getByText("미등록", { exact: true })).toBeVisible();
    expect(document.body.textContent).toContain("종료일 미포함");
    expect(document.body.textContent).toContain("0.5 FTE");
    expect(String(fetchDetail.mock.calls[0][0])).toBe(`/api/v1/team-members/${first.id}`);
    expect(document.body.textContent).not.toContain(first.id);
  });
  it("omits empty scoring fields for noneligible person", async () => {
    fetchDetail.mockResolvedValue(Response.json({ ...second, scoring: null }));
    const root = render();
    root.render(<Harness person={second} />);
    await page.getByRole("button", { name: "이서준 상세 보기", exact: true }).click();
    await expect
      .element(page.getByText("점수 계산 대상이 아닙니다", { exact: true }))
      .toBeVisible();
    expect(document.body.textContent).not.toContain("점수 계산 정보");
    expect(document.body.textContent).not.toContain("가용성");
  });
  it("shows404 without resource disclosure", async () => {
    fetchDetail.mockResolvedValue(Response.json({ error: { code: "NOT_FOUND" } }, { status: 404 }));
    render();
    await open();
    await expect
      .element(page.getByText("인력 정보를 찾을 수 없습니다", { exact: true }))
      .toBeVisible();
  });
  it("keeps loading closable and retries network failure for same employee", async () => {
    fetchDetail
      .mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(Response.json(details));
    render();
    await open();
    await expect
      .element(page.getByText("상세 정보를 불러오지 못했습니다", { exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect.element(page.getByText("TypeScript", { exact: true })).toBeVisible();
    expect(fetchDetail.mock.calls.map((call) => String(call[0]))).toEqual([
      `/api/v1/team-members/${first.id}`,
      `/api/v1/team-members/${first.id}`,
    ]);
  });
  it("ignores stale response after a different employee is selected", async () => {
    let finishFirst: (response: Response) => void = () => {};
    fetchDetail
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ ...second, scoring: null }));
    const root = render();
    await open();
    root.render(<Harness person={second} />);
    await expect
      .element(page.getByText("점수 계산 대상이 아닙니다", { exact: true }))
      .toBeVisible();
    finishFirst(Response.json(details));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(document.body.textContent).not.toContain("TypeScript");
    await expect.element(page.getByRole("dialog", { name: "이서준", exact: true })).toBeVisible();
  });
  it("aborts close and never repaints an old response after reopening", async () => {
    let finishFirst: (response: Response) => void = () => {};
    fetchDetail
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(Response.json({ ...first, scoring: null }));
    render();
    await open();
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect((fetchDetail.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    await open();
    await expect
      .element(page.getByText("점수 계산 대상이 아닙니다", { exact: true }))
      .toBeVisible();
    finishFirst(Response.json(details));
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(document.body.textContent).not.toContain("TypeScript");
  });
  it("traps focus, closes with Escape and returns to original name button", async () => {
    fetchDetail.mockResolvedValue(Response.json(details));
    render();
    await open();
    const dialog = page.getByRole("dialog").element();
    await expect.poll(() => dialog.contains(document.activeElement)).toBe(true);
    for (let index = 0; index < 5; index++) {
      await userEvent.keyboard("{Tab}");
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "김민준 상세 보기", exact: true }))
      .toHaveFocus();
  });
  it("returns focus to panel heading when original trigger was removed", async () => {
    fetchDetail.mockResolvedValue(Response.json(details));
    const root = render();
    await open();
    root.render(<Harness removeTrigger />);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect.element(page.getByRole("heading", { name: "명부", exact: true })).toHaveFocus();
  });
});
