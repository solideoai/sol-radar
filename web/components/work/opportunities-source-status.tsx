import { cn } from "cn";
import { CircleCheckIcon, CircleDashedIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { formatRelative } from "@/components/bids/format";
import { SourceBadge } from "@/components/bids/source-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { SourceSummary } from "@/server/opportunities";

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
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>
          <h2>수집 소스 상태</h2>
        </CardTitle>
        <CardDescription className="type-caption">
          저장된 수집 기록 기준{summary?.isDemo ? " · 외부 수집 없음" : ""}
        </CardDescription>
        {canManage && (
          <CardAction>
            <Link
              href="/admin/ingestion"
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              수집 관리
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {summary === null ? (
          <p className="px-6 type-label text-muted-foreground">
            수집 현황을 불러오지 못했습니다. 데이터 새로고침으로 다시 시도하세요.
          </p>
        ) : (
          <ul className="divide-y divide-border">
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
                <li key={group.sourceFamily} className="px-6 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <SourceBadge family={group.sourceFamily} />
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 type-caption",
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
                  <p className="mt-2 type-caption text-muted-foreground">
                    활성 서비스 {group.enabledServices}/{group.services.length}
                  </p>
                  <p className="mt-1 type-caption text-muted-foreground">
                    마지막 성공{" "}
                    {group.lastSuccessAt === null ? "—" : formatRelative(group.lastSuccessAt, now)}
                  </p>
                  <details className="mt-2">
                    <summary className="w-fit cursor-pointer rounded-sm type-caption outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                      서비스 {group.services.length}개 보기
                    </summary>
                    <ul className="mt-2 space-y-2">
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
      </CardContent>
    </Card>
  );
}
