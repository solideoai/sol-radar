import "server-only";
import { expect, it, vi } from "vitest";
import {
  changeMySolRole,
  changeOrgMemberSolRole,
  type OrgSettingsDeps,
} from "./org-settings.service";
import { orgSettingsRepo } from "./org-settings.repo";

const org = {
  id: "org-1",
  name: "기관",
  slug: "org",
  isPersonal: false,
  myRole: "member" as const,
  isDemo: false,
};
it("denies non-ADMIN writes and derives self-demotion identity from authenticated access", async () => {
  const update = vi.fn(async () => "saved" as const);
  const deps: OrgSettingsDeps = {
    repo: { ...orgSettingsRepo, updateSolRole: update },
    access: async () => ({
      status: "ready",
      userId: "00000000-0000-4000-8000-000000000001",
      current: { ...org, solRole: "VIEWER" },
    }),
    mailer: { isConfigured: () => false, send: async () => "not-configured" },
  };
  expect(
    await changeOrgMemberSolRole("00000000-0000-4000-8000-000000000002", "SALES", deps),
  ).toEqual({ status: "forbidden" });
  expect(update).not.toHaveBeenCalled();
  deps.access = async () => ({
    status: "ready",
    userId: "00000000-0000-4000-8000-000000000001",
    current: { ...org, solRole: "ADMIN" },
  });
  expect(await changeMySolRole("SALES", deps)).toEqual({ status: "saved" });
  expect(update).toHaveBeenCalledWith("org-1", "00000000-0000-4000-8000-000000000001", "SALES");
});
