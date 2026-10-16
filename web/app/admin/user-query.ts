// 검색어·쪽은 URL 쿼리에 둔다. 기본값(검색 없음·1쪽)은 적지 않아 같은 조건이 늘 같은 주소가 된다.
export function usersHref(q: string | null, page = 1): string {
  const params = new URLSearchParams();
  const search = q?.trim() ?? "";
  if (search !== "") params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin?${query}` : "/admin";
}

export function listStatusText({
  total,
  page,
  pageSize,
  shown,
  isSearching,
}: {
  total: number;
  page: number;
  pageSize: number;
  shown: number;
  isSearching: boolean;
}): string {
  if (total === 0 || shown === 0)
    return isSearching ? "검색 결과가 없습니다." : "가입한 사용자가 없습니다.";
  const first = (page - 1) * pageSize + 1;
  return `사용자 ${total}명 중 ${first}–${first + shown - 1}번째를 보여 줍니다.`;
}
