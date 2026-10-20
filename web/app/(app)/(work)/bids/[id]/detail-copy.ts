// page·loading·error·not-found 가 같이 쓰는 값. 읽는 동안·오류·정상 화면의 단 폭과 제목 자리가 튀지 않게 한다.
// "use client" 파일에 두면 서버 부품(loading·not-found)이 받을 때 값이 아니라 클라이언트 참조가 되어 여기 따로 둔다.

// 스펙 §3.1: 표가 넓은 화면은 단 폭을 06 §4 "Content max 1440" 으로 넓힌다.
export const DETAIL_CONTENT_CLASS = "max-w-360";

// 공고 제목을 아직 모르거나 읽지 못했을 때의 화면 제목.
export const DETAIL_TITLE = "공고 상세";

// 스펙 §3.5 없음(404).
export const NOT_FOUND_TITLE = "공고를 찾을 수 없습니다";
export const NOT_FOUND_DESCRIPTION = "주소가 맞는지 확인하세요.";
