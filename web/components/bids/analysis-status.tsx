import { StatusBadge } from "@/components/bids/status-badge";
import { EXTRA_STATUS_LABEL, STATUS_ICON } from "@/components/bids/labels";
import { formatKst } from "@/components/bids/format";
import type { AnalysisStatus as AnalysisStatusValue } from "@/server/bids";

// 분석 상태 + 끝난 시각(§5.4.2). 분석이 없으면 미분석이다. 줄 안 표기라 테두리가 없다.
type AnalysisStatusProps = { status: AnalysisStatusValue | null; at?: string; short?: boolean };

function AnalysisStatus({ status, at, short = false }: AnalysisStatusProps) {
  const { icon: NoneIcon, className } = STATUS_ICON.NOT_ANALYZED;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {status === null ? (
        <span className={`inline-flex items-center gap-1 type-caption ${className}`}>
          <NoneIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span>{EXTRA_STATUS_LABEL.NOT_ANALYZED}</span>
        </span>
      ) : (
        <StatusBadge kind="analysis" value={status} short={short} variant="inline" />
      )}
      {status !== null && at !== undefined && (
        <time dateTime={at} className="type-caption tabular-nums text-muted-foreground">
          {formatKst(at)}
        </time>
      )}
    </span>
  );
}

export { AnalysisStatus };
