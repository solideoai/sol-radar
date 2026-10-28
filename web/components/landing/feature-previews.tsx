import { cn } from "cn";
import { BellRingIcon, UserCheckIcon } from "lucide-react";
import { DEMO_BIDS } from "@/components/landing/demo-bids";
import { formatDate, formatWon } from "@/components/landing/format";
import { EvidenceQuote, QualificationLabel } from "@/components/landing/status-badges";

// 주요 기능 줄 오른쪽의 제품 조각. 화면 낭독기에서 숨기고(aria-hidden) 초점을 막는다(inert) — 쓰는 쪽이 감싼다.
// 숫자와 공고는 미리보기와 같은 예시 데이터(demo-bids.ts)에서 가져온다. 따로 적으면 미리보기와 어긋난다.
// 테두리 틀도 쓰는 쪽이 그린다. 여기서는 머리 띠와 내용만 그려 틀 안에 틀을 두지 않는다.
// 조각 안 글자는 판과 같은 눈금(15~17px)이다 — 첫 화면의 가독성 바닥 아래로 내리지 않는다.

const STAGES = ["발주계획", "사전규격", "입찰공고"];
const [FEATURED] = DEMO_BIDS;
// 점수 조각은 원격 교육 플랫폼 구축(demo-3)이다. 요소 막대 길이가 서로 달라야 점수가 나뉘는 것이 읽힌다
// — 대표 예시(demo-1)는 다섯 요소 중 넷이 80% 라 막대가 고르다.
const SCORED = DEMO_BIDS[2];
const BY_DEADLINE = DEMO_BIDS.toSorted((a, b) => a.proposalDue.localeCompare(b.proposalDue));

function PreviewHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-15 items-center gap-2.5 border-b border-border bg-muted/50 px-5 py-3.5">
      {children}
    </div>
  );
}

const TABLE_HEAD =
  "px-5 py-2.5 type-label-lg font-semibold whitespace-nowrap text-muted-foreground";
const TABLE_CELL = "px-5 py-3.5 align-top type-ui-lg";
const NUMBER_CELL = cn(TABLE_CELL, "text-right whitespace-nowrap text-foreground tabular-nums");

