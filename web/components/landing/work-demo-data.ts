import { DATA_SOURCES } from "@/components/landing/showcase-data";

// 랜딩 업무 데모(work-demo.tsx)의 흐름과 숫자. 공고·숫자는 지어낸 것이고, 출처 이름과 로고만 실제다.
// 화면은 상태 하나(단계 번호)로 움직인다. 단계마다 머무는 시간과, 가짜 커서가 가리키거나 누르는 곳을 적는다.

export type DemoScene = 1 | 2 | 3 | 4 | 5;

/** 커서가 가리키는 곳. 화면 안 요소의 data-demo-target 값이다. */
export type CursorTarget = "agent-confirm" | "collect-next" | "bid-row" | "watch-add" | "replay";

/** 장면이 바뀔 때 커서가 비켜 서는 자리(판 기준 px). 화면 글자를 가리지 않는 오른쪽 아래 여백이다. */
export const CURSOR_REST = { x: 930, y: 548 };

type DemoStep = {
  id: string;
  scene: DemoScene;
  ms: number;
  /** "rest" 는 CURSOR_REST 로 비켜 선다. 없으면 그 자리에 둔다. */
  cursor?: CursorTarget | "rest";
  press?: boolean;
};

// 한 바퀴 약 25초(2026-10-28 사용자 요청으로 처음 31초보다 1.25배 빠르게, 장면 안 움직임 시간도 같이 줄였다).
// 한 단계는 3초를 넘지 않는다(멈춤 시험이 한 단계보다 길게 기다린다).
const STEP_LIST = [
  // 1. 대시보드: 수집 에이전트 카드의 [확인]을 누른다.
  { id: "dashboard", scene: 1, ms: 1120 },
  { id: "agentHover", scene: 1, ms: 880, cursor: "agent-confirm" },
  { id: "agentPress", scene: 1, ms: 360, cursor: "agent-confirm", press: true },
  // 2. 수집: 출처마다 받는 중 → 숫자가 오르고 ✓. 입력 커서 뒤에 고른 결과를 말한다.
  { id: "collectRows", scene: 2, ms: 2400, cursor: "rest" },
  { id: "collectCaret", scene: 2, ms: 720 },
  { id: "collectMessage", scene: 2, ms: 1520 },
  { id: "collectHover", scene: 2, ms: 880, cursor: "collect-next" },
  { id: "collectPress", scene: 2, ms: 360, cursor: "collect-next", press: true },
  // 3. 관련 공고 표: 행이 한 줄씩 나오고, 자격 확인이 필요한 공고를 적는다. 한 행을 연다.
  { id: "tableRows", scene: 3, ms: 2080, cursor: "rest" },
  { id: "tableReview", scene: 3, ms: 1120 },
  { id: "rowHover", scene: 3, ms: 880, cursor: "bid-row" },
  { id: "rowPress", scene: 3, ms: 360, cursor: "bid-row", press: true },
  // 4. 분석 상세: 필수 자격을 하나씩 판정하고, 다섯 요소 점수가 자라고, 공고문 인용을 짚는다.
  { id: "detailChecks", scene: 4, ms: 1920, cursor: "rest" },
  { id: "detailScore", scene: 4, ms: 1760 },
  { id: "detailQuote", scene: 4, ms: 1040 },
  { id: "detailBubble", scene: 4, ms: 1200 },
  { id: "watchHover", scene: 4, ms: 880, cursor: "watch-add" },
  { id: "watchPress", scene: 4, ms: 360, cursor: "watch-add", press: true },
  // 5. 마무리: 관심 공고에 담기고 마감 알림이 잡힌다. [다시보기] 뒤 처음으로.
  { id: "watchlist", scene: 5, ms: 1360, cursor: "rest" },
  { id: "reminder", scene: 5, ms: 1200 },
  { id: "replay", scene: 5, ms: 1920, cursor: "replay" },
  { id: "replayPress", scene: 5, ms: 360, cursor: "replay", press: true },
] as const satisfies readonly DemoStep[];

export type StepId = (typeof STEP_LIST)[number]["id"];

export const STEPS: readonly DemoStep[] = STEP_LIST;

/** 단계 이름 → 번호. 화면은 "이 단계부터 보인다"를 step >= STEP.이름 으로 정한다. */
export const STEP = Object.fromEntries(STEP_LIST.map((step, index) => [step.id, index])) as Record<
  StepId,
  number
>;

/** 움직임 줄이기의 정지 화면: 분석 상세가 다 그려지고 말풍선까지 나온 상태(커서 없음). */
export const STATIC_STEP = STEP.detailBubble;

// 데모 속 "오늘". 마감 D-day 와 알림 날짜를 이 날 기준으로 센다(발표일).
const DEMO_TODAY = "2026-11-04";

const dayNumber = (isoDate: string): number => {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

export const dDayOf = (isoDate: string): number => dayNumber(isoDate) - dayNumber(DEMO_TODAY);

/** 마감 며칠 전 알림의 날짜("11월 17일"). */
export const reminderDateOf = (isoDate: string, daysBefore: number): string => {
  const date = new Date((dayNumber(isoDate) - daysBefore) * 86_400_000);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
};

/** 표의 예산은 억 단위 한 자리로 줄인다(14.5억). */
export const formatEok = (won: number): string =>
  `${(won / 100_000_000).toFixed(1).replace(/\.0$/, "")}억`;

// 수집 행의 로고는 120×28 칸 안에 둔다. 로고마다 글자·여백의 비율이 달라 넓이 계산으로는 무게가 맞지 않아,
// 다섯 행을 나란히 놓고 눈으로 맞춘 높이(px)를 함께 적는다.
const logoOf = (name: string, displayHeight: number) => {
  const source = DATA_SOURCES.find((candidate) => candidate.name === name);
  if (source === undefined) throw new Error(`출처 로고 없음: ${name}`);
  return { ...source.logo, displayHeight };
};

// 오늘 06:00 수집에서 출처마다 가져온 새 공고 수(지어낸 숫자). 합계가 대시보드의 "새 공고"다.
export const COLLECTED = [
  { name: "나라장터", kind: "입찰공고", count: 96, logo: logoOf("나라장터(조달청)", 24) },
  { name: "LH", kind: "입찰공고", count: 9, logo: logoOf("한국토지주택공사", 30) },
  { name: "K-water", kind: "입찰공고", count: 7, logo: logoOf("한국수자원공사", 27) },
  { name: "한국전력공사", kind: "입찰공고", count: 11, logo: logoOf("한국전력공사", 15) },
  { name: "기업마당", kind: "지원사업", count: 5, logo: logoOf("기업마당", 27) },
] as const;

export const COLLECTED_TOTAL = COLLECTED.reduce((total, source) => total + source.count, 0);
