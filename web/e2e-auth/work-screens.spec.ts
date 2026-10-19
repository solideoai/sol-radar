import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  assertNoAxe,
  choose,
  fontSizeOf,
  horizontalOverflow,
  analysisBand,
  decisionRail,
  kevDistribution,
  kevSection,
  qualificationSection,
  readWorkContext,
  rowOf,
  shot,
  storageOf,
  tableRows,
  topbar,
  widthOf,
} from "./support/work-fixtures";

// C6 네 화면의 상태·값·글자·넘침과 06 §12 스크린샷(읽기만 한다). 값의 정본은 11 #6~#9·19 S2·S3, ADR-030 B25·B26, Ruling 9.
// 알림 읽음·결정 기록처럼 데이터를 바꾸는 확인은 *.write.spec.ts 에 있다.
test.use({ storageState: storageOf("sales") });

// 상세 단언에 쓰는 GET /api/v1/bids/{id} 의 일부(05 §4.4). 화면 글자를 API 값과 맞춰 본다.
const detailSchema = z.object({
  sourceUrl: z.string(),
  latestAnalysis: z.object({
    qualification: z.object({
      checks: z.array(
        z.object({
          requirementName: z.string(),
          outcome: z.literal("SATISFIED"),
          evidence: z.array(z.object({ quotedText: z.string().min(1) })),
        }),
      ),
    }),
  }),
});

const sidebarMenuFont = (page: Page) =>
  fontSizeOf(
    page
      .getByRole("navigation", { name: "주요 메뉴", exact: true })
      .getByRole("link", { name: "입찰 공고" }),
  );

test.describe("S2 /dashboard", () => {
  test("카드·BID 표 값이 19 S2 와 같고 표 두 개는 위아래로 쌓이며 +3px 눈금이다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const { bids } = readWorkContext();
    await page.goto("/dashboard");
    const h1 = page.getByRole("heading", { level: 1, name: "대시보드", exact: true });
    await expect(h1).toBeVisible();

    const summary = page.locator('section[aria-labelledby="dashboard-summary-title"]');
    const card = (label: string) =>
      summary.locator('[data-slot="card"]').filter({ has: page.getByText(label, { exact: true }) });
    await expect(card("BID 권고").locator(".type-title")).toHaveText("3");
    await expect(card("분석 현황").locator(".type-title")).toHaveText("18");
    await expect(card("분석 현황")).toContainText("부분 0 · 실패 0");
    await expect(card("수집")).toContainText("적재 19 · 격리 1");

    const bidTable = page.getByRole("table", { name: "BID 권고 (점수 높은 순)" });
    const rows = await tableRows(bidTable);
    expect(rows.slice(0, 3)).toEqual([
      { id: bids["FX-01"], score: "94" },
      { id: bids["FX-18"], score: "82" },
      { id: bids["FX-06"], score: "78" },
    ]);

    // Ruling 9: 두 표는 위아래로 쌓인다(나란히가 아니다).
    const [bidBox, deadlineBox] = await Promise.all([
      bidTable.boundingBox(),
      page.getByRole("table", { name: "마감 임박 (7일)" }).boundingBox(),
    ]);
    expect(bidBox && deadlineBox && deadlineBox.y >= bidBox.y + bidBox.height).toBe(true);
    expect(bidBox && deadlineBox && Math.abs(deadlineBox.x - bidBox.x) < 1).toBe(true);

    // ADR-030 B25·B26: 대시보드 본문 +3px(h1 33·본문 17), 사이드바 메뉴 16.
    expect(await fontSizeOf(h1)).toBe("33px");
    expect(
      await fontSizeOf(
        page.locator("main#main-content > div > div").first().locator("p.type-body"),
      ),
    ).toBe("17px");
    expect(await sidebarMenuFont(page)).toBe("16px");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await shot(page, "dashboard", "loaded", width);
    await assertNoAxe(page, "dashboard-loaded");
  });
});

