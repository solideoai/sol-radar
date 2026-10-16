import type { Page } from "@playwright/test";

// 브라우저가 Supabase(인증·데이터 API)에 보낸 요청을 모은다. 여는 것만으로 요청하면 안 되는 화면을 시험할 때 쓴다.
const SUPABASE_REQUEST =
  /supabase\.(co|in)|\/auth\/v1\/|\/rest\/v1\/|\/realtime\/v1\/|\/storage\/v1\//;

export const watchSupabase = (page: Page) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (SUPABASE_REQUEST.test(request.url())) requests.push(request.url());
  });
  return requests;
};
