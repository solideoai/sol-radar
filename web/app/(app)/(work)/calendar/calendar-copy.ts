import type { CalendarEventKind, CalendarView } from "@/server/calendar";
import type { GoogleConnectOutcome } from "@/server/google-calendar";

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
// 일정별 링크(OAuth 없음): 일정 하나를 사용자의 구글 캘린더 "일정 만들기" 화면에 채워 연다. 연동 여부와 상관없이 쓴다.
export const GOOGLE_ADD = "구글 캘린더에 추가";

// ── 구글 캘린더 연동(ADR-073). 띠 문구는 스펙(polaris/specs 2026-10-30-google-calendar-sync) "상태" 표 그대로다(끝에 마침표만 붙였다) ──
// 툴바 버튼 셋: 연결 전 [구글 캘린더 연동] → 연결 뒤 [구글 캘린더에 넣기] → 만료면 [다시 연결].
export const GOOGLE_CONNECT = "구글 캘린더 연동";
export const GOOGLE_CONNECT_HINT = "구글 계정을 연결하고 이 달 일정을 보조 캘린더에 넣습니다";
export const GOOGLE_SYNC = "구글 캘린더에 넣기";
export const GOOGLE_SYNC_HINT =
  "지금 보는 달·보기·종류의 일정을 구글 보조 캘린더 'SOL RADAR 입찰 일정'에 넣습니다. 조직 전체 보기에서는 고른 종류 가운데 없어진 일정을 지웁니다.";
export const GOOGLE_RECONNECT = "다시 연결";
export const GOOGLE_SYNCING = "구글 캘린더에 넣는 중…";
export const GOOGLE_OPEN = "구글 캘린더 열기";
export const GOOGLE_CALENDAR_HOME = "https://calendar.google.com/calendar/";
export const googleSynced = (counts: { created: number; updated: number; deleted: number }) =>
  `구글 캘린더에 넣었습니다: 새로 ${counts.created}건 · 갱신 ${counts.updated}건 · 삭제 ${counts.deleted}건`;
// 그 달 일정이 0건이면 넣은 것이 없다. 이전에 넣은 일정을 지웠으면 건수를 붙인다.
export const googleSyncedEmpty = (deleted: number) =>
  deleted > 0
    ? `이 달에는 넣을 일정이 없습니다. 이전에 넣은 일정 ${deleted}건을 지웠습니다.`
    : "이 달에는 넣을 일정이 없습니다.";
// 밀어넣기 실패. 오류 코드(05 API)마다 하나다. 서버 message 대신 이 글자를 쓴다(화면 문구를 한곳에 둔다).
export const GOOGLE_SYNC_ERRORS = {
  expired: "구글 연결이 만료됐습니다. 다시 연결하세요.",
  notConnected: "구글 계정이 연결되어 있지 않습니다. 먼저 연결하세요.",
  upstream: "구글 캘린더 오류로 일부를 넣지 못했습니다. 다시 눌러 주세요.",
  relevant: "IT 공고 일정을 불러오지 못해 넣지 않았습니다. 새로 고친 뒤 다시 시도하세요.",
  notReady: "구글 캘린더 연동이 아직 준비되지 않았습니다. 잠시 뒤 다시 시도하세요.",
  signedOut: "로그인이 끝났습니다. 다시 로그인한 뒤 시도하세요.",
  tooMany: "한 번에 넣을 수 있는 일정은 500건까지입니다. 일정 종류를 줄여 주세요.",
  unknown: "구글 캘린더에 넣지 못했습니다. 잠시 뒤 다시 시도하세요.",
} as const;
// 구글 연결에서 돌아온 결과(?google=). account_mismatch 는 세션을 끊어 로그인 화면이 같은 글자를 보인다.
// state_mismatch·failed 는 스펙 표 밖의 결과(연결 요청 만료·서버 설정·구글 오류)다. 설정 화면의 구글 칸도 이 글자를 쓴다.
export const GOOGLE_CONNECT_NOTICES: Record<GoogleConnectOutcome, string> = {
  connected: "구글 캘린더를 연결했습니다. [구글 캘린더에 넣기]로 이 달 일정을 넣으세요.",
  consent_denied: "구글 캘린더 권한을 허용하지 않아 연결하지 않았습니다.",
  account_mismatch: "다른 계정으로 로그인되어 연결을 취소했습니다. 다시 로그인하세요.",
  no_refresh_token:
    "구글이 갱신 토큰을 주지 않았습니다. 구글 계정 보안 설정에서 SOL RADAR 접근을 지우고 다시 연결하세요.",
  state_mismatch: "연결 요청이 만료되었거나 올바르지 않습니다. 다시 연결하세요.",
  failed: "구글 캘린더를 연결하지 못했습니다. 잠시 뒤 다시 시도하세요.",
};
export const MONTH_EMPTY = "이 달에는 일정이 없습니다.";
export const NO_EVENTS_HINT =
  "입찰 공고에서 별을 눌러 관심 표시하거나 입찰 프로젝트를 열면 일정이 여기에 모입니다.";
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
