import { describe, expect, it } from "vitest";
import { parseCollapsedGroups, revealGroup, toggleGroup } from "./sidebar-groups";

describe("parseCollapsedGroups", () => {
  it.each([
    [null, []],
    ['["work","system"]', ["work", "system"]],
    ['["work",1,null,"system"]', ["work", "system"]],
    ['{"work":true}', []],
    ["not json", []],
  ])("%s → %j", (raw, expected) => {
    expect(parseCollapsedGroups(raw)).toEqual(expected);
  });
});

describe("toggleGroup", () => {
  it("adds a missing group and removes a present one without touching the input", () => {
    const collapsed = ["work"];
    expect(toggleGroup(collapsed, "system")).toEqual(["work", "system"]);
    expect(toggleGroup(collapsed, "work")).toEqual([]);
    expect(collapsed).toEqual(["work"]);
  });
});

describe("revealGroup", () => {
  it("removes the current group when it is collapsed", () => {
    expect(revealGroup(["work", "system"], "work")).toEqual(["system"]);
  });

  it("returns the same array when nothing changes", () => {
    const collapsed = ["system"];
    expect(revealGroup(collapsed, "work")).toBe(collapsed);
    expect(revealGroup(collapsed, null)).toBe(collapsed);
  });
});
