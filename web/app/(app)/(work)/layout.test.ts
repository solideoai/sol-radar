import { beforeEach, expect, it, vi } from "vitest";

// M3: 업무 틀(layout)은 화면을 그릴 때마다 돈다. 상단바에 필요한 것(수집 신선도·안 읽은 수)만 가볍게 읽고,
// 대시보드 전체 집계와 AI 프로브(최대 2초)는 기다리지 않는다. AI 상태는 TopbarStatus 가 마운트 때 읽는다.

const { aiProbe, supabase, client, targets, business, workspace, profile } = vi.hoisted(() => {
  const targets: string[] = [];
  // 어느 체인에서 await 해도 빈 응답(안 읽은 수 2)을 주는 Supabase 가짜. 부른 표·함수 이름만 남긴다.
  const chain = (): object =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (value: unknown) => unknown) =>
              resolve({ data: [], error: null, count: 2 });
          }
          return () => chain();
        },
      },
    );
  const client = {
    from: (table: string) => {
      targets.push(table);
      return chain();
    },
    rpc: (name: string) => {
      targets.push(`rpc:${name}`);
      return chain();
    },
  };
  return {
    aiProbe: vi.fn(async () => "mock"),
    supabase: vi.fn(),
    client,
    targets,
    business: vi.fn(),
    workspace: vi.fn(),
    profile: vi.fn(),
  };
});

vi.mock("@/server/supabase", () => ({ getSupabase: supabase }));
vi.mock("@/server/health", () => ({ getAiState: aiProbe }));
vi.mock("@/server/organization", () => ({
  getMyBusinessAccess: business,
  getMyWorkspace: workspace,
}));
vi.mock("@/server/profile", () => ({ getMyProfile: profile }));
vi.mock("@/components/app-shell", () => ({ AppShell: () => null }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import WorkLayout from "./layout";

const current = { id: "org-1", slug: "solideo", name: "솔리데오", myRole: "member" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SOL_RUN_MODE", "mock");
  targets.splice(0);
  supabase.mockResolvedValue(client);
  business.mockResolvedValue({
    status: "ready",
    userId: "u1",
    current: { ...current, solRole: "SALES" },
  });
  workspace.mockResolvedValue({
    status: "ready",
    userId: "u1",
    current,
    orgs: [],
    pendingInvitationCount: 0,
  });
  profile.mockResolvedValue({
    status: "ready",
    profile: { displayName: "가상직원", email: "a@example.test", avatarUrl: null, isAdmin: false },
  });
});

it("상단바 값만 읽고 AI 프로브와 공고 전체 집계를 부르지 않는다", async () => {
  await WorkLayout({ children: null });
  expect(aiProbe).not.toHaveBeenCalled();
  expect(targets).not.toContain("bid_notices");
  expect([...targets].sort()).toEqual(["notifications", "rpc:latest_ingest_run"]);
});

it("상단바 값을 못 읽어도 셸은 그리고 원인을 한 줄 로그로 남긴다", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  supabase.mockRejectedValueOnce(new Error("db down"));
  const element = await WorkLayout({ children: null });
  expect(element.props.status.initialSummary).toBeNull();
  expect(logged).toHaveBeenCalledTimes(1);
  expect(String(logged.mock.calls[0]?.[0])).toContain("work_status_failed");
  logged.mockRestore();
});
