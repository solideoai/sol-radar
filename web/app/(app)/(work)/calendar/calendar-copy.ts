import type { CalendarView } from "@/server/calendar";

// /calendar 문구. page·loading·error 가 같은 제목과 설명을 쓴다(읽는 동안과 읽은 뒤 제목 줄이 튀지 않게).
// "use client" 파일에 두면 서버 부품(page·loading)이 받을 때 값이 아니라 클라이언트 참조가 되어 여기 따로 둔다.

export const CALENDAR_PATH = "/calendar";
export const CALENDAR_TITLE = "입찰 일정";
export const CALENDAR_DESCRIPTION =
  "내 관심 공고와 조직 입찰 프로젝트의 마감을 한국 시각(KST) 달력으로 모아 봅니다.";
export const CALENDAR_CAPTION = "월간 입찰 일정";
export const CALENDAR_LOADING = "입찰 일정을 불러오는 중…";

export const VIEW_ORDER: readonly CalendarView[] = ["org", "mine"];
export const VIEW_LABELS = { org: "조직 전체", mine: "내 일정" } as const;
export const VIEW_HINTS = {
  org: "내 관심 공고와 조직의 진행 중인 입찰 프로젝트",
  mine: "내 관심 공고와 내가 담당인 입찰 프로젝트",
} as const;

export const KIND_LABELS = { SUBMISSION_DUE: "제출 마감", BID_DEADLINE: "공고 마감" } as const;

export const UPCOMING_TITLE = "다가오는 14일";
export const UPCOMING_EMPTY = "다가오는 14일 안에 마감이 없습니다.";
export const MONTH_EMPTY = "이 달에는 일정이 없습니다.";
export const NO_EVENTS_HINT =
  "입찰 공고에서 별을 눌러 관심 표시하거나 입찰 프로젝트를 열면 마감이 여기에 모입니다.";
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
