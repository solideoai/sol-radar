import type { Metadata } from "next";
import { connection } from "next/server";
import { canReadCompanyProfile } from "@/server/company-profile";
import {
  GAPS_ASSUMPTION_NOTICE,
  GAPS_BUDGET_NOTICE,
  GAPS_SCOPE_NOTICE,
  GAPS_SOURCE_NOTICE,
  GAP_BLOCKER_KIND_LABELS,
  GAP_BUCKET_LABELS,
  GAP_REVIEW_REASON_LABELS,
  gapRadarHref,
  getGapRadar,
  parseGapQuery,
  toggleAssume,
  type GapQuery,
  type GapRadarView,
} from "@/server/gaps";
import { QUALIFICATION_CODES } from "@/server/scoring";
import { canRunIngestion } from "@/app/(app)/(work)/empty-state";
import { requireWork } from "@/app/(app)/(work)/work";
import { GAPS_TITLE } from "./gaps-copy";
import type { AssumeCode, GapsCopy, GapsLinks } from "./gaps-props";
import { GapsView } from "./gaps-view";

export const metadata: Metadata = { title: GAPS_TITLE };

// 자격 갭 레이더(기능 스펙 polaris/specs/in-progress/2026-10-28-gaps-market-calendar.md §5, 디자인 스펙 docs/plans/2026-10-28-gaps-ui-spec.md).
// 읽기 전용이다. 판정·집계·보유 가정 재계산은 서버(getGapRadar)가 하고, 화면은 그 결과와 다음 주소만 받는다.
// 배럴이 server-only 라 클라이언트 부품은 상수·주소 함수를 부를 수 없다. 그래서 여기서 문구를 모으고 주소를 미리 만든다.

const COPY: GapsCopy = {
  bucketLabels: GAP_BUCKET_LABELS,
  reasonLabels: GAP_REVIEW_REASON_LABELS,
  blockerKindLabels: GAP_BLOCKER_KIND_LABELS,
  scopeNotice: GAPS_SCOPE_NOTICE,
  budgetNotice: GAPS_BUDGET_NOTICE,
  assumptionNotice: GAPS_ASSUMPTION_NOTICE,
  sourceNotice: GAPS_SOURCE_NOTICE,
  dictionaryNames: Object.fromEntries(
    Object.entries(QUALIFICATION_CODES).map(([code, entry]) => [code, entry.name]),
  ),
};

/** 지금 쿼리에서 한 번 조작한 다음 주소들. 스위치는 막는 자격 표의 사전 코드에만 단다. */
function linksOf(query: GapQuery, view: GapRadarView): GapsLinks | null {
  if (view.kind !== "READY") return null;
  const codes = [
    ...new Set(
      view.radar.blockers.flatMap((row): AssumeCode[] => (row.code === null ? [] : [row.code])),
    ),
  ];
  return {
    scope: {
      relevant: gapRadarHref({ ...query, scope: "relevant" }),
      all: gapRadarHref({ ...query, scope: "all" }),
    },
    clearAssume: gapRadarHref({ ...query, assume: [] }),
    assume: Object.fromEntries(
      codes.map((code) => [
        code,
        {
          on: gapRadarHref(toggleAssume(query, code, true)),
          off: gapRadarHref(toggleAssume(query, code, false)),
        },
      ]),
    ),
  };
}

export default async function GapsPage({ searchParams }: PageProps<"/gaps">) {
  await connection();
  const query = parseGapQuery(await searchParams);
  const work = await requireWork(gapRadarHref(query));
  // D-n 기준 시각. 요청마다 한 번 만들어 내린다(하이드레이션 차이 없음).
  const now = new Date();
  const view = await getGapRadar(work.orgId, query, now);
  return (
    <GapsView
      view={view}
      copy={COPY}
      links={linksOf(view.kind === "READY" ? view.query : query, view)}
      access={{
        canOpenCompany: canReadCompanyProfile(work.role),
        canRunIngestion: canRunIngestion(work.role),
      }}
      now={now.toISOString()}
    />
  );
}
