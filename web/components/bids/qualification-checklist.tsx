import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { NEEDS_REVIEW_REASON_LABEL } from "@/components/bids/labels";
import { readableCheck } from "@/components/bids/qualification-reason";
import { StatusBadge } from "@/components/bids/status-badge";
import { evidenceLabel } from "@/components/bids/evidence-drawer";
import type { EvidenceContext, EvidenceRef } from "@/components/bids/evidence-store";
import { MAX_ASSUMPTIONS, showWhatIfBand } from "@/components/bids/what-if-band";
import type { AnalysisView, BidDocument, QualificationCheckView } from "@/server/bids";

// 필수자격 체크리스트(§5.4.4). 표가 아니라 목록이다 — 행마다 근거 버튼이 여럿일 수 있다.
// BOOST-2: 서버가 가정 가능하다고 준 행(assumable)에만 "보유 가정" 스위치를 단다(디자인 스펙 §4.2).
// 스위치를 켜도 행의 판정 배지·사유·근거는 저장된 run 그대로다. 가정 값은 가정 시나리오 띠에만 나온다.
type QualificationChecklistProps = {
  qualification: AnalysisView["qualification"];
  onOpenEvidence?: (ctx: EvidenceContext) => void;
  /** 근거 위치 라벨(Ruling 9)이 첨부 이름을 찾는 데 쓴다. 없으면 첨부 근거는 "첨부"다. */
  documents?: BidDocument[];
  /** 가정 가능한 자격 코드(서버 판정). 없으면 스위치를 그리지 않는다. */
  assumable?: ReadonlySet<string>;
  /** 지금 켠 자격 코드. */
  assumed?: ReadonlySet<string>;
  onToggleAssumption?: (code: string) => void;
  /** 필수자격 제목 바로 아래 한 줄(가정 불러오기 실패·입력 기록 없음 등). */
  notice?: React.ReactNode;
};

// 09 "근거 부족"(2026-11-03 개정). 자격은 점수에 들어가지 않고 추천을 막는다는 것을 말한다. 내부 코드는 쓰지 않는다.
// 필수 자격이 아닌 행은 권고를 막지 않으므로 둘째 문장이 다르다(08 §5.2: 판정은 필수 행만 본다).
const NO_EVIDENCE_TEXT = {
  mandatory:
    "근거를 확인하지 못했습니다. 이 필수 자격을 확인하기 전에는 점수가 높아도 추천이 나오지 않습니다.",
  optional: "근거를 확인하지 못했습니다. 필수 자격이 아니라 권고에는 영향이 없습니다.",
} as const;
const ASSUMPTION_HINT = "보유 가정을 켜면 저장하지 않고 권고와 점수를 다시 계산합니다.";
const ASSUMPTION_LIMIT = "가정은 10개까지 켤 수 있습니다.";

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

type AssumptionControl = {
  code: string;
  checked: boolean;
  disabled: boolean;
  hintId: string;
  onToggle: (code: string) => void;
};

// 첫 줄 오른쪽 끝 스위치 묶음(D2). 이름은 "{행 이름} 보유 가정"이고 보이는 글자 "보유 가정"이 그 안에 있다(WCAG 2.5.3).
function AssumptionSwitch({ nameId, control }: { nameId: string; control: AssumptionControl }) {
  const switchId = useId();
  const labelId = useId();
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Label id={labelId} htmlFor={switchId} className="text-foreground">
        보유 가정
      </Label>
      <Switch
        id={switchId}
        data-slot="what-if-switch"
        data-code={control.code}
        checked={control.checked}
        disabled={control.disabled}
        onCheckedChange={() => control.onToggle(control.code)}
        aria-labelledby={`${nameId} ${labelId}`}
        aria-describedby={control.hintId}
      />
    </div>
  );
}

function CheckRow({
  check,
  onOpenEvidence,
  documents,
  assumption,
}: {
  check: QualificationCheckView;
  onOpenEvidence?: (ctx: EvidenceContext) => void;
  documents: BidDocument[];
  assumption?: AssumptionControl;
}) {
  const nameId = useId();
  const needsReview = check.outcome === "NEEDS_REVIEW";
  const { name, reason } = readableCheck(check);
  return (
    <li className="flex flex-col gap-1 py-3">
      {/* 이름이 길어 꺾여도 스위치는 첫 줄 오른쪽 위에 남는다(§4.2·§9). */}
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <StatusBadge
            kind="qualification"
            value={check.outcome}
            reasonCode={check.reasonCode}
            variant="inline"
          />
          <span id={nameId} className="min-w-0 wrap-anywhere type-body text-foreground">
            {name}
          </span>
          <span className="flex flex-wrap gap-x-2 type-caption text-muted-foreground">
            {check.mandatory && <span>필수</span>}
            <span>{BASIS_LABEL[check.basis]}</span>
          </span>
        </div>
        {assumption !== undefined && <AssumptionSwitch nameId={nameId} control={assumption} />}
      </div>
      <p className="type-label text-muted-foreground">
        {needsReview &&
          check.reasonCode !== null &&
          `${NEEDS_REVIEW_REASON_LABEL[check.reasonCode]} · `}
        {reason}
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
                onClick={() => onOpenEvidence({ title: name, evidence: check.evidence })}
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
          <p className="type-label text-foreground">
            {NO_EVIDENCE_TEXT[check.mandatory ? "mandatory" : "optional"]}
          </p>
        )}
      {/* 띠가 화면 위쪽 밖에 생겼을 때 결과로 가는 길(D8). 켠 행에만 둔다. */}
      {assumption?.checked === true && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-start px-0"
          onClick={() => showWhatIfBand()}
        >
          가정 시나리오 보기
        </Button>
      )}
    </li>
  );
}

function QualificationChecklist({
  qualification,
  onOpenEvidence,
  documents = [],
  assumable,
  assumed,
  onToggleAssumption,
  notice,
}: QualificationChecklistProps) {
  const headingId = useId();
  const hintId = useId();
  const assumedCodes = assumed ?? new Set<string>();
  const atLimit = assumedCodes.size >= MAX_ASSUMPTIONS;
  // 같은 코드가 두 행에 있으면 두 행 모두 같은 상태를 나눠 쓴다(§11 열린 질문 1).
  const controlOf = (check: QualificationCheckView): AssumptionControl | undefined => {
    const code = check.requirementCode;
    if (code === null || onToggleAssumption === undefined || assumable?.has(code) !== true) {
      return undefined;
    }
    const checked = assumedCodes.has(code);
    return { code, checked, disabled: atLimit && !checked, hintId, onToggle: onToggleAssumption };
  };
  const controls = qualification.checks.map(controlOf);
  const hasSwitch = controls.some((control) => control !== undefined);
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <h2 id={headingId} className="type-heading text-foreground">
        필수자격{" "}
        <span className="type-label font-normal text-muted-foreground">
          {summarize(qualification.checks)}
        </span>
      </h2>
      {notice}
      {hasSwitch && (
        <p id={hintId} className="type-label text-muted-foreground">
          {atLimit ? `${ASSUMPTION_HINT} ${ASSUMPTION_LIMIT}` : ASSUMPTION_HINT}
        </p>
      )}
      <ul className="divide-y divide-border">
        {qualification.checks.map((check, index) => (
          <CheckRow
            key={check.id}
            check={check}
            onOpenEvidence={onOpenEvidence}
            documents={documents}
            assumption={controls[index]}
          />
        ))}
      </ul>
    </section>
  );
}

export { QualificationChecklist };
