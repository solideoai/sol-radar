import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  PROGRAMS_STORAGE_PATH,
  assertNoAxe,
  expectNoConsoleErrors,
  expectNoHorizontalOverflow,
  readMssRecording,
  readProgramsContext,
  shotPrograms,
  visibleText,
  watchConsole,
} from "./support/programs-fixtures";
import { widthOf } from "./support/work-fixtures";

// 부처 지원사업 공고 /bids/programs(ADR-040) — 업무 사용자(VIEWER)의 목록·상세 서랍·빈 상태(playwright.programs.config.ts, 1440·1280 두 폭).
// 기준: 디자인 스펙 docs/plans/2026-10-21-program-notices-design.md §4.1 링크 줄·§4.5 표·§4.6 서랍·§4.7 상태표·§11 브라우저 확인 항목,
//       §12.1 결정(Q1: /bids/programs h1 "부처 지원사업 공고", /bids h1 은 그대로 "입찰 공고").
// 데이터: globalSetup(support/programs-setup.ts)이 격리 Supabase 에 demo:reset 을 넣고, program_notices 를 비운 뒤
// 중기부 녹음(fixtures/recorded/program-notices/mss/rss-310.20261021.masked.json)을 worker mock 모드로 재생해 적재한다.
// 기업마당 녹음은 없다. 그래서 출처 "기업마당"으로 거르면 "조건 결과 0건"이다. 이 시험은 읽기만 한다.
// 화면 문구는 앱 상수를 가져오지 않고 옮겨 적는다(문구가 바뀌면 시험이 알아야 한다).

const BIDS_PATH = "/bids";
const PROGRAMS_PATH = "/bids/programs";
const BIDS_TITLE = "입찰 공고";
const PROGRAMS_TITLE = "부처 지원사업 공고";
const NAV_G2B = "나라장터 공고";
const NAV_PROGRAMS = "부처 지원사업";
const TABLE_CAPTION = "부처 지원사업 공고 목록. 공고명을 누르면 상세가 열립니다.";
const MSS_AGENCY = "중소벤처기업부";
const MSS_ORIGIN = "https://www.mss.go.kr/";
const TITLE_ONLY =
  "이 출처는 제목과 등록일만 제공합니다. 사업 내용과 신청 기간은 원문에서 확인하세요.";
const EMPTY_FILTERED_TITLE = "조건에 맞는 공고가 없습니다";
const CLOSED_HIDDEN = "마감 지난 공고는 숨겨져 있습니다.";
const RESET_FILTERS = "필터 초기화";
const DRAWER_WIDTH = 480;

test.use({ storageState: PROGRAMS_STORAGE_PATH });

const h1 = (page: Page, name: string) => page.getByRole("heading", { level: 1, name, exact: true });
const sourceNavLink = (page: Page, name: string) =>
  page
    .getByRole("navigation", { name: "공고 종류", exact: true })
    .getByRole("link", { name, exact: true });
const resultLine = (page: Page) => page.getByRole("status").filter({ hasText: /^공고 \d+건 표시/ });
const programsTable = (page: Page) => page.getByRole("table", { name: TABLE_CAPTION, exact: true });
const programRows = (page: Page) =>
  programsTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("cell") });

/** 링크 줄에서 지금 화면 링크만 aria-current="page" 다(디자인 스펙 §4.1·§4.9). */
async function expectCurrentNav(page: Page, current: string, other: string) {
  await expect(sourceNavLink(page, current)).toHaveAttribute("aria-current", "page");
  await expect(sourceNavLink(page, other)).not.toHaveAttribute("aria-current");
}

/** 녹음 항목이 모두 표에 있다: 행 수 = 녹음 <item 수, 결과 줄 건수도 같고, 공고명 단추 글자 = 녹음 제목(보이는 글자, 순서 무시). */
async function expectAllRecordedRows(page: Page) {
  const recording = readMssRecording();
  await expect(programRows(page)).toHaveCount(recording.itemCount);
  await expect(resultLine(page)).toHaveText(`공고 ${recording.itemCount}건 표시`);
  const titles = await programsTable(page).getByRole("button").allTextContents();
  expect(titles.map(visibleText).sort()).toEqual([...recording.titles].sort());
}

