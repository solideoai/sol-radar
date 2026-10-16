import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { page } from "vitest/browser";
const { accept, push } = vi.hoisted(() => ({ accept: vi.fn(), push: vi.fn() }));
vi.mock("./actions", () => ({ accept, decline: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
import { InvitationList } from "./invitation-list";
it("successful invitation cannot authorize result.slug navigation", async () => {
  accept.mockResolvedValue({ status: "accepted", slug: "forged-or-second-company" });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    root.render(
      <InvitationList
        email="user@example.test"
        invitations={[
          {
            id: "invitation",
            email: "user@example.test",
            orgName: "초대 조직",
            orgSlug: "claimed",
            role: "member",
            roleLabel: "멤버",
            expiresAt: "2099-01-01T00:00:00Z",
            expiresAtText: "2099. 1. 1.",
            isExpired: false,
          },
        ]}
      />,
    );
    await page.getByRole("button", { name: "수락 초대 조직 초대", exact: true }).click();
    expect(accept).toHaveBeenCalledWith("invitation");
    expect(push).toHaveBeenCalledExactlyOnceWith("/dashboard");
  } finally {
    root.unmount();
    host.remove();
  }
});
