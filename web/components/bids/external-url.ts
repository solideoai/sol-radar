// 원문 링크(공고 sourceUrl)를 <a href> 로 그려도 되는지의 판정 하나. 상세 머리·근거 서랍·첨부 상태가 함께 쓴다.
// 수집한 값이라 믿지 않는다. http·https 절대 주소만 링크로 그리고, javascript:·data: 같은 다른 스킴과 상대 주소는 글자로만 보인다.
export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
