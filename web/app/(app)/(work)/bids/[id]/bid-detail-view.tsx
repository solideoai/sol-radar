"use client";
import type { AwardReference } from "@/server/award-reference";
import type { StageLinksView } from "@/server/bids";
import { StageLinks } from "@/components/bids/stage-links";

import {
  ArrowLeftIcon,
  CircleDashedIcon,
  ExternalLinkIcon,
  LoaderCircleIcon,
  OctagonAlertIcon,
  RefreshCwIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "cn";
import { AppPage } from "@/components/app-page";
import { AnalysisBanner } from "@/components/bids/analysis-banner";
import { AnalysisStatus } from "@/components/bids/analysis-status";
import { DecisionPanel, type ReviewInputValues } from "@/components/bids/decision-panel";
import { AttachmentStatus, EvidenceDrawer, EvidenceList } from "@/components/bids/evidence-drawer";
import { useEvidenceStore } from "@/components/bids/evidence-store";
import { dDay, formatKrwFull, formatKst } from "@/components/bids/format";
import { KevOpinion } from "@/components/bids/kev-opinion";
import {
  kevRecordMissing,
  RECOMMENDATION_LABEL,
  ruleReasonOf,
  SOL_ROLE_LABEL,
  STAGE_LABEL,
} from "@/components/bids/labels";
import { QualificationChecklist } from "@/components/bids/qualification-checklist";
import { RecommendationInsight } from "@/components/bids/recommendation-insight";
import { ScoreFactors } from "@/components/bids/score-factors";
import { SourceLink } from "@/components/bids/source-link";
import { StageTimeline } from "@/components/bids/stage-timeline";
import { OPPORTUNITY_SERVICES } from "@/components/work/opportunities-copy";
import { DemoBadge, StatusBadge } from "@/components/bids/status-badge";
import {
  agencyLabelOf,
  isUnverifiedOrigin,
  sourceLinkLabelOf,
} from "@/components/bids/notice-origin";
import {
  isAssumptionCandidate,
  matchesStoredRun,
  WHAT_IF_CLEARED_MESSAGE,
  WHAT_IF_FAILED_MESSAGE,
  WhatIfBand,
  whatIfLiveMessage,
  WhatIfNotice,
  type WhatIfCalcState,
  type WhatIfFailure,
} from "@/components/bids/what-if-band";
import { refreshTopbarStatus } from "@/components/topbar-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  AnalysisStatus as AnalysisStatusValue,
  AnalysisView,
  BidDetail,
  Recommendation,
  RunMode,
} from "@/server/bids";
import type { InsightView } from "@/server/insight";
import type { WatchSummary } from "@/server/watchlist";
import { BidProjectEntry } from "@/components/projects/bid-project-entry";
import type { ProjectEntryState } from "@/server/projects";
import { DetailWatch } from "./detail-watch";
import type { WhatIfSummary } from "@/server/scoring";
import { EmptyState } from "@/app/(app)/(work)/empty-state";
import { DETAIL_CONTENT_CLASS } from "./detail-copy";
import { requestWhatIf, type WhatIfResult } from "./request-what-if";
import { recheckTopbarAfterReview, submitReview } from "./submit-review";
import { AwardReferenceCard } from "./award-reference-card";
import { useAnalysisRun, type ActiveRun, type RunState } from "./use-analysis-run";

// /bids/[id] 본문(스펙 §5.4). 정보 위계는 06 §6 순서로 고정이다:
// ① 상단 요약 → ② 분석 요약 띠(+배너) → ②' 가정 시나리오 띠(BOOST-2, 켠 가정이 있을 때만)
// → ②" 참고 낙찰가 범위(ADR-077, 대상 공고만) → ③ 단계 이력 → ④ 필수자격
// → ⑤ SOL Score 분해 → ⑥ 결정 모델 참고 지표 → ⑦ 근거 인용.
// 오른쪽 레일은 결정 패널이다. 분석 실행 상태를 머리(버튼)와 본문(skeleton)이 함께 써서 한 클라이언트 부품으로 그린다.

/**
 * 화면에 내려보내는 공고. 본문 근거 하이라이트에 쓰는 content 는 싣고, 화면이 쓰지 않는 큰 칸은 뺀다.
 * analysisReadiness(10-26): 분석할 본문·첨부 텍스트가 없으면 ready=false·SOURCE_TEXT_MISSING 이고, 서버도 POST 를
 * 409 ANALYSIS_SOURCE_MISSING 으로 막는다. DEMO 공고는 본문이 있어 ready 다.
 */
export type DetailBid = Omit<
  BidDetail,
  "extraction" | "original" | "structuredQualifications" | "revisions"
>;

/** 분석 이력 한 줄(§5.4.2: 시각·상태·점수·권고·분석 실행 모드, 목록만). */
export type AnalysisHistoryRow = {
  id: string;
  status: AnalysisStatusValue;
  at: string;
  solScore: number | null;
  recommendation: Recommendation | null;
  runMode: RunMode;
  errorCode: string | null;
};