/**
 * "조건 결과 0건" 빈 상태(EmptyState) 상자. 제목 글자와 단추를 함께 가진 가장 안쪽 상자다(문서 순서상 마지막).
 * 필터 막대에도 같은 이름의 [필터 초기화](ghost)가 있어, 빈 상태 안의 단추를 이 상자로 좁혀 고른다.
 */
const emptyStateBox = (page: Page, title: string): Locator =>
  page
    .locator("div")
    .filter({ has: page.getByText(title, { exact: true }) })
    .filter({ has: page.getByRole("button") })
    .last();

test("링크 줄: /bids 에서 '부처 지원사업'을 누르면 /bids/programs 로 옮기고 지금 화면 표시(aria-current)가 따라간다", async ({
  page,
}) => {
  const width = widthOf(page);
  const context = readProgramsContext();
  const logs = watchConsole(page);

  const response = await page.goto(BIDS_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("table", { name: "입찰 공고 목록", exact: true })).toBeVisible();
  await expect(h1(page, BIDS_TITLE)).toBeVisible();
  await expectCurrentNav(page, NAV_G2B, NAV_PROGRAMS);
  await expect(sourceNavLink(page, NAV_G2B)).toHaveAttribute("href", BIDS_PATH);
  await expect(sourceNavLink(page, NAV_PROGRAMS)).toHaveAttribute("href", PROGRAMS_PATH);
  await expectNoHorizontalOverflow(page, "bids-list-loaded");
  await shotPrograms(page, context, "bids-list-loaded", width);

  await sourceNavLink(page, NAV_PROGRAMS).click();
  await expect(page).toHaveURL(new RegExp(`${PROGRAMS_PATH}$`));
  // 읽어 온 화면에만 있는 것(표 행)을 먼저 본다. loading.tsx 뼈대도 같은 제목·링크 줄을 그려, 스트리밍이 끝난 경계를
  // React 가 바꿔 넣기 전에는 제목이 잠깐 둘(하나는 숨은 경계 안) 있다(N8 관례).
  await expect(programRows(page)).toHaveCount(context.recordedItems);
  await expect(h1(page, PROGRAMS_TITLE)).toBeVisible();
  await expectCurrentNav(page, NAV_PROGRAMS, NAV_G2B);
  expectNoConsoleErrors(logs, context);
});

test("목록: 중기부 녹음 항목이 모두 표에 보이고(행 수·결과 줄 건수 = 녹음 <item 수) 가로 넘침이 없다", async ({
  page,
}) => {
  const width = widthOf(page);
  const context = readProgramsContext();
  const logs = watchConsole(page);
  // 준비 단계가 저장 행 수를 녹음 항목 수와 맞춰 봤다. 화면 시험의 전제를 한 번 더 고정한다.
  expect(context.storedNotices).toBe(readMssRecording().itemCount);

  const response = await page.goto(PROGRAMS_PATH);
  expect(response?.status()).toBe(200);
  await expectAllRecordedRows(page);
  await expect(h1(page, PROGRAMS_TITLE)).toBeVisible();
  await expectCurrentNav(page, NAV_PROGRAMS, NAV_G2B);
  // 출처 칸은 모두 "중기부" 배지다(녹음 출처가 중기부 하나).
  await expect(programsTable(page).getByRole("cell", { name: "중기부", exact: true })).toHaveCount(
    context.recordedItems,
  );

  await expectNoHorizontalOverflow(page, "bids-programs-loaded");
  await shotPrograms(page, context, "bids-programs-loaded", width);
  await assertNoAxe(page, "bids-programs-loaded");
  expectNoConsoleErrors(logs, context);
});

