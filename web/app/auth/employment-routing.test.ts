import { expect, it } from "vitest";
import {
  businessLayoutNext,
  completionPath,
  safeEmploymentNext,
  safeBusinessNext,
  organizationStatePath,
} from "./employment-routing";
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
// Ruling 16: 보완·조직 상태 뒤 기본 이동은 로그인·초대 수락과 같은 업무 첫 화면(/dashboard)이다.
// 템플릿 /{slug}/dashboard 경로는 남지만(D30), 갈 곳이 없을 때 기본값으로 쓰지 않는다.
it.each([
  null,
  "",
  "/other/tasks",
  "https://evil.test",
  "/auth/callback?code=secret",
  "/alpha/../other/tasks",
  "/alpha/not-a-page",
])("없거나 잘못 전달된 %s는 업무 첫 화면(/dashboard)으로", (path) => {
  expect(businessLayoutNext(path, "alpha")).toBe("/dashboard");
});
it("현재 조직의 템플릿 대시보드를 직접 가리키면 그대로 둔다", () => {
  expect(businessLayoutNext("/alpha/dashboard", "alpha")).toBe("/alpha/dashboard");
});
it("갈 곳 없이 보완하면 보완 뒤 업무 첫 화면으로 간다", () => {
  expect(completionPath(businessLayoutNext(null, "alpha"))).toBe(
    "/auth/complete-profile?next=%2Fdashboard",
  );
  expect(organizationStatePath(businessLayoutNext(null, "alpha"))).toBe("/auth/organization-state");
});

it.each([
  { value: ["/alpha/tasks", "/other/tasks"] },
  { value: 123 },
  { value: { next: "/alpha/tasks" } },
])("반복 쿼리와 문자열이 아닌 next는 기본 경로다", ({ value }) => {
  expect(safeEmploymentNext(value)).toBe("/auth/login");
});

it.each([
  undefined,
  ["/alpha/tasks"],
  "https://evil.test",
  "/auth/organization-state",
  "/teams/new",
  "/unreleased",
  "/alpha/../auth/login",
  "/%61uth/complete-profile",
])("business continuation %s defaults to canonical dashboard", (value) => {
  expect(safeBusinessNext(value)).toBe("/dashboard");
  expect(organizationStatePath(value)).toBe("/auth/organization-state");
});
it("state continuation keeps supported business destinations without choosing an organization", () => {
  expect(organizationStatePath("/alpha/tasks?q=1")).toBe(
    "/auth/organization-state?next=%2Falpha%2Ftasks%3Fq%3D1",
  );
});

it.each(["/bids", "/bids/6f1b7f0e-4a52-4c1e-9a43-0d2f6f6a9b11", "/notifications"])(
  "업무 화면 %s 는 그대로 이어 간다",
  (value) => {
    expect(safeBusinessNext(value)).toBe(value);
    expect(organizationStatePath(value)).toBe(
      `/auth/organization-state?next=${encodeURIComponent(value)}`,
    );
  },
);
it.each(["/bids/../admin", "/bids/not-a-uuid", "/bids/6f1b7f0e-4a52-4c1e-9a43-0d2f6f6a9b11/x"])(
  "업무 화면 모양이 아닌 %s 는 대시보드로 돌린다",
  (value) => {
    expect(safeBusinessNext(value)).toBe("/dashboard");
  },
);
