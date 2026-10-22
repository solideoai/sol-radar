// ★ 토글 문구(N3 디자인 §6 T5·T11~T13). 표 행·상세 머리가 같이 쓴다.
// 이름은 상태와 상관없이 하나로 고정하고 상태는 aria-pressed 로 알린다(WAI-ARIA APG 토글 버튼, 디자인 §11-1).
export const WATCH_TOGGLE_LABEL = "관심 공고";

// 실패 토스트는 방향마다 한 문장이다. 오류 코드·요청 id 는 싣지 않는다(D12).
export const WATCH_ADD_FAILED = "관심 공고에 추가하지 못했습니다. 잠시 뒤 다시 시도하세요.";
export const WATCH_REMOVE_FAILED = "관심 공고에서 빼지 못했습니다. 잠시 뒤 다시 시도하세요.";

// 상세 머리의 "관심 N명"(T11). 0명이면 글자를 비운다(D6) — 대부분 공고가 0명이라 모든 상세에 같은 소음이 된다.
export const watcherCountLabel = (count: number): string => (count === 0 ? "" : `관심 ${count}명`);
