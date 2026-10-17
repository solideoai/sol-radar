import { describe, expect, it } from "vitest";
import { getSignupOptions } from "./profile.catalog";

describe("signup options catalog", () => {
  it("public projection has only approved keys and exact counts", () => {
    const options = getSignupOptions();
    expect(Object.keys(options).sort()).toEqual([
      "catalogVersion",
      "companyName",
      "departments",
      "jobTitles",
    ]);
    expect(options).toMatchObject({
      companyName: "솔리데오",
      catalogVersion: "solideo-organization/v1.0",
    });
    expect(options.departments).toHaveLength(38);
    expect(options.jobTitles).toHaveLength(12);
    for (const option of [...options.departments, ...options.jobTitles]) {
      expect(Object.keys(option).sort()).toEqual(["id", "label"]);
    }
    options.departments.pop();
    expect(getSignupOptions().departments).toHaveLength(38);
  });
});
