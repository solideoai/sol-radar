import { z } from "zod";

export const ANALYSIS_TITLE = "분석 결과 비교";
export const ANALYSIS_DESCRIPTION = "조직의 분석 이력을 확인하고 저장된 결과를 비교합니다.";
export function comparisonSelection(raw: string | null): { ids: string[]; notice: string | null } {
  const ids = [...new Set((raw ?? "").split(",").filter(Boolean))];
  if (ids.length > 4)
    return {
      ids: [],
      notice: "최대 4건을 선택하세요. 선택을 초기화한 뒤 다시 선택할 수 있습니다.",
    };
  if (ids.some((id) => !z.uuid().safeParse(id).success))
    return {
      ids: [],
      notice: "유효하지 않은 비교 선택입니다. 선택을 초기화한 뒤 다시 선택하세요.",
    };
  return { ids, notice: null };
}
