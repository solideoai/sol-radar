import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { kstToday, listProgramNotices, programNoticesRepo } from "@/server/program-notices";
import { requireWork } from "@/app/(app)/(work)/work";
import { BidsSourceNav } from "@/app/(app)/(work)/bids/bids-source-nav";
import { listQueryOf } from "./list-query";
import { ProgramListView } from "./program-list-view";
import { PROGRAMS_DESCRIPTION, PROGRAMS_PATH, PROGRAMS_TITLE } from "./programs-copy";

export const metadata: Metadata = { title: PROGRAMS_TITLE };

// 부처 지원사업 공고(스펙 §6, 디자인 스펙 §4.3). 필터 값은 주소 쿼리가 정본이다.
// /bids 첫 쪽처럼 Route Handler 를 거치지 않고 서비스를 직접 부른다. 누가 무엇을 읽는지는 RLS 가 정한다(anon + 로그인 세션).
// 쪽 나누기 없이 서버가 거르고 정렬한 최대 300건을 한 번에 그린다. 점수·권고·분석·결정은 없다(분석 대상이 아니다).
export default async function ProgramsPage({ searchParams }: PageProps<"/bids/programs">) {
  await connection();
  const raw = await searchParams;
  await requireWork(nextPathOf(raw));
  const { query, search, isDefault } = listQueryOf(raw);
  // 마감 판정과 D-n 의 "오늘"(서울 날짜). 요청마다 한 번 만들어 목록 거르기와 화면 표기에 같은 값을 쓴다.
  const today = kstToday(new Date());
  const list = await listProgramNotices(query, { repo: programNoticesRepo, today });
  return (
    <AppPage title={PROGRAMS_TITLE} description={PROGRAMS_DESCRIPTION} contentClassName="max-w-360">
      <BidsSourceNav current="programs" />
      <ProgramListView
        items={list.items}
        hasAnyNotice={list.hasAnyNotice}
        isCapped={list.isCapped}
        query={query}
        search={search}
        isDefault={isDefault}
        today={today}
      />
    </AppPage>
  );
}

// 로그인·가입 보완 뒤 돌아올 주소. 조건을 잃지 않게 쿼리를 그대로 붙인다(경로는 고정이라 바깥으로 새지 않는다).
function nextPathOf(raw: Awaited<PageProps<"/bids/programs">["searchParams"]>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const search = params.toString();
  return search ? `${PROGRAMS_PATH}?${search}` : PROGRAMS_PATH;
}