type BidDetailViewProps = {
  bid: DetailBid;
  relatedStages?: StageLinksView | null;
  revisionsHref?: string | null;
  /** 최신 run 이 점수 run(COMPLETED·PARTIAL)이 아닐 때 결정 패널이 쓸 직전 점수 run(§5.4.10). */
  previousScored: AnalysisView | null;
  /** 분석 이력 첫 쪽. 읽지 못했으면 null. */
  history: { items: AnalysisHistoryRow[]; hasMore: boolean } | null;
  /** 결정 모델 항목별 분포의 itemId → 추출 문구(서버가 BidDetail.extraction 에서 풀었다). */
  assessmentLabels: Record<string, string>;
  members: { id: string; name: string }[];
  currentUserId: string;
  canAnalyze: boolean;
  canDecide: boolean;
  /** "← 공고 목록"이 돌아갈 주소. 목록에서 왔으면 그 조건을 보존한다. */
  backHref: string;
  /** 서버가 요청마다 한 번 만든 시각(ISO). D-n 의 기준이다(하이드레이션 차이 없음). */
  now: string;
  watch?: WatchSummary | null;
  projectEntry?: ProjectEntryState | null;
  /** 이 조직에서 본 사업기회의 마지막 변경 시각(opportunity_list_items.changed_at). 모르면 null 이고 표시하지 않는다. */
  changedAt?: string | null;
  /** 추천 분석 패널(ADR-066)의 첫 값. 넘기지 않으면 패널을 그리지 않는다. */
  insight?: InsightPanelInput | null;
  /** 참고 낙찰가 범위(ADR-077). 카드 대상이 아니거나 읽지 못했으면 null 이고 카드를 그리지 않는다. */
  awardReference?: AwardReference | null;
};

/** 추천 분석 패널에 서버가 넘기는 값. 상수·역할 판단은 서버 전용 모듈(@/server/insight)에 있어 서버 화면이 정한다. */
export type InsightPanelInput = {
  /** 최신 점수 run 의 최신 1건. 다른 run 의 것이면 패널이 쓰지 않는다. */
  initial: InsightView | null;
  /** 최신이 FAILED 일 때 그 run 의 마지막 모델 결과(ADR-078). 그 밖에는 null. */
  previous: InsightView | null;
  /** INSIGHT_POLL_LIMIT_MS */
  pollLimitMs: number;
  /** INSIGHT_PROMPT_VERSION. 저장된 버전이 다르면 옛 형식으로 그린다. */
  currentPromptVersion: string;
  /** 역할이 INSIGHT_REQUEST_ROLES(ADMIN·SALES·ANALYST)인가. */
  canRequest: boolean;
};

// 09 고정
const PROFILE_BADGE = "가상 회사 프로필로 분석";
// 06 §8
const PROFILE_TOOLTIP = "실제 공고를 가상 솔리데오 프로필과 대조한 결과입니다";
const LIVE_PROFILE_TEXT = "실제 공고 × 가상 회사 프로필";
// 분석에 쓴 프로필이 공개 자료 프로필(is_demo=false, ADR-052)일 때. 운영 revision 6 부터 회사 확인 자격 3건이 들어 있다(ADR-059 2차 개정).
const PUBLIC_PROFILE_BADGE = "공개 자료 회사 프로필로 분석";
const PUBLIC_PROFILE_TOOLTIP =
  "공개 자료(홈페이지·기사·채용공고·나라장터 계약·DART 공시·협회 등록 조회)로 만든 솔리데오 프로필과 대조한 결과입니다. 자격 중 소프트웨어사업자·직접생산·중소기업 3건은 회사가 확인해 더했습니다. 선호 분야는 회사가 정한 선택값입니다. 실적은 공개 자료에 있는 것만 들어 있습니다";
const LIVE_PUBLIC_PROFILE_TEXT = "실제 공고 × 공개 자료 회사 프로필";
const ANALYZE_ROLE_HINT = `분석 요청은 ${[SOL_ROLE_LABEL.ADMIN, SOL_ROLE_LABEL.SALES, SOL_ROLE_LABEL.ANALYST].join("·")} 역할만 할 수 있습니다`;
const SOURCE_MISSING_HINT = "공고 본문 미확보 · 분석 준비 중";
const SOURCE_MISSING_CODE = "ANALYSIS_SOURCE_MISSING";
const REVIEW_SAVED = "결정을 기록했습니다";

// 머리 줄 회색 칩(Chip sm)이 줄바꿈에 눌리거나 두 줄로 꺾이지 않게 한다.
const CHIP_LAYOUT = "shrink-0 whitespace-nowrap";
// 분석 띠의 회사 프로필 배지는 출처 배지라 회색 Chip 이 아니라 흰 바탕 테두리 모양을 지킨다(2026-10-28 화면 개편 규칙 d, gaps·회사 역량과 같다).
const PROFILE_BADGE_CLASS =
  "inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-foreground";
const TEXT_LINK = "rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const PULSE = "motion-reduce:animate-none";

const isScored = (analysis: AnalysisView | null): analysis is AnalysisView =>
  analysis !== null && (analysis.status === "COMPLETED" || analysis.status === "PARTIAL");

const activeOf = (analysis: AnalysisView | null): ActiveRun | null =>
  analysis !== null && (analysis.status === "QUEUED" || analysis.status === "RUNNING")
    ? { id: analysis.id, status: analysis.status }
    : null;

// 스펙 §5.4.1: demo 는 "출처 데모 데이터", live 는 "출처 나라장터 입찰공고". 내부 출처 키(g2b-bid-notice 등)는 보이지 않는다
// (2026-11-03 사용자 지시). 표에 없는 새 출처만 키 그대로다.
const sourceText = (source: string): string =>
  source === "fixture" ? "데모 데이터" : (OPPORTUNITY_SERVICES[source] ?? source);

type PollingView = { status: "QUEUED" | "RUNNING"; delayed: boolean };

