// 자격 갭 레이더(/gaps) 화면 글자(디자인 스펙 docs/plans/2026-10-28-gaps-ui-spec.md §6.2, 초안).
// 서버 계약의 고정 문구·라벨(GAPS_*_NOTICE·GAP_*_LABELS)은 여기 다시 적지 않는다. page 가 배럴에서 읽어 넘긴다.
// 서버 컴포넌트·클라이언트 부품·loading·error 가 같이 쓴다. 서버 모듈을 부르지 않는다.

export const GAPS_TITLE = "자격 갭 레이더";
export const GAPS_DESCRIPTION =
  "마감 전 실공고의 면허제한·참가가능지역을 회사 프로필과 대조해, 어떤 자격이 몇 건의 공고를 막는지 봅니다.";
/** 화면 단 폭. 읽는 중(loading)·오류·정상 화면의 제목 자리가 같게 셋이 같은 값을 쓴다. */
export const GAPS_CONTENT_CLASS = "max-w-360";
