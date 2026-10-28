import Link from "next/link";
import { STAGE_LABEL } from "@/components/bids/labels";
import { StatusBadge } from "@/components/bids/status-badge";
import { Chip } from "@/components/ui/chip";
import type { StageLinkCandidateItem, StageLinkItem, StageLinksView } from "@/server/bids";

// 상세 단계 이력 아래 "같은 사업의 다른 단계 공고"(P0-8, 디자인 스펙 docs/plans/2026-10-21-p08-stage-links-ui-spec.md).
// 식별자로 이은 공고는 연결 묶음, 제목만 비슷한 공고는 접힌 후보 묶음으로 낸다. 후보는 자동으로 잇지 않았다는 뜻을 글자로 밝힌다.
// 데이터를 읽지 않고 상태도 없다(훅 없음). 펼침은 네이티브 <details> 가 맡는다. 유사도 값은 받지도 그리지도 않는다.
// 문구 상수를 여기 두는 이유: labels.ts 는 S5 가 고치는 파일이라 병합 충돌을 피한다(스펙 U5).

export const STAGE_LINK_BASIS_LABEL = {
  PLAN_REF: "발주계획 번호로 연결",
  PRE_SPEC_REF: "사전규격 번호로 연결",
} as const satisfies Record<StageLinkItem["basis"], string>;

export const STAGE_LINKS_COPY = {
  linkedTitle: "연결된 공고",
  candidatesTitle: "연결 후보",
  candidatesNote: "이 공고와 제목이 비슷합니다. 자동으로 잇지 않았습니다.",
  loadFailed: "다른 단계 공고를 불러오지 못했습니다",
  noticeIdPrefix: "공고번호",
} as const;

const LINKED_TITLE_ID = "stage-links-linked-title";
const CANDIDATES_NOTE_ID = "stage-links-candidates-note";

// 상세 eyebrow 의 단계 칩과 같은 Chip(sm)이다(2026-10-28 화면 개편). mt-px 는 제목 첫 줄(22px)에 20px 칩을 맞춘다.
const STAGE_CHIP_LAYOUT = "mt-px shrink-0 whitespace-nowrap";
const TITLE_LINK =
  "rounded-sm font-medium text-foreground underline decoration-muted-foreground underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50";

type StageLinkRowProps =
  { kind: "linked"; item: StageLinkItem } | { kind: "candidate"; item: StageLinkCandidateItem };

// 빈 글자 기관은 보조 줄에서 토막째 뺀다(보조 줄이라 "—" 로 빈 칸을 알릴 까닭이 없다).
const agencyOf = (agency: string | null): string | null =>
  agency !== null && agency.trim() !== "" ? agency : null;

function StageLinkRow(props: StageLinkRowProps) {
  const { kind, item } = props;
  const base = `stage-link-${kind}-${item.bidId}`;
  const agency = agencyOf(item.agency);
  const describedBy = [`${base}-stage`, `${base}-meta`]
    .concat(kind === "candidate" ? [CANDIDATES_NOTE_ID] : [])
    .join(" ");
  return (
    <li
      data-slot="stage-link-item"
      data-kind={kind}
      data-bid-id={item.bidId}
      data-stage={item.stage}
      data-basis={props.kind === "linked" ? props.item.basis : undefined}
      className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5 px-4 py-3"
    >
      <Chip id={`${base}-stage`} size="sm" className={STAGE_CHIP_LAYOUT}>
        {STAGE_LABEL[item.stage]}
      </Chip>
      {/* 감싸개가 눈금을 갖고 링크는 인라인이라 밑줄·초점이 글자 줄을 따른다. 링크 이름은 보이는 제목 그대로다. */}
      <div className="min-w-0 type-body wrap-anywhere">
        <Link href={`/bids/${item.bidId}`} aria-describedby={describedBy} className={TITLE_LINK}>
          {item.title}
        </Link>
      </div>
      <p
        id={`${base}-meta`}
        className="col-start-2 type-caption text-muted-foreground wrap-anywhere"
      >
        {props.kind === "linked" && props.item.status === "CANCELLED" && (
          <>
            <StatusBadge kind="bidStatus" value="CANCELLED" variant="inline" />
            {" · "}
          </>
        )}
        {STAGE_LINKS_COPY.noticeIdPrefix} <span className="font-mono">{item.noticeId}</span>
        {agency !== null && ` · ${agency}`}
        {props.kind === "linked" && ` · ${STAGE_LINK_BASIS_LABEL[props.item.basis]}`}
      </p>
    </li>
  );
}