export function CollectPreview() {
  return (
    <>
      <PreviewHead>
        {/* 거르기 칩: 고른 단계는 선택색(연한 파랑 바탕 + 파란 글자), 나머지는 회색 칩이다(2026-10-28 화면 개편). */}
        {/* 앱의 Chip(13px)이 아니라 판과 같은 15px 눈금으로 같은 색 규칙을 따른다 — 조각 글자를 판보다 작게 두지 않는다. */}
        {STAGES.map((stage) => (
          <span
            key={stage}
            className={cn(
              "rounded-md px-2.5 py-0.5 type-label-lg",
              stage === "입찰공고"
                ? "bg-selected font-semibold text-selected-foreground"
                : "bg-secondary text-secondary-foreground",
            )}
          >
            {stage}
          </span>
        ))}
        <span className="ml-auto type-label-lg text-muted-foreground">마감 빠른 순</span>
      </PreviewHead>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className={TABLE_HEAD}>
              공고명
            </th>
            <th scope="col" className={TABLE_HEAD}>
              기관
            </th>
            <th scope="col" className={cn(TABLE_HEAD, "text-right")}>
              예산
            </th>
            <th scope="col" className={cn(TABLE_HEAD, "text-right")}>
              마감
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {BY_DEADLINE.map((bid) => (
            <tr key={bid.id}>
              <td className={cn(TABLE_CELL, "font-semibold text-foreground")}>{bid.title}</td>
              <td className={cn(TABLE_CELL, "whitespace-nowrap text-muted-foreground")}>
                {bid.agency}
              </td>
              <td className={NUMBER_CELL}>{formatWon(bid.budgetWon)}</td>
              <td className={NUMBER_CELL}>{formatDate(bid.proposalDue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// 세 상태를 한 번씩 보여 준다. 예시 공고의 자격 항목에서 상태마다 첫 항목을 고른다.
const SAMPLE_CHECKS = (["SATISFIED", "NEEDS_REVIEW", "NOT_SATISFIED"] as const)
  .map((status) => DEMO_BIDS.flatMap((bid) => bid.checks).find((check) => check.status === status))
  .filter((check) => check !== undefined);

// 판의 자격 줄과 같은 모양이다. 판단(상태) 옆에 근거(공고문 쪽수·인용)를 붙인다.
export function QualifyPreview() {
  return (
    <>
      <PreviewHead>
        <span className="type-ui-lg font-semibold text-foreground">참가 자격 검토</span>
      </PreviewHead>
      <ul className="divide-y divide-border">
        {SAMPLE_CHECKS.map((check) => (
          <li
            key={check.requirement}
            className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-3 px-5 py-3.5"
          >
            <QualificationLabel status={check.status} />
            <div className="min-w-0">
              <p className="type-ui-lg font-semibold text-foreground">{check.requirement}</p>
              <p className="mt-0.5 type-label-lg text-muted-foreground">{check.note}</p>
              <p className="mt-2">
                <EvidenceQuote evidence={check.evidence} />
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export function ScorePreview() {
  return (
    <>
      <PreviewHead>
        <span className="min-w-0 truncate type-ui-lg font-semibold text-foreground">
          {SCORED.title}
        </span>
        <span className="ml-auto flex shrink-0 items-baseline gap-1.5">
          <span className="type-heading-lg text-foreground tabular-nums">{SCORED.score}</span>
          <span className="type-label-lg text-muted-foreground">/ 100</span>
        </span>
      </PreviewHead>
      <ul className="py-2.5">
        {SCORED.factors.map((factor) => (
          <li
            key={factor.label}
            className="grid grid-cols-[150px_minmax(0,1fr)_72px] items-center gap-4 px-5 py-2.5 type-ui-lg"
          >
            <span className="text-foreground">{factor.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-brand"
                style={{ width: `${(factor.points / factor.max) * 100}%` }}
              />
            </span>
            <span className="text-right font-semibold text-foreground tabular-nums">
              {factor.points} / {factor.max}
            </span>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-5 py-4">
        <p className="type-label-lg font-semibold text-muted-foreground">주요 판단 근거</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {SCORED.reasons.map((reason) => (
            <li key={reason} className="type-ui-lg text-foreground">
              {reason}
            </li>
          ))}
        </ul>
      </div>
      <p className="border-t border-border px-5 py-3 type-label-lg text-muted-foreground">
        적합도 지표입니다. 수주 확률이 아닙니다.
      </p>
    </>
  );
}

// 대표 예시(WATCH)의 이력이다. 사람이 아직 결정하지 않았다는 것까지 보여 준다.
// 검토 의견은 그리지 않는다 — 해커톤 범위 밖 기능(FR-13, P1)이라 있는 것처럼 보이지 않게 한다.
const EVENTS = [
  {
    icon: BellRingIcon,
    kind: "변경 알림",
    text: "첨부문서 1건이 추가되었습니다.",
    time: "10. 16. 09:12",
  },
  { icon: UserCheckIcon, kind: "참여 결정", text: "권고 WATCH · 담당자 결정 전", time: "대기" },
];

export function HistoryPreview() {
  return (
    <>
      <PreviewHead>
        <span className="min-w-0 truncate type-ui-lg font-semibold text-foreground">
          {FEATURED.title}
        </span>
      </PreviewHead>
      <ol className="divide-y divide-border">
        {EVENTS.map((event) => (
          <li key={event.kind} className="flex items-start gap-3.5 px-5 py-4">
            <event.icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block type-ui-lg font-semibold text-foreground">{event.kind}</span>
              <span className="mt-0.5 block type-label-lg text-muted-foreground">{event.text}</span>
            </span>
            <span className="shrink-0 type-label-lg text-muted-foreground tabular-nums">
              {event.time}
            </span>
          </li>
        ))}
      </ol>
    </>
  );
}
