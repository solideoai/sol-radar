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
  email: z.email().nullable(),
  departmentId: z.uuid(),
  jobTitleId: z.uuid(),
  portraitUrl: z.string().nullable(),
  scoringEligible: z.boolean(),
  isDemo: z.literal(true),
});
const certificationSchema = z.strictObject({
  code: z.string(),
  name: z.string(),
  issuedAt: z.iso.date(),
  expiresAt: z.iso.date(),
  isDemo: z.literal(true),
  evidenceRef: z.string().startsWith("synthetic:"),
});
const pastProjectSchema = z.strictObject({
  projectId: z.string(),
  name: z.string(),
  client: z.string(),
  domain: z.string(),
  role: z.string(),
  startsAt: z.iso.date(),
  endsAt: z.iso.date(),
  skills: z.array(z.string()),
  isDemo: z.literal(true),
  evidenceRef: z.string().startsWith("synthetic:"),
});
const scoringSchema = z.strictObject({
  role: z.string(),
  grade: z.string().nullable(),
  skills: z.array(z.string()),
  certifications: z.array(certificationSchema).min(1),
  pastProjects: z.array(pastProjectSchema).min(1),
  capabilitySource: z.literal("SYNTHETIC"),
  capabilityVersion: z.literal("synthetic-people/v2"),
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
// Feature-specific setup verifies real form authentication and the browser session cookie.
// Automatic login router.refresh redirection belongs to the unchanged Auth regressions;
// explicit document navigation below must never be reported as that redirect passing.
const signIn = async (page: Page, role = "viewer", destination = "/people") => {
  const account = fixture().accounts[role];
  await page.goto("/auth/login");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호", { exact: true }).fill(account.password);
  const authenticated = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/auth/v1/token" && response.request().method() === "POST";
  });
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  expect((await authenticated).status()).toBe(200);
  await expect
    .poll(async () =>
      (await page.context().cookies()).some(({ name }) =>
        /^sb-.+-auth-token(?:\.\d+)?$/.test(name),
      ),
    )
    .toBe(true);
  await page.goto(destination);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: destination.startsWith("/org-chart") ? "조직도" : "조직·인력",
      exact: true,
    }),
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
        expect(first.summary).toEqual({ totalCount: 200, scoringCount: 200 });
        const detail = await get(request, `/api/v1/team-members/${first.items[0].id}`, role);
        expect(detail.status()).toBe(200);
        detailSchema.parse(await detail.json());
        await signIn(page, role);
        const cookie = await page.request.get("/api/v1/team-members");
        expect(cookie.status()).toBe(200);
        expect(pageSchema.parse(await cookie.json()).summary).toEqual(first.summary);
        await page.goto("/org-chart");
        await expect(
          page.getByRole("heading", { level: 1, name: "조직도", exact: true }),
        ).toBeVisible();
        await expect(page.getByText(/전체 200명.*본부 6.*그룹 4.*팀 38/)).toBeVisible();
        await expect(peopleButtons(page)).toHaveCount(14);
        await expect(
          page.getByRole("button", {
            name: /직원 추가|인력 추가|편집|퇴사|시뮬레이션/,
          }),
        ).toHaveCount(0);
      });
    }

    test("all200 pagination, catalogs, hierarchy aggregates and200 calculation details are complete", async ({
      request,
    }) => {
      test.setTimeout(120_000);
      const members = await allMembers(request);
      expect(members).toHaveLength(200);
      expect(new Set(members.map(({ personCode }) => personCode)).size).toBe(200);
      const windowSchema = z.strictObject({
        startsAt: z.iso.date(),
        endsAt: z.iso.date(),
        fte: z.number(),
      });
      const fixturePeople = z
        .object({
          assignments: z.array(
            z.strictObject({
              personId: z.string(),
              startsAt: z.iso.date(),
              endsAt: z.iso.date(),
              allocationPercent: z.number(),
            }),
          ),
          people: z.array(
            z.object({
              personId: z.string(),
              name: z.string(),
              scoringEligible: z.boolean(),
              role: z.string(),
              grade: z.string().nullable(),
              skills: z.array(z.string()),
              certifications: z.array(certificationSchema).min(1),
              pastProjects: z.array(pastProjectSchema).min(1),
              capabilitySource: z.literal("SYNTHETIC"),
              capabilityVersion: z.literal("synthetic-people/v2"),
              availability: z.array(windowSchema),
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
      // The roster's prior project assignments have no bid, so they cannot live in the
      // assignments table. The normal seed folds them into team_member_scoring.availability
      // (3e181b7, scripts/people/availability.mjs): the covered span's fte drops by
      // allocationPercent/100, floored at 0. Every fixture assignment covers exactly one
      // whole window of its person, so the expected window keeps its dates and only fte drops.
      // A partial-window assignment would need the full split oracle; fail loudly instead.
      expect(fixturePeople.assignments).toHaveLength(7);
      for (const assignment of fixturePeople.assignments)
        expect(
          fixturePeople.people
            .find(({ personId }) => personId === assignment.personId)
            ?.availability.filter(
              ({ startsAt, endsAt }) =>
                startsAt === assignment.startsAt && endsAt === assignment.endsAt,
            ),
          `${assignment.personId} assignment must cover exactly one whole availability window`,
        ).toHaveLength(1);
      const seededAvailability = (personId: string, windows: z.infer<typeof windowSchema>[]) =>
        windows.map((window) => {
          const allocated = fixturePeople.assignments
            .filter(
              (assignment) =>
                assignment.personId === personId &&
                assignment.startsAt === window.startsAt &&
                assignment.endsAt === window.endsAt,
            )
            .reduce((sum, { allocationPercent }) => sum + allocationPercent / 100, 0);
          return { ...window, fte: Math.max(0, window.fte - allocated) };
        });
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
            certifications: expected?.certifications,
            pastProjects: expected?.pastProjects,
            capabilitySource: expected?.capabilitySource,
            capabilityVersion: expected?.capabilityVersion,
            availability: expected && seededAvailability(expected.personId, expected.availability),
          });
        } else expect(detail.scoring).toBeNull();
      }
      expect(scoringCount).toBe(200);
      expect(await allMembers(request, new URLSearchParams({ scoring: "1" }))).toHaveLength(200);
      expect(await allMembers(request, new URLSearchParams({ scoring: "0" }))).toHaveLength(0);
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
      expect(matching.summary).toEqual({ totalCount: 200, scoringCount: 200 });
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
          await expect
            .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
            .toBe(true);
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
        // Reset navigates to /people; when that transition commits the filter form is
        // remounted for the new query (key={query}), which closes any select opened earlier.
        // Wait for the reset list (no query, full first page) before choosing the next filter.
        await expect.poll(() => new URL(page.url()).search).toBe("");
        await expect(peopleButtons(page)).toHaveCount(20);
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

      test(`${width}px standalone chart initial team, URL/history, cards and keyboard search`, async ({
        page,
        request,
      }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width, height: 1000 });
        const people = await allMembers(request);
        const departments = z
          .array(departmentSchema)
          .parse(await (await get(request, "/api/v1/departments")).json());
        const titles = z
          .array(titleSchema)
          .parse(await (await get(request, "/api/v1/job-titles")).json());
        const firstTeam = departments.find(({ name }) => name === "AX사업본부 AI플랫폼운영팀");
        expect(firstTeam).toBeDefined();
        const firstTeamId = z.uuid().parse(firstTeam?.id);
        await signIn(page, "viewer", "/org-chart");
        await assertOpenSidebar(page);
        // 조직도는 주요 메뉴의 "회사" 묶음 마지막 메뉴다(2026-10-26 사이드바 묶음 3개). 페이지 전체에 하나뿐이다.
        const orgChartLink = page.getByRole("link", { name: "조직도", exact: true });
        await expect(orgChartLink).toHaveCount(1);
        const companyGroup = page
          .getByRole("navigation", { name: "주요 메뉴", exact: true })
          .getByRole("list", { name: "회사", exact: true });
        await expect(companyGroup.getByRole("link")).toHaveText([
          "회사 역량",
          "조직·인력",
          "조직도",
        ]);
        await expect(
          companyGroup.getByRole("link", { name: "조직도", exact: true }),
        ).toHaveAttribute("href", "/org-chart");
        await expect(orgChartLink).toHaveAttribute("aria-current", "page");
        const userMenu = page.getByRole("button", { name: /^사용자 메뉴/ });
        await expect
          .poll(async () => {
            const linkBox = await orgChartLink.boundingBox();
            const userBox = await userMenu.boundingBox();
            return Boolean(linkBox && userBox && linkBox.y + linkBox.height <= userBox.y + 1);
          })
          .toBe(true);
        await expect(page.getByText(/전체 200명.*본부 6.*그룹 4.*팀 38/)).toBeVisible();
        // 최상위 부서는 구역 없이 한 목록이다: 본부(인원 많은 순) → 상위 없는 그룹·팀(코드 순) → 0명 부서.
        await expect(page.getByText(/상위 미지정/)).toHaveCount(0);
        const isDivision = (kind: string | null) => Number(kind === "DIVISION");
        const expectedRoots = departments
          .filter(({ parentId }) => parentId === null)
          .toSorted(
            (a, b) =>
              Number(a.memberCount === 0) - Number(b.memberCount === 0) ||
              isDivision(b.kind) - isDivision(a.kind) ||
              (a.kind === "DIVISION" && b.kind === "DIVISION"
                ? b.memberCount - a.memberCount
                : 0) ||
              a.code.localeCompare(b.code),
          );
        expect(expectedRoots).toHaveLength(35);
        expect(
          await page
            .getByRole("complementary", { name: "부서 탐색", exact: true })
            .locator(":scope > ul > li")
            .evaluateAll((items) =>
              items.map((item) => (item as HTMLElement).innerText.split("\n")[0].trim()),
            ),
        ).toEqual(expectedRoots.map(({ name }) => name));
        await expect(page.getByRole("button", { name: "P&AX컨설팅본부", exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByText("P&AX컨설팅본부", { exact: true })).toBeVisible();
        await expect(peopleButtons(page)).toHaveCount(14);
        await expect(
          page.getByRole("button", { name: firstTeam?.name, exact: true }),
        ).toHaveAttribute("aria-current", "true");
        await expect(
          page.getByRole("heading", {
            name: new RegExp("AX사업본부 AI플랫폼운영팀.*14명.*목표 14명"),
          }),
        ).toBeVisible();
        expect(await overflow(page)).toBe(0);
        const expectedOrder = people
          .filter(({ departmentId }) => departmentId === firstTeamId)
          .toSorted(
            (left, right) =>
              titles.findIndex(({ id }) => id === left.jobTitleId) -
                titles.findIndex(({ id }) => id === right.jobTitleId) ||
              left.name.localeCompare(right.name, "ko"),
          );
        expect(
          await peopleButtons(page).evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute("aria-label")),
          ),
        ).toEqual(expectedOrder.map(({ name }) => `${name} 상세 보기`));
        const selectedTeam = page.getByRole("region", { name: "선택한 팀", exact: true });
        const cards = selectedTeam.locator("[data-person-id]");
        await expect(cards).toHaveCount(14);
        expect(
          await selectedTeam
            .locator('[data-slot="org-people-grid"]')
            .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(/\s+/).length),
        ).toBe(width === 1440 ? 4 : 3);
        await expect(page.getByRole("tree")).toHaveCount(0);
        for (const person of expectedOrder) {
          const card = selectedTeam.locator(`[data-person-id="${person.id}"]`);
          await expect(card).toContainText(
            z.string().parse(titles.find(({ id }) => id === person.jobTitleId)?.label),
          );
          await expect(card.getByText("점수 계산 대상", { exact: true })).toHaveCount(
            person.scoringEligible ? 1 : 0,
          );
          const portrait = card.locator('[data-slot="avatar"]');
          await expect
            .poll(async () => Math.round((await portrait.boundingBox())?.width ?? 0))
            .toBe(44);
          await expect(card.locator("img")).toHaveAttribute(
            "src",
            `/demo/people/${person.personCode}.png`,
          );
          expect(await card.innerText()).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-|MALE|FEMALE|@|010-/);
        }
        for (const group of departments.filter(
          ({ kind, parentId }) => kind === "GROUP" && parentId === null,
        )) {
          await expect(page.getByRole("button", { name: group.name, exact: true })).toHaveCount(0);
          await expect(page.getByText(group.name, { exact: true })).toBeVisible();
        }
        const divisionTeamIds = new Set(
          departments
            .filter(
              ({ id, kind, parentId }) =>
                kind === "TEAM" &&
                id !== firstTeamId &&
                departments.some((item) => item.id === parentId && item.kind === "DIVISION"),
            )
            .map(({ id }) => id),
        );
        const highlighted = people.find(({ departmentId }) => divisionTeamIds.has(departmentId));
        expect(highlighted).toBeDefined();
        const person = memberSchema.parse(highlighted);
        const personDivision = z
          .string()
          .parse(
            departments.find(
              ({ id }) => id === departments.find(({ id }) => id === person.departmentId)?.parentId,
            )?.name,
          );
        // Finder must expand a collapsed division to reveal the person's team.
        const division = page.getByRole("button", { name: personDivision, exact: true });
        if ((await division.getAttribute("aria-expanded")) === "true") await division.click();
        await expect(division).toHaveAttribute("aria-expanded", "false");
        const find = page.getByRole("combobox", { name: "이름으로 찾기", exact: true });
        await find.fill("김");
        await expect(page.getByRole("option").first()).toBeVisible();
        expect(await page.getByRole("option").count()).toBeLessThanOrEqual(8);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("option")).toHaveCount(0);
        await find.fill("일치없는이름");
        await expect(page.getByText("일치하는 이름이 없습니다", { exact: true })).toBeVisible();
        await find.fill(person.name);
        const option = page.getByRole("option").filter({ hasText: person.name });
        await expect(option).toContainText(
          z.string().parse(departments.find(({ id }) => id === person.departmentId)?.name),
        );
        await expect(option).toContainText(
          z.string().parse(titles.find(({ id }) => id === person.jobTitleId)?.label),
        );
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await expect
          .poll(() => new URL(page.url()).searchParams.get("team"))
          .toBe(person.departmentId);
        await expect(division).toHaveAttribute("aria-expanded", "true");
        const teamPath = page.getByRole("navigation", { name: "팀 부서 경로", exact: true });
        await expect(teamPath).toContainText(personDivision);
        await expect(teamPath).not.toContainText("미지정");
        const card = page.getByRole("button", { name: `${person.name} 상세 보기`, exact: true });
        await expect(card).toBeFocused();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        await page.reload();
        await expect(card).toBeVisible();
        await expect(division).toHaveAttribute("aria-expanded", "true");
        await page.goBack();
        await expect(peopleButtons(page)).toHaveCount(14);
        if ((await division.getAttribute("aria-expanded")) === "true") await division.click();
        await expect(division).toHaveAttribute("aria-expanded", "false");
        await page.goForward();
        await expect(card).toBeVisible();
        await expect(division).toHaveAttribute("aria-expanded", "true");
        await card.focus();
        await page.keyboard.press("Enter");
        const dialog = page.getByRole("dialog", { name: person.name, exact: true });
        await expect(dialog).toBeVisible();
        await expect
          .poll(async () => Math.round((await dialog.boundingBox())?.width ?? 0))
          .toBe(480);
        await expect
          .poll(async () => {
            const box = await dialog.boundingBox();
            return Boolean(box && box.x >= 0 && box.x + box.width <= width + 1);
          })
          .toBe(true);
        await assertAxe(page, `chart-drawer-${width}`);
        await page.screenshot({
          path: test.info().outputPath(`org-chart-drawer-${width}.png`),
          fullPage: true,
        });
        await page.keyboard.press("Escape");
        await expect(card).toBeFocused();
        await assertAxe(page, `chart-${width}`);
        expect(await overflow(page)).toBe(0);
        await page.screenshot({
          path: test.info().outputPath(`org-chart-${width}.png`),
          fullPage: true,
        });
      });
    }

    test("people ignores all legacy view values and keeps the directory without tabs", async ({
      page,
    }) => {
      await signIn(page);
      for (const view of ["tree", "list", "invalid"]) {
        await page.goto(`/people?view=${view}`);
        await expect(
          page.getByRole("heading", { level: 1, name: "조직·인력", exact: true }),
        ).toBeVisible();
        expect(new URL(page.url()).pathname).toBe("/people");
        expect(new URL(page.url()).searchParams.get("view")).toBe(view);
        await expect(peopleButtons(page)).toHaveCount(20);
        await expect(page.getByRole("navigation", { name: "인력 보기", exact: true })).toHaveCount(
          0,
        );
        await expect(page.getByRole("heading", { name: "전체 조직도", exact: true })).toHaveCount(
          0,
        );
        await expect(
          page.getByRole("combobox", { name: "이름으로 찾기", exact: true }),
        ).toHaveCount(0);
      }
    });

    test("all200 belong exactly once across38 actual team selections; invalid team defaults safely", async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const expected = await allMembers(request);
      const departments = z
        .array(departmentSchema)
        .parse(await (await get(request, "/api/v1/departments")).json());
      const teams = departments
        .filter(({ kind }) => kind === "TEAM")
        .toSorted((a, b) => a.code.localeCompare(b.code));
      expect(teams).toHaveLength(38);
      await signIn(page, "viewer", "/org-chart");
      const ids: string[] = [];
      // Actual selection uses nested native buttons, retaining the documented hierarchy.
      for (const team of teams) {
        await page.goto(`/org-chart?team=${team.id}`);
        const chooseTeam = page.getByRole("button", { name: team.name, exact: true });
        await expect(chooseTeam).toBeVisible();
        await chooseTeam.click();
        await expect(chooseTeam).toHaveAttribute("aria-current", "true");
        const members = expected.filter(({ departmentId }) => departmentId === team.id);
        await expect(peopleButtons(page)).toHaveCount(members.length);
        const selectedIds = z
          .array(z.uuid())
          .parse(
            await page
              .locator("[data-person-id]")
              .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-person-id"))),
          );
        expect(selectedIds.toSorted()).toEqual(members.map(({ id }) => id).toSorted());
        ids.push(...selectedIds);
      }
      expect(ids).toHaveLength(200);
      expect(new Set(ids).size).toBe(200);
      expect(ids.toSorted()).toEqual(expected.map(({ id }) => id).toSorted());
      const upper = z.uuid().parse(departments.find(({ kind }) => kind === "DIVISION")?.id);
      for (const invalid of [
        "invalid",
        "11111111-1111-4111-8111-111111111111",
        fixture().foreign.departmentId,
        upper,
      ]) {
        await page.goto(`/org-chart?team=${invalid}`);
        await expect(
          page.getByRole("heading", { level: 1, name: "조직도", exact: true }),
        ).toBeVisible();
        await expect(peopleButtons(page)).toHaveCount(14);
        await expect(
          page.getByRole("button", { name: "AX사업본부 AI플랫폼운영팀", exact: true }),
        ).toHaveAttribute("aria-current", "true");
      }
      await test.info().attach("actual38-team200-uuid-coverage", {
        body: JSON.stringify({
          teams: teams.length,
          total: ids.length,
          unique: new Set(ids).size,
        }),
        contentType: "application/json",
      });
    });

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
      await expect(dialog.getByText("QA본부 → QA그룹 → QA팀", { exact: true })).toBeVisible();
      const fallback = dialog.getByRole("img", {
        name: "김시험 프로필 사진 없음",
        exact: true,
      });
      await expect(fallback).toHaveText("김");
      await expect(dialog.locator('img[src*="SOL-P9999"]')).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.goto(`/org-chart?team=${fixture().foreign.departmentId}`);
      await expect(page.getByText(/전체 1명.*본부 1.*그룹 1.*팀 2/)).toBeVisible();
      await expect(peopleButtons(page)).toHaveCount(1);
      for (const name of ["QA본부", "QA그룹", "QA팀"])
        await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
      await page.getByRole("button", { name: "QA빈팀", exact: true }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("team"))
        .toBe(fixture().foreign.emptyDepartmentId);
      await expect(page.getByText("소속 인력이 없습니다", { exact: true })).toBeVisible();
      await expect(peopleButtons(page)).toHaveCount(0);
      await page.getByRole("button", { name: "QA팀", exact: true }).click();
      await expect(peopleButtons(page)).toHaveCount(1);
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
        const firstOpenerElement = await firstOpener.elementHandle();
        if (!firstOpenerElement)
          throw new Error("The first opener must be mounted before opening.");
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
        await firstOpenerElement.evaluate((button) => button.remove());
        await firstOpenerElement.dispose();
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