function LinkedGroup({ linked }: { linked: StageLinkItem[] }) {
  return (
    <div data-slot="stage-links-linked" className="flex min-w-0 flex-col gap-2">
      <h3 id={LINKED_TITLE_ID} className="type-label font-semibold text-foreground">
        {STAGE_LINKS_COPY.linkedTitle}{" "}
        <span className="font-normal text-muted-foreground">{linked.length}건</span>
      </h3>
      <ul
        aria-labelledby={LINKED_TITLE_ID}
        className="divide-y divide-border rounded-lg border border-border"
      >
        {linked.map((item) => (
          <StageLinkRow key={item.bidId} kind="linked" item={item} />
        ))}
      </ul>
    </div>
  );
}

// 처음엔 접혀 있다(스펙 U2). 펼친 채면 FX-01 1440×900 첫 화면에서 셋째 필수자격 행이 잘린다.
// 점선은 확인되지 않은 후보임을 거든다. 뜻은 요약 줄의 안내 글자가 진다.
function CandidatesGroup({ candidates }: { candidates: StageLinkCandidateItem[] }) {
  return (
    <details data-slot="stage-links-candidates" className="group/candidates min-w-0">
      {/* 기본 펼침 표시(▶)를 숨기고 ▾ 하나만 둔다. 펼치면 뒤집는다(분석 이력과 같은 모양). */}
      <summary className="flex w-fit max-w-full cursor-pointer list-none flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
        <span className="type-label font-semibold text-foreground">
          {STAGE_LINKS_COPY.candidatesTitle}{" "}
          <span className="font-normal text-muted-foreground">{candidates.length}건</span>{" "}
          <span aria-hidden="true" className="inline-block group-open/candidates:rotate-180">
            ▾
          </span>
        </span>
        <span id={CANDIDATES_NOTE_ID} className="type-caption text-muted-foreground">
          {STAGE_LINKS_COPY.candidatesNote}
        </span>
      </summary>
      <ul
        aria-label={STAGE_LINKS_COPY.candidatesTitle}
        className="mt-2 divide-y divide-dashed divide-border rounded-lg border border-dashed border-border"
      >
        {candidates.map((item) => (
          <StageLinkRow key={item.bidId} kind="candidate" item={item} />
        ))}
      </ul>
    </details>
  );
}

type StageLinksProps = {
  /** null 은 읽기 실패다. 서버가 정렬·최대 건수를 지켜 주므로 받은 순서 그대로 그린다. */
  stageLinks: StageLinksView | null;
};

function StageLinks({ stageLinks }: StageLinksProps) {
  // 읽지 못해도 상세의 나머지는 그린다. 다시 읽는 길은 새로 고침이라 버튼·알림 영역을 두지 않는다.
  if (stageLinks === null) {
    return (
      <p
        data-slot="stage-links-error"
        className="mt-1 basis-full type-caption text-muted-foreground"
      >
        {STAGE_LINKS_COPY.loadFailed}
      </p>
    );
  }
  const { linked, candidates } = stageLinks;
  if (linked.length === 0 && candidates.length === 0) return null;
  return (
    <div data-slot="stage-links" className="mt-1 flex min-w-0 basis-full flex-col gap-4">
      {linked.length > 0 && <LinkedGroup linked={linked} />}
      {candidates.length > 0 && <CandidatesGroup candidates={candidates} />}
    </div>
  );
}

export { StageLinks };
export type { StageLinksProps };
