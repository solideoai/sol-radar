import { BIDS_DESCRIPTION } from "@/app/(app)/(work)/bids/bids-copy";

// /watchlist 문구(N3 디자인 §6). page·loading·error 가 같은 제목과 설명을 쓴다(읽는 동안과 읽은 뒤 제목 줄이 튀지 않게).
// "use client" 파일에 두면 서버 부품(page·loading)이 받을 때 값이 아니라 클라이언트 참조가 되어 여기 따로 둔다.

export const WATCHLIST_PATH = "/watchlist";

// T1 (정본 06 §4.1, 스펙 §5)
export const WATCHLIST_TITLE = "관심 공고";
// T2: 첫 문장이 /bids 와 다른 점을 말하고, 같은 SOL Score 열이 보이므로 면책 두 문장은 그대로 둔다(D8).
export const WATCHLIST_DESCRIPTION = `내가 관심 표시한 공고만 보입니다. ${BIDS_DESCRIPTION}`;
// T4 (표 이름, 낭독 전용)
export const WATCHLIST_CAPTION = "관심 공고 목록";

// T8 · E1 관심 0건
export const WATCHLIST_EMPTY_TITLE = "아직 관심 공고가 없습니다";
export const WATCHLIST_EMPTY_DESCRIPTION =
  "입찰 공고 목록에서 별을 누르면 여기에 모입니다. 관심 표시는 나만 볼 수 있습니다.";
export const WATCHLIST_EMPTY_ACTION = "입찰 공고 보기";

// T9 · E2 조건 0건은 /bids 문구 그대로다. 빈 상태는 BidListView 의 기본을 basePath(/watchlist)로 쓴다.

// T10 · E3 기본 조건 0건(관심은 있는데 진행 중이 아니다)
export const WATCHLIST_INACTIVE_TITLE = "진행 중인 관심 공고가 없습니다";
export const watchlistInactiveDescription = (count: number): string =>
  `관심 공고 ${count}건이 기본 검색 조건에 포함되지 않습니다.`;
export const WATCHLIST_INACTIVE_ACTION = "관심 공고 모두 보기";
// 마감·취소 포함(상태 네 값) + 출처 전체. 필터 막대가 "마감·취소 포함"·"전체"로 읽는다.
export const WATCHLIST_ALL_HREF = `${WATCHLIST_PATH}?status=OPEN&status=AMENDED&status=CANCELLED&status=CLOSED&origin=all&includeEarly=true&stage=PLAN&stage=PROCUREMENT_REQUEST&stage=PRE_SPEC&stage=NOTICE&stage=OPENING&stage=AWARD&stage=CONTRACT`;

// T14 (로딩 낭독)
export const WATCHLIST_LOADING = "관심 공고를 불러오는 중…";

// T16 (상태 필터 선택지, D10)
export const WATCHLIST_STATUS_WITH_CLOSED = "마감·취소 포함";
