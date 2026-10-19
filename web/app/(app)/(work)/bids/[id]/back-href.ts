import "server-only";
import { parseBidListQuery, type RunMode } from "@/server/bids";

// "← 공고 목록"의 주소(스펙 §5.4.1). 목록 표가 상세 링크에 ?list=<목록 조건> 을 붙인다.
// 그 값이 목록 조건으로 읽힐 때만 그 조건으로 돌아가고, 아니면 기본 목록이다. 경로는 /bids 고정이라 바깥 주소로 새지 않는다.
export function backHrefOf(list: string | string[] | undefined, runMode: RunMode): string {
  const value = Array.isArray(list) ? list[0] : list;
  if (value === undefined || value.trim() === "") return "/bids";
  const params = new URLSearchParams(value);
  const raw = Object.fromEntries(
    [...new Set(params.keys())].map((key) => [key, params.getAll(key)]),
  );
  if (!parseBidListQuery(raw, runMode).ok) return "/bids";
  const search = params.toString();
  return search === "" ? "/bids" : `/bids?${search}`;
}