test("서랍: 첫 행 공고명을 누르면 480px 서랍에 그 공고와 원문 보기(새 창) 링크·제목만 제공 안내가 보이고, Esc 로 닫으면 초점이 공고명 단추로 돌아온다", async ({
  page,
}) => {
  const width = widthOf(page);
  const context = readProgramsContext();
  const logs = watchConsole(page);

  await page.goto(PROGRAMS_PATH);
  await expect(programRows(page)).toHaveCount(context.recordedItems);
  const opener = programRows(page).first().getByRole("button");
  await expect(opener).toHaveAttribute("aria-haspopup", "dialog");
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  const title = visibleText((await opener.textContent()) ?? "");
  expect(readMssRecording().titles, "첫 행 공고명은 녹음 제목 중 하나다").toContain(title);

  await opener.click();
  const drawer = page.getByRole("dialog", { name: title, exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAccessibleDescription(MSS_AGENCY);
  // 모달 서랍이 열린 동안 뒤 화면은 접근성 트리에서 빠진다(Base UI Dialog). 열린 행 표시(aria-expanded)는
  // 숨은 요소까지 찾는 같은 역할 선택자로 본다.
  await expect(
    page
      .getByRole("table", { name: TABLE_CAPTION, exact: true, includeHidden: true })
      .getByRole("button", { name: title, exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-expanded", "true");
  // 오른쪽에서 밀려 들어온 뒤의 자리와 폭(지원 폭 1280 이상에서 480px, 오른쪽 끝에 붙는다).
  await expect
    .poll(() =>
      drawer.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { width: Math.round(box.width), right: Math.round(box.right) };
      }),
    )
    .toEqual({ width: DRAWER_WIDTH, right: width });

  // 원문 보기: 새 창(target=_blank) + rel noopener·noreferrer + 중기부 주소 + 접근 이름에 공고명과 "(새 창)".
  // 바깥 사이트라 누르지 않는다.
  const sourceLink = drawer.getByRole("link", { name: `원문 보기: ${title} (새 창)`, exact: true });
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toHaveAttribute("target", "_blank");
  await expect(sourceLink).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
  await expect(sourceLink).toHaveAttribute("rel", /(^|\s)noreferrer(\s|$)/);
  expect(await sourceLink.getAttribute("href")).toMatch(
    new RegExp(`^${MSS_ORIGIN.replaceAll(".", "\\.")}`),
  );
  // 중기부 RSS 는 제목·등록일·주소만 준다 → 구역 대신 안내 한 줄(디자인 스펙 §4.6 "내용 없음").
  await expect(drawer.getByText(TITLE_ONLY, { exact: true })).toBeVisible();

  await expectNoHorizontalOverflow(page, "bids-programs-drawer-loaded");
  await shotPrograms(page, context, "bids-programs-drawer-loaded", width);
  await assertNoAxe(page, "bids-programs-drawer-loaded");

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAttribute("aria-expanded", "false");
  expectNoConsoleErrors(logs, context);
});

test("빈 상태: ?source=bizinfo 는 '조건에 맞는 공고가 없습니다'이고, 빈 상태의 [필터 초기화]로 녹음 전체 목록으로 돌아온다", async ({
  page,
}) => {
  const width = widthOf(page);
  const context = readProgramsContext();
  const logs = watchConsole(page);

  const response = await page.goto(`${PROGRAMS_PATH}?source=bizinfo`);
  expect(response?.status()).toBe(200);
  await expect(resultLine(page)).toHaveText("공고 0건 표시");
  await expect(programsTable(page)).toHaveCount(0);
  // 주소가 정본이라 필터 막대의 출처 칸도 "기업마당"이다.
  await expect(page.getByRole("combobox", { name: "출처", exact: true })).toContainText("기업마당");
  const empty = emptyStateBox(page, EMPTY_FILTERED_TITLE);
  await expect(empty.getByText(EMPTY_FILTERED_TITLE, { exact: true })).toBeVisible();
  // 토글(마감 지난 공고 포함)이 꺼져 있으면 설명이 붙는다(상태표 "조건 결과 0건").
  await expect(empty.getByText(CLOSED_HIDDEN, { exact: true })).toBeVisible();
  const reset = empty.getByRole("button", { name: RESET_FILTERS, exact: true });
  await expect(reset).toHaveCount(1);

  await expectNoHorizontalOverflow(page, "bids-programs-empty");
  await shotPrograms(page, context, "bids-programs-empty", width);
  await assertNoAxe(page, "bids-programs-empty");

  await reset.click();
  await expect(page).toHaveURL(new RegExp(`${PROGRAMS_PATH}$`));
  await expectAllRecordedRows(page);
  // 기본 조건으로 돌아와 필터 막대의 [필터 초기화]도 사라진다.
  await expect(page.getByRole("button", { name: RESET_FILTERS, exact: true })).toHaveCount(0);
  expectNoConsoleErrors(logs, context);
});
