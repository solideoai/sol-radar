import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import type {
  WorkforceBidResult,
  WorkforceCandidate,
  WorkforceResult,
  WorkforceTeamPerson,
  WorkforceTeamSupply,
} from "@/server/workforce";
import { WorkforceView } from "./workforce-view";

// 인력 배치 화면의 추천 공고 불러오기와 역할·팀 표시(계획 docs/plans/2026-10-30-team-staffing.md Task 3).
// 결과는 손으로 만든 WorkforceResult 다. 이름·부서는 지어낸 값이다.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, className, children }: React.ComponentProps<"a">) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const BID_A = "0b6f6d1e-6a3c-4c1f-9f5a-2b0c3d4e5f61";
const BID_B = "1c7a7e2f-7b4d-4d2a-8a6b-3c1d4e5f6a72";
const PERSON: WorkforceTeamPerson = {
  personId: "p-1",
  name: "한가람",
  jobTitle: "선임",
  role: "DEVELOPER",
  grade: "중급",
  isDemo: true,
  availableFte: 1,
};
const CANDIDATE: WorkforceCandidate = {
  ...PERSON,
  department: "개발1팀",
  skills: ["Java"],
  matchReason: "요구 역할 일치: 개발",
};
const TEAM: WorkforceTeamSupply = { department: "개발1팀", people: [PERSON], availableFte: 1 };
const bid = (
  bidId: string,
  title: string,
  overrides: Partial<WorkforceBidResult> = {},
): WorkforceBidResult => ({
  bidId,
  title,
  isDemo: true,
  analysisId: "aaaaaaaa-0000-4000-8000-000000000001",
  analysisStatus: "COMPLETED",
  revision: 1,
  analyzedAt: "2026-10-16T01:00:00Z",
  snapshotAsOf: "2026-10-16T00:00:00Z",
  calculationDate: "2026-10-16",
  latestAttempt: null,
  period: { startsAt: "2026-12-01", endsAt: "2027-06-01" },
  periodSource: "BID",
  requiredFte: 3,
  requiredFteSource: "STAFFING",
  availableFte: 1,
  missingReason: null,
  note: null,
  candidateBasisMissing: false,
  candidates: [CANDIDATE],
  roleNeeds: [
    {
      role: "개발",
      roleCode: "DEVELOPER",
      minCount: 3,
      grade: null,
      mandatory: true,
      supplyCount: 1,
      shortfall: 2,
      teams: [TEAM],
    },
  ],
  teams: [TEAM],
  ...overrides,
});
const RESULT: WorkforceResult = {
  bids: [bid(BID_A, "가상 행정 시스템 고도화"), bid(BID_B, "가상 민원 포털 구축")],
  currentAssignmentsAsOf: "2026-10-30T00:00:00Z",
  overloads: [],
  sharedCandidates: [],
  currentMissingPersonIds: [],
  teamPlan: [
    {
      department: "개발1팀",
      personCount: 1,
      cells: [
        { bidId: BID_A, people: [PERSON], roles: ["개발"] },
        { bidId: BID_B, people: [PERSON], roles: ["개발"] },
      ],
    },
  ],
};
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

