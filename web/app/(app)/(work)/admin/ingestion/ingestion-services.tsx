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
import type { SourceSummary, SourceServiceStatus } from "@/server/opportunities";
import type { IngestionRunView } from "@/server/ingestion";
import { RUNS_ENDPOINT } from "./ingestion-copy";

export function IngestionServices({
  summary,
  runMode,
  onAccepted,
}: {
  summary: SourceSummary;
  runMode: "live" | "fixture" | "mock";
  onAccepted: (run: IngestionRunView) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null),
    [message, setMessage] = useState<string | null>(null);
  const now = new Date(summary.generatedAt);
  async function collect(service: SourceServiceStatus) {
    if (busy || !service.enabled || runMode !== "live") return;
    setBusy(service.key);
    setMessage(null);
    try {
      const response = await fetch(RUNS_ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "sol-radar",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          source: service.sourceFamily.toLowerCase(),
          serviceKey: service.key,
        }),
      });
      if (!response.ok) {
        setMessage(
          response.status === 403
            ? "수집 관리 권한이 없습니다."
            : "수집을 접수하지 못했습니다. 서비스 설정과 실행 기록을 확인하세요.",
        );
        return;
      }
      const run: IngestionRunView = await response.json();
      onAccepted(run);
      setMessage(`${service.displayName} 증분 수집을 접수했습니다.`);
    } catch {
      setMessage("수집 접수에 연결하지 못했습니다. 실행 기록을 확인한 뒤 다시 시도하세요.");
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
          : "검증·활용승인이 완료된 서비스만 증분 수집할 수 있습니다."}
      </p>
      {message && (
        <p role="status" className="type-label">
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border">
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
              .map((service) => (
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
                      <p className="type-caption text-muted-foreground">
                        {service.blockedReason === "DISABLED"
                          ? "활성화 대기"
                          : "연동 조건 확인 필요"}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <p>{service.lastIngestAt ? formatRelative(service.lastIngestAt, now) : "—"}</p>
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
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!service.enabled || runMode !== "live" || busy !== null}
                      onClick={() => void collect(service)}
                    >
                      {busy === service.key ? "접수 중…" : "증분 수집"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