// 상태 전이를 화면 낭독기에 한 곳에서 읽는다(스펙 §5.4.2 2번).
function liveMessageOf(state: RunState, polling: PollingView | null): string {
  if (state.phase === "requesting") return "분석 요청 중…";
  if (polling !== null) {
    if (polling.delayed) return "분석이 지연되고 있습니다.";
    return polling.status === "QUEUED" ? "분석 대기 중" : "분석 중";
  }
  if (state.phase !== "idle" || state.finished === undefined) return "";
  const { status, solScore, recommendation } = state.finished;
  if (status === "FAILED") return "분석에 실패했습니다.";
  const parts = [
    solScore === null ? null : `SOL Score ${Math.round(solScore)}`,
    recommendation === null ? null : `권고 ${RECOMMENDATION_LABEL[recommendation]}`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? "분석이 끝났습니다." : `분석이 끝났습니다. ${parts.join(", ")}`;
}

// ── 가정 재계산(BOOST-2, 디자인 스펙 docs/plans/2026-10-20-boost2-what-if-ui.md §4.4~§4.6) ──
// 가정은 화면 상태에만 둔다(저장·공유 없음). 새로 고치거나 떠나면 버린다. 결정 패널은 저장된 run 그대로다.

type WhatIfEntry =
  | { phase: "ready"; assumable: string[]; before: WhatIfSummary }
  | { phase: "no-snapshot" }
  | { phase: "load-error"; failure: WhatIfFailure };

type WhatIfStore = {
  /** 이 상태가 속한 점수 run. 바뀌면(새 run·재분석 시작) 상태를 버린다. */
  scope: string | null;
  /** 진입 호출(빈 가정) 결과. null 이면 부르는 중이거나 대상이 아니다. */
  entry: WhatIfEntry | null;
  /** 켠 자격 코드(정렬). 요청 본문 순서도 이것이다. */
  codes: string[];
  /** 마지막으로 보낸 계산 요청 번호. 이 번호의 응답만 그린다. */
  seq: number;
  calc: { seq: number; value: WhatIfCalcState } | null;
  live: string;
};

const emptyWhatIf = (scope: string | null): WhatIfStore => ({
  scope,
  entry: null,
  codes: [],
  seq: 0,
  calc: null,
  live: "",
});

const failureView = (result: Extract<WhatIfResult, { ok: false }>): WhatIfFailure => ({
  code: result.code,
  message: result.message,
  ...(result.requestId === undefined ? {} : { requestId: result.requestId }),
});

// 404 NO_SNAPSHOT 은 다시 해도 같으므로 다시 시도 없이 안내만 한다. 그 밖 실패는 다시 시도할 수 있다.
const entryOf = (result: WhatIfResult): WhatIfEntry =>
  result.ok
    ? { phase: "ready", assumable: result.data.assumable, before: result.data.before }
    : result.status === 404 && result.details.reason === "NO_SNAPSHOT"
      ? { phase: "no-snapshot" }
      : { phase: "load-error", failure: failureView(result) };

type WhatIfView = {
  assumable: ReadonlySet<string> | undefined;
  assumed: ReadonlySet<string>;
  notice: React.ReactNode;
  /** 띠 상태. 켠 가정이 없으면 null(띠 없음). */
  calc: WhatIfCalcState | null;
  live: string;
  toggle: (code: string) => void;
  clear: () => void;
  retry: () => void;
};

/**
 * 가정 재계산 상태. scored 가 진입 대상(scope)일 때만 빈 가정으로 한 번 부르고, 스위치를 바꿀 때마다 앞 요청을 취소한 뒤
 * 새로 보낸다. 응답은 마지막 요청 번호와 같을 때만 그린다(취소가 늦어 도착한 응답도 버린다). 지연(debounce)은 두지 않는다.
 */
function useWhatIf(scored: AnalysisView | null, scope: string | null): WhatIfView {
  const [store, setStore] = useState(() => emptyWhatIf(scope));
  const [entryAttempt, setEntryAttempt] = useState(0);
  const seqRef = useRef(0);
  const calcRef = useRef<AbortController | null>(null);

  // 최신 run 이 바뀌거나 재분석이 시작되면 가정을 버린다. 렌더 중에 맞춰 옛 띠가 한 번도 보이지 않게 한다.
  const current = store.scope === scope ? store : emptyWhatIf(scope);
  if (store.scope !== scope) setStore(current);

  // 같은 때 진행 중인 계산 요청을 취소하고, 늦게 와도 버리도록 번호를 넘긴다. 화면을 떠날 때도 같다.
  useEffect(
    () => () => {
      seqRef.current += 1;
      calcRef.current?.abort();
      calcRef.current = null;
    },
    [scope],
  );

  // 진입 호출: 가정 가능 목록과 다시 계산한 원래 값(D9 비교용). 불러오는 중에는 화면을 바꾸지 않는다(D6).
  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    void requestWhatIf(scope, [], controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setStore((prev) => (prev.scope === scope ? { ...prev, entry: entryOf(result) } : prev));
    });
    return () => controller.abort();
  }, [scope, entryAttempt]);

  const send = (codes: string[]) => {
    if (scope === null) return;
    calcRef.current?.abort();
    seqRef.current += 1;
    const seq = seqRef.current;
    if (codes.length === 0) {
      calcRef.current = null;
      setStore((prev) => ({ ...prev, codes, seq, calc: null, live: WHAT_IF_CLEARED_MESSAGE }));
      return;
    }
    const controller = new AbortController();
    calcRef.current = controller;
    setStore((prev) => ({ ...prev, codes, seq }));
    void requestWhatIf(scope, codes, controller.signal).then((result) => {
      if (seqRef.current !== seq) return;
      calcRef.current = null;
      const value: WhatIfCalcState = result.ok
        ? { phase: "result", before: result.data.before, after: result.data.after }
        : { phase: "error", failure: failureView(result) };
      const live = result.ok
        ? whatIfLiveMessage(result.data.before, result.data.after)
        : WHAT_IF_FAILED_MESSAGE;
      setStore((prev) => (prev.seq === seq ? { ...prev, calc: { seq, value }, live } : prev));
    });
  };

  const { entry } = current;
  // D9: 다시 계산한 원래 값이 저장된 run 과 다르면 띠의 "원래"와 결정 패널이 달라 보이므로 스위치를 내지 않는다.
  const mismatch =
    entry?.phase === "ready" && (scored === null || !matchesStoredRun(entry.before, scored));
  const assumable =
    entry?.phase === "ready" && !mismatch && entry.assumable.length > 0
      ? new Set(entry.assumable)
      : undefined;
  const notice =
    entry?.phase === "no-snapshot" ? (
      <WhatIfNotice kind="no-snapshot" />
    ) : entry?.phase === "load-error" ? (
      <WhatIfNotice
        kind="load-error"
        failure={entry.failure}
        onRetry={() => {
          setStore((prev) => ({ ...prev, entry: null }));
          setEntryAttempt((attempt) => attempt + 1);
        }}
      />
    ) : mismatch ? (
      <WhatIfNotice kind="mismatch" />
    ) : null;
  const calc: WhatIfCalcState | null =
    assumable === undefined || current.codes.length === 0
      ? null
      : current.calc?.seq === current.seq
        ? current.calc.value
        : { phase: "calculating" };

  return {
    assumable,
    assumed: new Set(current.codes),
    notice,
    calc,
    live: current.live,
    toggle: (code) =>
      send(
        current.codes.includes(code)
          ? current.codes.filter((item) => item !== code)
          : [...current.codes, code].sort(),
      ),
    clear: () => send([]),
    retry: () => send(current.codes),
  };
}

