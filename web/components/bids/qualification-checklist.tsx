import { useId } from "react";
import { Button } from "@/components/ui/button";
import { NEEDS_REVIEW_REASON_LABEL } from "@/components/bids/labels";
import { StatusBadge } from "@/components/bids/status-badge";
import { evidenceLabel } from "@/components/bids/evidence-drawer";
import type { EvidenceContext, EvidenceRef } from "@/components/bids/evidence-store";
import type { AnalysisView, BidDocument, QualificationCheckView } from "@/server/bids";

// 필수자격 체크리스트(§5.4.4). 표가 아니라 목록이다 — 행마다 근거 버튼이 여럿일 수 있다.
type QualificationChecklistProps = {
  qualification: AnalysisView["qualification"];
  onOpenEvidence?: (ctx: EvidenceContext) => void;
  /** 근거 위치 라벨(Ruling 9)이 첨부 이름을 찾는 데 쓴다. 없으면 첨부 근거는 "첨부"다. */
  documents?: BidDocument[];
};

// 09 "근거 부족"
const INSUFFICIENT_DATA_TEXT =
  "근거를 확인할 수 없어 INSUFFICIENT_DATA로 표시합니다. 이 항목은 점수에 반영하지 않았습니다.";

const BASIS_LABEL = {
  API_FIELD: "공고 API 필드",
  EXTRACTION: "AI 추출",
} as const satisfies Record<QualificationCheckView["basis"], string>;

function summarize(checks: QualificationCheckView[]): string {
  const count = (outcome: QualificationCheckView["outcome"]) =>
    checks.filter((c) => c.outcome === outcome).length;
  const unmet = count("NOT_SATISFIED");
  const review = count("NEEDS_REVIEW");
  const parts = [`${checks.length}건`];
  if (unmet > 0) parts.push(`미충족 ${unmet}`);
  if (review > 0) parts.push(`확인 필요 ${review}`);
  if (unmet === 0 && review === 0 && checks.length > 0) parts.push("모두 충족");
  return `(${parts.join(" · ")})`;
}

// 근거 한 건의 글자: "근거 {위치} · "{인용 앞부분}"". 위치는 근거 목록·서랍과 같은 Ruling 9 라벨이다
// (API 필드 → API {필드}, 쪽 → p.N, 본문(documentId null) → 공고 본문, 첨부 → 문서 이름).
// 저장된 근거에는 kind·page 가 없을 수 있다(사전 분석 행: {match, charStart, charEnd, documentId:null, quotedText…}).
const QUOTE_HEAD = 30;
const quoteHead = (text: string): string =>
  text.length > QUOTE_HEAD ? `${text.slice(0, QUOTE_HEAD)}…` : text;
const evidenceText = (ev: EvidenceRef, documents: BidDocument[]): string =>
  `근거 ${evidenceLabel(ev, documents)} · "${quoteHead(ev.quotedText)}"`;

function CheckRow({
  check,
  onOpenEvidence,
  documents,
}: {
  check: QualificationCheckView;
  onOpenEvidence?: (ctx: EvidenceContext) => void;
  documents: BidDocument[];
}) {
  const needsReview = check.outcome === "NEEDS_REVIEW";
  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge
          kind="qualification"
          value={check.outcome}
          reasonCode={check.reasonCode}
          variant="inline"
        />
        <span className="min-w-0 wrap-anywhere type-body text-foreground">
          {check.requirementName}
        </span>
        <span className="flex flex-wrap gap-x-2 type-caption text-muted-foreground">
          {check.mandatory && <span>필수</span>}
          <span>{BASIS_LABEL[check.basis]}</span>
        </span>
      </div>
      <p className="type-label text-muted-foreground">
        {needsReview && check.reasonCode !== null && (
          <>
            {NEEDS_REVIEW_REASON_LABEL[check.reasonCode]}{" "}
            <span className="font-mono type-caption">{check.reasonCode}</span>
            {" · "}
          </>
        )}
        {check.reason}
      </p>
      {check.profileEvidence.length > 0 && (
        <p className="type-label text-muted-foreground wrap-anywhere">
          회사: {check.profileEvidence.map((p) => p.label).join(", ")}
        </p>
      )}
      {check.evidence.length > 0 && (
        <div className="flex flex-col items-start gap-1">
          {check.evidence.map((ev, i) =>
            onOpenEvidence === undefined ? (
              <span key={i} className="type-label text-muted-foreground wrap-anywhere">
                {evidenceText(ev, documents)}
              </span>
            ) : (
              // 인용이 길면 줄을 꺾는다(기본 버튼은 한 줄 고정이라 616px 단에서 넘친다).
              <Button
                key={i}
                type="button"
                variant="link"
                size="sm"
                className="h-auto min-h-8 max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"
                onClick={() =>
                  onOpenEvidence({ title: check.requirementName, evidence: check.evidence })
                }
              >
                {evidenceText(ev, documents)}
              </Button>
            ),
          )}
        </div>
      )}
      {needsReview &&
        check.reasonCode !== "STAGE_NOT_APPLICABLE" &&
        check.evidence.length === 0 && (
          <p className="type-label text-foreground">{INSUFFICIENT_DATA_TEXT}</p>
        )}
    </li>
  );
}

function QualificationChecklist({
  qualification,
  onOpenEvidence,
  documents = [],
}: QualificationChecklistProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="type-heading text-foreground">
        필수자격{" "}
        <span className="type-label font-normal text-muted-foreground">
          {summarize(qualification.checks)}
        </span>
      </h2>
      <ul className="divide-y divide-border">
        {qualification.checks.map((check) => (
          <CheckRow
            key={check.id}
            check={check}
            onOpenEvidence={onOpenEvidence}
            documents={documents}
          />
        ))}
      </ul>
    </section>
  );
}

export { QualificationChecklist };
