import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import type { SignupOptions } from "@/server/shared";
import { SignUpForm } from "./sign-up-form";
const { signUp, replace, refresh } = vi.hoisted(() => ({
  signUp: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ onNavigate, ...props }: ComponentProps<"a"> & { onNavigate?: () => void }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onNavigate?.();
      }}
    />
  ),
}));
vi.mock("next/navigation", () => ({ __esModule: true, useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowser: () => ({ auth: { signUp } }) }));
vi.mock("./address-search", () => ({
  AddressSearch: () => <button type="button">주소 검색</button>,
}));
const options: SignupOptions = {
  companyName: "솔리데오",
  catalogVersion: "solideo-organization/v1.0",
  departments: [{ id: "SOL-D001", label: "설계부" }],
  jobTitles: [{ id: "SOL-J001", label: "연구원" }],
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  host.className = "mx-auto max-w-100";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  root.unmount();
  host.remove();
  vi.unstubAllGlobals();
});
const render = (catalog: SignupOptions | null = options) =>
  root.render(
    <SignUpForm options={catalog}>
      <button type="button">간편 가입</button>
    </SignUpForm>,
  );
async function fill() {
  await page.getByRole("textbox", { name: "이름 (필수)" }).fill("두자");
  await page.getByRole("combobox", { name: "부서 (필수)" }).click();
  await page.getByRole("option", { name: "설계부" }).click();
  await page.getByRole("combobox", { name: "직급/직책 (필수)" }).click();
  await page.getByRole("option", { name: "연구원" }).click();
  await page.getByRole("textbox", { name: "이메일", exact: true }).fill("user@example.test");
  await page.getByLabelText("비밀번호", { exact: true }).fill("secret12");
  await page.getByLabelText("비밀번호 확인", { exact: true }).fill("secret12");
  await page.getByRole("checkbox", { name: "전체 동의" }).click();
}
it("필수 항목은 제출 후 오류와 이름 초점을 제공한다", async () => {
  render();
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "이름 (필수)" })).toHaveFocus();
  expect(signUp).not.toHaveBeenCalled();
});
it("Auth 메타데이터만 보내고 확인 메일 후 폼과 간편 가입을 제거한다", async () => {
  signUp.mockResolvedValue({ data: { session: null }, error: null });
  render();
  await fill();
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("확인 메일을 보냈습니다");
  expect(signUp).toHaveBeenCalledWith({
    email: "user@example.test",
    password: "secret12",
    options: { data: { name: "두자", department_code: "SOL-D001", job_title_code: "SOL-J001" } },
  });
  await expect.element(page.getByRole("button", { name: "간편 가입" })).not.toBeInTheDocument();
});
it("세션이 생긴 뒤 이동 중에도 중복 가입을 막는다", async () => {
  const pending = Promise.withResolvers<{ data: { session: object }; error: null }>();
  signUp.mockReturnValue(pending.promise);
  render();
  await fill();
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "가입 중…" })).toBeDisabled();
  pending.resolve({ data: { session: {} }, error: null });
  await expect.poll(() => replace.mock.calls).toEqual([["/auth/login"]]);
  await expect.element(page.getByRole("button", { name: "가입 중…" })).toBeDisabled();
  expect(signUp).toHaveBeenCalledTimes(1);
});
it("네트워크 실패 입력을 유지하고 재시도한다", async () => {
  signUp
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce({ data: { session: null }, error: null });
  render();
  await fill();
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("가입하지 못했습니다");
  await expect.element(page.getByRole("textbox", { name: "이름 (필수)" })).toHaveValue("두자");
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect.element(page.getByRole("status")).toBeVisible();
});
it("Supabase Auth 오류 코드를 한국어 이메일 필드 오류로 표시한다", async () => {
  signUp.mockResolvedValue({
    data: { session: null },
    error: { code: "user_already_exists", message: "private detail" },
  });
  render();
  await fill();
  await page.getByRole("button", { name: "회원가입", exact: true }).click();
  await expect.element(page.getByRole("textbox", { name: "이메일", exact: true })).toHaveFocus();
  await expect.element(page.getByRole("alert")).toHaveTextContent("이미 가입된 이메일입니다");
  expect(host.textContent).not.toContain("private detail");
});
it("목록 오류도 로그인과 간편 가입을 유지하고 재조회 시 입력을 지우지 않는다", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(options)));
  render(null);
  await expect.element(page.getByRole("button", { name: "회원가입", exact: true })).toBeDisabled();
  await expect.element(page.getByRole("link", { name: "로그인", exact: true })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "간편 가입" })).toBeEnabled();
  await page.getByRole("textbox", { name: "이름 (필수)" }).fill("유지");
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "회원가입", exact: true })).toBeEnabled();
  await expect.element(page.getByRole("textbox", { name: "이름 (필수)" })).toHaveValue("유지");
});

it("목록을 다시 읽는 동안 선택 자리만 로딩하고 다른 가입 입력은 유지한다", async () => {
  const pending = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(pending.promise));
  render(null);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("선택 목록을 불러오는 중입니다");
  await expect.element(page.getByRole("textbox", { name: "이름 (필수)" })).toBeEnabled();
  expect(host.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(2);
  await expect.element(page.getByRole("button", { name: "회원가입", exact: true })).toBeDisabled();
  pending.resolve(Response.json(options));
  await expect.element(page.getByRole("button", { name: "회원가입", exact: true })).toBeEnabled();
});
