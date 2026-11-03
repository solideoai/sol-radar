"use client";

import { CircleHelpIcon } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "cn";
import { formatKst, formatPoints } from "@/components/bids/format";
import { MOCK_MODEL_TEXT } from "@/components/bids/kev-opinion";
import { FACTOR_LABEL, FACTOR_ORDER, REVIEW_FLAG_LABEL } from "@/components/bids/labels";
import { readableCheck } from "@/components/bids/qualification-reason";
import { StatusBadge } from "@/components/bids/status-badge";
import { Button } from "@/components/ui/button";
import type { QualificationCheckView, Recommendation, ScoreFactorView } from "@/server/bids";
import type {
  InsightCheckNote,
  InsightFactorNote,
  InsightItem,
  InsightPayload,
  InsightRef,
  InsightStaffing,
  InsightView,
} from "@/server/insight";

// 추천 분석 팝업 본문의 섹션(디자인 스펙 2026-11-03-recommendation-insight-detail-design §5).
// 판단 이유가 맨 앞에서 결론을 주고, 모델 해설(요소·자격·강점과 보완할 점·확인할 것)이 가운데, 규칙 값(인력 가용·근거 원문)이 아래에서 받친다.
// 상자 없이 1px 선으로만 나눈다. 글자는 모두 본문 14px 이고 위계는 순서·제목·선으로 만든다.
// 옛 형식(v0.1) 결과에는 판단 이유·강점과 보완할 점·근거 원문만 있다(계획 "계획이 정하는 것").

export const INSIGHT_NOTICE = "판정은 규칙 엔진이 하고, 최종 참여 결정은 사람이 합니다.";

// 판단 이유와 항목 문장은 gateway 가 만든 저장 글이라 결정 모델 이름(Bosun·KEV)과 검토 신호 코드가 들어 있을 수 있다
// (규칙만으로 쓴 대체 문장 포함). 저장 값은 그대로 두고 화면에서만 바꾼다(2026-11-03 사용자 지시: 화면에 모델 이름을
// 보이지 않는다, "화면에서만 KEV를 결정 모델로 바꿔"). 괄호 속 검토 신호 코드는 앞에 한국어 설명이 이미 있어 지운다:
// "의견 불일치(MODEL_RULE_DISAGREEMENT)의" → "의견 불일치의", "KEV 필수 리스크(KEV_MANDATORY_RISK)에" → "결정 모델 필수 리스크에".
const FLAG_CODE_IN_PARENS = new RegExp(
  `\\s?\\((?:${Object.keys(REVIEW_FLAG_LABEL).join("|")})\\)`,
  "g",
);
const MODEL_NAME = /\bBosun\b|\bK(?:EV|ev)\b/g;

export const readableModelText = (text: string): string =>
  text.replace(FLAG_CODE_IN_PARENS, "").replace(MODEL_NAME, "결정 모델");

// TEMPLATE 대체 안내. INJECTION_SUSPECTED 는 입력이 의심스러워 모델을 일부러 부르지 않은 경우라 문구를 나누고,
// 같은 입력이면 다시 요청해도 같은 결과라 [다시 요청]을 두지 않는다(보안 리뷰 중-2). 문구는 검토 표시 "문서 지시문 의심"과 맞춘다.
const TEMPLATE_NOTICE = "모델 설명을 쓰지 못해 규칙 결과로 정리했습니다.";
const INJECTION_NOTICE =
  "문서에 지시문으로 의심되는 글이 있어 모델을 부르지 않고 규칙 결과로 정리했습니다.";
const OLD_FORMAT_NOTICE =
  "이전 형식으로 만든 분석이라 점수 요소별 해설, 자격 요건 해설, 참여 전 확인할 것, 사업 기간 인력 가용이 없습니다.";
const EMPTY_ITEMS = "정리할 항목이 없습니다.";

const REF_KIND: Record<InsightRef["kind"], string> = { BID: "공고문", COMPANY: "회사 자료" };
// gateway mock 의 /insight 응답 model 값. worker 가 model_name 에 그대로 저장한다.
// mock 응답이 실제 모델처럼 보이면 안 되므로(ADR-034 15번) 결정 모델 참고 지표와 같은 글자로 바꿔 쓴다.
const MOCK_INSIGHT_MODEL = "mock";

