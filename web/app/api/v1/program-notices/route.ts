import { serviceResponse } from "@/app/api/v1/_lib/http";
import { businessRoute, invalidQuery, rawQueryOf } from "@/app/api/v1/_lib/work-route";
import {
  kstToday,
  listProgramNotices,
  parseProgramNoticeListQuery,
  programNoticesRepo,
} from "@/server/program-notices";

// GET /program-notices — 부처 지원사업 공고 목록(ADR-040, 스펙 §6). 출처·소관기관 검색·정렬·마감 지난 공고 포함.
// 나라장터 목록(/bids)과 따로 둔다. 마감 판정의 "오늘"은 KST 날짜다.
export async function GET(request: Request): Promise<Response> {
  return businessRoute(request, async () => {
    const query = parseProgramNoticeListQuery(rawQueryOf(request));
    if (!query.ok) return invalidQuery(query.issues);
    const data = await listProgramNotices(query.value, {
      repo: programNoticesRepo,
      today: kstToday(new Date()),
    });
    return serviceResponse({ ok: true, status: 200, data });
  });
}
