import { describe, expect, it } from "vitest";
import { peopleHref, peopleListParams, peopleSearchParams } from "./people-query";

describe("people URL state", () => {
  it("preserves duplicate inputs for strict service validation but strips UI view", () => {
    const params = peopleSearchParams({ view: "tree", q: ["김", "이"], orgId: "foreign" });
    expect(peopleListParams(params).getAll("q")).toEqual(["김", "이"]);
    expect(peopleListParams(params).has("view")).toBe(false);
    expect(peopleListParams(params).get("orgId")).toBe("foreign");
    expect(peopleListParams(params).get("limit")).toBe("20");
  });
  it("paging ignores legacy view while retaining opaque cursor and every filter", () => {
    const query = "q=김&scoring=1&departmentId=team&jobTitleId=title&cursor=opaque%2Btoken";
    const url = new URL(
      peopleHref(`view=tree&${query}`, { cursor: "opaque+token" }),
      "http://local",
    );
    expect(url.pathname).toBe("/people");
    expect(url.searchParams.get("cursor")).toBe("opaque+token");
    expect(url.searchParams.get("departmentId")).toBe("team");
    expect(url.searchParams.get("scoring")).toBe("1");
    expect(url.searchParams.has("view")).toBe(false);
  });
  it("page two previous removes null cursor while retaining filters", () => {
    const url = new URL(peopleHref("q=김&cursor=page2", { cursor: null }), "http://local");
    expect(url.searchParams.has("cursor")).toBe(false);
    expect(url.searchParams.get("q")).toBe("김");
  });
});