// 켠 가정 칩: 필수자격 목록 순서, 이름은 같은 코드의 첫 행 이름이다(스펙 §5).
const assumptionsOf = (
  checks: AnalysisView["qualification"]["checks"],
  assumed: ReadonlySet<string>,
): { code: string; name: string }[] =>
  checks.flatMap((check, index) =>
    check.requirementCode !== null &&
    assumed.has(check.requirementCode) &&
    checks.findIndex((other) => other.requirementCode === check.requirementCode) === index
      ? [{ code: check.requirementCode, name: check.requirementName }]
      : [],
  );

function Dot() {
  return (
    <span aria-hidden="true" className="text-muted-foreground">
      ·
    </span>
  );
}

// ① 제목 위: 뒤로 링크와 배지 줄(DEMO·단계·취소·출처).
function DetailEyebrow({ bid, backHref }: { bid: DetailBid; backHref: string }) {
  return (
    <div className="mb-3 flex flex-col items-start gap-2">
      <Link
        href={backHref}
        className={cn(
          "inline-flex items-center gap-1 type-label text-muted-foreground hover:text-foreground",
          TEXT_LINK,
        )}
      >
        <ArrowLeftIcon aria-hidden="true" className="size-4 shrink-0" />
        {backHref === "/watchlist" || backHref.startsWith("/watchlist?")
          ? "관심 공고"
          : "공고 목록"}
      </Link>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {bid.isDemo && <DemoBadge withTooltip />}
        {isUnverifiedOrigin(bid) && (
          <span data-part="unverified-origin" className="type-caption text-warning">
            출처 미확인
          </span>
        )}
        <Chip size="sm" className={CHIP_LAYOUT}>
          {STAGE_LABEL[bid.stage]}
        </Chip>
        <StatusBadge kind="bidStatus" value={bid.status} />
        <span className="type-caption text-muted-foreground wrap-anywhere">
          출처 {sourceText(bid.source)}
        </span>
      </div>
    </div>
  );
}

// ① 요약 두 줄: 기관(·공고기관)·예산·마감 / 공고번호·수집·마지막 변경 시각. 시각은 한국 시각이고 시간대 표기는 붙이지 않는다.
// 기관 라벨은 저장된 source 의 정규화 규칙을 따른다(G2B 는 dminsttNm 수요기관, notice-origin). 공고기관(ntceInsttNm)은 원본에 있을 때만 보인다.
function SummaryLines({
  bid,
  now,
  changedAt,
}: {
  bid: DetailBid;
  now: Date;
  changedAt: string | null;
}) {
  const due = dDay(bid.deadlineAt, now);
  return (
    <>
      <span className="block">
        {agencyLabelOf(bid.source)} {bid.agency ?? "—"}
        {bid.noticeAgency !== null && ` · 공고기관 ${bid.noticeAgency}`} · 예산{" "}
        <span className="tabular-nums">{formatKrwFull(bid.budgetKrw)}</span>
        {bid.budgetKrw === null && <span className="sr-only">미공개</span>} · 마감{" "}
        {bid.deadlineAt === null ? (
          "—"
        ) : (
          <time dateTime={bid.deadlineAt} className="tabular-nums">
            {formatKst(bid.deadlineAt)}
            {due !== null && ` (${due.label})`}
          </time>
        )}
      </span>
      <span className="block">
        공고번호 <span className="font-mono">{bid.noticeId}</span> · 수집{" "}
        <time dateTime={bid.lastSyncedAt} className="tabular-nums">
          {formatKst(bid.lastSyncedAt)}
        </time>
        {changedAt !== null && (
          <>
            {" "}
            · 마지막 변경{" "}
            <time dateTime={changedAt} className="tabular-nums">
              {formatKst(changedAt)}
            </time>
          </>
        )}
      </span>
    </>
  );
}

