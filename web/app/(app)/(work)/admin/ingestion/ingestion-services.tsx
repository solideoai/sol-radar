"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { SourceBadge } from "@/components/bids/source-badge";
import { formatRelative } from "@/components/bids/format";
import type { SourceFamily, SourceSummary, SourceServiceStatus } from "@/server/opportunities";
import { isRunning, type AcceptedRun } from "./ingest-runs";
import { requestIngestionRun, type ManualGate } from "./ingestion-api";
import {
  REFERENCE_DESCRIPTION,
  REFERENCE_TITLE,
  SERVICE_COLLECT_BUSY,
  SERVICE_COLLECT_LABEL,
  sourceBlockText,
  type IngestRun,
  type IngestSource,
} from "./ingestion-copy";
import type { LiveControlView } from "./manual-gate";
import { requestErrorOf } from "./request-errors";
import { serviceCollectViewOf } from "./service-collect";

// API 서비스별 수집 현황과 [증분 수집](10-26 0순위). 단추는 웹의 실행 모드가 아니라 판정(GET manual-gate)의
// 수집 모드·정기 일정·Worker 서비스 상태와 수동 수집 제한으로 막는다(service-collect.ts). 최종 판정은 서버다.

const FAMILY_SOURCE = {
  G2B: "g2b",
  KWATER: "kwater",
  LH: "lh",
  KEPCO: "kepco",
} as const satisfies Record<SourceFamily, Exclude<IngestSource, "fixture">>;
const familySource = (service: SourceServiceStatus) => FAMILY_SOURCE[service.sourceFamily];

