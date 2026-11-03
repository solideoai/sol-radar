// 카카오톡 안에서 열린 창(인앱 브라우저)은 휴대폰의 Safari·Chrome 과 로그인 쿠키를 나누지 않는다.
// 그래서 카톡 [분석 보기]로 열면 브라우저에서 이미 로그인했어도 로그인이 없는 것으로 보인다.
// 아이폰·안드로이드 카카오톡 모두 user agent 에 KAKAOTALK 을 싣는다.
const KAKAOTALK_USER_AGENT = /\bKAKAOTALK\b/i;

export function isKakaoInAppBrowser(userAgent: string | null): boolean {
  return userAgent !== null && KAKAOTALK_USER_AGENT.test(userAgent);
}

// 카카오톡이 받아 기본 브라우저(아이폰 Safari, 안드로이드 Chrome 등)로 주소를 넘기는 스킴이다.
// 카카오 공식 문서가 아니라 널리 쓰이는 방법이라, 안 열릴 때를 위해 화면에 다른 길을 함께 둔다(open-in-browser 화면).
export function kakaoOpenExternalUrl(targetUrl: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(targetUrl)}`;
}
