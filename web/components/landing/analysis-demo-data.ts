import { DEMO_BIDS, type DemoBid } from "@/components/landing/demo-bids";

// 공고 분석 예시(analysis-demo.tsx)의 자동 재생 흐름. 업무 데모처럼 상태는 단계 번호 하나다.
// 가짜 커서가 목록의 다음 공고를 누르면 분석이 그 공고로 바뀌고, 제목 → 기관·예산·마감 → 자격 항목 하나씩 →
// 점수 → 시스템 권고 순서로 채워진다. 둘째 → 셋째 → 첫째 공고 순서로 돌고 한 바퀴는 약 24초다.
// 한 단계는 3초를 넘지 않는다.

/** 고른 공고에서 지금 보이는 만큼. checks 는 보이는 자격 항목 수다. */
export type Shown = { facts: boolean; checks: number; score: boolean; verdict: boolean };

/** 다 보인다. 첫 화면·직접 조작·움직임 줄이기와 권고까지 채워진 단계. */
export const SHOWN_ALL: Shown = {
  facts: true,
  checks: Number.POSITIVE_INFINITY,
  score: true,
  verdict: true,
};

export type AnalysisStep = {
  /** "<공고 id>:<단계 이름>" (예: demo-2:hover). 공고 id 는 이 단계가 채우는 공고다. */
  id: string;
  /** 이 단계에서 고른 공고(목록 선택과 가운데·오른쪽 단). */
  bid: DemoBid["id"];
  ms: number;
  /** 가짜 커서가 올라가 있는 목록 줄(공고 id). 없으면 쉼 자리에 있다. */
  pointing?: DemoBid["id"];
  press?: boolean;
  shown: Shown;
};

/** 커서가 비켜 서는 자리(판 기준 px). 왼쪽 목록 단의 세 공고 아래 빈 곳이라 글자를 가리지 않는다. */
export const CURSOR_REST = { x: 128, y: 560 };

const HIDDEN: Shown = { facts: false, checks: 0, score: false, verdict: false };

// from 의 완성 화면에서 to 를 눌러, to 의 분석이 다 채워질 때까지.
const moveTo = (from: DemoBid, to: DemoBid): AnalysisStep[] => [
  { id: `${to.id}:hover`, bid: from.id, ms: 900, pointing: to.id, shown: SHOWN_ALL },
  { id: `${to.id}:press`, bid: from.id, ms: 300, pointing: to.id, press: true, shown: SHOWN_ALL },
  { id: `${to.id}:title`, bid: to.id, ms: 500, shown: HIDDEN },
  { id: `${to.id}:facts`, bid: to.id, ms: 700, shown: { ...HIDDEN, facts: true } },
  // 개수 줄과 추가 확인 줄은 마지막 항목과 함께 나온다.
  ...to.checks.map((_, index): AnalysisStep => ({
    id: `${to.id}:check-${index + 1}`,
    bid: to.id,
    ms: 550,
    shown: { ...HIDDEN, facts: true, checks: index + 1 },
  })),
  {
    id: `${to.id}:score`,
    bid: to.id,
    ms: 1500,
    shown: { facts: true, checks: to.checks.length, score: true, verdict: false },
  },
  { id: `${to.id}:verdict`, bid: to.id, ms: 2400, shown: SHOWN_ALL },
];

const nextOf = (index: number): DemoBid => DEMO_BIDS[(index + 1) % DEMO_BIDS.length];

// 첫째 → 둘째, 둘째 → 셋째, 셋째 → 첫째. 마지막 단계(첫째 공고 완성 화면에 머묾)를 0번으로 올려,
// 처음 그린 화면(첫째 공고 완성)이 곧 0번 단계가 되고 2.4초 머문 뒤 둘째로 간다.
const MOVES = DEMO_BIDS.flatMap((bid, index) => moveTo(bid, nextOf(index)));

export const STEPS: readonly AnalysisStep[] = [MOVES[MOVES.length - 1], ...MOVES.slice(0, -1)];