const SECTION_TITLE = "type-label font-semibold text-foreground";
const EMPTY_TEXT = "type-label text-muted-foreground";

/** 팝업 머리·점수 요소·자격 해설이 쓰는 그 run 의 규칙 값. 공고 상세가 이미 가진 분석 값에서 넘긴다. */
export type InsightRunFacts = {
  solScore: number | null;
  recommendation: Recommendation | null;
  /** 필수 자격 미충족으로 권고에 쓰지 않은 점수(상세 화면의 "참고" 표시와 같은 조건). */
  referenceScore: boolean;
  factors: ScoreFactorView[];
  checks: QualificationCheckView[];
};

/** 저장된 출력 형식 버전이 지금 버전과 다르면 옛 형식이다. 서버 중복 판단(isModelDone)과 같은 기준이다(ADR-078). */
export const isOldFormat = (view: InsightView, currentPromptVersion: string): boolean =>
  view.status === "DONE" && view.promptVersion !== currentPromptVersion;

/** 작성 줄. 대체 결과·mock 응답은 그렇다고 앞에 밝힌다. */
export function authorshipText(view: InsightView): string {
  const madeAt = formatKst(view.finishedAt ?? view.createdAt);
  if (view.source === "TEMPLATE") return `규칙 결과로 정리 · ${madeAt} 작성`;
  if (view.modelName === MOCK_INSIGHT_MODEL) return `${MOCK_MODEL_TEXT} · ${madeAt} 작성`;
  return `${madeAt} 작성`;
}

type NoticeAction = { label: string; onClick: () => void };

