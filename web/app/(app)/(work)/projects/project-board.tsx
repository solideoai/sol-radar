import Link from "next/link";
import type { ReactNode } from "react";
import { RECOMMENDATION_LABEL } from "@/components/bids/labels";
import { DemoBadge } from "@/components/bids/status-badge";
import { AppPage } from "@/components/app-page";
import { PROJECT_STATUSES, type ProjectBoard, type ProjectCard } from "@/server/projects";
import { projectDate, resultLabels, statusLabels } from "./project-labels";

function BoardColumn({ title, children }: { title: string; children: ReactNode[] }) {
  const visible = children.slice(0, 6);
  const remaining = children.slice(6);
  return (
    // 열은 테두리 없이 연한 바탕만 둔다. 안의 카드가 테두리를 가져 상자가 겹치지 않는다(2026-10-28 화면 개편).
    <section className="min-w-0 rounded-lg bg-muted/50 p-3" aria-label={title}>
      <h2 className="mb-3 flex flex-wrap items-center justify-between gap-2 type-heading">
        {title}
        <span className="type-caption text-muted-foreground">{children.length}건</span>
      </h2>
      <div className="flex flex-col gap-3">
        {visible}
        {children.length === 0 && (
          <p className="py-8 type-label text-muted-foreground">아직 없습니다.</p>
        )}
        {remaining.length > 0 && (
          <details>
            <summary className="cursor-pointer type-label">{remaining.length}건 더 보기</summary>
            <div className="mt-3 flex flex-col gap-3">{remaining}</div>
          </details>
        )}
      </div>
    </section>
  );
}
function ProjectCardView({ card }: { card: ProjectCard }) {
  return (
    <Link
      href={`/projects/${card.id}`}
      className="block min-w-0 rounded-lg border border-border bg-background p-3 hover:border-primary focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h3 className="line-clamp-2 type-body font-medium wrap-anywhere">{card.title}</h3>
      {/* 기관명과 DEMO 배지 사이를 띄운다. */}
      <p className="mt-1 flex flex-wrap items-center gap-1.5 type-caption text-muted-foreground wrap-anywhere">
        {card.agency ?? "기관 미정"}
        {card.isDemo && <DemoBadge dense />}
      </p>
      <p className="mt-3 type-caption">
        마감 {projectDate(card.effectiveDueAt)}
        {card.dueOverridden ? " (변경)" : ""}
      </p>
      <p className="mt-1 type-caption text-muted-foreground">
        {card.owner?.name ?? "담당자 없음"} · 체크 {card.checklist.done}/{card.checklist.total}
      </p>
      {card.warnings.latestDecision && (
        <p className="mt-2 type-caption text-destructive">
          최신 결정 {RECOMMENDATION_LABEL[card.warnings.latestDecision]} · 전진 불가
        </p>
      )}
      {card.warnings.bidAmended && (
        <p className="mt-1 type-caption text-muted-foreground">공고 정정됨</p>
      )}
      {card.warnings.bidCancelled && (
        <p className="mt-1 type-caption text-destructive">공고 취소됨</p>
      )}
      {card.result && <p className="mt-2 type-caption">결과 {resultLabels[card.result]}</p>}
    </Link>
  );
}
export function ProjectBoardView({ board }: { board: ProjectBoard }) {
  return (
    <AppPage
      title="입찰 프로젝트"
      description={`사람이 내린 ${RECOMMENDATION_LABEL.BID} 결정 이후의 입찰 업무를 관리합니다.`}
      contentClassName="max-w-360"
    >
      <p className="type-label text-muted-foreground">
        검토 대기는 분석 결과가 있고 아직 사람 결정이 없는 공고입니다. 카드를 열어 상태를 바꿀 수
        있습니다.
      </p>
      <div className="grid min-w-0 grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-5">
        <BoardColumn title="검토 대기">
          {board.pending.map((card) => (
            <Link
              key={card.bidId}
              href={`/bids/${card.bidId}`}
              className="block rounded-lg border border-dashed border-border bg-background p-3 hover:border-primary"
            >
              <h3 className="line-clamp-2 type-body font-medium wrap-anywhere">{card.title}</h3>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 type-caption text-muted-foreground wrap-anywhere">
                {card.agency ?? "기관 미정"}
                {card.isDemo && <DemoBadge dense />}
              </p>
              <p className="mt-3 type-caption">마감 {projectDate(card.deadlineAt)}</p>
              <p className="mt-1 type-caption text-muted-foreground">
                시스템 권고{" "}
                {card.recommendation === null
                  ? "확인 필요"
                  : RECOMMENDATION_LABEL[card.recommendation]}
              </p>
            </Link>
          ))}
        </BoardColumn>
        {PROJECT_STATUSES.map((status) => (
          <BoardColumn key={status} title={statusLabels[status]}>
            {board.projects
              .filter((card) => card.status === status)
              .map((card) => (
                <ProjectCardView key={card.id} card={card} />
              ))}
          </BoardColumn>
        ))}
      </div>
    </AppPage>
  );
}
