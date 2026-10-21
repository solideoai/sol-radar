import "server-only";
import type { RunMode } from "@/server/bids";
import { parseOpportunityQuery } from "@/server/opportunities";

// "← 공고 목록"의 주소(스펙 §5.4.1). 목록 표가 상세 링크에 ?list=<목록 조건> 을 붙인다.
// 새 공공조달 조건도 서버 정본으로 검증한다. 경로는 /bids 고정이라 바깥 주소로 새지 않는다.
export function backHrefOf(list: string | string[] | undefined, runMode: RunMode): string {
  const value = Array.isArray(list) ? list[0] : list;
  if (value === undefined || value.trim() === "") return "/bids";
  const params = new URLSearchParams(value);
  const raw = Object.fromEntries(
    [...new Set(params.keys())].map((key) => [key, params.getAll(key)]),
  );
  if (!parseOpportunityQuery(raw, runMode).ok) return "/bids";
  params.delete("cursor");
  params.delete("limit");
  const search = params.toString();
  return search === "" ? "/bids" : `/bids?${search}`;
}
