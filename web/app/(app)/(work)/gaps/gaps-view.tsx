"use client";

import { Building2Icon, InboxIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { GapQuery, GapRadarView, GapScope } from "@/server/gaps";
import { INGESTION_PATH } from "@/app/(app)/(work)/admin/ingestion/ingestion-copy";
import { EmptyState, NO_BIDS_HINT, NO_BIDS_ACTION_LABEL } from "@/app/(app)/(work)/empty-state";
import { GAPS_CONTENT_CLASS, GAPS_DESCRIPTION, GAPS_TITLE } from "./gaps-copy";
import { formatCount, formatEok } from "./gaps-format";
import type { AssumeCode, GapsAccess, GapsCopy, GapsLinks, ReadyGapView } from "./gaps-props";
import {
  AssumptionBand,
  BlockerTable,
  FixedNotices,
  GapsMeta,
  OpenedNotices,
  ReviewReasons,
  SummaryStrip,
} from "./gaps-sections";

// 자격 갭 레이더 화면(디자인 스펙 docs/plans/2026-10-28-gaps-ui-spec.md). 계산은 서버(getGapRadar)가 한다.
// 스위치·관련성 거르기·가정 지우기는 page 가 미리 만든 주소로 router.push(scroll: false) 한다. 가정은 주소에만 있고 저장하지 않는다.
// 이동하는 동안(transition pending)에는 스위치를 막는다(disabled). 주소가 지금 쿼리 기준이라, 겹쳐 누르면 앞의 조작이 사라지기 때문이다.

type GapsViewProps = {
  view: GapRadarView;
  copy: GapsCopy;
  /** NO_PROFILE 이면 null. */
  links: GapsLinks | null;
  access: GapsAccess;
  /** D-n 기준 시각(ISO). 요청마다 page 가 한 번 만든다(하이드레이션 차이 없음). */
  now: string;
};

export function GapsView({ view, copy, links, access, now }: GapsViewProps) {
  if (view.kind === "NO_PROFILE" || links === null)
    return <NoProfile copy={copy} canOpenCompany={access.canOpenCompany} />;
  return <ReadyGaps view={view} copy={copy} links={links} access={access} now={new Date(now)} />;
}

const NO_PROFILE_TITLE = "회사 프로필을 찾지 못했습니다";
const NO_PROFILE_DESCRIPTION =
  "자격 갭은 회사 프로필의 보유 자격과 공고 조건을 대조해 셉니다. 이 조직의 회사 프로필이 없거나 읽을 권한이 없습니다.";

function NoProfile({ copy, canOpenCompany }: { copy: GapsCopy; canOpenCompany: boolean }) {
  return (
    <AppPage
      title={GAPS_TITLE}
      description={GAPS_DESCRIPTION}
      contentClassName={GAPS_CONTENT_CLASS}
    >
      <FixedNotices copy={copy} />
      <EmptyState
        icon={Building2Icon}
        title={NO_PROFILE_TITLE}
        description={
          canOpenCompany
            ? NO_PROFILE_DESCRIPTION
            : `${NO_PROFILE_DESCRIPTION} 관리자에게 문의하세요.`
        }
        action={
          canOpenCompany ? (
            <Link href="/company" className={cn(buttonVariants({ variant: "outline" }))}>
              회사 역량 보기
            </Link>
          ) : undefined
        }
      />
    </AppPage>
  );
}

const queryKey = (query: GapQuery): string => `${query.scope}|${query.assume.join(",")}`;

// 조사 "으로"는 건·억·만(받침 있음)으로 끝나는 값에만 붙인다.
const changeText = (label: string, from: string, to: string): string =>
  from === to ? `${label} ${from} 그대로.` : `${label} ${from}에서 ${to}으로 바뀜.`;

/** 숫자 변화 알림(§7). 계산 중에는 알리지 않고, 결과가 그려진 뒤 마지막 결과만 읽는다. */
function announcementOf(previous: GapQuery, view: ReadyGapView, copy: GapsCopy): string {
  if (previous.scope !== view.query.scope)
    return `${view.query.scope === "all" ? "전체" : "관련"} 업종 공고 ${formatCount(view.radar.summary.total.count)}건 기준으로 다시 셌습니다.`;
  if (view.assumption !== null) {
    const before = view.radar.summary.buckets.ELIGIBLE;
    const after = view.assumption.summary.buckets.ELIGIBLE;
    return [
      "가정 결과.",
      changeText(
        copy.bucketLabels.ELIGIBLE,
        `${formatCount(before.count)}건`,
        `${formatCount(after.count)}건`,
      ),
      changeText("배정 예산 합", formatEok(before.budgetKrw), formatEok(after.budgetKrw)),
    ].join(" ");
  }
  return previous.assume.length > 0 ? "가정을 지웠습니다. 원래 결과만 보입니다." : "";
}

// 바깥 탭 열기(⌘·Ctrl·Shift·가운데 단추)는 링크 기본 동작에 맡긴다.
const isPlainClick = (event: React.MouseEvent): boolean =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function ReadyGaps({
  view,
  copy,
  links,
  access,
  now,
}: {
  view: ReadyGapView;
  copy: GapsCopy;
  links: GapsLinks;
  access: GapsAccess;
  now: Date;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [assumed, setAssumed] = useOptimistic<AssumeCode[], AssumeCode[]>(
    view.query.assume,
    (_, next) => next,
  );
  const [scope, setScope] = useOptimistic<GapScope, GapScope>(view.query.scope, (_, next) => next);
  const bandTitle = useRef<HTMLHeadingElement>(null);
  const scopeSwitchId = useId();
  const scopeLabelId = useId();
  const scopeCountsId = useId();

  // 주소(쿼리)가 바뀌어 새 결과가 그려지면 그때 한 번 알림 글자를 바꾼다(이전 쿼리와 비교).
  const key = queryKey(view.query);
  const [heard, setHeard] = useState({ key, query: view.query, message: "" });
  if (heard.key !== key)
    setHeard({ key, query: view.query, message: announcementOf(heard.query, view, copy) });

  const navigate = (href: string, optimistic: () => void) => {
    if (pending) return;
    startTransition(() => {
      optimistic();
      router.push(href, { scroll: false });
    });
  };
  const toggleAssume = (code: AssumeCode, on: boolean) => {
    const target = links.assume[code];
    if (target === undefined) return;
    navigate(on ? target.on : target.off, () =>
      setAssumed(on ? [...assumed, code] : assumed.filter((entry) => entry !== code)),
    );
  };
  const clearAssume = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    // 지우면 이 단추가 사라진다. 초점을 띠 제목으로 먼저 옮긴다(§4.3).
    bandTitle.current?.focus();
    navigate(links.clearAssume, () => setAssumed([]));
  };
  const changeScope = (all: boolean) => {
    const next: GapScope = all ? "all" : "relevant";
    navigate(links.scope[next], () => setScope(next));
  };

  const total = view.radar.summary.total.count;
  return (
    <AppPage
      title={GAPS_TITLE}
      description={GAPS_DESCRIPTION}
      contentClassName={GAPS_CONTENT_CLASS}
      actions={
        <div className="flex shrink-0 flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Label id={scopeLabelId} htmlFor={scopeSwitchId} className="text-foreground">
              전체 업종 보기
            </Label>
            <Switch
              id={scopeSwitchId}
              data-slot="gaps-scope-switch"
              checked={scope === "all"}
              disabled={pending}
              onCheckedChange={changeScope}
              aria-labelledby={scopeLabelId}
              aria-describedby={scopeCountsId}
            />
          </div>
          <p id={scopeCountsId} className="type-caption text-muted-foreground tabular-nums">
            관련 {formatCount(view.scopeCounts.relevant)}건 · 전체{" "}
            {formatCount(view.scopeCounts.all)}건
          </p>
        </div>
      }
    >
      <p data-slot="gaps-live" aria-live="polite" className="sr-only">
        {heard.message}
      </p>
      <div className="flex flex-col gap-4">
        <GapsMeta view={view} copy={copy} />
        {total === 0 ? (
          <>
            <FixedNotices copy={copy} />
            <NoTargets view={view} links={links} canRunIngestion={access.canRunIngestion} />
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <SummaryStrip view={view} copy={copy} />
              <FixedNotices copy={copy} />
            </div>
            <AssumptionBand
              view={view}
              copy={copy}
              pending={pending}
              titleRef={bandTitle}
              clearControl={
                <Link
                  href={links.clearAssume}
                  onClick={clearAssume}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                >
                  <XIcon data-icon="inline-start" aria-hidden="true" />
                  가정 지우기
                </Link>
              }
            />
            <div className="mt-4 flex flex-col gap-10">
              <BlockerTable
                view={view}
                copy={copy}
                assumed={assumed}
                pending={pending}
                onToggle={toggleAssume}
              />
              {view.assumption !== null && (
                <OpenedNotices
                  key={view.query.assume.join(",")}
                  opened={view.assumption.opened}
                  now={now}
                  pending={pending}
                />
              )}
              <ReviewReasons view={view} copy={copy} />
            </div>
          </>
        )}
      </div>
    </AppPage>
  );
}

// 대상 0건(§5 상태표). 관련 업종만 0건이면 전체 업종으로 가는 길을, 전체도 0건이면 수집 안내를 둔다.
function NoTargets({
  view,
  links,
  canRunIngestion,
}: {
  view: ReadyGapView;
  links: GapsLinks;
  canRunIngestion: boolean;
}) {
  if (view.query.scope === "relevant" && view.scopeCounts.all > 0)
    return (
      <EmptyState
        icon={InboxIcon}
        title="마감 전 관련 공고가 없습니다"
        description={`전체 업종에는 ${formatCount(view.scopeCounts.all)}건이 있습니다.`}
        action={
          <Link
            href={links.scope.all}
            scroll={false}
            className={cn(buttonVariants({ variant: "outline" }))}
          >
            전체 업종 보기
          </Link>
        }
      />
    );
  return (
    <EmptyState
      icon={InboxIcon}
      title="마감 전 수집 공고가 없습니다"
      description={canRunIngestion ? undefined : NO_BIDS_HINT}
      action={
        canRunIngestion ? (
          <Link href={INGESTION_PATH} className={cn(buttonVariants({ variant: "outline" }))}>
            {NO_BIDS_ACTION_LABEL}
          </Link>
        ) : undefined
      }
    />
  );
}
