import { z } from "zod";
import { employmentNameSchema, type SignupOptions } from "@/server/shared";
export const selectionUnavailable = "선택한 항목을 사용할 수 없습니다. 다시 선택해 주세요.";
export function createEmploymentSchema(options: SignupOptions) {
  return z.object({
    name: employmentNameSchema,
    departmentId: z
      .string()
      .min(1, "부서를 선택해 주세요")
      .refine(
        (value) => !value || options.departments.some((item) => item.id === value),
        selectionUnavailable,
      ),
    jobTitleId: z
      .string()
      .min(1, "직급/직책을 선택해 주세요")
      .refine(
        (value) => !value || options.jobTitles.some((item) => item.id === value),
        selectionUnavailable,
      ),
  });
}