test.describe("S3 /bids", () => {
  test("목록 정상 상태·글자·넘침과 스크린샷", async ({ page }) => {
    const width = widthOf(page);
    await page.goto("/bids");
    const h1 = page.getByRole("heading", { level: 1, name: "입찰 공고", exact: true });
    await expect(h1).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /^공고 \d+건 표시$/ })).toHaveText(
      "공고 19건 표시",
    );
    expect(await fontSizeOf(h1)).toBe("30px");
    expect(await sidebarMenuFont(page)).toBe("16px");
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "bids-list", "loaded", width);
    await assertNoAxe(page, "bids-list-loaded");
  });

  test("S3 1·2·4·5번: 권고 BID + 점수 높은 순 → FX-01 상단, 결정 NO-BID → FX-03 규칙 우선", async ({
    page,
  }) => {
    const { bids } = readWorkContext();
    await page.goto("/bids");
    const table = page.getByRole("table", { name: "입찰 공고 목록" });
    // 1번: 권고 BID + 점수 높은 순(단계 필터가 아니다, ADR-031 C3).
    await choose(page, "권고", "BID");
    await expect(page).toHaveURL(/[?&]recommendation=BID(&|$)/);
    await choose(page, "정렬", "점수 높은 순");
    await expect(page).toHaveURL(/[?&]sort=score%3Adesc(&|$)/);
    await expect(table.locator("tbody tr")).toHaveCount(3);
    expect(await tableRows(table)).toEqual([
      { id: bids["FX-01"], score: "94" },
      { id: bids["FX-18"], score: "82" },
      { id: bids["FX-06"], score: "78" },
    ]);
    const fx01Row = rowOf(page, table, bids["FX-01"]);
    // 목록 예산 칸은 줄인 표기다(19 표의 "12억").
    await expect(fx01Row).toContainText("12억");

    // 2번: FX-01 상단. 상세 예산은 전체 금액 표기다(스펙 §5.4.1, 12억 = 1,200,000,000원).
    // D-21 은 demo:reset 이 서울 오늘 기준 +21일 18:00 으로 마감을 놓아서 고정이다.
    // globalSetup(seed)과 이 시험 사이에 서울 자정을 넘기면 하루 밀린다.
    await fx01Row.getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/bids/${bids["FX-01"]}\\?list=`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText("세종특별자치시");
    const summary = page.locator("main#main-content h1 + p");
    await expect(summary).toContainText("발주기관 세종특별자치시");
    await expect(summary).toContainText("예산 1,200,000,000원");
    await expect(summary).toContainText("(D-21)");
    await expect(summary).toContainText("revision 1");
    await expect(page.getByRole("heading", { level: 2, name: "단계 이력" })).toBeVisible();
    await expect(page.getByRole("link", { name: "원문 보기 (새 탭)" })).toBeVisible();
    await expect(analysisBand(page).getByText("완료", { exact: true })).toBeVisible();

    // 4번: 목록으로 돌아가 권고 필터를 풀고 결정 NO-BID.
    await page.goBack();
    await page.getByRole("button", { name: "필터 초기화" }).click();
    await expect(page).toHaveURL(/\/bids$/);
    await expect(table.locator("tbody tr")).toHaveCount(19);
    await choose(page, "결정", "NO-BID");
    await expect(page).toHaveURL(/[?&]decision=NO_BID(&|$)/);
    await expect
      .poll(async () => (await tableRows(table)).map((row) => row.id))
      .toContain(bids["FX-03"]);

    // 5번: FX-03 은 필수자격 미충족 1건(사유·근거 문장)이라 권고 NO-BID, Kev 는 BID 0.55 로 달라 규칙 우선이다.
    await rowOf(page, table, bids["FX-03"]).getByRole("link").first().click();
    await expect(page).toHaveURL(new RegExp(`/bids/${bids["FX-03"]}`));
    const qualification = qualificationSection(page);
    await expect(qualification.getByRole("heading", { level: 2 })).toContainText("미충족 1");
    const unmet = qualification
      .locator("ul > li")
      .filter({ has: page.getByText("미충족", { exact: true }) });
    await expect(unmet).toHaveCount(1);
    await expect(unmet).toContainText("정보통신공사업");
    await expect(unmet.locator("p").first()).not.toBeEmpty();
    await expect(unmet.getByRole("button", { name: /^근거 \S.* · ".+"$/ }).first()).toBeVisible();
    const rail = decisionRail(page);
    await expect(rail).toContainText(/권고\s*NO-BID/);
    await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuetext",
      "68점 / 100점 (참고)",
    );
    await expect(rail).toContainText("MODEL_RULE_DISAGREEMENT");
    expect(await kevDistribution(page)).toEqual({ BID: 55, WATCH: 30, "NO-BID": 15 });
    const kev = kevSection(page);
    await expect(kev.getByText("규칙 우선(Kev 의견 상이)", { exact: true })).toBeVisible();
    await expect(kev).toContainText("규칙 판정이 우선합니다");
  });

  test("필터 결과 0건이면 빈 상태와 필터 초기화를 보인다", async ({ page }) => {
    const width = widthOf(page);
    await page.goto("/bids");
    const search = page.getByRole("searchbox", { name: "공고 검색" });
    await search.fill("존재하지않는공고zz");
    await search.press("Enter");
    await expect(page).toHaveURL(/[?&]q=/);
    await expect(page.getByText("조건에 맞는 공고가 없습니다", { exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: /건 표시$/ })).toHaveText(
      "공고 0건 표시",
    );
    await expect(page.locator("main").getByRole("button", { name: "필터 초기화" })).toHaveCount(2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "bids-list", "empty", width);
    await assertNoAxe(page, "bids-list-empty");
  });

  test("잘못된 공고 주소는 공고를 찾을 수 없습니다와 공고 목록으로를 보인다", async ({ page }) => {
    await page.goto("/bids/not-a-uuid");
    await expect(page.getByText("공고를 찾을 수 없습니다").first()).toBeVisible();
    const back = page.getByRole("link", { name: "공고 목록으로" });
    await expect(back).toBeVisible();
    await back.click();
    await expect(page).toHaveURL(/\/bids$/);
  });
});

test.describe("S4 /bids/[id] FX-01", () => {
  test("상세 정상 상태·넘침·스크린샷, 결정 레일은 sticky, 첨부 내려받기 링크는 없다", async ({
    page,
  }) => {
    const width = widthOf(page);
    const { bids } = readWorkContext();
    await page.goto(`/bids/${bids["FX-01"]}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("세종특별자치시");
    const rail = decisionRail(page);
    await expect(rail.getByRole("meter", { name: "SOL Score", exact: true })).toHaveAttribute(
      "aria-valuenow",
      "94",
    );
    await expect(page.getByRole("heading", { level: 2, name: "SOL Score 분해" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "bid-detail", "loaded", width);
    await assertNoAxe(page, "bid-detail-loaded");

    const detail = detailSchema.parse(
      await (await page.request.get(`/api/v1/bids/${bids["FX-01"]}`)).json(),
    );
    const checks = detail.latestAnalysis.qualification.checks;
    expect(checks).toHaveLength(3);

    // S3 3번: 자격 3건 모두 충족, 행마다 근거 버튼 1개 이상(위치 + 인용 앞부분, E1).
    const qualification = qualificationSection(page);
    await expect(qualification.getByRole("heading", { level: 2 })).toContainText("3건 · 모두 충족");
    const rows = qualification.locator("ul > li");
    await expect(rows).toHaveCount(3);
    for (const [index, check] of checks.entries()) {
      const row = rows.nth(index);
      await expect(row).toContainText(check.requirementName);
      await expect(row.getByText("충족", { exact: true })).toBeVisible();
      const buttons = row.getByRole("button", { name: /^근거 / });
      expect(await buttons.count()).toBeGreaterThanOrEqual(1);
      for (const text of await buttons.allInnerTexts()) expect(text).toMatch(/^근거 \S.* · ".+"$/);
      expect(check.evidence.length).toBeGreaterThanOrEqual(1);
      await expect(buttons.first()).toContainText(check.evidence[0].quotedText.slice(0, 10));
    }

    // 근거 열기 → 서랍에 인용 → Esc 로 닫히고 초점이 버튼으로 돌아온다.
    const opener = rows
      .first()
      .getByRole("button", { name: /^근거 / })
      .first();
    await opener.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(checks[0].requirementName);
    await expect(drawer.locator("blockquote").first()).toHaveText(checks[0].evidence[0].quotedText);
    await shot(page, "bid-detail", "evidence-open", width);
    await assertNoAxe(page, "bid-detail-evidence-open");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(opener).toBeFocused();

    // 첨부는 상태만 보인다. 내려받기 링크(MinIO·presigned·download 속성)를 그리지 않는다(09).
    const { sourceUrl } = detail;
    const attachments = page.locator('section[aria-labelledby="attachment-status-title"]');
    await expect(attachments).toBeVisible();
    const attachmentHrefs = await attachments
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(attachmentHrefs.every((href) => href === sourceUrl)).toBe(true);
    const pageHrefs = await page
      .locator("a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(
      pageHrefs.filter((href) => /download|minio|presign|X-Amz|:9000|:19100/i.test(href)),
    ).toEqual([]);
    expect(await page.locator("a[download]").count()).toBe(0);

    // 결정 레일은 sticky(top-18 = 72px)다. 본문을 내려도 레일 위 끝이 Topbar 아래에 붙어 있다.
    const railBox = page.locator('[data-slot="bid-detail-rail"]');
    expect(await railBox.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
    const topBefore = await railBox.evaluate((element) => element.getBoundingClientRect().top);
    await page.mouse.move(400, 500);
    await page.mouse.wheel(0, 1200);
    await expect
      .poll(() => railBox.evaluate((element) => element.getBoundingClientRect().top))
      .toBeCloseTo(72, 0);
    const scrolled = await page.evaluate(() => {
      const main = document.querySelector('[data-slot="bid-detail-main"]');
      return main ? main.getBoundingClientRect().top : 0;
    });
    expect(scrolled).toBeLessThan(topBefore - 200);
  });
});

test.describe("/notifications", () => {
  test("알림 정상 상태: 2건, 바깥 링크는 앱 안 공고 경로로 바뀌어 있다", async ({ page }) => {
    const width = widthOf(page);
    const { bids } = readWorkContext();
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "알림", exact: true })).toBeVisible();
    const list = page.locator("main ul.divide-y");
    await expect(list.locator("li")).toHaveCount(2);
    await expect(list.getByText("결정 담당으로 지정되었습니다.", { exact: true })).toBeVisible();
    await expect(list.getByText("분석이 끝났습니다.", { exact: true })).toBeVisible();
    const evil = list.getByRole("link").filter({ hasText: "분석이 끝났습니다." });
    await expect(evil).toHaveAttribute("href", `/bids/${bids["FX-04"]}`);
    const hrefs = await page
      .locator("a[href]")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.filter((href) => href.includes("evil.example"))).toEqual([]);
    await expect(topbar(page).getByRole("button", { name: "알림, 안 읽음 2건" })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await shot(page, "notifications", "loaded", width);
    await assertNoAxe(page, "notifications-loaded");
  });
});

