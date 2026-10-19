import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { organizationRepo } from "./organization.repo";

const { client } = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/server/supabase", () => ({
  getSupabase: () => client(),
  getAuthClaims: vi.fn(),
  isSupabaseConfigured: () => true,
}));

describe("조직의 마지막 ADMIN 오류 매핑", () => {
  it("DB가 멤버 삭제를 막으면 last-admin으로 전달한다", async () => {
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
    await expect(
      organizationRepo.deleteMembership(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ),
    ).resolves.toBe("last-admin");
  });
});
