import { describe, expect, it, vi } from "vitest";
import type { CompanyProfileRepo } from "./company-profile.repo";
import {
  getCompanyProfile,
  getCompanyStaffing,
  listCompanyProfileRevisions,
} from "./company-profile.service";
import { ORG_ID, PROFILE_ROW, SUMMARY_ROWS } from "./company-profile.test-data";

const repoWith = (over: Partial<CompanyProfileRepo> = {}): CompanyProfileRepo => ({
  latest: vi.fn(async () => PROFILE_ROW),
  revisions: vi.fn(async () => SUMMARY_ROWS),
  staffing: vi.fn(async () => ({ totalCount: 200, scoringCount: 27 })),
  ...over,
});

describe("company-profile service", () => {
  it("화면이 확인한 조직의 최신 프로필을 읽는다", async () => {
    const repo = repoWith();
    const profile = await getCompanyProfile(ORG_ID, repo);
    expect(repo.latest).toHaveBeenCalledWith(ORG_ID);
    expect(profile?.revision).toBe(2);
  });

  it("프로필이 없으면 null 이다", async () => {
    expect(await getCompanyProfile(ORG_ID, repoWith({ latest: async () => null }))).toBeNull();
  });

  it("이력은 저장소 순서(최신부터)를 지키고 요약 모양으로 바꾼다", async () => {
    const repo = repoWith();
    const revisions = await listCompanyProfileRevisions(ORG_ID, repo);
    expect(repo.revisions).toHaveBeenCalledWith(ORG_ID);
    expect(revisions.map((revision) => revision.revision)).toEqual([2, 1]);
  });

  it("인력 요약은 저장소 개수 그대로다", async () => {
    expect(await getCompanyStaffing(ORG_ID, repoWith())).toEqual({
      totalCount: 200,
      scoringCount: 27,
    });
  });

  it("저장소 오류는 그대로 던진다(화면 오류 경계·API 500)", async () => {
    const failure = new Error("company_profiles select failed");
    await expect(
      getCompanyProfile(
        ORG_ID,
        repoWith({
          latest: async () => {
            throw failure;
          },
        }),
      ),
    ).rejects.toBe(failure);
  });
});
