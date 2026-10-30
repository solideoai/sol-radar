import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { TeamMemberDetail } from "@/server/people";
import { PersonDrawer } from "./person-drawer";

let root: Root | null = null;
afterEach(() => {
  root?.unmount();
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("360·390px: 인력 상세 서랍과 이름·본문이 화면 안에 맞는다", async () => {
  await page.viewport(360, 800);
  const person: TeamMemberDetail = {
    id: "00000000-0000-4000-8000-000000000001",
    personCode: "P1",
    name: "김민준",
    email: null,
    departmentId: "00000000-0000-4000-8000-000000000002",
    jobTitleId: "00000000-0000-4000-8000-000000000003",
    portraitUrl: null,
    scoringEligible: false,
    isDemo: true,
    hasUploadedPhoto: false,
    scoring: null,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(person)),
  );
  root = createRoot(document.body.appendChild(document.createElement("div")));
  flushSync(() =>
    root?.render(
      <PersonDrawer
        person={person}
        departments={[]}
        jobTitles={[]}
        onClose={vi.fn()}
        returnFocus={() => null}
      />,
    ),
  );
  const dialog = page.getByRole("dialog", { name: person.name, exact: true });
  await expect.element(dialog).toBeVisible();
  await expect
    .element(dialog.getByRole("heading", { name: "기본 정보", exact: true }))
    .toBeVisible();
  for (const width of [360, 390]) {
    await page.viewport(width, 800);
    await expect.poll(() => Math.round(dialog.element().getBoundingClientRect().width)).toBe(width);
    const bounds = dialog.element().getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
    await expect
      .element(dialog.getByRole("heading", { name: person.name, exact: true }))
      .toBeVisible();
  }
});