function HeaderActions({
  bid,
  state,
  busy,
  hasResult,
  hasAnalysis,
  canAnalyze,
  onAnalyze,
  watch,
}: {
  bid: DetailBid;
  state: RunState;
  busy: boolean;
  hasResult: boolean;
  hasAnalysis: boolean;
  canAnalyze: boolean;
  onAnalyze: () => void;
  watch: WatchSummary | null;
}) {
  const requesting = state.phase === "requesting";
  // 본문이 없으면 분석하지 않는다. 서버 판정(analysisReadiness)이나 요청 거절(409 ANALYSIS_SOURCE_MISSING) 어느 쪽이든 같은 안내다.
  const sourceRejected =
    state.phase === "error" && state.stage === "request" && state.code === SOURCE_MISSING_CODE;
  const sourceMissing = !bid.analysisReadiness.ready || sourceRejected;
  const hintIds = [
    canAnalyze ? null : "analyze-role-hint",
    sourceMissing ? "analyze-source-hint" : null,
  ].filter((value) => value !== null);
  const label = requesting
    ? "분석 요청 중…"
    : busy
      ? "분석 중…"
      : hasAnalysis
        ? "재분석"
        : "분석 실행";
  return (
    <div className="flex max-w-sm flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {watch !== null && <DetailWatch bidId={bid.id} watch={watch} />}
        <SourceLink
          href={bid.sourceUrl}
          ariaLabel={`${sourceLinkLabelOf(bid.sourceUrlKind)} (새 탭)`}
          className={cn(buttonVariants({ variant: "outline" }))}
        >
          <ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />
          {sourceLinkLabelOf(bid.sourceUrlKind)}
        </SourceLink>
        {/* 이 화면의 default 버튼은 하나다. 결과가 없으면 분석, 있으면 결정 기록(스펙 §5.4.9). */}
        <Button
          type="button"
          variant={hasResult ? "outline" : "default"}
          disabled={!canAnalyze || bid.status === "CANCELLED" || busy || sourceMissing}
          aria-describedby={hintIds.length === 0 ? undefined : hintIds.join(" ")}
          onClick={onAnalyze}
        >
          {busy ? (
            <LoaderCircleIcon
              data-icon="inline-start"
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : (
            hasAnalysis && <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {label}
        </Button>
      </div>
      {!canAnalyze && (
        // 비활성 버튼은 초점을 받지 않아 툴팁 대신 보이는 글자로 이유를 둔다(§5.4.10).
        <p id="analyze-role-hint" className="text-right type-label text-muted-foreground">
          {ANALYZE_ROLE_HINT}
        </p>
      )}
      {sourceMissing && (
        // 요청이 막혀 생긴 안내면 바로 알린다(성공으로 들리지 않게). 처음부터 막힌 공고는 조용히 둔다.
        <p
          id="analyze-source-hint"
          role={sourceRejected ? "alert" : undefined}
          className="text-right type-label text-muted-foreground"
        >
          {SOURCE_MISSING_HINT}
        </p>
      )}
      {/* 요청(POST) 실패만 버튼 곁에 둔다. 상태 확인(GET) 실패는 본문의 StatusCheckFailed 가 보인다.
          본문 미확보 거절은 위 안내가 같은 뜻을 말하므로 오류 상자를 따로 두지 않는다(성공으로도 보이지 않는다). */}
      {state.phase === "error" && state.stage === "request" && !sourceRejected && (
        <div
          role="alert"
          className="flex flex-col gap-0.5 rounded-lg border border-destructive p-3 type-label text-destructive"
        >
          <p>분석을 요청하지 못했습니다</p>
          <p className="wrap-anywhere text-foreground">{state.message}</p>
          <ErrorCode code={state.code} requestId={state.requestId} />
        </div>
      )}
    </div>
  );
}

function ErrorCode({ code, requestId }: { code: string; requestId?: string }) {
  return (
    <p className="font-mono type-caption wrap-anywhere">
      {code}
      {requestId !== undefined && ` · ${requestId}`}
    </p>
  );
}

// 분석은 요청됐는데 진행 상태를 읽지 못했다(poll 401·403·404). 분석이 실패한 것이 아니므로 결과 없음으로 보이지 않고,
// 다시 읽게 한다. [새로고침]은 서버가 다시 그리게 하고, 아직 진행 중이면 이어 읽기를 다시 시작한다.
function StatusCheckFailed({
  failure,
  onRefresh,
}: {
  failure: Extract<RunState, { phase: "error" }>;
  onRefresh: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border border-destructive bg-background p-4"
    >
      <OctagonAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 type-label text-foreground">
        <p className="type-body">분석 상태를 확인하지 못했습니다</p>
        <p className="wrap-anywhere">{failure.message}</p>
        <div className="text-muted-foreground">
          <ErrorCode code={failure.code} requestId={failure.requestId} />
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
        <RefreshCwIcon aria-hidden="true" data-icon="inline-start" />
        새로고침
      </Button>
    </div>
  );
}

function ProfileBadge({ isDemo }: { isDemo: boolean }) {
  return (
    <Tooltip landmark>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className={cn(
          PROFILE_BADGE_CLASS,
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        )}
      >
        {isDemo ? PROFILE_BADGE : PUBLIC_PROFILE_BADGE}
      </TooltipTrigger>
      <TooltipContent>{isDemo ? PROFILE_TOOLTIP : PUBLIC_PROFILE_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

function HistoryTable({ rows }: { rows: AnalysisHistoryRow[] }) {
  return (
    // 분석 띠 상자 안이라 표 바깥 테두리는 끈다(2026-10-28 화면 개편).
    <Table containerClassName="mt-2 rounded-none border-0">
      <caption className="sr-only">분석 이력</caption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead scope="col">시각</TableHead>
          <TableHead scope="col">상태</TableHead>
          <TableHead scope="col" className="text-right">
            점수
          </TableHead>
          <TableHead scope="col">권고</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="align-top tabular-nums">
              <time dateTime={row.at}>{formatKst(row.at)}</time>
            </TableCell>
            <TableCell className="align-top whitespace-normal">
              <StatusBadge kind="analysis" value={row.status} short variant="inline" />
            </TableCell>
            <TableCell className="text-right align-top tabular-nums">
              {row.solScore === null ? "—" : Math.round(row.solScore)}
            </TableCell>
            <TableCell className="align-top">
              {row.recommendation === null ? (
                "—"
              ) : (
                <StatusBadge kind="recommendation" value={row.recommendation} variant="inline" />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// 상태와 데이터 성격(저장 공고·모의 응답·회사 프로필)만 보인다. 실행 모드·모델명·알고리즘·프로필 버전은 화면에 두지 않는다
// (2026-11-03 사용자 지시). 그 값은 분석 기록(score_runs)에 남는다.
function AnalysisBand({
  bid,
  latest,
  polling,
  history,
}: {
  bid: DetailBid;
  latest: AnalysisView | null;
  polling: PollingView | null;
  history: BidDetailViewProps["history"];
}) {
  // polling 중에는 새 run 의 상태만 보인다. 지난 run 의 모드·모델을 새 결과처럼 보이지 않게 한다.
  const shown = polling === null ? latest : null;
  const historyRows = history?.items ?? [];
  return (
    <section
      aria-labelledby="analysis-band-title"
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <h2 id="analysis-band-title" className="sr-only">
        분석 요약
      </h2>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 type-label text-foreground">
        {polling !== null ? (
          <AnalysisStatus status={polling.status} />
        ) : (
          <AnalysisStatus
            status={latest?.status ?? null}
            at={latest === null ? undefined : (latest.finishedAt ?? latest.queuedAt)}
          />
        )}
        {shown?.runMode === "fixture" && (
          <>
            <Dot />
            <span className="type-label text-warning">저장 공고 기반 분석</span>
          </>
        )}
        {shown?.model.provider === "mock" && (
          <>
            <Dot />
            <span className="type-label text-warning">Mock 응답(데모 데이터)</span>
          </>
        )}
      </div>
      {shown !== null && (
        <>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProfileBadge isDemo={shown.profileIsDemo} />
            {!bid.isDemo && (
              <span className="type-caption text-muted-foreground">
                {shown.profileIsDemo ? LIVE_PROFILE_TEXT : LIVE_PUBLIC_PROFILE_TEXT}
              </span>
            )}
          </div>
        </>
      )}
      {historyRows.length >= 2 && (
        <details className="group">
          {/* 기본 펼침 표시(▶)를 숨기고 스펙의 ▾ 하나만 둔다. 펼치면 뒤집는다. */}
          <summary
            className={cn(
              "w-fit cursor-pointer list-none type-label text-foreground [&::-webkit-details-marker]:hidden",
              TEXT_LINK,
            )}
          >
            {/* 첫 쪽(최근 20건)만 읽는다. 더 있으면 "최근"을 붙여 전체 수가 아님을 밝힌다. */}
            분석 이력 {history?.hasMore ? "최근 " : ""}
            {historyRows.length}건{" "}
            <span aria-hidden="true" className="inline-block group-open:rotate-180">
              ▾
            </span>
          </summary>
          <HistoryTable rows={historyRows} />
        </details>
      )}
      {history === null && latest !== null && (
        <p className="type-caption text-muted-foreground">분석 이력을 불러오지 못했습니다</p>
      )}
    </section>
  );
}

// ④~⑦ 구역 하나. 구역은 가는 선으로 나눈다(design-system 방향 1).
function Section({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 border-t border-border pt-6">{children}</div>;
}

// polling 중 ④~⑦ 자리. 실제 구역과 비슷한 높이로 두어 결과가 오면 덜 튄다. 상태 안내는 live 영역이 맡는다.
function AnalysisSkeleton() {
  return (
    <div data-slot="analysis-pending" aria-hidden="true" className="flex flex-col gap-6">
      {[3, 5, 4, 3].map((rows, section) => (
        <div key={section} className="flex flex-col gap-3 border-t border-border pt-6">
          <Skeleton className={cn("h-6 w-40", PULSE)} />
          {Array.from({ length: rows }, (_, row) => (
            <Skeleton key={row} className={cn("h-5 w-full", PULSE)} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Attachments({ bid }: { bid: DetailBid }) {
  if (bid.documents.length === 0) return null;
  return (
    <AttachmentStatus
      documents={bid.documents}
      sourceUrl={bid.sourceUrl}
      sourceLabel={sourceLinkLabelOf(bid.sourceUrlKind)}
    />
  );
}

type ChecklistAssumptionProps = Pick<
  React.ComponentProps<typeof QualificationChecklist>,
  "assumable" | "assumed" | "onToggleAssumption" | "notice"
>;

function AnalysisResult({
  analysis,
  bid,
  assessmentLabels,
  assumption,
  insight,
}: {
  analysis: AnalysisView;
  bid: DetailBid;
  assessmentLabels: Record<string, string>;
  assumption: ChecklistAssumptionProps;
  insight: InsightPanelInput | null;
}) {
  const openWith = useEvidenceStore((store) => store.openWith);
  // 이 결과는 진행 중이 아닐 때 최신 run 으로만 그려져, 분석 요약 띠와 같은 조건으로 mock 을 이미 밝혔는지 안다.
  const mockShownAbove = analysis.model.provider === "mock";
  const assessments = analysis.requirementAssessments.map((assessment) => ({
    assessment,
    label: assessmentLabels[assessment.itemId] ?? assessment.itemId,
  }));
  return (
    <>
      <Section>
        <QualificationChecklist
          qualification={analysis.qualification}
          onOpenEvidence={openWith}
          documents={bid.documents}
          {...assumption}
        />
      </Section>
      <Section>
        <ScoreFactors
          factors={analysis.scoreBreakdown}
          reviewFlags={analysis.reviewFlags}
          explanation={analysis.explanation}
          reference={analysis.qualification.status === "NOT_SATISFIED"}
          onOpenEvidence={openWith}
        />
      </Section>
      <Section>
        <KevOpinion
          kev={analysis.kev}
          reviewFlags={analysis.reviewFlags}
          recommendation={analysis.recommendation}
          ruleReason={ruleReasonOf(analysis)}
          notRecorded={kevRecordMissing(analysis)}
          assessments={assessments}
          mockShownAbove={mockShownAbove}
        />
      </Section>
      {/* 추천 분석은 점수 run(COMPLETED·PARTIAL)에만 붙는다. run 이 바뀌면 key 로 새로 그려 옛 run 의 설명을 버린다. */}
      {insight !== null && (
        <Section>
          <RecommendationInsight
            key={analysis.id}
            bidId={bid.id}
            runId={analysis.id}
            bidTitle={bid.title}
            run={{
              solScore: analysis.solScore,
              recommendation: analysis.recommendation,
              referenceScore: analysis.qualification.status === "NOT_SATISFIED",
              factors: analysis.scoreBreakdown,
              checks: analysis.qualification.checks,
            }}
            canRequest={insight.canRequest}
            initialInsight={insight.initial?.scoreRunId === analysis.id ? insight.initial : null}
            initialPrevious={insight.previous?.scoreRunId === analysis.id ? insight.previous : null}
            pollLimitMs={insight.pollLimitMs}
            currentPromptVersion={insight.currentPromptVersion}
            mockShownAbove={mockShownAbove}
          />
        </Section>
      )}
      <Section>
        <div className="flex flex-col gap-6">
          <EvidenceList title="근거 인용" evidence={analysis.evidence} documents={bid.documents} />
          <Attachments bid={bid} />
        </div>
      </Section>
    </>
  );
}

function NoResult({ title, bid }: { title: string; bid: DetailBid }) {
  return (
    <>
      <Section>
        <EmptyState icon={CircleDashedIcon} title={title} />
      </Section>
      {bid.documents.length > 0 && (
        <Section>
          <Attachments bid={bid} />
        </Section>
      )}
    </>
  );
}

export function BidDetailView({
  relatedStages = null,
  revisionsHref = null,
  bid,
  previousScored,
  history,
  assessmentLabels,
  members,
  currentUserId,
  canAnalyze,
  canDecide,
  backHref,
  now,
  watch = null,
  projectEntry = null,
  changedAt = null,
  insight = null,
  awardReference = null,
}: BidDetailViewProps) {
  const router = useRouter();
  const at = useMemo(() => new Date(now), [now]);
  const latest = bid.latestAnalysis;
  const run = useAnalysisRun(bid.id, { active: activeOf(latest) });
  const { state } = run;

  // 서버가 진행 중인 run 을 그렸는데 훅이 아직 첫 응답을 받지 않았으면(새로고침 직후) 그 상태를 그대로 보인다.
  const serverActive = activeOf(latest);
  const polling: PollingView | null =
    state.phase === "polling"
      ? { status: state.status, delayed: state.delayed }
      : state.phase === "idle" && serverActive !== null
        ? { status: serverActive.status, delayed: false }
        : null;
  const busy = state.phase === "requesting" || (polling !== null && !polling.delayed);
  // 진행 중 표시. 훅이 읽기를 멈췄어도(상태 확인 실패) 서버가 진행 중이라고 준 run 은 빈 결과로 떨어뜨리지 않는다.
  const progress: PollingView | null =
    polling ?? (serverActive === null ? null : { status: serverActive.status, delayed: false });
  const statusFailure = state.phase === "error" && state.stage === "status" ? state : null;
  const cancelled = bid.status === "CANCELLED";
  const scored = isScored(latest) ? latest : null;
  // 결정은 점수 run 에 묶는다. 최신 run 이 진행 중·실패면 직전 점수 run 이다(§5.4.10).
  const decisionAnalysis = scored ?? previousScored;
  const reanalyze =
    canAnalyze && !cancelled && bid.analysisReadiness.ready
      ? () => void run.start(true)
      : undefined;

  // 가정 재계산은 최신 run 이 점수 run 이고 진행 중이 아니며, 필수 항목에 미충족·회사 증빙 없음이 있을 때만 한다(§4.5 대상 아님).
  const whatIfScope =
    progress === null && scored !== null && scored.qualification.checks.some(isAssumptionCandidate)
      ? scored.id
      : null;
  const whatIf = useWhatIf(scored, whatIfScope);
  const assumptions =
    scored === null ? [] : assumptionsOf(scored.qualification.checks, whatIf.assumed);
  // 가정 지우기 뒤 초점은 켰던 스위치 중 목록 순서 첫 번째로 옮긴다(띠와 함께 버튼이 사라진다).
  const clearAssumptions = () => {
    const first = assumptions[0]?.code;
    whatIf.clear();
    if (first === undefined) return;
    document
      .querySelector<HTMLElement>(`[data-slot="what-if-switch"][data-code="${CSS.escape(first)}"]`)
      ?.focus();
  };

  // 결정 기록 뒤 상단바 두 번째 읽기(5초 뒤). 화면을 떠나면 취소한다.
  const recheck = useRef<(() => void) | null>(null);
  useEffect(() => {
    const box = recheck;
    return () => box.current?.();
  }, []);

  const onSubmitReview = useCallback(
    async (input: ReviewInputValues) => {
      const result = await submitReview(bid.id, input);
      if (result.ok) {
        toast(REVIEW_SAVED);
        router.refresh();
        recheck.current?.();
        recheck.current = recheckTopbarAfterReview(refreshTopbarStatus);
      }
      return result;
    },
    [bid.id, router],
  );

  return (
    <>
      <AppPage
        eyebrow={<DetailEyebrow bid={bid} backHref={backHref} />}
        title={bid.title}
        description={<SummaryLines bid={bid} now={at} changedAt={changedAt} />}
        actions={
          <HeaderActions
            bid={bid}
            state={state}
            busy={busy}
            hasResult={decisionAnalysis !== null}
            hasAnalysis={latest !== null}
            canAnalyze={canAnalyze}
            onAnalyze={() => void run.start(latest !== null)}
            watch={watch}
          />
        }
        contentClassName={DETAIL_CONTENT_CLASS}
      >
        <p data-slot="analysis-live" role="status" aria-live="polite" className="sr-only">
          {liveMessageOf(state, polling)}
        </p>
        {/* 띠가 생길 때 첫 알림을 놓치지 않게 띠 밖에 늘 둔다(§4.1). 마지막 결과만 알린다. */}
        <p data-slot="what-if-live" role="status" aria-live="polite" className="sr-only">
          {whatIf.live}
        </p>
        <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div data-slot="bid-detail-main" className="flex min-w-0 flex-col gap-6">
            <AnalysisBand bid={bid} latest={latest} polling={progress} history={history} />
            {statusFailure !== null && (
              <StatusCheckFailed failure={statusFailure} onRefresh={run.refresh} />
            )}
            <AnalysisBanner
              analysis={progress === null ? latest : null}
              bidStatus={bid.status}
              delayed={polling?.delayed ?? false}
              onReanalyze={reanalyze}
              onRefresh={run.refresh}
            />
            {whatIf.calc !== null && (
              <WhatIfBand
                assumptions={assumptions}
                state={whatIf.calc}
                onClear={clearAssumptions}
                onRetry={whatIf.retry}
              />
            )}
            {awardReference !== null && <AwardReferenceCard reference={awardReference} />}
            <section
              aria-labelledby="stage-history-title"
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-6"
            >
              <h2 id="stage-history-title" className="type-heading text-foreground">
                단계 이력
              </h2>
              <StageTimeline
                stage={bid.stage}
                stageLinks={bid.stageLinks}
                revisionsHref={revisionsHref}
              />
              <StageLinks stageLinks={relatedStages} />
            </section>
            {progress !== null ? (
              <AnalysisSkeleton />
            ) : latest === null ? (
              <NoResult title="아직 분석하지 않았습니다" bid={bid} />
            ) : scored === null ? (
              <NoResult title="분석 결과가 없습니다" bid={bid} />
            ) : (
              <AnalysisResult
                analysis={scored}
                bid={bid}
                assessmentLabels={assessmentLabels}
                insight={insight}
                assumption={{
                  assumable: whatIf.assumable,
                  assumed: whatIf.assumed,
                  onToggleAssumption: whatIf.toggle,
                  notice: whatIf.notice,
                }}
              />
            )}
          </div>
          <div
            data-slot="bid-detail-rail"
            className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-18 xl:max-h-[calc(100dvh-5.5rem)] xl:overflow-y-auto"
          >
            {/* 판정(권고·SOL Score)이 레일 맨 위에 오게 결정 패널을 먼저 둔다. 입찰 프로젝트 칸은 그 아래다.
                새 분석이면 라디오 기본값(시스템 권고)도 새로 잡는다(P2). */}
            <DecisionPanel
              key={decisionAnalysis?.id ?? "none"}
              analysis={decisionAnalysis}
              reviews={bid.reviews}
              members={members}
              currentUserId={currentUserId}
              canRecordReview={canDecide}
              bidStatus={bid.status}
              onSubmit={onSubmitReview}
              pending={progress !== null}
            />
            {projectEntry !== null && <BidProjectEntry entry={projectEntry} />}
          </div>
        </div>
      </AppPage>
      <EvidenceDrawer
        content={bid.content}
        sourceUrl={bid.sourceUrl}
        documents={bid.documents}
        sourceLabel={sourceLinkLabelOf(bid.sourceUrlKind)}
      />
    </>
  );
}
