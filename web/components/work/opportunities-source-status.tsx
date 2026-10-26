import { cn } from "cn";
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { formatRelative } from "@/components/bids/format";
import type { SourceSummary } from "@/server/opportunities";

// 대시보드 오른쪽 칸의 한 구역. 상자 없이 제목 줄 + 구분선 목록으로 그린다(제목 줄 모양은 dashboard-view 와 같다).
export function OpportunitySourceStatus({
  summary,
  now,
  canManage,
}: {
  summary: SourceSummary | null;
  now: Date;
  canManage: boolean;
}) {
  return (
    <section className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="type-heading text-foreground">수집 소스 상태</h2>
          <p className="mt-0.5 type-caption wrap-anywhere text-muted-foreground">
            저장된 수집 기록 기준{summary?.isDemo ? " · 외부 수집 없음" : ""}
          </p>
        </div>
        {canManage && (
          <Link
            href="/admin/ingestion"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-sm type-label whitespace-nowrap text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            수집 관리
            <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
          </Link>
        )}
      </div>
      {summary === null ? (
        <p className="mt-3 border-y border-border py-4 type-label text-muted-foreground">
          수집 현황을 불러오지 못했습니다. 데이터 새로고침으로 다시 시도하세요.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border border-y border-border">
          {summary.groups.map((group) => {
            const isHealthy = !summary.isDemo && group.status === "HEALTHY";
            const isDegraded = !summary.isDemo && group.status === "DEGRADED";
            const Icon = isHealthy
              ? CircleCheckIcon
              : isDegraded
                ? TriangleAlertIcon
                : CircleDashedIcon;
            const label = summary.isDemo
              ? "외부 수집 없음"
              : isHealthy
                ? "정상"
                : isDegraded
                  ? "일부 미완료"
                  : "연동 준비";
            return (
              <li key={group.sourceFamily} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="type-label font-semibold text-foreground">{group.label}</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 self-center type-caption",
                      isHealthy
                        ? "text-success"
                        : isDegraded
                          ? "text-warning"
                          : "text-muted-foreground",
                    )}
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {label}
                  </span>
                </div>
                <p className="mt-0.5 type-caption text-muted-foreground">
                  <span>
                    활성 서비스 {group.enabledServices}/{group.services.length}
                  </span>
                  <span aria-hidden> · </span>
                  <span className="whitespace-nowrap">
                    마지막 성공{" "}
                    {group.lastSuccessAt === null ? "—" : formatRelative(group.lastSuccessAt, now)}
                  </span>
                </p>
                <details className="mt-1">
                  <summary className="w-fit cursor-pointer rounded-sm type-caption outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                    서비스 {group.services.length}개 보기
                  </summary>
                  <ul className="mt-2 mb-1 space-y-2">
                    {group.services.map((service) => (
                      <li key={service.key} className="type-caption wrap-anywhere">
                        <span>{service.displayName}</span>
                        <span className="block text-muted-foreground">
                          {!service.enabled
                            ? "연동 준비"
                            : service.status === "HEALTHY" && !summary.isDemo
                              ? "수집 완료"
                              : "확인 전"}{" "}
                          ·{" "}
                          {service.lastSuccessAt === null
                            ? "성공 기록 없음"
                            : formatRelative(service.lastSuccessAt, now)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