/** 본문 맨 위 상태 안내 줄. 버튼은 하나까지이고 문장 뒤에서 줄을 바꾼다. strong 은 실패·늦어짐처럼 알아야 할 상태다. */
export function InsightNotice({
  lines,
  code = null,
  action = null,
  strong = false,
}: {
  lines: string[];
  code?: string | null;
  action?: NoticeAction | null;
  strong?: boolean;
}) {
  return (
    <div data-slot="insight-notice" className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-6">
      <div className="flex min-w-0 flex-col gap-1">
        {lines.map((line) => (
          <p
            key={line}
            className={cn("type-label", strong ? "text-foreground" : "text-muted-foreground")}
          >
            {line}
          </p>
        ))}
        {code !== null && (
          <p className="font-mono type-caption text-muted-foreground wrap-anywhere">{code}</p>
        )}
      </div>
      {action !== null && (
        <Button variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/**
 * 끝난 결과 한 건(안내 줄·섹션·작성 줄). onRequest 가 null 이면 요청 버튼을 두지 않는다
 * (읽기 전용 역할, 또는 실패 안내가 이미 [다시 요청]을 가진 이전 결과).
 */
export function InsightResult({
  view,
  payload,
  run,
  currentPromptVersion,
  onRequest,
}: {
  view: InsightView;
  payload: InsightPayload;
  run: InsightRunFacts;
  currentPromptVersion: string;
  onRequest: (() => void) | null;
}) {
  const oldFormat = isOldFormat(view, currentPromptVersion);
  const template = view.source === "TEMPLATE";
  const injection = view.fallbackReason === "INJECTION_SUSPECTED";
  const lines = [
    ...(template ? [injection ? INJECTION_NOTICE : TEMPLATE_NOTICE] : []),
    ...(oldFormat ? [OLD_FORMAT_NOTICE] : []),
  ];
  // 버튼은 하나만 둔다. 옛 형식이면 새 형식으로, 대체 결과면(인젝션 의심 제외) 다시 요청한다.
  const action: NoticeAction | null =
    onRequest === null
      ? null
      : oldFormat
        ? { label: "새 형식으로 다시 분석", onClick: onRequest }
        : template && !injection
          ? { label: "다시 요청", onClick: onRequest }
          : null;
  return (
    <>
      {lines.length > 0 && <InsightNotice lines={lines} action={action} />}
      <div className="divide-y divide-border">
        <Section title="판단 이유">
          <p className="type-body text-foreground">{readableModelText(payload.summary)}</p>
        </Section>
        {!oldFormat && (
          <Section title="점수 요소별 해설">
            <FactorNotes
              notes={payload.factorNotes ?? []}
              factors={run.factors}
              refs={payload.refs}
            />
          </Section>
        )}
        {!oldFormat && (
          <Section title="자격 요건 해설">
            <CheckNotes notes={payload.checkNotes ?? []} checks={run.checks} refs={payload.refs} />
          </Section>
        )}
        <div className="py-6">
          <h3 className={SECTION_TITLE}>강점</h3>
          <div className="mt-3">
            <ItemList items={payload.strengths} refs={payload.refs} />
          </div>
          <h3 className={cn("mt-6", SECTION_TITLE)}>보완할 점</h3>
          <div className="mt-3">
            <ItemList items={payload.improvements} refs={payload.refs} />
          </div>
        </div>
        {!oldFormat && (
          <Section title="참여 전 확인할 것">
            <ItemList items={payload.nextSteps ?? []} refs={payload.refs} />
          </Section>
        )}
        {!oldFormat && (
          <Section title="사업 기간 인력 가용">
            <StaffingLine staffing={payload.staffing ?? null} />
          </Section>
        )}
        <Section title="근거 원문">
          <RefList refs={payload.refs} />
        </Section>
      </div>
      <InsightMeta view={view} />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-6">
      <h3 className={SECTION_TITLE}>{title}</h3>
      <div className="mt-3">{children}</div>
    </div>
  );
}

// 작성 줄. 모델명은 화면에 두지 않는다(2026-11-03 사용자 지시). 대체 결과·mock 응답은 작성 줄이 밝힌다.
function InsightMeta({ view }: { view: InsightView }) {
  return (
    <div className="flex flex-col gap-1 border-t border-border pt-4">
      <p className="type-caption text-muted-foreground">{authorshipText(view)}</p>
    </div>
  );
}

function ItemList({ items, refs }: { items: InsightItem[]; refs: InsightRef[] }) {
  if (items.length === 0) return <p className={EMPTY_TEXT}>{EMPTY_ITEMS}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {items.map((item, index) => (
        <li key={`${index}-${item.text}`} className="flex flex-col gap-1.5">
          <p className="type-body text-foreground">{readableModelText(item.text)}</p>
          <RefChips refIds={item.refIds} refs={refs} />
        </li>
      ))}
    </ul>
  );
}

// 점수 요소별 해설. 요소 순서는 점수표(FACTOR_ORDER)이고, 점수는 그 run 의 요소 값이다. 해설이 남은 요소만 그린다.
function FactorNotes({
  notes,
  factors,
  refs,
}: {
  notes: InsightFactorNote[];
  factors: ScoreFactorView[];
  refs: InsightRef[];
}) {
  const rows = FACTOR_ORDER.flatMap((key) =>
    notes.filter((note) => note.factor === key).map((note) => ({ key, note })),
  );
  if (rows.length === 0) return <p className={EMPTY_TEXT}>{EMPTY_ITEMS}</p>;
  return (
    <ul className="flex flex-col gap-4">
      {rows.map(({ key, note }, index) => (
        <li key={`${key}-${index}`} data-slot="factor-note" className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span
              data-slot="factor-name"
              className="min-w-0 type-label font-semibold text-foreground"
            >
              {FACTOR_LABEL[key]}
            </span>
            <FactorPoints factor={factors.find((factor) => factor.factor === key) ?? null} />
          </div>
          <p className="type-body text-foreground">{readableModelText(note.text)}</p>
          <RefChips refIds={note.refIds} refs={refs} />
        </li>
      ))}
    </ul>
  );
}

// "미확인" 표시는 SOL Score 분해(score-factors.tsx)와 같은 모양이다.
function MissingMark() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border border-border bg-background px-1.5 type-caption text-muted-foreground">
      <CircleHelpIcon aria-hidden="true" className="size-3.5 shrink-0" />
      미확인
    </span>
  );
}

function FactorPoints({ factor }: { factor: ScoreFactorView | null }) {
  if (factor === null) return <MissingMark />;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {factor.missing && <MissingMark />}
      <span className="type-label tabular-nums text-foreground">
        {formatPoints(factor.points)} / {factor.maxPoints}
      </span>
    </span>
  );
}

