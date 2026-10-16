import { expect, it } from "vitest";
import { businessLayoutNext, completionPath, safeEmploymentNext } from "./employment-routing";
it.each([
  "https://evil.test",
  "//evil.test",
  "/\\evil.test",
  "/auth/complete-profile",
  "/auth/login?next=/alpha",
  "/auth/callback",
  "/auth",
  "/%61uth/complete-profile",
  "/alpha/../auth/login",
])("안전하지 않거나 순환하는 %s는 기본 진입", (value) => {
  expect(safeEmploymentNext(value)).toBe("/auth/login");
  expect(completionPath(value)).toBe("/auth/complete-profile");
});
it("내부 업무 목적지를 유지한다", () => {
  expect(safeEmploymentNext("/alpha/tasks?q=1")).toBe("/alpha/tasks?q=1");
});

it.each([
  "/alpha/tasks?q=1",
  "/alpha/settings?link=linked",
  "/alpha/settings/members",
  "/alpha/settings/team",
])("현재 조직의 업무 경로 %s를 유지한다", (path) => {
  expect(businessLayoutNext(path, "alpha")).toBe(path);
});
it.each([
  "/other/tasks",
  "https://evil.test",
  "/auth/callback?code=secret",
  "/alpha/../other/tasks",
  "/alpha/not-a-page",
])("잘못 전달된 %s는 현재 조직 대시보드로", (path) => {
  expect(businessLayoutNext(path, "alpha")).toBe("/alpha/dashboard");
});

it.each([
  { value: ["/alpha/tasks", "/other/tasks"] },
  { value: 123 },
  { value: { next: "/alpha/tasks" } },
])("반복 쿼리와 문자열이 아닌 next는 기본 경로다", ({ value }) => {
  expect(safeEmploymentNext(value)).toBe("/auth/login");
});
