import type { CalendarEventKind, CalendarView } from "@/server/calendar";

// /calendar 문구. page·loading·error 가 같은 제목과 설명을 쓴다(읽는 동안과 읽은 뒤 제목 줄이 튀지 않게).
// "use client" 파일에 두면 서버 부품(page·loading)이 받을 때 값이 아니라 클라이언트 참조가 되어 여기 따로 둔다.

export const CALENDAR_PATH = "/calendar";
export const CALENDAR_TITLE = "입찰 일정";
export const CALENDAR_DESCRIPTION =
  "관심 공고·입찰 프로젝트·IT 공고의 마감과 원본 일정을 한국 시각(KST) 달력으로 모아 봅니다.";
export const CALENDAR_CAPTION = "월간 입찰 일정";
export const CALENDAR_LOADING = "입찰 일정을 불러오는 중…";

export const VIEW_ORDER: readonly CalendarView[] = ["org", "mine"];
export const VIEW_LABELS = { org: "조직 전체", mine: "내 일정" } as const;
export const VIEW_HINTS = {
  org: "내 관심 공고, 조직의 진행 중인 입찰 프로젝트, IT 공고",
  mine: "내 관심 공고와 내가 담당인 입찰 프로젝트",
} as const;
// 일정의 출처. IT 공고(ADR-069 IT 범위)는 조직 전체 보기에만 실린다.
export const SOURCE_NOTES = {
  org: "나라장터 입찰공고 원본의 일정 · IT 공고 중 마감 전·최근 14일 마감 공고 · 변경 공고는 수집 주기마다 반영",
  mine: "나라장터 입찰공고 원본의 일정 · 변경 공고는 수집 주기마다 반영",
} as const;
// IT 공고 읽기가 실패하면 관심·프로젝트 일정만 그리고 출처 줄 아래에 한 줄로 알린다.
export const RELEVANT_LOAD_FAILED =
  "IT 공고 일정을 불러오지 못했습니다. 관심·프로젝트 일정만 보입니다.";

// 칩 메뉴·다가오는 목록·접근 이름은 전체 이름, 종류 거르기 칩은 짧은 이름(전체 이름은 title 로 보인다).
export const KIND_LABELS: Record<CalendarEventKind, string> = {
  SUBMISSION_DUE: "제출 마감",
  BID_DEADLINE: "공고 마감",
  BID_BEGIN: "입찰서 제출 시작",
  QUALIFICATION_DUE: "입찰참가자격 등록 마감",
  JOINT_AGREEMENT_DUE: "공동수급협정서 마감",
  SITE_BRIEFING: "현장설명회",
  OPENING: "개찰",
};
export const KIND_SHORT_LABELS: Record<CalendarEventKind, string> = {
  SUBMISSION_DUE: "제출 마감",
  BID_DEADLINE: "공고 마감",
  BID_BEGIN: "제출 시작",
  QUALIFICATION_DUE: "자격 등록 마감",
  JOINT_AGREEMENT_DUE: "협정서 마감",
  SITE_BRIEFING: "현장설명회",
  OPENING: "개찰",
};
// 거르기 칩 순서. 서버 CALENDAR_EVENT_KINDS(server/calendar/calendar.model.ts)와 같은 순서다.
// 화면 부품은 서버 모듈을 값으로 부르지 않아(브라우저 시험이 그대로 그린다) 여기 따로 둔다. 바꿀 때 둘 다 고친다.
export const KIND_ORDER: readonly CalendarEventKind[] = [
  "SUBMISSION_DUE",
  "BID_DEADLINE",
  "BID_BEGIN",
  "QUALIFICATION_DUE",
  "JOINT_AGREEMENT_DUE",
  "SITE_BRIEFING",
  "OPENING",
];
export const KIND_FILTER_LABEL = "일정 종류";
export const KIND_FILTER_ALL = "전체 보기";
export const KIND_FILTER_EMPTY = "이 달에는 고른 종류의 일정이 없습니다.";
// 거르기 칩의 켜짐·꺼짐을 화면 읽기에 글자로 알린다(칩 접근 이름 뒤에 붙는다).
export const KIND_SHOWN = "보는 중";
export const KIND_HIDDEN = "숨김";
export const LEGEND_LABEL = "표시 설명";

export const UPCOMING_TITLE = "다가오는 14일";
export const UPCOMING_EMPTY = "다가오는 14일 안에 일정이 없습니다.";
// 다가오는 목록은 처음 몇 건만 펼쳐 두고 나머지는 접는다(펼친 목록이 달력 높이와 비슷하게).
export const UPCOMING_VISIBLE = 8;
// 그리는 총 건수 상한(처음 + 펼침). 관련 공고가 많은 달은 수백 건이 HTML·RSC 에 실려 무거워진다. 넘는 건수는 글자로만 알린다.
export const UPCOMING_MAX = 40;
export const upcomingMore = (count: number) => `나머지 ${count}건 더 보기`;
export const upcomingOverflow = (count: number) =>
  `그 밖에 ${count}건은 일정 종류를 거르거나 달력에서 봅니다.`;
// 칸의 "+n건 더" 메뉴가 그리는 항목 상한. 메뉴 항목은 열기 전부터 RSC 에 실려 하루 이만큼만 그린다.
export const MORE_MENU_MAX = 15;
export const moreMenuOverflow = (count: number) =>
  `그 밖에 ${count}건 · 일정 종류를 거르면 줄어듭니다`;
export const MONTH_EMPTY = "이 달에는 일정이 없습니다.";
export const NO_EVENTS_HINT =
  "입찰 공고에서 별을 눌러 관심 표시하거나 입찰 프로젝트를 열면 일정이 여기에 모입니다.";
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
