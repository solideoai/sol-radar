import { z } from "zod";

export const employmentNameSchema = z
  .string("이름을 입력하세요")
  .trim()
  .min(1, "이름을 입력하세요")
  .max(40, "이름은 40자 이하입니다");

export const optionItemSchema = z.strictObject({ id: z.string().min(1), label: z.string().min(1) });
export const signupOptionsSchema = z.strictObject({
  companyName: z.literal("솔리데오"),
  catalogVersion: z.literal("solideo-organization/v1.0"),
  departments: z.array(optionItemSchema),
  jobTitles: z.array(optionItemSchema),
});
export const employmentSelectionSchema = z.strictObject({
  departmentId: z.string("부서를 선택하세요").regex(/^SOL-D\d{3}$/, "부서를 선택하세요"),
  jobTitleId: z.string("직급/직책을 선택하세요").regex(/^SOL-J\d{3}$/, "직급/직책을 선택하세요"),
});
export const employmentInputSchema = employmentSelectionSchema.extend({
  name: employmentNameSchema,
});
export const employmentInfoSchema = employmentSelectionSchema.extend({
  companyName: z.literal("솔리데오"),
  departmentName: z.string().min(1),
  jobTitleLabel: z.string().min(1),
});
export const employmentStateSchema = z.strictObject({
  name: z.string().nullable(),
  employment: employmentInfoSchema.nullable(),
  profileComplete: z.boolean(),
});

export type OptionItem = z.infer<typeof optionItemSchema>;
export type SignupOptions = z.infer<typeof signupOptionsSchema>;
export type EmploymentSelection = z.infer<typeof employmentSelectionSchema>;
export type EmploymentInput = z.infer<typeof employmentInputSchema>;
export type EmploymentInfo = z.infer<typeof employmentInfoSchema>;
export type EmploymentState = z.infer<typeof employmentStateSchema>;
