import { describe, expect, it } from "vitest";
import {
  currentNavGroupId,
  isCurrentItem,
  NAV_GROUPS,
  ORG_CHART_ITEM,
  screenLabelOf,
  visibleNavGroups,
} from "./app-nav";

const labelsOf = (role: Parameters<typeof visibleNavGroups>[0]) =>
  visibleNavGroups(role).map((group) => [group.label, group.items.map((item) => item.label)]);

describe("NAV_GROUPS", () => {
  it("follows the ADR-021 group order, paths and lucide icons of 06 §4.1", () => {
    expect(
      NAV_GROUPS.map((group) => [
        group.label,
        group.items.map((item) => [item.href, item.icon.displayName, item.status]),
      ]),
    ).toEqual([
      [
        "업무",
        [
          ["/dashboard", "LayoutDashboard", "released"],
          ["/bids", "FileText", "released"],
          ["/watchlist", "Star", "released"],
          ["/notifications", "Bell", "released"],
        ],
      ],
      [
        "AI 분석",
        [
          ["/analysis", "GitCompareArrows", "planned"],
          ["/workforce", "UsersRound", "planned"],
        ],
      ],
      ["입찰 관리", [["/projects", "FolderKanban", "planned"]]],
      [
        "조직",
        [
          ["/company", "Award", "released"],
          ["/people", "Users", "released"],
        ],
      ],
      [
        "시스템",
        [
          ["/settings", "Settings", "released"],
          ["/admin/ingestion", "Database", "released"],
        ],
      ],
    ]);
    expect([ORG_CHART_ITEM.href, ORG_CHART_ITEM.icon.displayName]).toEqual([
      "/org-chart",
      "Network",
    ]);
  });

  it("does not list post-hackathon screens (D5)", () => {
    const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs).not.toContain("/intelligence");
    expect(hrefs).not.toContain("/calendar");
  });
});

describe("visibleNavGroups", () => {
  it("shows data ingestion only to ADMIN", () => {
    expect(labelsOf("ADMIN").at(-1)).toEqual(["시스템", ["설정", "데이터 수집 관리"]]);
    for (const role of ["VIEWER", "ANALYST", "SALES", null] as const) {
      expect(labelsOf(role).at(-1)).toEqual(["시스템", ["설정"]]);
    }
  });

  it("keeps every group for every role", () => {
    expect(visibleNavGroups("VIEWER").map((group) => group.id)).toEqual([
      "work",
      "analysis",
      "bid-management",
      "organization",
      "system",
    ]);
  });
});

describe("isCurrentItem", () => {
  const items = NAV_GROUPS.flatMap((group) => group.items);
  const bids = items.find((item) => item.href === "/bids") ?? ORG_CHART_ITEM;
  const settings = items.find((item) => item.href === "/settings") ?? ORG_CHART_ITEM;

  it("matches the path and its sub paths only", () => {
    expect(isCurrentItem("/bids", bids, "solideo")).toBe(true);
    expect(isCurrentItem("/bids/abc", bids, "solideo")).toBe(true);
    expect(isCurrentItem("/bidsx", bids, "solideo")).toBe(false);
  });

  it("treats the template settings path of the current org as settings", () => {
    expect(isCurrentItem("/settings", settings, "solideo")).toBe(true);
    expect(isCurrentItem("/solideo/settings", settings, "solideo")).toBe(true);
    expect(isCurrentItem("/solideo/settings/members", settings, "solideo")).toBe(true);
    expect(isCurrentItem("/other/settings", settings, "solideo")).toBe(false);
    expect(isCurrentItem("/solideo/tasks", settings, "solideo")).toBe(false);
  });
});

describe("currentNavGroupId", () => {
  const groups = visibleNavGroups("ADMIN");

  it.each([
    ["/dashboard", "work"],
    ["/bids/x", "work"],
    ["/company", "organization"],
    ["/people", "organization"],
    ["/admin/ingestion", "system"],
    ["/solideo/settings", "system"],
    ["/org-chart", null],
    ["/watchlist", "work"],
  ])("%s belongs to %s", (pathname, id) => {
    expect(currentNavGroupId(groups, pathname, "solideo")).toBe(id);
  });
});

describe("screenLabelOf", () => {
  it.each([
    ["/dashboard", "대시보드"],
    ["/bids/x", "입찰 공고"],
    ["/admin/ingestion", "데이터 수집 관리"],
    ["/company", "회사 역량"],
    ["/org-chart", "조직도"],
    ["/solideo/settings", "설정"],
    ["/solideo/tasks", "작업"],
    ["/solideo/dashboard", "대시보드"],
    ["/watchlist", "관심 공고"],
    ["/unknown", null],
  ])("%s → %s", (pathname, label) => {
    expect(screenLabelOf(pathname, "solideo")).toBe(label);
  });
});