const mounted: Root[] = [];
const startUrl = window.location.href;
function render(props: Partial<React.ComponentProps<typeof WorkforceView>> = {}) {
  const host = document.body.appendChild(document.createElement("div"));
  host.style.width = "1184px";
  const root = createRoot(host);
  flushSync(() =>
    root.render(
      <WorkforceView
        origin="demo"
        initialOptions={[]}
        initialNextCursor={null}
        initialResult={null}
        initialIds={[]}
        initialNotice={null}
        {...props}
      />,
    ),
  );
  mounted.push(root);
  return host;
}
const stubFetch = (opportunities: unknown) => {
  const fetch = vi.fn(async (url: string) =>
    url.startsWith("/api/v1/opportunities") ? json(opportunities) : json(RESULT),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};
const simulationCalls = (fetch: ReturnType<typeof stubFetch>) =>
  fetch.mock.calls.filter(([url]) => url.startsWith("/api/v1/workforce/simulation"));

beforeEach(async () => {
  await page.viewport(1440, 900);
});
afterEach(() => {
  mounted.splice(0).forEach((root) => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", startUrl);
});

it("추천 공고 0건이면 안내만 하고 선택·결과를 그대로 둔 채 조회하지 않는다", async () => {
  const fetch = stubFetch({ items: [] });
  const host = render({ initialIds: [BID_A, BID_B], initialResult: RESULT });
  await userEvent.click(page.getByRole("button", { name: "추천 공고 불러오기" }));
  await expect
    .element(page.getByRole("alert"))
    .toHaveTextContent("추천 공고가 없습니다. 공고를 직접 고르세요.");
  const selection = host.querySelector('section[aria-label="시뮬레이션 공고 선택"] ul');
  expect(selection?.querySelectorAll("li")).toHaveLength(2);
  await expect.element(page.getByRole("table", { name: /팀별 지원 요청/ })).toBeVisible();
  const [url] = fetch.mock.calls[0]!;
  const query = new URL(url, window.location.origin).searchParams;
  expect(query.get("recommendation")).toBe("BID");
  expect(query.getAll("status")).toEqual(["OPEN", "AMENDED"]);
  expect(query.get("limit")).toBe("3");
  expect(simulationCalls(fetch)).toHaveLength(0);
});

it("추천 공고를 불러오면 선택을 바꾸고 팀별 지원 요청 표를 그린다", async () => {
  const fetch = stubFetch({
    items: [
      { bidId: BID_A, title: "가상 행정 시스템 고도화", isDemo: true, source: "fixture" },
      { bidId: BID_B, title: "가상 민원 포털 구축", isDemo: true, source: "fixture" },
    ],
  });
  const host = render();
  await userEvent.click(page.getByRole("button", { name: "추천 공고 불러오기" }));
  const table = page.getByRole("table", { name: /팀별 지원 요청/ });
  await expect.element(table).toBeVisible();
  const selection = host.querySelector('section[aria-label="시뮬레이션 공고 선택"] ul');
  expect([...(selection?.querySelectorAll("li") ?? [])].map((li) => li.textContent)).toEqual([
    expect.stringContaining("가상 행정 시스템 고도화"),
    expect.stringContaining("가상 민원 포털 구축"),
  ]);
  const element = table.element();
  expect([...element.querySelectorAll("th")].map((th) => th.textContent)).toEqual([
    "팀",
    "가상 행정 시스템 고도화",
    "가상 민원 포털 구축",
  ]);
  const row = [...element.querySelectorAll("tbody tr")].find((tr) =>
    tr.textContent?.startsWith("개발1팀"),
  );
  const cells = [...(row?.querySelectorAll("td") ?? [])].slice(1);
  expect(cells.map((td) => td.textContent)).toEqual([
    expect.stringContaining("한가람"),
    expect.stringContaining("한가람"),
  ]);
  expect(simulationCalls(fetch)[0]?.[0]).toContain(`bidIds=${BID_A}%2C${BID_B}`);
});

it("역할마다 팀은 3개까지 보이고 나머지는 접는다", async () => {
  const teams = ["개발1팀", "개발2팀", "개발3팀", "개발4팀"].map((department, index) => ({
    department,
    people: [{ ...PERSON, personId: `p-${index}` }],
    availableFte: 1,
  }));
  const [first] = RESULT.bids;
  const host = render({
    initialIds: [BID_A],
    initialResult: {
      ...RESULT,
      bids: [
        {
          ...first!,
          roleNeeds: [{ ...first!.roleNeeds[0]!, supplyCount: 4, shortfall: 0, teams }],
        },
      ],
      teamPlan: [],
    },
  });
  const role = page.getByText("개발 · 3명 필요 · 가용 후보 4명", { exact: true });
  await expect.element(role).toBeVisible();
  const item = role.element().closest("li")!;
  const details = item.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("나머지 1개 팀 보기");
  expect(details.textContent).toContain("개발4팀 1명");
  expect(item.textContent?.replace(details.textContent ?? "", "")).not.toContain("개발4팀");
  expect(host.textContent).toContain("개발3팀 1명 · 가용 1 FTE");
});

it("요구조건 없는 공고 열은 사람이 확인하라고 적고, 가용 0 인 사람을 표시한다", async () => {
  const busy = { ...PERSON, personId: "p-busy", name: "윤바쁨", availableFte: 0 };
  render({
    initialIds: [BID_A, BID_B],
    initialResult: {
      ...RESULT,
      bids: [RESULT.bids[0]!, { ...RESULT.bids[1]!, candidateBasisMissing: true }],
      teamPlan: [
        {
          department: "개발1팀",
          personCount: 2,
          cells: [
            { bidId: BID_A, people: [PERSON, busy], roles: ["개발"] },
            { bidId: BID_B, people: [], roles: [] },
          ],
        },
      ],
    },
  });
  const table = page.getByRole("table", { name: /팀별 지원 요청/ });
  await expect.element(table).toBeVisible();
  const headers = [...table.element().querySelectorAll("th")].map((th) => th.textContent);
  expect(headers[2]).toBe("가상 민원 포털 구축요구조건 없음 · 사람이 확인");
  expect(headers[1]).toBe("가상 행정 시스템 고도화");
  expect(table.element().querySelector("tbody td:nth-child(2)")?.textContent).toContain(
    "한가람(개발자·중급), 윤바쁨(개발자·중급·가용 0)",
  );
});

it("팀별 지원 요청 표는 10개 팀만 보이고 버튼으로 나머지를 같은 표에 펼친다", async () => {
  const teamPlan = Array.from({ length: 12 }, (_, index) => ({
    department: `가상${String(index + 1).padStart(2, "0")}팀`,
    personCount: 12 - index,
    cells: [
      { bidId: BID_A, people: [PERSON], roles: ["개발"] },
      { bidId: BID_B, people: [], roles: [] },
    ],
  }));
  render({ initialIds: [BID_A, BID_B], initialResult: { ...RESULT, teamPlan } });
  const table = page.getByRole("table", { name: /팀별 지원 요청/ });
  await expect.element(table).toBeVisible();
  const rows = () =>
    [...table.element().querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td p")?.textContent,
    );
  expect(rows()).toEqual(teamPlan.slice(0, 10).map((row) => row.department));
  const toggle = page.getByRole("button", { name: "나머지 2개 팀 보기" });
  await expect.element(toggle).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(toggle);
  const collapse = page.getByRole("button", { name: "접기" });
  await expect.element(collapse).toHaveAttribute("aria-expanded", "true");
  expect(rows()).toEqual(teamPlan.map((row) => row.department));
  expect(table.element().querySelectorAll("tbody")).toHaveLength(1);
  await userEvent.click(collapse);
  await expect.element(page.getByRole("button", { name: "나머지 2개 팀 보기" })).toBeVisible();
  expect(rows()).toHaveLength(10);
});

it("역할 정보가 없으면 '역할 정보 없음'과 팀 묶음을 보인다", async () => {
  const unassigned = { department: "부서 미지정", people: [PERSON], availableFte: 1 };
  render({
    initialIds: [BID_A],
    initialResult: {
      ...RESULT,
      bids: [
        bid(BID_A, "가상 행정 시스템 고도화", {
          requiredFteSource: "BUDGET_TIER",
          roleNeeds: [],
          teams: [unassigned],
          candidates: [{ ...CANDIDATE, department: null, matchReason: "요구 기술 일치: Java" }],
        }),
      ],
      teamPlan: [
        {
          department: "부서 미지정",
          personCount: 1,
          cells: [{ bidId: BID_A, people: [PERSON], roles: [] }],
        },
      ],
    },
  });
  await expect.element(page.getByText("역할 정보 없음", { exact: true })).toBeVisible();
  await expect.element(page.getByText("필요 인력은 예산 구간 추정입니다.")).toBeVisible();
  await expect.element(page.getByText("부서 미지정 1명 · 가용 1 FTE").first()).toBeVisible();
});

it("계산 기준은 접고 기간 가정·추정·FTE 정의와 최근 실패 경고는 노출한다", async () => {
  const fetch = stubFetch({ items: [] });
  const host = render({
    initialIds: [BID_A],
    initialResult: {
      ...RESULT,
      bids: [
        bid(BID_A, "가상 행정 시스템 고도화", {
          periodSource: "DEFAULT",
          requiredFteSource: "BUDGET_TIER",
          latestAttempt: { id: "new-attempt", status: "FAILED", at: "2026-10-30T00:00:00Z" },
        }),
      ],
      teamPlan: [],
    },
  });
  const details = [...host.querySelectorAll("details")].find(
    (item) => item.querySelector("summary")?.textContent === "계산 기준",
  )!;
  expect(details.open).toBe(false);
  const analysis = page.getByText("분석 aaaaaaaa · 공고 revision 1", { exact: true });
  await expect.element(analysis).not.toBeVisible();
  await expect
    .element(page.getByText(/기본 기간: 마감·기준일의 1개월 뒤 월초부터 6개월/))
    .toBeVisible();
  await expect.element(page.getByText("필요 인력은 예산 구간 추정입니다.")).toBeVisible();
  await expect
    .element(page.getByText("FTE는 상근 환산 인력이며 실제 인원 수와 다릅니다."))
    .toBeVisible();
  await expect.element(page.getByText(/최근 유효 완료 분석을 표시합니다/)).toBeVisible();
  await userEvent.click(details.querySelector("summary")!);
  await expect.element(analysis).toBeVisible();
  await expect.element(page.getByText("계산 기준일 2026-10-16", { exact: true })).toBeVisible();
  expect(fetch).not.toHaveBeenCalled();
});
