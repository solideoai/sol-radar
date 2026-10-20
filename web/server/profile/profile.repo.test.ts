import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { profileRepo } from "./profile.repo";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/server/supabase", () => ({
  getSupabase: () => client(),
  getAuthClaims: vi.fn(),
  isSupabaseConfigured: () => true,
}));

describe("탈퇴 거절 오류 매핑", () => {
  it("DB의 last_admin을 계정 삭제 대신 sole-admin 결과로 전달한다", async () => {
    client.mockReturnValue(
      createClient<Database>("https://supabase.example.invalid", "fake-key", {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: async () =>
            new Response(
              JSON.stringify({ code: "P0001", hint: "last_admin", message: "마지막 ADMIN" }),
              { status: 400, headers: { "Content-Type": "application/json" } },
            ),
        },
      }),
    );
    await expect(profileRepo.deleteAccount()).resolves.toBe("sole-admin");
  });
});
