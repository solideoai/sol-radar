import "server-only";
import { parseBidListQuery, type RunMode } from "@/server/bids";

// "← 공고 목록"의 주소(스펙 §5.4.1). 목록 표가 상세 링크에 ?list=<목록 조건> 을 붙인다.
// 그 값이 목록 조건으로 읽힐 때만 그 조건으로 돌아가고, 아니면 기본 목록이다. 경로는 /bids 고정이라 바깥 주소로 새지 않는다.
// 관심 공고 목록(N3 D14)은 list 에 watched=me 를 싣는다. 그때만 /watchlist 로 돌아가고 watched 는 주소에서 뺀다
// (/watchlist 가 늘 watched=me 로 읽는다).
export function backHrefOf(list: string | string[] | undefined, runMode: RunMode): string {
  const value = Array.isArray(list) ? list[0] : list;
  if (value === undefined || value.trim() === "") return "/bids";
  const params = new URLSearchParams(value);
  const raw = Object.fromEntries(
    [...new Set(params.keys())].map((key) => [key, params.getAll(key)]),
  );
  const parsed = parseBidListQuery(raw, runMode);
  if (!parsed.ok) return "/bids";
  const path = parsed.value.watched === "me" ? "/watchlist" : "/bids";
  params.delete("watched");
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}
