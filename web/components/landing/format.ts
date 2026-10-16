// 금액은 억·만 단위로 줄여 읽기 쉽게 한다. 날짜는 예시 데이터라 시간대 변환이 필요 없는 YYYY-MM-DD 만 받는다.
export function formatWon(won: number): string {
  const eok = Math.floor(won / 100_000_000);
  const man = Math.floor((won % 100_000_000) / 10_000);
  const parts = [
    eok > 0 ? `${eok}억` : null,
    man > 0 ? `${man.toLocaleString("ko-KR")}만` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? `${parts.join(" ")} 원` : `${won.toLocaleString("ko-KR")}원`;
}

export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year}. ${month}. ${day}.`;
}