const FLAGGED: ReadonlySet<QualificationCheckView["outcome"]> = new Set([
  "NOT_SATISFIED",
  "NEEDS_REVIEW",
]);
// gateway 가 받은 자격 이름은 앞 80자다(insight-request.model.ts MAX_LABEL). 해설의 label 도 그 글자다.
const LABEL_LENGTH = 80;
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 자격 해설과 체크리스트 자격의 짝. 요청과 같은 순서(필수 먼저, 이름 순, 같은 이름은 id 순, insight-store.ts)에서
 * 이름(앞 80자)이 같은 첫 미충족·확인 필요 자격이다. 한 run 에 같은 이름이 두 번 나올 수 있다(운영 확인).
 * uuid 의 DB 순서는 소문자 16진 글자 순서와 같다. 짝이 없으면 null 이고 배지·"걸린 것" 없이 그린다.
 */
function pairChecks(
  notes: InsightCheckNote[],
  checks: QualificationCheckView[],
): (QualificationCheckView | null)[] {
  const ordered = checks.toSorted(
    (a, b) =>
      Number(b.mandatory) - Number(a.mandatory) ||
      byName(a.requirementName, b.requirementName) ||
      byName(a.id, b.id),
  );
  return notes.map(
    (note) =>
      ordered.find(
        (check) =>
          FLAGGED.has(check.outcome) && check.requirementName.slice(0, LABEL_LENGTH) === note.label,
      ) ?? null,
  );
}

// 자격 요건 해설. 자격 이름과 판정은 규칙 체크리스트 값이고 해설만 모델이 쓴다.
function CheckNotes({
  notes,
  checks,
  refs,
}: {
  notes: InsightCheckNote[];
  checks: QualificationCheckView[];
  refs: InsightRef[];
}) {
  if (notes.length === 0) {
    const flagged = checks.some((check) => FLAGGED.has(check.outcome));
    return (
      <p className={EMPTY_TEXT}>{flagged ? EMPTY_ITEMS : "미충족·확인 필요 자격이 없습니다."}</p>
    );
  }
  const pairs = pairChecks(notes, checks);
  return (
    <ul className="flex flex-col gap-4">
      {notes.map((note, index) => {
        const pair = pairs[index] ?? null;
        // 자격 목록과 같은 화면 문장(코드·버전 꼬리표를 뺀 이름·사유)을 쓴다.
        const readable = pair === null ? null : readableCheck(pair);
        return (
          <li
            key={`${index}-${note.label}`}
            data-slot="check-note"
            className="flex flex-col gap-1.5"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="min-w-0 type-label font-semibold text-foreground wrap-anywhere">
                {readable?.name ?? note.label}
              </span>
              {pair !== null && (
                <StatusBadge
                  kind="qualification"
                  value={pair.outcome}
                  reasonCode={pair.reasonCode}
                  variant="inline"
                />
              )}
            </div>
            <dl className="flex flex-col gap-1.5">
              {readable !== null && <NoteRow term="걸린 것" detail={readable.reason} />}
              <NoteRow term="확인할 것" detail={readableModelText(note.text)} />
            </dl>
            <RefChips refIds={note.refIds} refs={refs} />
          </li>
        );
      })}
    </ul>
  );
}

// 768px 이상은 두 칸(이름 5rem · 내용), 그 아래 폭은 위아래로 쌓는다.
function NoteRow({ term, detail }: { term: string; detail: string }) {
  return (
    <div className="flex flex-col gap-0.5 md:grid md:grid-cols-[5rem_minmax(0,1fr)] md:items-baseline md:gap-x-3">
      <dt className="type-label text-muted-foreground">{term}</dt>
      <dd className="type-body text-foreground">{detail}</dd>
    </div>
  );
}

