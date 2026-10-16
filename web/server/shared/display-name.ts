// 사용자 메뉴·멤버 목록·작업·활동 기록이 같은 이름 규칙을 쓴다.
export const nameOf = (displayName: string | null, email: string | null): string =>
  displayName ?? email?.split("@")[0] ?? "이름 없음";
