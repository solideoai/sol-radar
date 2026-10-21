import { createRoot, type Root } from "react-dom/client";
import { useForm } from "react-hook-form";
import { afterEach, expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";
import type { EmploymentInput, SignupOptions } from "@/server/shared";
import { EmploymentFields } from "./employment-fields";
const longLabel = "아주 긴 승인 부서 표시명 ".repeat(10);
const options: SignupOptions = {
  companyName: "솔리데오",
  catalogVersion: "solideo-organization/v1.0",
  departments: [
    { id: "SOL-D001", label: longLabel },
    { id: "SOL-D002", label: "마지막 부서" },
  ],
  jobTitles: [{ id: "SOL-J001", label: "연구원" }],
};
function Harness() {
  const { control } = useForm<EmploymentInput>({
    defaultValues: { name: "", departmentId: "", jobTitleId: "" },
  });
  return <EmploymentFields options={options} control={control} disabled={false} />;
}
let root: Root;
let host: HTMLDivElement;
afterEach(() => {
  root.unmount();
  host.remove();
});
it.each([1440, 1280])(
  "%s 폭에서 회사는 정적이고 긴 선택명은 넘치지 않으며 키보드로 선택한다",
  async (width) => {
    await page.viewport(width, 900);
    host = document.createElement("div");
    host.className = "mx-auto flex max-w-100 flex-col gap-4";
    document.body.append(host);
    root = createRoot(host);
    root.render(<Harness />);
    await expect.element(page.getByText("솔리데오")).toBeVisible();
    expect(page.getByRole("combobox").elements()).toHaveLength(2);
    await page.getByRole("textbox", { name: "이름 (필수)" }).click();
    await userEvent.keyboard("{Tab}{ArrowDown}");
    await expect.element(page.getByRole("option", { name: longLabel.trim() })).toBeVisible();
    // 목록이 그려진 뒤에 초점이 첫 항목으로 옮겨 간다. 그 전에 누른 키는 선택칸이 받아서 Enter 가 고르지 않고
    // 목록을 닫는다(부하 때만 실패하던 원인). 첫 항목이 초점을 받은 뒤에 키를 누른다.
    await expect.element(page.getByRole("option", { name: longLabel.trim() })).toHaveFocus();
    const popup = page.getByRole("listbox").element();
    expect(popup.scrollWidth).toBe(popup.clientWidth);
    await userEvent.keyboard("{End}{Enter}");
    await expect
      .element(page.getByRole("combobox", { name: "부서 (필수)" }))
      .toHaveTextContent("마지막 부서");
    await expect.element(page.getByRole("combobox", { name: "부서 (필수)" })).toHaveFocus();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
    await page.getByRole("combobox", { name: "부서 (필수)" }).click();
    await page.getByRole("option", { name: longLabel.trim() }).click();
    // 팝업이 닫히는 애니메이션이 끝난 뒤의 화면을 잰다. 도는 동안은 닫히는 옵션도 보여서 결과가 실행 속도에 따라 바뀐다.
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
    expect(host.scrollWidth).toBe(host.clientWidth);
    // 닫힌 팝업은 body 끝에 남아 같은 글자의 숨은 옵션을 갖는다. 그래서 폼 안(선택칸·그 아래 설명)에서만 찾는다.
    const shown = page.elementLocator(host).getByText(longLabel.trim(), { exact: true });
    expect(shown.elements()).toHaveLength(2);
    await expect.element(shown.last()).toBeVisible();
    await page.getByRole("combobox", { name: "부서 (필수)" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("combobox", { name: "부서 (필수)" })).toHaveFocus();
    await userEvent.keyboard("{Tab}");
    await expect.element(page.getByRole("combobox", { name: "직급/직책 (필수)" })).toHaveFocus();
  },
);