export function IngestionServices({
  summary,
  gate,
  live,
  rows,
  pending,
  onAccepted,
  onGateRefresh,
}: {
  summary: SourceSummary;
  /** 판정. 읽는 중이거나 읽지 못했으면 null */
  gate: ManualGate | null;
  /** 쿨다운·공유 실행·하루 상한만 본 판정(liveControlViewOf, inProgress false). 실수집이 아니면 null */
  live: LiveControlView | null;
  rows: readonly IngestRun[];
  pending: readonly AcceptedRun[];
  onAccepted: (run: IngestRun) => void;
  onGateRefresh: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const now = new Date(summary.generatedAt);
  // 같은 출처가 실행 중이거나 이 화면이 접수해 아직 목록에 없으면 그 출처의 단추를 막는다(서버도 409 로 막는다).
  const activeSources = new Set<IngestSource>([
    ...rows.filter(isRunning).map((run) => run.source),
    ...pending.map((entry) => entry.run.source),
  ]);
  const viewOf = (service: SourceServiceStatus) =>
    serviceCollectViewOf({
      service,
      gate,
      live,
      running: activeSources.has(familySource(service)),
      busy: busy !== null,
    });

  async function collect(service: SourceServiceStatus) {
    if (viewOf(service).disabled) return;
    const source = familySource(service);
    setBusy(service.key);
    setMessage(null);
    try {
      const outcome = await requestIngestionRun(
        { source, serviceKey: service.key },
        crypto.randomUUID(),
      );
      if (outcome.ok) {
        onAccepted(outcome.run);
        setMessage(`${service.displayName} 증분 수집을 접수했습니다.`);
      } else {
        setMessage(
          requestErrorOf(outcome.failure, {
            retryAfterSec: outcome.retryAfterSec,
            submitted: source,
            runMode: "live",
            now: new Date(),
          }).message,
        );
      }
      // 접수했든 거절됐든 쿨다운·공유 실행·서비스 상태를 서버에서 다시 읽는다.
      onGateRefresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="ingestion-services-title" className="space-y-3">
      <h2 id="ingestion-services-title" className="type-heading">
        API 서비스별 수집 현황
      </h2>
      <p className="type-caption text-muted-foreground">
        최근 실행 기준입니다.{" "}
        {summary.isDemo
          ? "DEMO 모드에서는 외부 API를 호출하지 않습니다."
          : "검증·활용승인이 끝나고 수집 Worker 가 준비된 서비스만 증분 수집할 수 있습니다."}
      </p>
      {message && (
        <p role="status" className="type-label">
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border">
        <Table className="min-w-300">
          <TableHeader>
            <TableRow>
              {[
                "출처 / 서비스",
                "연결 / 인증",
                "마지막 수집 / 성공",
                "수신",
                "신규",
                "변경",
                "중복",
                "오류",
                "격리",
                "수집",
              ].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.groups
              .flatMap((g) => g.services)
              .map((service) => {
                const view = viewOf(service);
                const reasonId = `service-collect-${service.key}`;
                const statusId = `service-status-${service.key}`;
                // registry 이유는 연결/인증 칸이 이미 보인다. 단추 아래에 되풀이하지 않고 그 칸을 가리킨다.
                const reasonInRow =
                  service.blockedReason !== null &&
                  view.reason === sourceBlockText(service.blockedReason);
                return (
                  <TableRow key={service.key}>
                    <TableCell>
                      <SourceBadge family={service.sourceFamily} />
                      <p className="mt-1 type-caption">{service.displayName}</p>
                      <p className="type-caption text-muted-foreground">{service.serviceId}</p>
                    </TableCell>
                    <TableCell>
                      <p>
                        {service.enabled
                          ? service.connectionStatus === "CONNECTED"
                            ? "연결됨"
                            : service.connectionStatus === "ERROR"
                              ? "오류"
                              : "연결 확인 전"
                          : "비활성"}
                      </p>
                      <p className="type-caption text-muted-foreground">
                        {service.authStatus === "VERIFIED"
                          ? "인증 확인"
                          : service.authStatus === "FAILED"
                            ? "인증 실패"
                            : "인증 미검증"}{" "}
                        · {service.keyIssuance === "ISSUED" ? "키 발급 완료" : "키 상태 미확인"}
                      </p>
                      {service.blockedReason && (
                        <p id={statusId} className="type-caption text-muted-foreground">
                          {sourceBlockText(service.blockedReason)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>
                      <p>
                        {service.lastIngestAt ? formatRelative(service.lastIngestAt, now) : "—"}
                      </p>
                      <p className="type-caption text-muted-foreground">
                        {service.lastSuccessAt
                          ? formatRelative(service.lastSuccessAt, now)
                          : "성공 기록 없음"}
                      </p>
                    </TableCell>
                    {[
                      service.counts.fetched,
                      service.counts.created,
                      service.counts.updated,
                      service.counts.duplicates,
                      service.counts.errors,
                      service.counts.quarantined,
                    ].map((n, i) => (
                      <TableCell key={i} className="font-mono tabular-nums">
                        {n.toLocaleString("ko-KR")}
                      </TableCell>
                    ))}
                    <TableCell className="w-48 align-top whitespace-normal">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={view.disabled}
                        aria-describedby={
                          view.reason === null ? undefined : reasonInRow ? statusId : reasonId
                        }
                        onClick={() => void collect(service)}
                      >
                        {busy === service.key ? SERVICE_COLLECT_BUSY : SERVICE_COLLECT_LABEL}
                      </Button>
                      {view.reason !== null && !reasonInRow && (
                        <p
                          id={reasonId}
                          className="mt-1 type-caption wrap-anywhere text-muted-foreground"
                        >
                          {view.reason}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </div>
      {summary.references.length > 0 && <ReferenceServices summary={summary} now={now} />}
    </section>
  );
}

// 공고가 아닌 기준 정보(업종·근거법규). 증분 수집 단추·건수 열을 두지 않는다.
function ReferenceServices({ summary, now }: { summary: SourceSummary; now: Date }) {
  return (
    <div aria-labelledby="ingestion-references-title" role="group" className="space-y-2 pt-2">
      <h3 id="ingestion-references-title" className="type-label font-semibold">
        {REFERENCE_TITLE}
      </h3>
      <p className="type-caption text-muted-foreground">{REFERENCE_DESCRIPTION}</p>
      <ul className="divide-y divide-border rounded-lg border">
        {summary.references.map((service) => (
          <li
            key={service.key}
            className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3"
          >
            <span className="flex items-baseline gap-2">
              <SourceBadge family={service.sourceFamily} />
              <span className="type-label">{service.displayName}</span>
              <span className="type-caption text-muted-foreground">{service.serviceId}</span>
            </span>
            <span className="type-caption text-muted-foreground">
              {service.enabled ? "연결 준비됨" : sourceBlockText(service.blockedReason)} · 마지막
              성공{" "}
              {service.lastSuccessAt === null ? "—" : formatRelative(service.lastSuccessAt, now)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
