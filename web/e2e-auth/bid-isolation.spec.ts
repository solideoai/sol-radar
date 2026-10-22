import { expect, test } from "@playwright/test";
import { z } from "zod";
import {
  ISOLATION_EVIDENCE_PATH,
  assertNoAxe,
  readWorkContext,
  localAdmin,
  shot,
  storageOf,
  widthOf,
  writeEvidenceJson,
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
  // 증거에는 받은 본문 글자를 그대로 남긴다(파싱해 다시 쓴 값이 아니다).
  const rawBody = await api.text();
  expect(JSON.parse(rawBody)).toMatchObject({
    error: { code: "NOT_FOUND", details: { resource: "analysis" } },
  });

  const detailUrl = `/api/v1/bids/${bids["FX-01"]}`;
  const detail = await page.request.get(detailUrl);
  expect(detail.status()).toBe(200);
  const detailBody = z
    .object({
      latestAnalysis: z.unknown(),
      latestReview: z.unknown(),
      reviews: z.array(z.unknown()),
    })
    .parse(await detail.json());
  expect(detailBody.latestAnalysis).toBeNull();
  expect(detailBody.latestReview).toBeNull();
  expect(detailBody.reviews).toEqual([]);

  // 새로운 읽기 경계는 기능 폭(1440)에서 한 번만 검증한다.
  if (width === 1440) {
    const history = await page.request.get("/api/v1/analyses");
    expect(history.status()).toBe(200);
    expect(await history.json()).toMatchObject({ items: [] });
    const { orgs } = readWorkContext();
    const privateRuns = z
      .array(z.object({ id: z.uuid() }))
      .parse(
        await localAdmin().call(
          "GET",
          `/rest/v1/score_runs?select=id&org_id=eq.${orgs.org01}&limit=1`,
        ),
      );
    expect(privateRuns).toHaveLength(1);
    expect((await page.request.get(`/api/v1/analyses/${privateRuns[0].id}`)).status()).toBe(404);
    const simulation = await page.request.get(
      `/api/v1/workforce/simulation?bidIds=${bids["FX-01"]}`,
    );
    expect(simulation.status()).toBe(200);
    expect(await simulation.json()).toMatchObject({
      bids: [{ analysisId: null, availableFte: null, candidates: [] }],
      overloads: [],
      sharedCandidates: [],
    });
  }

  // 두 폭이 같은 응답을 낸다. 1440 실행이 증거 파일을 쓴다.
  if (width === 1440)
    await writeEvidenceJson(ISOLATION_EVIDENCE_PATH, {
      scenario: "S7 / G5 — org-02 VIEWER 가 org-01 분석이 있는 FX-01 의 자격 API 를 부른다",
      account: "viewer@other.invalid (org-02, VIEWER)",
      capturedAt: new Date().toISOString(),
      request: { method: "GET", path: url, auth: "Supabase 세션 쿠키(브라우저 컨텍스트)" },
      response: {
        status: api.status(),
        contentType: api.headers()["content-type"] ?? null,
        xRequestId: api.headers()["x-request-id"] ?? null,
        rawBody,
      },
      // 같은 계정의 상세 응답에서 조직 소유 칸을 받은 그대로 옮긴다.
      sameAccountDetail: {
        path: detailUrl,
        status: detail.status(),
        latestAnalysis: detailBody.latestAnalysis,
        latestReview: detailBody.latestReview,
        reviews: detailBody.reviews,
      },
    });
});
