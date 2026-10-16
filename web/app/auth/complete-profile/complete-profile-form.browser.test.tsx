import type { ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { CompleteProfileForm } from "./complete-profile-form";
const { replace, refresh, signOut } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  signOut: vi.fn(),
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
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }) }));
vi.mock("@/lib/supabase-browser", () => ({ getSupabaseBrowser: () => ({ auth: { signOut } }) }));
const options = {
  companyName: "솔리데오",
  catalogVersion: "solideo-organization/v1.0",
  departments: [{ id: "SOL-D001", label: "설계부" }],
  jobTitles: [{ id: "SOL-J001", label: "연구원" }],
} as const;
const state = { name: "이름", employment: null, profileComplete: false };
let root: Root;
let host: HTMLDivElement;
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetcher);
  signOut.mockResolvedValue({ error: null });
  host = document.createElement("div");
  host.className = "mx-auto max-w-100";
  document.body.append(host);
  root = createRoot(host);
  root.render(
    <CompleteProfileForm
      options={{
        ...options,
        departments: [...options.departments],
        jobTitles: [...options.jobTitles],
      }}
      state={state}
      next="/alpha/tasks"
    />,
  );
});
afterEach(() => {
  root.unmount();
  host.remove();
  vi.unstubAllGlobals();
});
async function fill() {
  await page.getByRole("combobox", { name: "부서 (필수)" }).click();
  await page.getByRole("option", { name: "설계부" }).click();
  await page.getByRole("combobox", { name: "직급/직책 (필수)" }).click();
  await page.getByRole("option", { name: "연구원" }).click();
}
it("빈 선택 오류의 첫 트리거로 초점을 옮긴다", async () => {
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.element(page.getByRole("combobox", { name: "부서 (필수)" })).toHaveFocus();
  expect(fetcher).not.toHaveBeenCalled();
});
it("저장 실패에 입력을 보존하고 원자 PATCH와 CSRF로 재시도한다", async () => {
  fetcher
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValueOnce(Response.json({ ...state, profileComplete: true }));
  await fill();
  await page.getByRole("textbox", { name: "이름 (필수)" }).fill("새 이름");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("저장하지 못했습니다");
  await expect.element(page.getByRole("textbox", { name: "이름 (필수)" })).toHaveValue("새 이름");
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.poll(() => replace.mock.calls).toEqual([["/alpha/tasks"]]);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]).toEqual([
    "/api/v1/me/employment",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-Requested-With": "sol-radar" },
      body: JSON.stringify({ name: "새 이름", departmentId: "SOL-D001", jobTitleId: "SOL-J001" }),
    },
  ]);
});
it("저장 중 중복을 막고 로그아웃 뒤 늦은 성공 이동을 막는다", async () => {
  const pending = Promise.withResolvers<Response>();
  fetcher.mockReturnValue(pending.promise);
  await fill();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.element(page.getByRole("button", { name: "저장 중…" })).toBeDisabled();
  await expect.element(page.getByRole("combobox", { name: "부서 (필수)" })).toBeDisabled();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect.poll(() => replace.mock.calls).toEqual([["/auth/login"]]);
  pending.resolve(Response.json({ ...state, profileComplete: true }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(replace.mock.calls).toEqual([["/auth/login"]]);
});
it("200 미완료 응답은 이동 없이 수정하게 한다", async () => {
  fetcher.mockResolvedValue(Response.json(state));
  await fill();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect
    .element(page.getByRole("alert").filter({ hasText: "필수 정보를 확인해 주세요" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("combobox", { name: "부서 (필수)" }))
    .toHaveAttribute("aria-invalid", "true");
  expect(replace).not.toHaveBeenCalled();
  await expect
    .element(page.getByRole("combobox", { name: "부서 (필수)" }))
    .toHaveTextContent("설계부");
});
it("로그아웃 실패는 입력을 유지하고 재시도를 제공한다", async () => {
  signOut
    .mockResolvedValueOnce({ error: { message: "internal" } })
    .mockResolvedValueOnce({ error: null });
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("로그아웃하지 못했습니다. 다시 시도해 주세요.");
  expect(replace).not.toHaveBeenCalled();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect.poll(() => replace.mock.calls).toEqual([["/auth/login"]]);
});

it("서버가 거절한 코드에 초점을 주고 목록을 다시 읽어 나머지 입력을 보존한다", async () => {
  fetcher
    .mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            details: { issues: [{ path: "departmentId", message: "invalid" }] },
          },
        },
        { status: 400 },
      ),
    )
    .mockResolvedValueOnce(
      Response.json({ ...options, departments: [{ id: "SOL-D002", label: "새 부서" }] }),
    );
  await fill();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.element(page.getByRole("combobox", { name: "부서 (필수)" })).toHaveFocus();
  await page.getByRole("button", { name: "선택 목록 다시 불러오기" }).click();
  await expect
    .element(page.getByRole("combobox", { name: "부서 (필수)" }))
    .toHaveTextContent("부서를 선택해 주세요");
  await expect
    .element(page.getByRole("combobox", { name: "직급/직책 (필수)" }))
    .toHaveTextContent("연구원");
  await expect.element(page.getByRole("textbox", { name: "이름 (필수)" })).toHaveValue("이름");
});
it("로그아웃 실패 뒤 새 저장 시도는 다시 완료할 수 있다", async () => {
  signOut.mockResolvedValue({ error: { message: "network" } });
  fetcher.mockResolvedValue(Response.json({ ...state, profileComplete: true }));
  await fill();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect.element(page.getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.poll(() => replace.mock.calls).toEqual([["/alpha/tasks"]]);
});
it("세션 만료는 로그인 안내와 계정 관리 경로를 남긴다", async () => {
  fetcher.mockResolvedValue(Response.json({ error: { code: "UNAUTHENTICATED" } }, { status: 401 }));
  await fill();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await expect.element(page.getByRole("alert")).toHaveTextContent("로그인이 필요합니다");
  await expect
    .element(page.getByRole("link", { name: "로그인", exact: true }))
    .toHaveAttribute("href", "/auth/login");
  await expect
    .element(page.getByRole("link", { name: "계정 관리" }))
    .toHaveAttribute("href", "/auth/account");
});

it("계정 관리로 이동을 시작하면 늦게 끝난 저장이 업무 화면으로 이동시키지 않는다", async () => {
  const pending = Promise.withResolvers<Response>();
  fetcher.mockReturnValue(pending.promise);
  await fill();
  await page.getByRole("button", { name: "저장하고 계속" }).click();
  await page.getByRole("link", { name: "계정 관리" }).click();
  pending.resolve(Response.json({ ...state, profileComplete: true }));
  await expect.element(page.getByRole("button", { name: "저장하고 계속" })).toBeEnabled();
  expect(replace).not.toHaveBeenCalled();
});
it("프로필 조회 실패는 저장을 잠그고 재조회한 서버 값만 초기화한다", async () => {
  root.render(
    <CompleteProfileForm
      key="reload"
      options={{
        ...options,
        departments: [...options.departments],
        jobTitles: [...options.jobTitles],
      }}
      state={null}
      next="/alpha/tasks"
    />,
  );
  fetcher.mockResolvedValue(
    Response.json({
      ...state,
      name: "불러온 이름",
      employment: {
        companyName: "솔리데오",
        departmentId: "SOL-D001",
        departmentName: "설계부",
        jobTitleId: "SOL-J001",
        jobTitleLabel: "연구원",
      },
    }),
  );
  await expect.element(page.getByRole("button", { name: "저장하고 계속" })).toBeDisabled();
  await expect.element(page.getByRole("link", { name: "계정 관리" })).toBeVisible();
  await page.getByRole("button", { name: "정보 다시 시도" }).click();
  await expect
    .element(page.getByRole("textbox", { name: "이름 (필수)" }))
    .toHaveValue("불러온 이름");
  await expect
    .element(page.getByRole("combobox", { name: "부서 (필수)" }))
    .toHaveTextContent("설계부");
  await expect.element(page.getByRole("button", { name: "저장하고 계속" })).toBeEnabled();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
