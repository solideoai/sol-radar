import "server-only";

// ── Content-Security-Policy ──
// proxy.ts 가 요청마다 새 nonce 로 이 정책을 만들어 요청(Next 가 nonce 를 꺼내 자기 스크립트에 붙인다)과 응답에 싣는다.
// 근거: web/node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md. 설명은 docs/boilerplate/AUTH-SECURITY.md 의 "CSP".
// 바깥 출처를 더할 때는 여기 한 곳만 고친다. 운영 빌드를 브라우저로 열어 콘솔의 CSP 위반이 0건인지 본다.

// 가입 화면의 주소 검색(카카오 우편번호, web/app/auth/sign-up/address-search.tsx).
// 스크립트는 우리 스크립트가 만들어 넣으므로 'strict-dynamic' 이 연다. 출처는 'strict-dynamic' 을 모르는 옛 브라우저용이다.
const POSTCODE_SCRIPT_ORIGIN = "https://t1.kakaocdn.net";
// 그 스크립트가 대화상자 안에 넣는 검색 창(iframe)의 출처. 스크립트가 화면의 scheme 을 따라 http·https 를 고르므로
// scheme 을 적지 않는다 — https 화면(운영)에서는 https 만, http 화면(로컬의 next start·next dev)에서는 둘 다 맞는다.
const POSTCODE_FRAME_HOST = "postcode.map.kakao.com";

// 간편 로그인 제공자가 주는 프로필 사진(profiles.avatar_url — DB 제약이 https 만 받는다).
// 구글 lh3.googleusercontent.com, 카카오 k.kakaocdn.net·img1.kakaocdn.net, 네이버 phinf.pstatic.net·ssl.pstatic.net.
// 이메일 가입은 가입 정보(user_metadata)에 아무 https 주소나 넣을 수 있어서, 목록 밖의 사진은 막고 이름 첫 글자를 그린다.
const AVATAR_ORIGINS = [
  "https://*.googleusercontent.com",
  "https://*.kakaocdn.net",
  "https://*.pstatic.net",
] as const;

export type ContentSecurityPolicyOptions = {
  /** 요청마다 새로 만든 값. 이 값을 가진 스크립트만 실행된다. */
  nonce: string;
  /** next dev 인지. React 가 개발 모드에서만 eval 로 서버 오류의 호출 스택을 다시 만든다. */
  isDevelopment: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL. 브라우저가 로그인·데이터 요청을 직접 보내는 곳이다. 없거나 주소가 아니면 열지 않는다. */
  supabaseUrl?: string | null;
};

// 주소에서 출처(scheme://host:port)만 남긴다. 경로·끝의 / 가 붙어 있어도 같은 값이 된다.
function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { origin, protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? origin : null;
  } catch {
    return null;
  }
}

/** 응답 헤더 Content-Security-Policy 의 값. 같은 입력이면 같은 문자열이다. */
export function buildContentSecurityPolicy({
  nonce,
  isDevelopment,
  supabaseUrl,
}: ContentSecurityPolicyOptions): string {
  const supabaseOrigin = originOf(supabaseUrl);
  const directives: [string, ...string[]][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      POSTCODE_SCRIPT_ORIGIN,
      ...(isDevelopment ? ["'unsafe-eval'"] : []),
    ],
    // 'unsafe-inline' 이 필요하다(nonce 를 함께 적으면 브라우저가 'unsafe-inline' 을 무시하므로 nonce 는 적지 않는다).
    // - 알림(sonner)이 처음 불릴 때 nonce 없는 <style> 을 head 에 넣는다. 막으면 알림이 모양 없이 그려진다.
    // - 서버가 그린 HTML 의 style="…" 속성(사이드바 폭 변수·막대그래프 높이 등)은 nonce 로 열 수 없다.
    // 스타일은 스크립트를 실행하지 못한다. 스크립트는 nonce 로만 연다.
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "blob:", "data:", ...AVATAR_ORIGINS],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])],
    ["frame-src", POSTCODE_FRAME_HOST],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    // 다른 사이트가 이 화면을 iframe 에 넣지 못한다(next.config.ts 의 X-Frame-Options: DENY 와 같은 일, CSP 를 모르는 브라우저는 그쪽을 따른다).
    ["frame-ancestors", "'none'"],
  ];
  return directives.map((sources) => sources.join(" ")).join("; ");
}
