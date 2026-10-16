import type { NextConfig } from "next";

// 모든 응답(페이지·404·정적 파일)에 다는 보안 헤더. e2e/operations.spec.ts 가 응답에서 확인한다.
// CSP(Content-Security-Policy)는 여기 두지 않는다. nonce 가 요청마다 달라야 해서 proxy.ts 가 화면 응답에 단다
// (정책은 server/csp, 근거는 web/node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
const securityHeaders = [
  // 응답의 Content-Type 을 그대로 믿게 한다. 브라우저가 내용을 보고 스크립트로 추측해 실행하지 않는다.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // 다른 사이트로 나갈 때 경로·검색어는 빼고 출처만 보낸다.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 다른 사이트가 이 화면을 iframe 에 넣어 클릭을 가로채지 못한다. CSP 의 frame-ancestors 'none' 과 같은 일이고,
  // CSP 를 모르는 브라우저와 proxy 가 거치지 않는 응답(정적 파일·/api)을 위해 남긴다.
  { key: "X-Frame-Options", value: "DENY" },
  // 쓰지 않는 브라우저 기능은 끈다. 필요해지면 그 기능만 연다(예: camera=(self)).
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  turbopack: { root: __dirname },
  // X-Powered-By: Next.js 를 빼서 쓰는 프레임워크를 알리지 않는다.
  poweredByHeader: false,
  // 16.3 부터 next dev 는 에이전트를 감지하면 web/AGENTS.md·web/CLAUDE.md 를 만든다. 지침의 정본은 루트 AGENTS.md
  // 하나라서 끈다. 루트 AGENTS.md 가 web/node_modules/next/dist/docs/ 를 읽으라고 같은 안내를 한다.
  agentRules: false,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  // 계정 화면은 /auth 아래로 옮겼다(/auth/login·sign-up·reset·password). 옛 주소는 이미 보낸 메일 링크(클라우드에 붙여 둔 템플릿의
  // next=/account·/account/password)와 북마크가 쓰므로 영구 이동으로 넘긴다. 검색어(?link=…)는 그대로 따라간다.
  redirects: async () => [
    // 브라우저·도구가 /favicon.ico 를 직접 요청한다. 아이콘은 app/icon.svg 하나뿐이라 거기로 보낸다(없으면 조직 주소 /[slug] 로 처리된다).
    { source: "/favicon.ico", destination: "/icon.svg", permanent: true },
    { source: "/account", destination: "/auth/login", permanent: true },
    {
      source: "/account/:page(sign-up|reset|password)",
      destination: "/auth/:page",
      permanent: true,
    },
  ],
};

export default nextConfig;
