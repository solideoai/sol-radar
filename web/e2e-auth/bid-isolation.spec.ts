import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  ISOLATION_EVIDENCE_PATH,
  assertNoAxe,
  readWorkContext,
  shot,
  storageOf,
  widthOf,
} from "./support/work-fixtures";

// G5(11 §3)·S7(19): 공고는 공용이라 org-02 VIEWER 도 FX-01 상세를 200 으로 보지만, org-01 의 분석·자격·결정은 보이지 않는다.
// 자격 API 는 이 조직에 분석이 없으니 404 다(ADR-029 A6 D18). 그 응답을 06 §12 S7 증거로 남긴다.
test.use({ storageState: storageOf("outsider") });

test("G5 org-02 VIEWER 는 FX-01 상세를 200 으로 보되 분석 없음이고 자격 API 는 404 다", async ({
  page,
}) => {
  const width = widthOf(page);
  const { bids } = readWorkContext();
  const response = await page.goto(`/bids/${bids["FX-01"]}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("세종특별자치시");
  await expect(page.getByText("아직 분석하지 않았습니다", { exact: true })).toBeVisible();
  const main = await page.locator("main#main-content").innerText();
  expect(main).not.toMatch(/(^|\D)94(\D|$)/);
  await shot(page, "bid-detail-org02", "loaded", width);
  await assertNoAxe(page, "bid-detail-org02-loaded");

  const url = `/api/v1/bids/${bids["FX-01"]}/qualification-checks`;
  const api = await page.request.get(url);
  expect(api.status()).toBe(404);
  const body: unknown = await api.json();
  expect(body).toMatchObject({ error: { code: "NOT_FOUND" } });

  const detail = await page.request.get(`/api/v1/bids/${bids["FX-01"]}`);
  expect(detail.status()).toBe(200);
  expect(await detail.json()).toMatchObject({ latestAnalysis: null });

  // 두 폭이 같은 응답을 낸다. 1440 실행이 증거 파일을 쓴다.
  if (width === 1440) {
    mkdirSync(path.dirname(ISOLATION_EVIDENCE_PATH), { recursive: true });
    writeFileSync(
      ISOLATION_EVIDENCE_PATH,
      `${JSON.stringify(
        {
          scenario: "S7 / G5 — org-02 VIEWER 가 org-01 분석이 있는 FX-01 의 자격 API 를 부른다",
          account: "viewer@other.invalid (org-02, VIEWER)",
          capturedAt: new Date().toISOString(),
          request: { method: "GET", path: url, auth: "Supabase 세션 쿠키(브라우저 컨텍스트)" },
          response: {
            status: api.status(),
            xRequestId: api.headers()["x-request-id"] ?? null,
            body,
          },
          sameAccountDetail: {
            path: `/api/v1/bids/${bids["FX-01"]}`,
            status: detail.status(),
            latestAnalysis: null,
          },
        },
        null,
        2,
      )}\n`,
    );
  }
});
