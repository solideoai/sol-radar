import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { z } from "zod";
import { test, readInstalledAxeSource, type PeopleFixtures } from "./people-fixtures";

// Independent contract oracle. The dedicated fixture owns provisioning/cleanup and never
// attaches the five normal seed accounts to org01.
let prepared: PeopleFixtures | undefined;
const fixture = () => {
  if (!prepared) throw new Error("Portable people worker fixture has not initialized.");
  return prepared;
};
const memberSchema = z.strictObject({
  id: z.uuid(),
  personCode: z.string().regex(/^SOL-P\d{4}$/),
  name: z.string(),
  departmentId: z.uuid(),
  jobTitleId: z.uuid(),
  portraitUrl: z.string().nullable(),
  scoringEligible: z.boolean(),
  isDemo: z.literal(true),
});
const scoringSchema = z.strictObject({
  role: z.string(),
  grade: z.string().nullable(),
  skills: z.array(z.string()),
  availability: z.array(
    z.strictObject({
      startsAt: z.iso.date(),
      endsAt: z.iso.date(),
      fte: z.number().min(0).max(1),
    }),
  ),
});
const detailSchema = memberSchema.extend({ scoring: scoringSchema.nullable() });
const pageSchema = z.strictObject({
  items: z.array(memberSchema),
  pageInfo: z.strictObject({
    cursor: z.string().nullable(),
    nextCursor: z.string().nullable(),
    previousCursor: z.string().nullable(),
    hasNext: z.boolean(),
    startIndex: z.number().int().nonnegative(),
  }),
  totalCount: z.number().int().nonnegative(),
  summary: z.strictObject({
    totalCount: z.number().int().nonnegative(),
    scoringCount: z.number().int().nonnegative(),
  }),
});
const departmentSchema = z.strictObject({
  id: z.uuid(),
  code: z.string().regex(/^SOL-D\d{3}$/),
  name: z.string(),
  kind: z.enum(["DIVISION", "GROUP", "TEAM"]).nullable(),
  parentId: z.uuid().nullable(),
  targetCount: z.number().nullable(),
  memberCount: z.number().int().nonnegative(),
});
const titleSchema = z.strictObject({
  id: z.uuid(),
  code: z.string().regex(/^SOL-J\d{3}$/),
  label: z.string(),
});
const errorSchema = z.object({
  error: z.object({
    code: z.string(),
    details: z.record(z.string(), z.unknown()),
  }),
});
type Member = z.infer<typeof memberSchema>;
const tokenFor = (request: APIRequestContext, name: string) => fixture().tokenFor(request, name);
const get = async (
  request: APIRequestContext,
  path: string,
  role = "viewer",
  extraHeaders: Record<string, string> = {},
) =>
  request.get(path, {
    headers: {
      Authorization: `Bearer ${await tokenFor(request, role)}`,
      ...extraHeaders,
    },
  });
