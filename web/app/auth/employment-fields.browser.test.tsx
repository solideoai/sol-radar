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
    expect(host.scrollWidth).toBe(host.clientWidth);
    await expect.element(page.getByText(longLabel.trim(), { exact: true }).last()).toBeVisible();
    await page.getByRole("combobox", { name: "부서 (필수)" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("combobox", { name: "부서 (필수)" })).toHaveFocus();
    await userEvent.keyboard("{Tab}");
    await expect.element(page.getByRole("combobox", { name: "직급/직책 (필수)" })).toHaveFocus();
  },
);
