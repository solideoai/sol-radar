import type { TaskListFilters } from "@/server/task";

// 거르기·정렬·쪽은 URL 쿼리에 둔다 — 주소를 복사해 열면 같은 조건이 보이고, 뒤로 가기가 이전 조건으로 간다.
// 기본값(전체·최근 만든 순·1쪽)은 적지 않는다. 같은 조건이 늘 같은 주소가 된다.
export function tasksHref(slug: string, filters: TaskListFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.status !== null) params.set("status", filters.status);
  if (filters.assignee !== null) params.set("assignee", filters.assignee);
  if (filters.sort === "due") params.set("sort", "due");
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/${slug}/tasks?${query}` : `/${slug}/tasks`;
}

export function listStatusText({
  total,
  page,
  pageSize,
  shown,
}: {
  total: number;
  page: number;
  pageSize: number;
  shown: number;
}): string {
  if (total === 0 || shown === 0) return "조건에 맞는 작업이 없습니다.";
  const first = (page - 1) * pageSize + 1;
  return `작업 ${total}개 중 ${first}–${first + shown - 1}번째를 보여 줍니다.`;
}

// 서버의 시간대와 상관없이 서울로 고정한다 — 서버에서 그린 글자와 브라우저에서 다시 그린 글자가 같아야 한다.
const seoulDayFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

// today 는 서버가 마감일 상태를 가른 서울 날짜 "YYYY-MM-DD" 다.
export function createdDayText(iso: string, today: string): string {
  const parts = seoulDayFormat.formatToParts(new Date(iso));
  const read = (type: "year" | "month" | "day") =>
    parts.find((part) => part.type === type)?.value ?? "";
  const monthDay = `${read("month")}. ${read("day")}.`;
  return read("year") === today.slice(0, 4) ? monthDay : `${read("year")}. ${monthDay}`;
}
