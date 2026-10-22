import type { Metadata } from "next";
import { connection } from "next/server";
import { AppPage } from "@/components/app-page";
import { defaultOrigin, parseBidListQuery } from "@/server/bids";
import { simulateWorkforce } from "@/server/workforce";
import { loadBidPage } from "@/app/_lib/work-data";
import { requireWork } from "@/app/(app)/(work)/work";
import { WORKFORCE_DESCRIPTION, WORKFORCE_TITLE, workforceSelection } from "./workforce-query";
import { WorkforceView } from "./workforce-view";
export const metadata: Metadata = { title: WORKFORCE_TITLE };
export default async function WorkforcePage({ searchParams }: PageProps<"/workforce">) {
  await connection();
  const raw = await searchParams;
  const selection = workforceSelection(raw.bidIds);
  const work = await requireWork(
    selection.ids.length ? `/workforce?bidIds=${selection.ids.join(",")}` : "/workforce",
  );
  const query = parseBidListQuery(
    { status: ["OPEN", "AMENDED", "CLOSED", "CANCELLED"] },
    work.runMode,
  );
  if (!query.ok) throw new Error("공고 선택 목록을 준비하지 못했습니다");
  const [options, result] = await Promise.all([
    loadBidPage(work.orgId, query.value),
    selection.ids.length
      ? simulateWorkforce(work.orgId, selection.ids, {}, new Date())
      : Promise.resolve(null),
  ]);
  return (
    <AppPage
      title={WORKFORCE_TITLE}
      description={WORKFORCE_DESCRIPTION}
      contentClassName="max-w-360"
    >
      <WorkforceView
        key={selection.ids.join(",")}
        origin={defaultOrigin(work.runMode)}
        initialOptions={options.items}
        initialNextCursor={options.pageInfo.nextCursor}
        initialResult={result?.ok ? result.data : null}
        initialIds={selection.ids}
        initialNotice={selection.notice ?? (result && !result.ok ? result.message : null)}
      />
    </AppPage>
  );
}
