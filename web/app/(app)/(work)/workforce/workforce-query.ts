import { z } from "zod";
export const WORKFORCE_TITLE = "인력 배치 시뮬레이션";
export const WORKFORCE_DESCRIPTION =
  "저장된 분석의 인력 가용성과 현재 배정의 기간 충돌을 확인합니다.";
export function workforceSelection(raw: string | string[] | undefined): {
  ids: string[];
  notice: string | null;
} {
  if (raw === undefined || raw === "") return { ids: [], notice: null };
  const parsed = z
    .array(z.uuid())
    .min(1)
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length)
    .safeParse(typeof raw === "string" ? raw.split(",") : []);
  return parsed.success
    ? { ids: parsed.data, notice: null }
    : { ids: [], notice: "서로 다른 공고를 1~3건 선택하세요. 선택 주소가 올바르지 않습니다." };
}
