import "server-only";
import { describe, expect, it, vi } from "vitest";
import type { JoinRequestRepo } from "./join-request.repo";
import {
  decideOrgJoinRequest,
  type JoinRequestDeps,
  submitMyJoinRequest,
} from "./join-request.service";

const me = "00000000-0000-4000-8000-000000000001";
const request = "1e000000-0000-4000-8000-000000000001";
const member = "5e000000-0000-4000-8000-000000000001";
const org = {
  id: "db4c863c-cb6a-593d-93ff-709a17e0157a",
  name: "솔리데오",
  slug: "org-01",
  isPersonal: false,
  myRole: "owner" as const,
  isDemo: true,
};

const fakeRepo = (overrides: Partial<JoinRequestRepo> = {}): JoinRequestRepo => ({
  isConfigured: () => true,
  currentUserId: vi.fn(async () => me),
  myLatestRequest: vi.fn(async () => null),
  submit: vi.fn(async () => ({ id: request, error: null })),
  findUnlinked: vi.fn(async () => ({ rows: [], error: null })),
  listPending: vi.fn(async () => []),
  decide: vi.fn(async () => ({ result: "APPROVED", error: null })),
  ...overrides,
});

const depsAs = (solRole: "ADMIN" | "VIEWER", repo: JoinRequestRepo): JoinRequestDeps => ({
  repo,
  access: async () => ({ status: "ready", userId: me, current: { ...org, solRole } }),
});

describe("decideOrgJoinRequest", () => {
  it("ADMIN 이 아니면 DB 를 부르지 않고 forbidden 이다", async () => {
    const repo = fakeRepo();
    expect(
      await decideOrgJoinRequest({ requestId: request, approve: true }, depsAs("VIEWER", repo)),
    ).toEqual({ status: "forbidden" });
    expect(repo.decide).not.toHaveBeenCalled();
  });
  it("DB 의 member_taken 은 member-taken, request_not_pending 은 already-decided 다", async () => {
    const taken = fakeRepo({
      decide: vi.fn(async () => ({ result: null, error: { code: "P0001", hint: "member_taken" } })),
    });
    expect(
      await decideOrgJoinRequest({ requestId: request, approve: true }, depsAs("ADMIN", taken)),
    ).toEqual({ status: "member-taken" });
    const decided = fakeRepo({
      decide: vi.fn(async () => ({
        result: null,
        error: { code: "P0001", hint: "request_not_pending" },
      })),
    });
    expect(
      await decideOrgJoinRequest({ requestId: request, approve: false }, depsAs("ADMIN", decided)),
    ).toEqual({ status: "already-decided" });
    // N4b(a2) 의 퇴사 직원 연결 거절 트리거(member_left)는 승인 표에서 따로 안내한다.
    const left = fakeRepo({
      decide: vi.fn(async () => ({ result: null, error: { code: "P0001", hint: "member_left" } })),
    });
    expect(
      await decideOrgJoinRequest({ requestId: request, approve: true }, depsAs("ADMIN", left)),
    ).toEqual({ status: "member-left" });
  });
  it("uuid 가 아닌 신청 id 는 invalid 이고, 업무 역할을 고르지 않으면 VIEWER 로 승인한다", async () => {
    const repo = fakeRepo();
    expect(
      await decideOrgJoinRequest({ requestId: "x", approve: true }, depsAs("ADMIN", repo)),
    ).toEqual({ status: "invalid" });
    expect(repo.decide).not.toHaveBeenCalled();
    expect(
      await decideOrgJoinRequest({ requestId: request, approve: true }, depsAs("ADMIN", repo)),
    ).toEqual({ status: "approved" });
    expect(repo.decide).toHaveBeenCalledWith(request, true, "VIEWER");
  });
});

describe("submitMyJoinRequest", () => {
  it("기존 직원 신청에 직원 id 가 없으면 invalid 이고, 퇴사한 직원(member_left)은 invalid-member 다", async () => {
    const repo = fakeRepo();
    expect(await submitMyJoinRequest({ kind: "EXISTING" }, repo)).toEqual({ status: "invalid" });
    expect(repo.submit).not.toHaveBeenCalled();
    const left = fakeRepo({
      submit: vi.fn(async () => ({ id: null, error: { code: "P0001", hint: "member_left" } })),
    });
    expect(
      await submitMyJoinRequest({ kind: "EXISTING", teamMemberId: member, name: "김민준" }, left),
    ).toEqual({ status: "invalid-member" });
    expect(await submitMyJoinRequest({ kind: "NEW_HIRE" }, repo)).toEqual({
      status: "submitted",
    });
    expect(repo.submit).toHaveBeenCalledWith({ kind: "NEW_HIRE" });
  });
});
