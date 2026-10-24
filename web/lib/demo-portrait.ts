const approvedPersonId = /^SOL-P(?:00(?:0[1-9]|[1-9]\d)|01\d\d|0200)$/;

export function demoPortraitPath(personId: string | null | undefined): string | null {
  return typeof personId === "string" && personId.length === 9 && approvedPersonId.test(personId)
    ? `/demo/people/${personId}.png`
    : null;
}

// 로컬 Supabase(supabase start)는 http 로 서명 주소를 준다. 그 밖의 http 주소는 그리지 않는다.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * 화면이 그려도 되는 사진 주소인가.
 * - 정장 사진 경로(/demo/people/…)는 그 사람의 것일 때만.
 * - 그 밖에는 https 절대 주소(올린 사진의 signed URL·제공자 사진)와 로컬 Supabase 의 http 주소만.
 * 실제로 불러올지는 CSP img-src 가 한 번 더 거른다.
 */
export function isDisplayablePortrait(url: string, personId: string | null | undefined): boolean {
  if (url.startsWith("/demo/people/")) return url === demoPortraitPath(personId);
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname))
    );
  } catch {
    return false;
  }
}