// 사업 기간 인력 가용. worker 가 규칙 값(인력 요소 입력)으로 채운 값이고, 회사 자료 "투입 가능 인력" 인용과 같은 숫자다.
// null 은 필요 인력(FTE)을 모르거나 인력 명부가 빈 경우다. 사업 기간은 모르면 규칙이 기본 기간을 쓰므로 null 의 이유가 아니다
// (web/server/scoring/factors.ts staffAvailabilityInput).
function StaffingLine({ staffing }: { staffing: InsightStaffing | null }) {
  if (staffing === null) {
    return (
      <p className={EMPTY_TEXT}>
        필요 인력이나 인력 명부를 알 수 없어 인력 가용을 계산하지 않았습니다.
      </p>
    );
  }
  // 가용 FTE 는 반올림 없는 합이라 0.7+0.7+0.7 이 2.0999999999999996 이 될 수 있다. 표시만 소수 둘째 자리로 줄인다(사전 리뷰 QA S5).
  const availableFte = Number(staffing.availableFte.toFixed(2));
  return (
    <p className="type-body text-foreground">
      사업 기간 {staffing.from}~{staffing.to} · 가용 {availableFte} FTE · 대상 인원{" "}
      {staffing.eligibleStaff}명
    </p>
  );
}

// 근거 원문 전체 목록. 칩과 같은 "{공고문|회사 자료} {id}" 글자로 눈으로 짝을 맞춘다. 늘 펼쳐 둔다.
function RefList({ refs }: { refs: InsightRef[] }) {
  if (refs.length === 0) return <p className={EMPTY_TEXT}>근거 원문이 없습니다.</p>;
  const bidRefs = refs.filter((ref) => ref.kind === "BID");
  const companyRefs = refs.filter((ref) => ref.kind === "COMPANY");
  return (
    <div className="flex flex-col gap-6">
      <RefGroup name="공고문" refs={bidRefs} empty="공고문 인용은 싣지 않았습니다." />
      {companyRefs.length > 0 && <RefGroup name="회사 자료" refs={companyRefs} empty={null} />}
    </div>
  );
}

function RefGroup({
  name,
  refs,
  empty,
}: {
  name: string;
  refs: InsightRef[];
  empty: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-label text-muted-foreground">{name}</p>
      {refs.length === 0 ? (
        <p className={EMPTY_TEXT}>{empty}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {refs.map((ref) => (
            <li key={ref.id} className="flex flex-col gap-1">
              <p className="type-label text-foreground wrap-anywhere">
                {REF_KIND[ref.kind]} {ref.id} · {ref.label}
              </p>
              <Quote text={ref.quotedText} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Quote({ text, label }: { text: string; label?: string }) {
  return (
    <figure className="flex flex-col gap-0.5 border-l-2 border-border pl-3">
      {label !== undefined && (
        <figcaption className="type-caption text-muted-foreground">{label}</figcaption>
      )}
      <blockquote className="type-body text-foreground wrap-anywhere">{text}</blockquote>
    </figure>
  );
}

// 한 항목의 근거 칩. 누르면 그 항목 아래에 인용(근거 이름·인용문)을 펼친다. 하나씩 펼치고 같은 칩을 다시 누르면 접는다.
function RefChips({ refIds, refs }: { refIds: string[]; refs: InsightRef[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const quoteId = useId();
  const cited = refIds.flatMap((refId) => refs.filter((ref) => ref.id === refId));
  if (cited.length === 0) return null;
  const opened = cited.find((ref) => ref.id === openId);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {cited.map((ref) => (
          <Button
            key={ref.id}
            variant="outline"
            size="xs"
            aria-expanded={ref.id === openId}
            aria-controls={quoteId}
            onClick={() => setOpenId((current) => (current === ref.id ? null : ref.id))}
          >
            {REF_KIND[ref.kind]} {ref.id}
          </Button>
        ))}
      </div>
      <div id={quoteId} className="empty:hidden">
        {opened !== undefined && <Quote text={opened.quotedText} label={opened.label} />}
      </div>
    </>
  );
}
