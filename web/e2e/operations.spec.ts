import { type APIResponse, expect, test } from "@playwright/test";

// 운영 기본기: 응답마다 붙는 보안 헤더, 화면 응답의 CSP(nonce), 기본 영어 화면 대신 한국어로 나오는 404.
// 보안 헤더는 next.config.ts 의 headers() 가 모든 경로(페이지·404·정적 파일)에 단다.
// CSP 는 proxy.ts 가 요청마다 nonce 를 새로 만들어 화면 응답에 단다(스펙 polaris/specs/done/team-settings-mail-csp-errors.md 3.5).
// 한 마디 주소(/<이름>)는 조직 주소(/[slug])라 로그인 전에는 "로그인이 필요합니다" 안내를 그린다. 없는 주소는 조직 아래의 없는 화면으로 쓴다.
const NOT_FOUND_PATH = "/acme/route-that-does-not-exist";
const PATHS = ["/", NOT_FOUND_PATH, "/icon.svg"];

PATHS.forEach((path) =>
  test(`${path} 응답에 보안 헤더가 붙고 X-Powered-By 는 없다`, async ({ request }) => {
    const response = await request.get(path);
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    ["camera", "microphone", "geolocation"].forEach((feature) =>
      expect(headers["permissions-policy"]).toContain(`${feature}=()`),
    );
    expect(headers["x-powered-by"]).toBeUndefined();
  }),
);

// ── CSP ──
// 화면 응답(랜딩·계정 화면·404, api 로 시작하는 조직 주소)마다 본다. /apiary 는 proxy 의 matcher 가 /api 만 빼는지 지킨다.
const CSP_PATHS = ["/", "/auth/login", NOT_FOUND_PATH, "/apiary"];
// 운영 정책이 반드시 담는 지시어(스펙 3.5). script-src 는 따로 본다.
const REQUIRED_DIRECTIVES = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];
const NONCE_SOURCE = /'nonce-([A-Za-z0-9+/_-]+={0,2})'/;
const SCRIPT_TAG = /<script\b[^>]*>/gi;
const NONCE_ATTRIBUTE = /\snonce="([^"]*)"/;

const cspOf = (response: APIResponse): string => {
  const policy = response.headers()["content-security-policy"];
  if (!policy) throw new Error(`${response.url()} 응답에 Content-Security-Policy 가 없다`);
  return policy;
};

// "script-src 'self' 'nonce-…'" → ["'self'", "'nonce-…'"]
const sourcesOf = (policy: string, directive: string): string[] => {
  const found = policy
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive);
  if (!found) throw new Error(`CSP 에 ${directive} 가 없다: ${policy}`);
  return found.slice(1);
};

const nonceOf = (policy: string): string => {
  const match = NONCE_SOURCE.exec(sourcesOf(policy, "script-src").join(" "));
  if (!match) throw new Error(`script-src 에 nonce 가 없다: ${policy}`);
  return match[1];
};

// 응답 본문의 script 태그마다 nonce 속성 값(없으면 null). 브라우저 DOM 은 nonce 를 숨겨(getAttribute 가 "") 본문에서 읽는다.
const scriptNoncesOf = (html: string): (string | null)[] =>
  (html.match(SCRIPT_TAG) ?? []).map((tag) => NONCE_ATTRIBUTE.exec(tag)?.[1] ?? null);

CSP_PATHS.forEach((path) =>
  test(`${path} 화면 응답의 CSP 는 nonce·'strict-dynamic'·필수 지시어를 담고, 본문의 script 는 모두 그 nonce 를 단다`, async ({
    request,
  }) => {
    const response = await request.get(path);
    const policy = cspOf(response);

    const scriptSources = sourcesOf(policy, "script-src");
    expect(scriptSources).toEqual(expect.arrayContaining(["'self'", "'strict-dynamic'"]));
    // 운영 빌드(next start)에는 eval·인라인 허용이 없다. 'unsafe-eval' 은 개발 모드만 더한다.
    expect(scriptSources).not.toContain("'unsafe-eval'");
    expect(scriptSources).not.toContain("'unsafe-inline'");
    REQUIRED_DIRECTIVES.forEach((directive) => expect(policy).toContain(directive));

    const nonce = nonceOf(policy);
    const scriptNonces = scriptNoncesOf(await response.text());
    // 화면은 Next 의 스크립트를 싣는다. 하나도 없으면 아래 비교가 헛돈다.
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(scriptNonces).toEqual(scriptNonces.map(() => nonce));
  }),
);

test("같은 화면을 두 번 요청하면 CSP 의 nonce 가 다르다", async ({ request }) => {
  const first = nonceOf(cspOf(await request.get("/")));
  const second = nonceOf(cspOf(await request.get("/")));

  expect(first).not.toBe(second);
});

test("요청에 CSP·nonce 헤더를 실어 보내도 응답과 script 의 nonce 는 서버가 새로 만든 값이다", async ({
  request,
}) => {
  const forged = "ZXZpbA==";
  const response = await request.get("/", {
    headers: { "content-security-policy": `script-src 'nonce-${forged}'`, "x-nonce": forged },
  });
  const nonce = nonceOf(cspOf(response));
  const html = await response.text();

  expect(nonce).not.toBe(forged);
  expect(scriptNoncesOf(html)).toEqual(scriptNoncesOf(html).map(() => nonce));
  expect(html).not.toContain("ZXZpbA");
});

// 브라우저가 정책에 막힌 스크립트·스타일·연결을 콘솔에 남기는 문장.
// 모든 위반이 콘솔에 남지는 않는다 — 잡힌 eval 시도(라이브러리의 eval 가능 여부 확인)는 콘솔에 아무것도 없이
// DevTools 의 Issues 에만 뜬다. 그래서 위반마다 오는 securitypolicyviolation 이벤트를 콘솔 문장으로 옮겨 함께 센다.
const CSP_VIOLATION = /Content Security Policy|Refused to|securitypolicyviolation/;

test("랜딩을 열고 가입 화면으로 옮겨 가는 동안 CSP 위반(콘솔 문장·securitypolicyviolation 이벤트)이 없다", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (CSP_VIOLATION.test(message.text())) violations.push(message.text());
  });
  // 페이지의 스크립트보다 먼저 돈다(브라우저 도구로 넣어 CSP 에 막히지 않는다).
  await page.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(
        `securitypolicyviolation: ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}`,
      ),
    ),
  );

  await page.goto("/");
  const start = page
    .getByRole("region", { name: /수많은 공고 속/ })
    .getByRole("link", { name: "시작하기", exact: true });
  await expect(start).toBeVisible();
  // 화면 옮기기는 스크립트(클라이언트 이동)와 RSC 요청(connect-src)을 함께 거친다.
  await start.click();
  await expect(page).toHaveURL(/\/auth\/sign-up$/);
  // DB 설정이 없는 빌드는 가입 폼 대신 연결 안내를 그린다.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    /^(회원가입|DB 가 연결되지 않았습니다)$/,
  );

  expect(violations).toEqual([]);
});

test("없는 주소는 한국어 404 화면과 첫 화면으로 가는 링크를 보여 준다", async ({ page }) => {
  const response = await page.goto(NOT_FOUND_PATH);

  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("페이지를 찾을 수 없습니다");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("페이지를 찾을 수 없습니다");
  await expect(page.getByRole("link", { name: "처음 화면으로" })).toHaveAttribute("href", "/");
  await expect(page.getByText("could not be found")).toHaveCount(0);
});
