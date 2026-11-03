import type { CalendarField } from "@/server/calendar";

// 공고 분야 → 토큰 클래스(design/tokens.json field-*). Tailwind 가 찾도록 클래스는 완전한 문자열로 적는다.
// 분야 없음(NONE)은 글자 없이 input 회색 띠만 둔다.
export type FieldKey = CalendarField | "NONE";

export const fieldKeyOf = (field: CalendarField | null): FieldKey => field ?? "NONE";

export const FIELD_BAND: Record<FieldKey, string> = {
  AI_AX: "border-l-field-ai",
  SI_SW: "border-l-field-si",
  CLOUD: "border-l-field-cloud",
  DATA: "border-l-field-data",
  SECURITY: "border-l-field-security",
  DIGITAL_TWIN: "border-l-field-twin",
  NONE: "border-l-input",
};

export const FIELD_TEXT: Record<CalendarField, string> = {
  AI_AX: "text-field-ai",
  SI_SW: "text-field-si",
  CLOUD: "text-field-cloud",
  DATA: "text-field-data",
  SECURITY: "text-field-security",
  DIGITAL_TWIN: "text-field-twin",
};

export const FIELD_SWATCH: Record<FieldKey, string> = {
  AI_AX: "bg-field-ai",
  SI_SW: "bg-field-si",
  CLOUD: "bg-field-cloud",
  DATA: "bg-field-data",
  SECURITY: "bg-field-security",
  DIGITAL_TWIN: "bg-field-twin",
  NONE: "bg-input",
};
