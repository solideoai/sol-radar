import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import {
  analysisHistoryRepo,
  getBid,
  listAnalysisHistory,
  listBids,
  parseAnalysisHistoryQuery,
  parseBidListQuery,
  readCursorSecret,
} from "@/server/bids";
import { workDeps } from "@/app/_lib/work-deps";
import { requireWork } from "@/app/(app)/(work)/work";
import { AnalysisHistoryView } from "./analysis-history-view";
import { ANALYSIS_DESCRIPTION, ANALYSIS_TITLE } from "./analysis-query";

export const metadata: Metadata = { title: ANALYSIS_TITLE };
export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  await connection();
  const raw = await searchParams;
  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(raw))
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
      incoming.append(key, entry);
  const work = await requireWork(`/analysis${incoming.size ? `?${incoming}` : ""}`);
  const parsed = parseAnalysisHistoryQuery(raw);
  const fallback = parseAnalysisHistoryQuery({});
  if (!fallback.ok) throw new Error("분석 이력 기본 조건을 읽지 못했습니다");
  const query = parsed.ok ? parsed.value : fallback.value;
  const result = await listAnalysisHistory(work.orgId, query, {
    repo: analysisHistoryRepo,
    cursorSecret: readCursorSecret(process.env.API_CURSOR_SECRET),
  });
  if (!result.ok) throw new Error(result.message);
  const optionsQuery = parseBidListQuery(
    { origin: "all", status: ["OPEN", "AMENDED", "CANCELLED", "CLOSED"], limit: "100" },
    work.runMode,
  );
  if (!optionsQuery.ok) throw new Error("공고 선택 조건을 읽지 못했습니다");
  const deps = workDeps();
  const options = await listBids(work.orgId, optionsQuery.value, deps.cursorSecret, {
    repo: deps.bids,
  });
  if (!options.ok) throw new Error(options.message);
  const selectedBid = query.bidId
    ? await getBid(work.orgId, query.bidId, { repo: deps.bids })
    : null;
  const bidOptions = options.data.items.map(({ id, title }) => ({ id, title }));
  if (selectedBid?.ok && !bidOptions.some((option) => option.id === selectedBid.data.id))
    bidOptions.unshift({ id: selectedBid.data.id, title: selectedBid.data.title });
  const stable = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== null) stable.set(key, String(value));
  return (
    <AppPage title={ANALYSIS_TITLE} description={ANALYSIS_DESCRIPTION} contentClassName="max-w-360">
      <AnalysisHistoryView
        key={stable.toString()}
        initial={result.data}
        query={query}
        querySearch={stable.toString()}
        bidOptions={bidOptions}
        notice={parsed.ok ? null : "유효하지 않은 필터를 초기화했습니다."}
      />
    </AppPage>
  );
}