const list = async (
  request: APIRequestContext,
  params = new URLSearchParams(),
  role = "viewer",
) => {
  const response = await get(request, `/api/v1/team-members?${params}`, role);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const result = pageSchema.parse(await response.json());
  await response.dispose();
  return result;
};
const allMembers = async (
  request: APIRequestContext,
  initial = new URLSearchParams(),
  role = "viewer",
) => {
  const params = new URLSearchParams(initial);
  const items: Member[] = [];
  const seenCursors = new Set<string>();
  let count: number | undefined;
  for (;;) {
    const result = await list(request, params, role);
    count ??= result.totalCount;
    expect(result.totalCount).toBe(count);
    expect(result.pageInfo.startIndex).toBe(items.length);
    items.push(...result.items);
    if (!result.pageInfo.nextCursor) {
      expect(result.pageInfo.hasNext).toBe(false);
      break;
    }
    expect(seenCursors.has(result.pageInfo.nextCursor)).toBe(false);
    seenCursors.add(result.pageInfo.nextCursor);
    params.set("cursor", result.pageInfo.nextCursor);
  }
  expect(items.length).toBe(count);
  expect(new Set(items.map(({ id }) => id)).size).toBe(items.length);
  expect(items.map(({ personCode, id }) => `${personCode}/${id}`)).toEqual(
    items.map(({ personCode, id }) => `${personCode}/${id}`).toSorted(),
  );
  return items;
};
const signIn = async (page: Page, role = "viewer") => {
  const account = fixture().accounts[role];
  await page.goto("/auth/login");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/\/[^/]+\/dashboard$/);
  await page.goto("/people");
  await expect(
    page.getByRole("heading", { level: 1, name: "조직·인력", exact: true }),
  ).toBeVisible();
};
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const peopleButtons = (page: Page) => page.getByRole("button", { name: / 상세 보기$/ });
const assertOpenSidebar = async (page: Page) => {
  const navigation = page.getByRole("navigation", { name: "주요 메뉴", exact: true });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByText("조직·인력", { exact: true })).toBeVisible();
  await expect.poll(async () => (await navigation.boundingBox())?.width ?? 0).toBeGreaterThan(180);
};
const choose = async (page: Page, label: string, option: string) => {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const assertAxe = async (page: Page, state: string) => {
  const source = readInstalledAxeSource();
  // Use the application's current nonce; no CSP changes/bypass are permitted.
  await page.evaluate((content) => {
    const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
    const script = document.createElement("script");
    if (nonce) script.nonce = nonce;
    script.textContent = content;
    document.head.append(script);
  }, source);
  const violations: unknown = await page.evaluate(async () => {
    const axe = Reflect.get(window, "axe") as {
      run: (context: Document) => Promise<{ violations: unknown[] }>;
    };
    return (await axe.run(document)).violations;
  });
  await test.info().attach(`axe-${state}`, {
    body: JSON.stringify(violations),
    contentType: "application/json",
  });
  expect(z.array(z.unknown()).parse(violations)).toEqual([]);
};

export function registerPeopleReadTests() {
  test.beforeAll(async ({ people }) => {
    prepared = people;
  });
  test.describe("[people-read-qa] independent authenticated read integration", () => {
    for (const role of ["viewer", "analyst", "sales", "admin"]) {
      test(`${role}: equal Bearer/cookie GET access without edits`, async ({ page, request }) => {
        const [departments, titles, first] = await Promise.all([
          get(request, "/api/v1/departments", role),
          get(request, "/api/v1/job-titles", role),
          list(request, new URLSearchParams(), role),
        ]);
        expect(departments.status()).toBe(200);
        expect(titles.status()).toBe(200);
        expect(z.array(departmentSchema).parse(await departments.json())).toHaveLength(48);
        expect(z.array(titleSchema).parse(await titles.json())).toHaveLength(12);
        expect(first.items).toHaveLength(20);
        expect(first.totalCount).toBe(200);
        expect(first.summary).toEqual({ totalCount: 200, scoringCount: 27 });
        const detail = await get(request, `/api/v1/team-members/${first.items[0].id}`, role);
        expect(detail.status()).toBe(200);
        detailSchema.parse(await detail.json());
        await signIn(page, role);
        const cookie = await page.request.get("/api/v1/team-members");
        expect(cookie.status()).toBe(200);
        expect(pageSchema.parse(await cookie.json()).summary).toEqual(first.summary);
        await expect(
          page.getByRole("button", {
            name: /직원 추가|인력 추가|편집|퇴사|시뮬레이션/,
          }),
        ).toHaveCount(0);
      });
    }

    test("all200 pagination, catalogs, hierarchy aggregates and27/173 details are complete", async ({
      request,
    }) => {
      test.setTimeout(120_000);
      const members = await allMembers(request);
      expect(members).toHaveLength(200);
      expect(new Set(members.map(({ personCode }) => personCode)).size).toBe(200);
      const fixturePeople = z
        .object({
          people: z.array(
            z.object({
              personId: z.string(),
              name: z.string(),
              scoringEligible: z.boolean(),
              role: z.string(),
              grade: z.string().nullable(),
              skills: z.array(z.string()),
              availability: z.array(z.unknown()),
            }),
          ),
        })
        .parse(
          JSON.parse(
            readFileSync(
              join(__dirname, "..", "..", "..", "fixtures", "people", "solideo.people.json"),
              "utf8",
            ),
          ),
        );
      expect(members.map(({ personCode }) => personCode)).toEqual(
        fixturePeople.people.map(({ personId }) => personId).toSorted(),
      );
      const departments = z
        .array(departmentSchema)
        .parse(await (await get(request, "/api/v1/departments")).json());
      const titles = z
        .array(titleSchema)
        .parse(await (await get(request, "/api/v1/job-titles")).json());
      expect(departments.filter(({ kind }) => kind === "DIVISION")).toHaveLength(6);
      expect(departments.filter(({ kind }) => kind === "GROUP")).toHaveLength(4);
      expect(departments.filter(({ kind }) => kind === "TEAM")).toHaveLength(38);
      expect(titles).toHaveLength(12);
      const teams = departments.filter(({ kind }) => kind === "TEAM");
      expect(teams.reduce((sum, team) => sum + (team.targetCount ?? 0), 0)).toBe(200);
      for (const department of departments) {
        if (department.kind !== "TEAM") expect(department.targetCount).toBeNull();
        const descendants = new Set([department.id]);
        for (let previous = 0; previous !== descendants.size;) {
          previous = descendants.size;
          departments
            .filter((child) => child.parentId !== null && descendants.has(child.parentId))
            .forEach(({ id }) => descendants.add(id));
        }
        expect(department.memberCount).toBe(
          new Set(
            members.filter((member) => descendants.has(member.departmentId)).map(({ id }) => id),
          ).size,
        );
      }
      const known = new Set(teams.filter(({ parentId }) => parentId !== null).map(({ id }) => id));
      const unknown = new Set(
        teams.filter(({ parentId }) => parentId === null).map(({ id }) => id),
      );
      expect(known.size).toBe(13);
      expect(unknown.size).toBe(25);
      expect(members.filter(({ departmentId }) => known.has(departmentId))).toHaveLength(81);
      expect(members.filter(({ departmentId }) => unknown.has(departmentId))).toHaveLength(119);
      expect(
        departments.filter(({ kind, parentId }) => kind === "GROUP" && parentId === null),
      ).toHaveLength(4);
      let scoringCount = 0;
      for (const member of members) {
        expect(teams.some(({ id }) => id === member.departmentId)).toBe(true);
        expect(titles.some(({ id }) => id === member.jobTitleId)).toBe(true);
        const response = await get(request, `/api/v1/team-members/${member.id}`);
        expect(response.status()).toBe(200);
        const detail = detailSchema.parse(await response.json());
        await response.dispose();
        expect(detail.personCode).toBe(member.personCode);
        expect(detail.portraitUrl).toBe(`/demo/people/${member.personCode}.png`);
        const expected = fixturePeople.people.find(
          ({ personId }) => personId === member.personCode,
        );
        expect(expected).toBeDefined();
        expect(member.name).toBe(expected?.name);
        if (member.scoringEligible) {
          scoringCount++;
          expect(detail.scoring).toEqual({
            role: expected?.role,
            grade: expected?.grade,
            skills: expected?.skills,
            availability: expected?.availability,
          });
        } else expect(detail.scoring).toBeNull();
      }
      expect(scoringCount).toBe(27);
      expect(await allMembers(request, new URLSearchParams({ scoring: "1" }))).toHaveLength(27);
      expect(await allMembers(request, new URLSearchParams({ scoring: "0" }))).toHaveLength(173);
    });

    test("Opaque cursors bind org/filter/limit, reject tampering and support previous", async ({
      request,
    }) => {
      const first = await list(request);
      expect(first.pageInfo.cursor).toBeNull();
      expect(first.pageInfo.previousCursor).toBeNull();
      const cursor = z.string().parse(first.pageInfo.nextCursor);
      const second = await list(request, new URLSearchParams({ cursor }));
      expect(second.pageInfo.startIndex).toBe(20);
      expect(second.pageInfo.previousCursor).toBeNull();
      const back = await list(request);
      expect(back.items.map(({ id }) => id)).toEqual(first.items.map(({ id }) => id));
      const third = await list(
        request,
        new URLSearchParams({
          cursor: z.string().parse(second.pageInfo.nextCursor),
        }),
      );
      expect(third.pageInfo.startIndex).toBe(40);
      const previous = await list(
        request,
        new URLSearchParams({
          cursor: z.string().parse(third.pageInfo.previousCursor),
        }),
      );
      expect(previous.items.map(({ id }) => id)).toEqual(second.items.map(({ id }) => id));
      expect((await list(request, new URLSearchParams({ limit: "100" }))).items).toHaveLength(100);
      const invalids: Array<{ params: URLSearchParams; role?: string }> = [
        { params: new URLSearchParams({ cursor: `${cursor.slice(0, -1)}!` }) },
        { params: new URLSearchParams({ cursor, scoring: "1" }) },
        { params: new URLSearchParams({ cursor, limit: "21" }) },
        { params: new URLSearchParams({ cursor }), role: "foreign" },
      ];
      for (const invalid of invalids) {
        const response = await get(request, `/api/v1/team-members?${invalid.params}`, invalid.role);
        expect(response.status()).toBe(400);
        expect(errorSchema.parse(await response.json()).error.code).toBe("INVALID_CURSOR");
      }
    });

    test("catalog UUID filters, trimmed search, validation and supplied org authority", async ({
      request,
    }) => {
      const first = (await list(request)).items[0];
      const matching = await list(
        request,
        new URLSearchParams({
          q: `  ${first.name}  `,
          departmentId: first.departmentId,
          jobTitleId: first.jobTitleId,
          scoring: first.scoringEligible ? "1" : "0",
        }),
      );
      expect(matching.items.map(({ id }) => id)).toEqual([first.id]);
      expect(matching.summary).toEqual({ totalCount: 200, scoringCount: 27 });
      expect(
        (await list(request, new URLSearchParams({ q: "존재하지않는가상인물" }))).totalCount,
      ).toBe(0);
      const invalid = [
        "orgId=abc",
        "unknown=1",
        "q=a&q=b",
        `q=${"가".repeat(41)}`,
        "limit=0",
        "limit=101",
        "limit=1.1",
        "scoring=2",
        "departmentId=SOL-D001",
        "jobTitleId=SOL-J001",
      ];
      const root = z
        .array(departmentSchema)
        .parse(await (await get(request, "/api/v1/departments")).json())
        .find(({ kind }) => kind === "DIVISION");
      invalid.push(`departmentId=${root?.id}`);
      for (const query of invalid) {
        const response = await get(request, `/api/v1/team-members?${query}`);
        expect(response.status()).toBe(400);
        expect(errorSchema.parse(await response.json()).error.code).toBe("VALIDATION_ERROR");
      }
      for (const query of [
        `departmentId=${fixture().foreign.departmentId}`,
        `jobTitleId=${fixture().foreign.jobTitleId}`,
      ]) {
        const response = await get(request, `/api/v1/team-members?${query}`);
        expect(response.status()).toBe(404);
        expect(errorSchema.parse(await response.json()).error.code).toBe("NOT_FOUND");
      }
      const header = await get(request, "/api/v1/team-members", "viewer", {
        "X-Organization-Id": fixture().foreign.orgId,
      });
      expect(header.status()).toBe(200);
      expect(pageSchema.parse(await header.json()).summary.totalCount).toBe(200);
      const foreignDetail = await get(
        request,
        `/api/v1/team-members/${fixture().foreign.personId}`,
      );
      expect(foreignDetail.status()).toBe(404);
      const missingDetail = await get(
        request,
        "/api/v1/team-members/11111111-1111-4111-8111-111111111111",
      );
      expect(missingDetail.status()).toBe(404);
    });

    for (const width of [1440, 1280]) {
      test(`${width}px list URL/filter/back/forward/drawer/keyboard/axe`, async ({
        page,
        request,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1000 });
        const first = (await list(request)).items[0];
        await signIn(page);
        await assertOpenSidebar(page);
        await expect(peopleButtons(page)).toHaveCount(20);
        expect(await overflow(page)).toBe(0);
        await page.getByRole("button", { name: "다음", exact: true }).click();
        await expect.poll(() => new URL(page.url()).searchParams.has("cursor")).toBe(true);
        await expect(peopleButtons(page)).toHaveCount(20);
        const nextUrl = page.url();
        await page.reload();
        await expect(peopleButtons(page)).toHaveCount(20);
        await page.getByRole("button", { name: "이전", exact: true }).click();
        await expect
          .poll(() => new URL(page.url()).searchParams.get("cursor"))
          .not.toBe(new URL(nextUrl).searchParams.get("cursor"));
        await page.goBack();
        await expect(page).toHaveURL(nextUrl);
        await page.goForward();
        await page.getByLabel("이름", { exact: true }).fill(first.name);
        const departments = z
          .array(departmentSchema)
          .parse(await (await get(request, "/api/v1/departments")).json());
        const titles = z
          .array(titleSchema)
          .parse(await (await get(request, "/api/v1/job-titles")).json());
        await choose(
          page,
          "부서",
          z.string().parse(departments.find(({ id }) => id === first.departmentId)?.name),
        );
        await choose(
          page,
          "직급/직책",
          z.string().parse(titles.find(({ id }) => id === first.jobTitleId)?.label),
        );
        await page.getByRole("button", { name: "검색", exact: true }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe(first.name);
        expect(new URL(page.url()).searchParams.get("departmentId")).toBe(first.departmentId);
        expect(new URL(page.url()).searchParams.get("jobTitleId")).toBe(first.jobTitleId);
        expect(new URL(page.url()).searchParams.has("cursor")).toBe(false);
        await expect(peopleButtons(page)).toHaveCount(1);
        await page.reload();
        await expect(page.getByLabel("이름", { exact: true })).toHaveValue(first.name);
        const opener = page.getByRole("button", {
          name: `${first.name} 상세 보기`,
          exact: true,
        });
        await opener.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
        await expect(
          dialog.getByText(first.scoringEligible ? "점수 계산 정보" : "점수 계산 대상이 아닙니다", {
            exact: true,
          }),
        ).toBeVisible();
        for (let index = 0; index < 8; index++) {
          await page.keyboard.press("Tab");
          expect(
            await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
          ).toBe(true);
        }
        await expect
          .poll(async () => Math.round((await dialog.boundingBox())?.width ?? 0))
          .toBe(480);
        await expect
          .poll(async () => {
            const box = await dialog.boundingBox();
            return Boolean(box && box.x >= 0 && box.x + box.width <= width + 1);
          })
          .toBe(true);
        expect(await overflow(page)).toBe(0);
        await assertAxe(page, `drawer-${width}`);
        await page.screenshot({
          path: test.info().outputPath(`people-drawer-${width}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        await page.getByRole("button", { name: "초기화", exact: true }).click();
        await choose(page, "점수 계산 대상", "대상");
        await page.getByRole("button", { name: "검색", exact: true }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get("scoring")).toBe("1");
        await expect(peopleButtons(page)).toHaveCount(20);
        await page.getByRole("button", { name: "다음", exact: true }).click();
        await expect(peopleButtons(page)).toHaveCount(7);
        await assertAxe(page, `list-${width}`);
        expect(await overflow(page)).toBe(0);
        await page.screenshot({
          path: test.info().outputPath(`people-list-${width}.png`),
          fullPage: true,
        });
      });

      test(`${width}px organization tree expands all200 once with honest null roots`, async ({
        page,
        request,
      }) => {
        test.setTimeout(90_000);
        await page.setViewportSize({ width, height: 1000 });
        const expected = await allMembers(request);
        await signIn(page);
        await assertOpenSidebar(page);
        await page.goto("/people?scoring=1&q=김");
        await page.getByRole("link", { name: "조직도", exact: true }).click();
        await expect.poll(() => new URL(page.url()).searchParams.get("view")).toBe("tree");
        expect(new URL(page.url()).searchParams.get("q")).toBe("김");
        expect(new URL(page.url()).searchParams.get("scoring")).toBe("1");
        await expect(page.getByRole("heading", { name: "본부", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { name: "상위 미지정", exact: true })).toBeVisible();
        await expect(page.getByText(/29개 부서.*119명/)).toBeVisible();
        await expect(
          page.getByText(/전체 조직도.*목록 검색 조건은 명부에만 적용됩니다/),
        ).toBeVisible();
        await page.getByRole("button", { name: "모두 펼치기", exact: true }).click();
        await expect(peopleButtons(page)).toHaveCount(200);
        const names = z
          .array(z.string())
          .parse(
            await peopleButtons(page).evaluateAll((buttons) =>
              buttons.map((button) => button.getAttribute("aria-label")),
            ),
          )
          .map((label) => label.replace(/ 상세 보기$/, ""))
          .toSorted();
        expect(names).toEqual(expected.map(({ name }) => name).toSorted());
        const personIds = z
          .array(z.uuid())
          .parse(
            await page
              .locator("[data-person-id]")
              .evaluateAll((items) => items.map((item) => item.getAttribute("data-person-id"))),
          );
        expect(new Set(personIds).size).toBe(200);
        expect(personIds.toSorted()).toEqual(expected.map(({ id }) => id).toSorted());
        for (const button of await page.locator('button[aria-expanded="true"]').all())
          expect(await button.getAttribute("aria-controls")).toBeTruthy();
        expect(await overflow(page)).toBe(0);
        await assertAxe(page, `tree-${width}`);
        await page.screenshot({
          path: test.info().outputPath(`people-tree-${width}.png`),
          fullPage: true,
        });
        await page.getByRole("button", { name: "모두 접기", exact: true }).click();
        await expect(peopleButtons(page)).toHaveCount(0);
        await page.getByRole("link", { name: "명부", exact: true }).click();
        await expect(page.getByLabel("이름", { exact: true })).toHaveValue("김");
        expect(new URL(page.url()).searchParams.get("scoring")).toBe("1");
      });
    }

    test("foreign one-person org uses server totals and real DIV-GROUP-TEAM; null portrait stays initials", async ({
      page,
      request,
    }) => {
      const result = await list(request, new URLSearchParams(), "foreign");
      expect(result.summary).toEqual({ totalCount: 1, scoringCount: 0 });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].portraitUrl).toBeNull();
      await signIn(page, "foreign");
      await expect(page.getByText(/전체 1명.*점수 계산 대상 0명/)).toBeVisible();
      await page.getByRole("button", { name: "김시험 상세 보기", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("점수 계산 대상이 아닙니다", { exact: true })).toBeVisible();
      const fallback = dialog.getByRole("img", {
        name: "김시험 프로필 사진 없음",
        exact: true,
      });
      await expect(fallback).toHaveText("김");
      await expect(dialog.locator('img[src*="SOL-P9999"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "조직도", exact: true }).click();
      await page.getByRole("button", { name: "모두 펼치기", exact: true }).click();
      await expect(peopleButtons(page)).toHaveCount(1);
      for (const name of ["QA본부", "QA그룹", "QA팀"])
        await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    });

    test("drawer failed fetch retries and missing detail is honest; image decode failure uses initials", async ({
      page,
      request,
    }) => {
      const person = (await list(request)).items[0];
      let attempts = 0;
      await page.route(`**/api/v1/team-members/${person.id}`, async (route) => {
        attempts++;
        if (attempts === 1)
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "SERVICE_UNAVAILABLE",
                message: "QA transient failure",
                details: {},
              },
            }),
          });
        else await route.continue();
      });
      await page.route(`**/demo/people/${person.personCode}.png`, (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/png",
          body: Buffer.from("deliberately invalid PNG for decode fallback"),
        }),
      );
      await signIn(page);
      await page.getByRole("button", { name: `${person.name} 상세 보기`, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByText("상세 정보를 불러오지 못했습니다", { exact: true }),
      ).toBeVisible();
      await dialog.getByRole("button", { name: "다시 시도", exact: true }).click();
      await expect(
        dialog.getByText(person.scoringEligible ? "점수 계산 정보" : "점수 계산 대상이 아닙니다", {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        dialog.getByRole("img", {
          name: `${person.name} 프로필 사진 없음`,
          exact: true,
        }),
      ).toHaveText(person.name.slice(0, 1));
      await page.keyboard.press("Escape");
      await page.unroute(`**/api/v1/team-members/${person.id}`);
      await page.route(`**/api/v1/team-members/${person.id}`, (route) =>
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "NOT_FOUND", message: "Not found", details: {} },
          }),
        }),
      );
      await page.getByRole("button", { name: `${person.name} 상세 보기`, exact: true }).click();
      await expect(
        page.getByRole("dialog").getByText("인력 정보를 찾을 수 없습니다", { exact: true }),
      ).toBeVisible();
    });

    test("drawer close/reopen/rapid next selection cannot consume a stale first response", async ({
      page,
      request,
    }) => {
      const [first, second] = (await list(request)).items;
      const detailResponse = await get(request, `/api/v1/team-members/${first.id}`);
      const firstDetail = detailSchema.parse(await detailResponse.json());
      let release: () => void = () => {};
      let observed: () => void = () => {};
      let settled: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const requested = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const completed = new Promise<void>((resolve) => {
        settled = resolve;
      });
      let requests = 0;
      await page.route(`**/api/v1/team-members/${first.id}`, async (route) => {
        requests++;
        if (requests > 1) {
          await route.continue();
          return;
        }
        observed();
        await gate;
        try {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(firstDetail),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "";
          if (
            !/Invalid InterceptionId|Target.*closed|interception.*not.*found|Request.*already.*handled/i.test(
              message,
            )
          )
            throw error;
        } finally {
          settled();
        }
      });
      try {
        await signIn(page);
        const firstOpener = page.getByRole("button", {
          name: `${first.name} 상세 보기`,
          exact: true,
        });
        await firstOpener.click();
        await requested;
        await expect(
          page.getByRole("dialog").getByRole("heading", { name: first.name, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("dialog").getByText("점수 계산 정보", { exact: true }),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await expect(firstOpener).toBeFocused();
        await page
          .getByRole("button", {
            name: `${second.name} 상세 보기`,
            exact: true,
          })
          .click();
        const secondDialog = page.getByRole("dialog");
        await expect(
          secondDialog.getByRole("heading", { name: second.name, exact: true }),
        ).toBeVisible();
        await expect(
          secondDialog.getByText(
            second.scoringEligible ? "점수 계산 정보" : "점수 계산 대상이 아닙니다",
            { exact: true },
          ),
        ).toBeVisible();
        release();
        await completed;
        await expect(
          secondDialog.getByRole("heading", { name: second.name, exact: true }),
        ).toBeVisible();
        await expect(
          secondDialog.getByRole("heading", { name: first.name, exact: true }),
        ).toHaveCount(0);
        await page.keyboard.press("Escape");
        await firstOpener.click();
        await expect(
          page
            .getByRole("dialog")
            .getByText(first.scoringEligible ? "점수 계산 정보" : "점수 계산 대상이 아닙니다", {
              exact: true,
            }),
        ).toBeVisible();
        // A removed trigger must fall back to the current panel heading rather than body.
        await firstOpener.evaluate((button) => button.remove());
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("heading", {
            level: 2,
            name: "명부",
            exact: true,
          }),
        ).toBeFocused();
      } finally {
        release();
      }
    });

    test("all200 actual Next PNG GET/MIME/approvedSHA and browser1254-square decode", async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const manifest = z
        .object({
          portraits: z.array(
            z.object({
              personId: z.string(),
              status: z.literal("READY"),
              path: z.string(),
              sha256: z.string().length(64),
            }),
          ),
        })
        .parse(
          JSON.parse(
            readFileSync(
              join(__dirname, "..", "..", "..", "fixtures", "people", "solideo.portraits.json"),
              "utf8",
            ),
          ),
        );
      expect(manifest.portraits).toHaveLength(200);
      expect(new Set(manifest.portraits.map(({ sha256 }) => sha256)).size).toBe(200);
      const evidence: Array<{
        personId: string;
        status: number;
        mime: string;
        sha256: string;
      }> = [];
      for (const portrait of manifest.portraits) {
        const response = await request.get(portrait.path);
        expect(response.status()).toBe(200);
        const mime = response.headers()["content-type"].split(";")[0];
        expect(mime).toBe("image/png");
        const sha256 = createHash("sha256")
          .update(await response.body())
          .digest("hex");
        expect(sha256).toBe(portrait.sha256);
        evidence.push({
          personId: portrait.personId,
          status: response.status(),
          mime,
          sha256,
        });
        await response.dispose();
      }
      await page.goto("/");
      const decoded: Array<{ path: string; width: number; height: number }> = [];
      for (let index = 0; index < manifest.portraits.length; index += 5) {
        decoded.push(
          ...(await page.evaluate(
            async (paths) =>
              Promise.all(
                paths.map(async (path) => {
                  const image = new Image();
                  image.src = path;
                  await image.decode();
                  return {
                    path,
                    width: image.naturalWidth,
                    height: image.naturalHeight,
                  };
                }),
              ),
            manifest.portraits.slice(index, index + 5).map(({ path }) => path),
          )),
        );
      }
      expect(decoded).toHaveLength(200);
      for (const image of decoded) expect([image.width, image.height]).toEqual([1254, 1254]);
      await test.info().attach("actual-next-photo200-http-sha-decode", {
        body: JSON.stringify({ http: evidence, decode: decoded }),
        contentType: "application/json",
      });
    });
  });
}