// 보안 검토 확인 필요 3: 목록 질의는 검색(q)·결정 필터·키셋 커서를 각각 PostgREST .or() 로 건다.
// 한 질의의 여러 .or() 가 AND 로 묶이는지 API 로 고정한다. 쪽을 나눠 읽어도 모든 행이 조건을 만족하고, 겹치거나 빠지는 행이 없다.
test.describe("API 질의 조합(.or 여러 개 = AND)", () => {
  const Q = "광역시";
  const listSchema = z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        agency: z.string().nullable(),
        noticeId: z.string(),
        latestReview: z.object({ decision: z.string() }).nullable(),
      }),
    ),
    pageInfo: z.object({ nextCursor: z.string().nullable(), hasNext: z.boolean() }),
  });

  const cases: Array<Record<string, string>> = [{}, { decision: "NONE" }];
  for (const extra of cases) {
    test(`q=${Q}${"decision" in extra ? " + 결정 미결정" : ""} + 점수 높은 순을 2건씩 읽어도 전체와 같다`, async ({
      page,
    }) => {
      const query = new URLSearchParams({ q: Q, sort: "score:desc", ...extra });
      const read = async (params: URLSearchParams) => {
        const response = await page.request.get(`/api/v1/bids?${params.toString()}`);
        expect(response.status()).toBe(200);
        return listSchema.parse(await response.json());
      };
      const whole = await read(new URLSearchParams({ ...Object.fromEntries(query), limit: "50" }));
      expect(whole.pageInfo.hasNext).toBe(false);
      // 2건씩 나눌 때 쪽이 둘 이상이어야 커서 .or() 가 실제로 걸린다.
      expect(whole.items.length).toBeGreaterThan(2);

      const paged: z.infer<typeof listSchema>["items"] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const params = new URLSearchParams({ ...Object.fromEntries(query), limit: "2" });
        if (cursor !== null) params.set("cursor", cursor);
        const page2 = await read(params);
        paged.push(...page2.items);
        cursor = page2.pageInfo.nextCursor;
        pages += 1;
      } while (cursor !== null && pages < 20);
      expect(pages).toBeGreaterThanOrEqual(2);

      const ids = paged.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toEqual(whole.items.map((item) => item.id));
      for (const item of paged) {
        expect(`${item.title} ${item.agency ?? ""} ${item.noticeId}`).toContain(Q);
        if ("decision" in extra) expect(item.latestReview).toBeNull();
      }
    });
  }
});
